'use strict';
// Pagamentos: registro (pedido vira PAGO), validação, regras de status, listagem por pedido, concorrência e rollback.
const L = require('./_lib.cjs');
const t = L.suite('pagamento');

const CHAVES = ['criadoEm', 'formaPagamento', 'id', 'identificadorExterno', 'pedido', 'pedidoId', 'statusPagamento', 'valor'];

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  // Produto com estoque farto: os pedidos criados pela API (como no uso real) não esgotam o saldo.
  const prod = await t.produto({ preco: '10.00', qtd: 100000 });
  // Pedido ABERTO de total `preco*qtd` criado pela API (como no uso real).
  // Cria um pedido ABERTO pela API; o total é preço (10,00) × quantidade.
  const novoPedido = async (qtd = 1, token = adm.token) => t.sucesso(await t.http('POST', '/pedidos', { token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: prod.id, quantidade: qtd }] } }), 201);
  // Atalho para POST /pagamentos.
  const pagar = (body, token = adm.token) => t.http('POST', '/pagamentos', { token, body });
  const status = async (id) => (await t.prisma.pedido.findUnique({ where: { id } })).status;

  // ---------------------------------------------------------------- caminho feliz
  // Pedido e pagamento base do caminho feliz, reaproveitados nos testes de listagem e nas divergências.
  let pedido;
  let pg;
  await t.caso('POST /pagamentos (201): aprova o pagamento e o pedido vira PAGO', async () => {
    pedido = await novoPedido(2);
    pg = t.sucesso(await pagar({ pedidoId: pedido.id, formaPagamento: 'PIX', valor: pedido.total }), 201);
    t.eq(Object.keys(pg).sort(), CHAVES);
    t.eq([pg.pedidoId, pg.formaPagamento, pg.statusPagamento, pg.valor, pg.identificadorExterno], [pedido.id, 'PIX', 'APROVADO', 20, null]);
    t.eq(pg.pedido, { id: pedido.id, status: 'PAGO', total: 20 });
    t.eq(new Date(pg.criadoEm).toISOString(), pg.criadoEm);
    t.eq(await status(pedido.id), 'PAGO');
  });
  await t.caso('o pagamento fica gravado uma única vez, com valor Decimal exato', async () => {
    const rows = await t.prisma.pagamento.findMany({ where: { pedidoId: pedido.id } });
    t.eq(rows.length, 1);
    t.eq([rows[0].valor.toString(), rows[0].statusPagamento], ['20', 'APROVADO']);
  });
  await t.caso('pagar não mexe no estoque (a baixa já foi feita na criação do pedido)', async () => {
    const p = await t.produto({ qtd: 10, preco: '5.00' });
    const r = t.sucesso(await t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: p.id, quantidade: 3 }] } }), 201);
    const antes = await t.contarMov(p.id);
    t.sucesso(await pagar({ pedidoId: r.id, formaPagamento: 'DINHEIRO', valor: 15 }), 201);
    t.eq([(await t.saldo(p.id)).quantidadeFisica, await t.contarMov(p.id)], [7, antes]);
  });
  await t.caso('GET /pedidos/:id passa a trazer o pagamento e status PAGO', async () => {
    const g = t.sucesso(await t.http('GET', `/pedidos/${pedido.id}`, { token: adm.token }));
    t.eq(g.status, 'PAGO');
    t.eq(g.pagamentos.length, 1);
    t.eq([g.pagamentos[0].id, g.pagamentos[0].statusPagamento, g.pagamentos[0].valor], [pg.id, 'APROVADO', 20]);
  });
  // A forma de pagamento aceita qualquer capitalização e espaços; o mapper devolve o enum.
  for (const [entrada, saida] of [['pix', 'PIX'], [' Cartao ', 'CARTAO'], ['CARTAO', 'CARTAO'], ['dinheiro', 'DINHEIRO'], ['Dinheiro', 'DINHEIRO']]) {
    await t.caso(`formaPagamento '${entrada}' é aceita e vira ${saida}`, async () => {
      const p = await novoPedido();
      t.eq(t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: entrada, valor: 10 }), 201).formaPagamento, saida);
    });
  }
  await t.caso('campos extras do corpo (statusPagamento, identificadorExterno, pedido.status) são ignorados', async () => {
    const p = await novoPedido();
    const r = t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10, statusPagamento: 'RECUSADO', identificadorExterno: 'abc', status: 'CANCELADO' }), 201);
    t.eq([r.statusPagamento, r.identificadorExterno], ['APROVADO', null]);
  });
  await t.caso('pedidoId pode ser enviado como texto numérico ("12")', async () => {
    const p = await novoPedido();
    t.sucesso(await pagar({ pedidoId: String(p.id), formaPagamento: 'PIX', valor: 10 }), 201);
  });
  await t.caso('valor 0.1+0.2 (ponto flutuante) paga um pedido de R$ 0,30', async () => {
    const barato = await t.produto({ preco: '0.30', qtd: 5 });
    const p = t.sucesso(await t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: barato.id, quantidade: 1 }] } }), 201);
    t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 0.1 + 0.2 }), 201);
  });

  // ---------------------------------------------------------------- validação
  // Pedido alvo da matriz de validação: nenhum caso inválido pode gravar pagamento nem mudar o status.
  const alvo = await novoPedido();
  // Contagem de pagamentos antes da matriz, para provar que as validações não gravam nada.
  const antes = await t.prisma.pagamento.count();
  // Matriz de entradas inválidas: pedidoId, formaPagamento e valor (inclusive valor diferente do total do pedido).
  for (const [rotulo, body, campo] of [
    ['pedidoId ausente', { formaPagamento: 'PIX', valor: 10 }, 'pedidoId'], ['pedidoId texto', { pedidoId: 'abc', formaPagamento: 'PIX', valor: 10 }, 'pedidoId'],
    ['pedidoId zero', { pedidoId: 0, formaPagamento: 'PIX', valor: 10 }, 'pedidoId'], ['pedidoId negativo', { pedidoId: -1, formaPagamento: 'PIX', valor: 10 }, 'pedidoId'],
    ['pedidoId fracionário', { pedidoId: 1.5, formaPagamento: 'PIX', valor: 10 }, 'pedidoId'],
    ['forma ausente', { pedidoId: alvo.id, valor: 10 }, 'formaPagamento'], ['forma vazia', { pedidoId: alvo.id, formaPagamento: '', valor: 10 }, 'formaPagamento'],
    ['forma BOLETO', { pedidoId: alvo.id, formaPagamento: 'BOLETO', valor: 10 }, 'formaPagamento'], ['forma numérica', { pedidoId: alvo.id, formaPagamento: 1, valor: 10 }, 'formaPagamento'],
    ['forma DEBITO', { pedidoId: alvo.id, formaPagamento: 'DEBITO', valor: 10 }, 'formaPagamento'], ['forma CREDITO', { pedidoId: alvo.id, formaPagamento: 'CREDITO', valor: 10 }, 'formaPagamento'],
    ['valor ausente', { pedidoId: alvo.id, formaPagamento: 'PIX' }, 'valor'], ['valor texto "10"', { pedidoId: alvo.id, formaPagamento: 'PIX', valor: '10' }, 'valor'],
    ['valor zero', { pedidoId: alvo.id, formaPagamento: 'PIX', valor: 0 }, 'valor'], ['valor negativo', { pedidoId: alvo.id, formaPagamento: 'PIX', valor: -10 }, 'valor'],
    ['valor com 3 casas', { pedidoId: alvo.id, formaPagamento: 'PIX', valor: 10.005 }, 'valor'], ['valor nulo', { pedidoId: alvo.id, formaPagamento: 'PIX', valor: null }, 'valor'],
    ['valor menor que o total', { pedidoId: alvo.id, formaPagamento: 'PIX', valor: 9.99 }, 'valor'],
    ['valor maior que o total', { pedidoId: alvo.id, formaPagamento: 'PIX', valor: 10.01 }, 'valor'],
    ['valor 1 centavo', { pedidoId: alvo.id, formaPagamento: 'PIX', valor: 0.01 }, 'valor'],
  ]) {
    await t.caso(`${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await pagar(body), 400, { campo });
    });
  }
  await t.caso('mensagem de valor errado informa o valor enviado e o total do pedido', async () => {
    L.erro(await pagar({ pedidoId: alvo.id, formaPagamento: 'PIX', valor: 9 }), 400, { campo: 'valor', mensagem: 'O valor (9) deve ser igual ao total do pedido (10).' });
  });
  await t.caso('pedido inexistente → 400 (não 404) campo=pedidoId "Pedido não encontrado."', async () => {
    L.erro(await pagar({ pedidoId: 2000000000, formaPagamento: 'PIX', valor: 10 }), 400, { campo: 'pedidoId', mensagem: 'Pedido não encontrado.' });
  });
  await t.caso('nenhuma das validações acima gravou pagamento nem mudou o pedido', async () => {
    t.eq(await t.prisma.pagamento.count(), antes);
    t.eq(await status(alvo.id), 'ABERTO');
  });
  await t.caso('sem token → 401; JSON malformado → 400; corpo vazio → 400 campo=pedidoId', async () => {
    L.erro(await t.http('POST', '/pagamentos', { body: { pedidoId: alvo.id, formaPagamento: 'PIX', valor: 10 } }), 401);
    L.erro(await t.http('POST', '/pagamentos', { token: adm.token, rawBody: '{' }), 400, { contem: 'JSON' });
    L.erro(await t.http('POST', '/pagamentos', { token: adm.token }), 400, { campo: 'pedidoId' });
  });

  // ---------------------------------------------------------------- regras de status do pedido
  // Só pedidos ABERTO, ENVIADO_AO_CAIXA e AGUARDANDO_PAGAMENTO recebem pagamento; os demais estados têm mensagens próprias.
  await t.caso('pedido já PAGO não aceita novo pagamento → 400 "já está pago" e continua com 1 pagamento', async () => {
    L.erro(await pagar({ pedidoId: pedido.id, formaPagamento: 'PIX', valor: 20 }), 400, { campo: 'pedidoId', mensagem: 'Este pedido já está pago.' });
    t.eq(await t.prisma.pagamento.count({ where: { pedidoId: pedido.id } }), 1);
  });
  for (const [st, esperado] of [['CANCELADO', 'Pedido cancelado não pode receber pagamento.'], ['ESTORNADO', 'Pedido estornado não pode receber pagamento.']]) {
    await t.caso(`pedido ${st} → 400 "${esperado}"`, async () => {
      const p = await novoPedido();
      await t.prisma.pedido.update({ where: { id: p.id }, data: { status: st } });
      L.erro(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10 }), 400, { campo: 'pedidoId', mensagem: esperado });
      t.eq(await status(p.id), st);
    });
  }
  for (const st of ['RECEBIDO_PELA_CANTINA', 'EM_SEPARACAO', 'PRONTO_PARA_RETIRADA', 'ENTREGUE', 'RETIRADO']) {
    await t.caso(`pedido ${st} → 400 "já foi pago e está em andamento"`, async () => {
      const p = await novoPedido();
      await t.prisma.pedido.update({ where: { id: p.id }, data: { status: st } });
      L.erro(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10 }), 400, { campo: 'pedidoId', contem: `status ${st}` });
    });
  }
  for (const st of ['ABERTO', 'ENVIADO_AO_CAIXA', 'AGUARDANDO_PAGAMENTO']) {
    await t.caso(`pedido ${st} é pagável → 201 e vira PAGO`, async () => {
      const p = await novoPedido();
      await t.prisma.pedido.update({ where: { id: p.id }, data: { status: st } });
      t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10 }), 201);
      t.eq(await status(p.id), 'PAGO');
    });
  }

  // ---------------------------------------------------------------- listar por pedido
  await t.caso('GET /pagamentos/pedido/:id lista os pagamentos do pedido no formato do mapper', async () => {
    const r = t.sucesso(await t.http('GET', `/pagamentos/pedido/${pedido.id}`, { token: adm.token }));
    t.eq(r.length, 1);
    t.eq(Object.keys(r[0]).sort(), CHAVES.filter((k) => k !== 'pedido'));
    t.eq([r[0].id, r[0].pedidoId, r[0].valor], [pg.id, pedido.id, 20]);
  });
  await t.caso('pedido sem pagamentos → []', async () => {
    const p = await novoPedido();
    t.eq(t.sucesso(await t.http('GET', `/pagamentos/pedido/${p.id}`, { token: adm.token })), []);
  });
  await t.caso('pedido inexistente → 404; id inválido → 400 campo=pedidoId; sem token → 401', async () => {
    L.erro(await t.http('GET', '/pagamentos/pedido/2000000000', { token: adm.token }), 404, { mensagem: 'Pedido não encontrado.' });
    for (const id of ['abc', '0', '-1', '1.5']) L.erro(await t.http('GET', `/pagamentos/pedido/${id}`, { token: adm.token }), 400, { campo: 'pedidoId' });
    L.erro(await t.http('GET', `/pagamentos/pedido/${pedido.id}`), 401);
  });
  // Pagamentos RECUSADO/EXPIRADO são inseridos direto no banco (a API ainda não gera esses estados — veja D10).
  await t.caso('lista vários pagamentos em ordem de id (inseridos direto no banco)', async () => {
    const p = await novoPedido();
    for (const st of ['RECUSADO', 'EXPIRADO']) await t.prisma.pagamento.create({ data: { pedidoId: p.id, formaPagamento: 'PIX', statusPagamento: st, valor: '10.00' } });
    const r = t.sucesso(await t.http('GET', `/pagamentos/pedido/${p.id}`, { token: adm.token }));
    t.eq(r.map((x) => x.statusPagamento), ['RECUSADO', 'EXPIRADO']);
    t.verdade(r[0].id < r[1].id);
  });
  await t.caso('tentativa RECUSADA anterior não impede o pagamento aprovado depois (o pedido segue ABERTO)', async () => {
    const p = await novoPedido();
    await t.prisma.pagamento.create({ data: { pedidoId: p.id, formaPagamento: 'CARTAO', statusPagamento: 'RECUSADO', valor: '10.00' } });
    t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10 }), 201);
    t.eq(await t.prisma.pagamento.count({ where: { pedidoId: p.id } }), 2);
  });
  await t.caso('não existe GET/DELETE/PATCH de pagamento por id (404 de rota): não há estorno', async () => {
    L.erro(await t.http('GET', `/pagamentos/${pg.id}`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
    L.erro(await t.http('DELETE', `/pagamentos/${pg.id}`, { token: adm.token }), 404);
    L.erro(await t.http('PATCH', `/pagamentos/${pg.id}`, { token: adm.token, body: {} }), 404);
  });
  await t.caso('caixa e atendente conseguem registrar pagamento', async () => {
    const a = await novoPedido(1, cx.token);
    t.sucesso(await pagar({ pedidoId: a.id, formaPagamento: 'DINHEIRO', valor: 10 }, cx.token), 201);
    const b = await novoPedido(1, at.token);
    t.sucesso(await pagar({ pedidoId: b.id, formaPagamento: 'PIX', valor: 10 }, at.token), 201);
  });
  // Lacuna conhecida: qualquer perfil paga o pedido de qualquer usuário e lista pagamentos de qualquer pedido.
  await t.lacuna('qualquer perfil paga o pedido de OUTRO usuário (atendente paga pedido criado pelo administrador)', async () => {
    const p = await novoPedido(1, adm.token);
    t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10 }, at.token), 201);
  });
  await t.lacuna('qualquer perfil lista os pagamentos de qualquer pedido (200)', async () => {
    t.sucesso(await t.http('GET', `/pagamentos/pedido/${pedido.id}`, { token: at.token }));
  });

  // ---------------------------------------------------------------- concorrência
  // Concorrência: o updateMany condicional no status do pedido deixa passar um único pagamento por pedido.
  await t.caso('12 pagamentos simultâneos do MESMO pedido: exatamente 1 vence e só existe 1 pagamento', async () => {
    const p = await novoPedido();
    const rs = await t.paralelo(12, (i) => pagar({ pedidoId: p.id, formaPagamento: ['PIX', 'CARTAO', 'DINHEIRO'][i % 3], valor: 10 }));
    t.eq(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join());
    for (const r of rs.filter((x) => x.status !== 201)) t.verdade([400, 409].includes(r.status), `status ${r.status}: ${r.texto}`);
    t.eq(await t.prisma.pagamento.count({ where: { pedidoId: p.id } }), 1);
    t.eq(await status(p.id), 'PAGO');
  });
  await t.caso('repetir a corrida 5 vezes nunca gera dois pagamentos', async () => {
    for (let r = 0; r < 5; r++) {
      const p = await novoPedido();
      await t.paralelo(6, () => pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10 }));
      t.eq(await t.prisma.pagamento.count({ where: { pedidoId: p.id } }), 1);
    }
  });
  await t.caso('pagamentos simultâneos de 10 pedidos diferentes: todos 201', async () => {
    const ps = [];
    for (let i = 0; i < 10; i++) ps.push(await novoPedido());
    const rs = await t.paralelo(10, (i) => pagar({ pedidoId: ps[i].id, formaPagamento: 'PIX', valor: 10 }));
    t.verdade(rs.every((r) => r.status === 201), rs.map((r) => r.status).join());
  });
  await t.caso('pagamento com valor errado e pagamento certo simultâneos: só o certo vale', async () => {
    const p = await novoPedido();
    const rs = await t.paralelo(6, (i) => pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: i % 2 ? 10 : 11 }));
    t.eq(rs.filter((r) => r.status === 201).length, 1);
    t.eq((await t.prisma.pagamento.findMany({ where: { pedidoId: p.id } }))[0].valor.toString(), '10');
  });

  // ---------------------------------------------------------------- rollback
  await t.caso('ROLLBACK: se a criação do pagamento falha, o pedido volta a ABERTO e nada é gravado', async () => {
    const caro = await t.produto({ preco: '13.13', qtd: 5 });
    const p = t.sucesso(await t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: caro.id, quantidade: 1 }] } }), 201);
    // Rollback: constraint temporária faz falhar a criação do pagamento depois que o pedido já foi movido para PAGO na transação; o status tem de voltar a ABERTO.
    await t.comConstraint('pagamentos', 'chk_tc_pag', `valor <> 13.13`, async () => {
      t.eq((await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 13.13 })).status, 500);
    });
    t.eq(await status(p.id), 'ABERTO');
    t.eq(await t.prisma.pagamento.count({ where: { pedidoId: p.id } }), 0);
    t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 13.13 }), 201); // sem a constraint, paga
    t.eq(await status(p.id), 'PAGO');
  });

  // ---------------------------------------------------------------- divergências
  // [DIVERGE-PDF] D9 — PDF: Pix, débito, crédito ou dinheiro; a API só tem PIX, CARTAO e DINHEIRO.
  await t.diverge('formas de pagamento: só PIX, CARTAO e DINHEIRO (PDF: Pix, débito, crédito e dinheiro)', async () => {
    const p = await novoPedido();
    for (const f of ['DEBITO', 'CREDITO']) L.erro(await pagar({ pedidoId: p.id, formaPagamento: f, valor: 10 }), 400, { campo: 'formaPagamento' });
    t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: 'CARTAO', valor: 10 }), 201);
  });
  // [DIVERGE-PDF] D10 — PDF: tentativas com estados pendente/aprovado/recusado/expirado; aqui nasce sempre aprovado.
  await t.diverge('todo pagamento nasce APROVADO — não existe fluxo PENDENTE → aprovado/recusado/expirado pelo gateway (PDF: tentativas)', async () => {
    const p = await novoPedido();
    t.eq(t.sucesso(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10 }), 201).statusPagamento, 'APROVADO');
  });
  // [DIVERGE-PDF] D3 — status_pedido e status_pagamento deveriam ser independentes.
  await t.diverge('registrar pagamento muda o status DO PEDIDO para PAGO (PDF: status_pedido e status_pagamento são controles independentes)', async () => {
    t.eq(pg.pedido.status, 'PAGO');
  });
  // [DIVERGE-PDF] D8/D10 — PDF: referencia_transacao; a API tem identificadorExterno e nunca o preenche.
  await t.diverge('referencia_transacao do PDF chama-se identificadorExterno e não é aceita na entrada (sempre null)', async () => {
    t.eq(pg.identificadorExterno, null);
    t.verdade(!('referenciaTransacao' in pg));
  });
  // [DIVERGE-PDF] D10 (e D2) — não existe estorno/cancelamento de pagamento nem devolução de estoque.
  await t.diverge('não há estorno/cancelamento de pagamento nem devolução de estoque (status ESTORNADO existe no enum, sem rota)', async () => {
    L.erro(await t.http('POST', `/pagamentos/${pg.id}/estornar`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
  });
  // [DIVERGE-PDF] D10 — o PDF permite várias tentativas por pedido; a API exige pagamento único igual ao total.
  await t.diverge('pagamento parcial/dividido não é possível: o valor tem de ser igual ao total do pedido', async () => {
    const p = await novoPedido(2);
    L.erro(await pagar({ pedidoId: p.id, formaPagamento: 'PIX', valor: 10 }), 400, { campo: 'valor' });
  });
});
