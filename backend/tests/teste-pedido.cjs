'use strict';
// Pedidos: criação (baixa de estoque transacional), validação, listagem paginada, busca, concorrência e rollback.
const L = require('./_lib.cjs');
const t = L.suite('pedido');

const MAX = 2147483647;
const CHAVES_PEDIDO = ['canal', 'clienteId', 'criadoEm', 'id', 'itens', 'pagamentos', 'status', 'total', 'usuarioId'];
const CHAVES_ITEM = ['id', 'imagemUrl', 'nome', 'precoUnitario', 'produtoId', 'quantidade', 'subtotal'];

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  // Atalho para POST /pedidos (presencial, administrador por padrão).
  const pedir = (itens, canal = 'PRESENCIAL', token = adm.token) => t.http('POST', '/pedidos', { token, body: { canal, itens } });
  const item = (p, quantidade = 1) => ({ produtoId: p.id, quantidade });
  // Conta os pedidos dos usuários desta suíte, para provar que falhas não deixam pedido pela metade.
  const meusPedidos = () => t.prisma.pedido.count({ where: { usuarioId: { in: [adm.id, cx.id, at.id] } } });

  // ---------------------------------------------------------------- caminho feliz
  // Produtos do caminho feliz: preços com centavos para conferir total e subtotais exatos.
  const pA = await t.produto({ preco: '7.50', qtd: 20 });
  const pB = await t.produto({ preco: '3.20', qtd: 10 });
  let ped;
  await t.caso('POST /pedidos cria pedido (201) com o formato do mapper', async () => {
    ped = t.sucesso(await pedir([item(pA, 2), item(pB, 3)]), 201);
    t.eq(Object.keys(ped).sort(), CHAVES_PEDIDO);
    t.eq([ped.canal, ped.status, ped.usuarioId, ped.clienteId, ped.pagamentos], ['PRESENCIAL', 'ABERTO', adm.id, null, []]);
    t.eq(new Date(ped.criadoEm).toISOString(), ped.criadoEm);
    t.eq(ped.itens.length, 2);
    t.eq(Object.keys(ped.itens[0]).sort(), CHAVES_ITEM);
  });
  await t.caso('total e subtotais são calculados no servidor com o preço atual do produto', async () => {
    t.eq(ped.itens.map((i) => [i.produtoId, i.quantidade, i.precoUnitario, i.subtotal]), [[pA.id, 2, 7.5, 15], [pB.id, 3, 3.2, 9.6]]);
    t.eq(ped.total, 24.6);
    t.eq(typeof ped.total, 'number');
  });
  await t.caso('os itens vêm na ordem enviada; nome do produto e imagemUrl ("" se nula) vêm do produto', async () => {
    t.eq(ped.itens.map((i) => i.nome), [pA.nome, pB.nome]);
    t.eq(ped.itens[0].imagemUrl, '');
  });
  // Fixa o comportamento atual (veja a divergência prioritária D1 no fim do arquivo).
  await t.caso('o estoque físico é baixado na criação (ver divergência prioritária abaixo)', async () => {
    t.eq([(await t.saldo(pA.id)).quantidadeFisica, (await t.saldo(pB.id)).quantidadeFisica], [18, 7]);
  });
  await t.caso('uma movimentação SAIDA "Venda - pedido #id" por item, com o usuário do token', async () => {
    const ms = await t.prisma.movimentacaoEstoque.findMany({ where: { motivo: `Venda - pedido #${ped.id}` }, orderBy: { produtoId: 'asc' } });
    t.eq(ms.map((m) => [m.produtoId, m.tipo, m.quantidade, m.usuarioId]), [[pA.id, 'SAIDA', 2, adm.id], [pB.id, 'SAIDA', 3, adm.id]]);
  });
  await t.caso('o usuário do pedido é o do token, mesmo se o corpo mandar usuarioId/total/status', async () => {
    const r = t.sucesso(await t.http('POST', '/pedidos', { token: cx.token, body: { canal: 'PRESENCIAL', itens: [item(pA)], usuarioId: adm.id, total: 0.01, status: 'PAGO', clienteId: 5 } }), 201);
    t.eq([r.usuarioId, r.status, r.clienteId], [cx.id, 'ABERTO', null]);
    t.eq(r.total, 7.5);
  });
  await t.caso('canal é aceito em minúsculas e com espaços e vira o enum', async () => {
    t.eq(t.sucesso(await pedir([item(pA)], '  presencial '), 201).canal, 'PRESENCIAL');
    t.eq(t.sucesso(await pedir([item(pA)], 'online'), 201).canal, 'ONLINE');
  });
  await t.caso('o preço do pedido fica congelado: mudar o preço do produto depois não altera o pedido', async () => {
    const p = await t.produto({ preco: '10.00', qtd: 5 });
    const r = t.sucesso(await pedir([item(p, 2)]), 201);
    await t.prisma.produto.update({ where: { id: p.id }, data: { precoVenda: '99.00' } });
    const g = t.sucesso(await t.http('GET', `/pedidos/${r.id}`, { token: adm.token }));
    t.eq([g.itens[0].precoUnitario, g.total], [10, 20]);
  });
  await t.caso('arredondamento: 3 × R$ 0,10 = R$ 0,30 exatos', async () => {
    const p = await t.produto({ preco: '0.10', qtd: 10 });
    t.eq(t.sucesso(await pedir([item(p, 3)]), 201).total, 0.3);
  });
  await t.caso('pedir exatamente todo o estoque disponível é permitido e zera o físico', async () => {
    const p = await t.produto({ qtd: 4 });
    t.sucesso(await pedir([item(p, 4)]), 201);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 0);
  });
  await t.caso('pedido com 100 itens (máximo) é aceito', async () => {
    const ps = [];
    for (let i = 0; i < 100; i++) ps.push(await t.produto({ qtd: 1, preco: '1.00' }));
    const r = t.sucesso(await pedir(ps.map((p) => item(p))), 201);
    t.eq([r.itens.length, r.total], [100, 100]);
  });
  await t.caso('produto sem linha de estoque não pode ser vendido (disponível 0)', async () => {
    const cat = await t.categoria();
    const p = await t.prisma.produto.create({ data: { nome: t.unico('sem'), precoVenda: '2.00', categoriaId: cat.id } });
    L.erro(await pedir([item(p)]), 400, { campo: 'itens', contem: 'Estoque insuficiente' });
  });
  await t.caso('o reservado conta contra o disponível: físico 10, reservado 8 → pedir 3 falha, pedir 2 passa', async () => {
    const p = await t.produto({ qtd: 10, reservada: 8 });
    L.erro(await pedir([item(p, 3)]), 400, { campo: 'itens', contem: 'disponível 2, solicitado 3' });
    t.sucesso(await pedir([item(p, 2)]), 201);
    const s = await t.saldo(p.id);
    t.eq([s.quantidadeFisica, s.quantidadeReservada], [8, 8]);
  });

  // ---------------------------------------------------------------- validação
  // Produto válido usado como base da matriz de validação; nenhum caso inválido pode criar pedido.
  const pv = await t.produto({ qtd: 5 });
  const antesValid = await meusPedidos();
  // Matriz de entradas inválidas: canal, lista de itens (tamanho e forma), cada item (índice no campo) e quantidade.
  for (const [rotulo, body, campo] of [
    ['canal ausente', { itens: [item(pv)] }, 'canal'], ['canal inválido', { canal: 'BALCAO', itens: [item(pv)] }, 'canal'],
    ['canal numérico', { canal: 1, itens: [item(pv)] }, 'canal'], ['canal vazio', { canal: '', itens: [item(pv)] }, 'canal'],
    ['itens ausente', { canal: 'PRESENCIAL' }, 'itens'], ['itens vazio', { canal: 'PRESENCIAL', itens: [] }, 'itens'],
    ['itens não é array', { canal: 'PRESENCIAL', itens: item(pv) }, 'itens'], ['itens texto', { canal: 'PRESENCIAL', itens: 'x' }, 'itens'],
    ['itens com 101 elementos', { canal: 'PRESENCIAL', itens: Array.from({ length: 101 }, (_, i) => ({ produtoId: i + 1, quantidade: 1 })) }, 'itens'],
    ['item nulo', { canal: 'PRESENCIAL', itens: [null] }, 'itens[0]'], ['item texto', { canal: 'PRESENCIAL', itens: ['a'] }, 'itens[0]'],
    ['item array', { canal: 'PRESENCIAL', itens: [[1, 1]] }, 'itens[0]'],
    ['produtoId ausente', { canal: 'PRESENCIAL', itens: [{ quantidade: 1 }] }, 'itens[0].produtoId'],
    ['produtoId texto', { canal: 'PRESENCIAL', itens: [{ produtoId: 'abc', quantidade: 1 }] }, 'itens[0].produtoId'],
    ['produtoId zero', { canal: 'PRESENCIAL', itens: [{ produtoId: 0, quantidade: 1 }] }, 'itens[0].produtoId'],
    ['produtoId negativo', { canal: 'PRESENCIAL', itens: [{ produtoId: -1, quantidade: 1 }] }, 'itens[0].produtoId'],
    ['produtoId fracionário', { canal: 'PRESENCIAL', itens: [{ produtoId: 1.5, quantidade: 1 }] }, 'itens[0].produtoId'],
    ['quantidade ausente', { canal: 'PRESENCIAL', itens: [{ produtoId: pv.id }] }, 'itens[0].quantidade'],
    ['quantidade zero', { canal: 'PRESENCIAL', itens: [item(pv, 0)] }, 'itens[0].quantidade'],
    ['quantidade negativa', { canal: 'PRESENCIAL', itens: [item(pv, -1)] }, 'itens[0].quantidade'],
    ['quantidade fracionária', { canal: 'PRESENCIAL', itens: [item(pv, 1.5)] }, 'itens[0].quantidade'],
    ['quantidade texto', { canal: 'PRESENCIAL', itens: [item(pv, '2')] }, 'itens[0].quantidade'],
    ['quantidade acima de int32', { canal: 'PRESENCIAL', itens: [item(pv, MAX + 1)] }, 'itens[0].quantidade'],
    ['produto repetido', { canal: 'PRESENCIAL', itens: [item(pv), item(pv)] }, 'itens'],
    ['erro no 2º item indica o índice', { canal: 'PRESENCIAL', itens: [item(pv), { produtoId: pv.id + 1, quantidade: 0 }] }, 'itens[1].quantidade'],
  ]) {
    await t.caso(`${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await t.http('POST', '/pedidos', { token: adm.token, body }), 400, { campo });
    });
  }
  await t.caso('produto inexistente → 400 campo=itens', async () => {
    L.erro(await pedir([{ produtoId: 2000000000, quantidade: 1 }]), 400, { campo: 'itens', contem: 'não existe' });
  });
  await t.caso('produto inativo → 400 campo=itens e o estoque não muda', async () => {
    const p = await t.produto({ qtd: 5, ativo: false });
    L.erro(await pedir([item(p)]), 400, { campo: 'itens', contem: 'inativo' });
    t.eq((await t.saldo(p.id)).quantidadeFisica, 5);
  });
  await t.caso('estoque insuficiente → 400 campo=itens com a mensagem disponível/solicitado', async () => {
    const p = await t.produto({ qtd: 2 });
    L.erro(await pedir([item(p, 3)]), 400, { campo: 'itens', contem: 'disponível 2, solicitado 3' });
  });
  await t.caso('produto com estoque 0 → 400', async () => {
    const p = await t.produto({ qtd: 0 });
    L.erro(await pedir([item(p)]), 400, { campo: 'itens', contem: 'disponível 0' });
  });
  await t.caso('um item sem estoque reprova o pedido INTEIRO: nenhum outro item é baixado', async () => {
    const a = await t.produto({ qtd: 5 });
    const b = await t.produto({ qtd: 1 });
    L.erro(await pedir([item(a, 2), item(b, 2)]), 400, { campo: 'itens' });
    t.eq([(await t.saldo(a.id)).quantidadeFisica, (await t.saldo(b.id)).quantidadeFisica], [5, 1]);
  });
  await t.caso('valor de um item acima do limite (R$ 99.999.999,99) → 400', async () => {
    const p = await t.produto({ preco: '99999999.99', qtd: 5 });
    L.erro(await pedir([item(p, 2)]), 400, { campo: 'itens', contem: 'excede o limite' });
    t.eq((await t.saldo(p.id)).quantidadeFisica, 5);
  });
  await t.caso('valor TOTAL acima do limite (soma de itens) → 400 e nada é baixado', async () => {
    const a = await t.produto({ preco: '60000000.00', qtd: 1 });
    const b = await t.produto({ preco: '60000000.00', qtd: 1 });
    L.erro(await pedir([item(a), item(b)]), 400, { campo: 'itens', contem: 'valor total' });
    t.eq((await t.saldo(a.id)).quantidadeFisica, 1);
  });
  await t.caso('nenhuma das validações acima criou pedido', async () => {
    t.eq(await meusPedidos(), antesValid);
  });
  await t.caso('sem token → 401; JSON malformado → 400', async () => {
    L.erro(await t.http('POST', '/pedidos', { body: { canal: 'PRESENCIAL', itens: [item(pv)] } }), 401);
    L.erro(await t.http('POST', '/pedidos', { token: adm.token, rawBody: '{canal' }), 400, { contem: 'JSON' });
  });
  await t.caso('corpo vazio → 400 campo=canal', async () => {
    L.erro(await t.http('POST', '/pedidos', { token: adm.token }), 400, { campo: 'canal' });
  });

  // ---------------------------------------------------------------- listar
  await t.caso('GET /pedidos devolve { dados, pagina, limite, total, totalPaginas } com padrões 1 e 20', async () => {
    const r = t.sucesso(await t.http('GET', '/pedidos', { token: adm.token }));
    t.eq(Object.keys(r).sort(), ['dados', 'limite', 'pagina', 'total', 'totalPaginas']);
    t.eq([r.pagina, r.limite], [1, 20]);
    t.eq(r.totalPaginas, Math.ceil(r.total / 20));
    t.verdade(r.dados.length <= 20);
  });
  await t.caso('itens da listagem NÃO trazem pagamentos (só o detalhe traz)', async () => {
    const r = t.sucesso(await t.http('GET', '/pedidos?limite=1', { token: adm.token }));
    t.eq(Object.keys(r.dados[0]).sort(), CHAVES_PEDIDO.filter((k) => k !== 'pagamentos'));
  });
  await t.caso('ordenação: mais recentes primeiro (id decrescente em empate)', async () => {
    const r = t.sucesso(await t.http('GET', '/pedidos?limite=100', { token: adm.token })).dados;
    for (let i = 1; i < r.length; i++) t.verdade(r[i - 1].criadoEm > r[i].criadoEm || (r[i - 1].criadoEm === r[i].criadoEm && r[i - 1].id > r[i].id));
  });
  await t.caso('paginação: páginas não se repetem e somam o total', async () => {
    const p1 = t.sucesso(await t.http('GET', '/pedidos?limite=5&pagina=1', { token: adm.token }));
    const p2 = t.sucesso(await t.http('GET', '/pedidos?limite=5&pagina=2', { token: adm.token }));
    t.eq(p1.total, p2.total);
    t.eq(p1.totalPaginas, Math.ceil(p1.total / 5));
    const ids1 = p1.dados.map((x) => x.id);
    t.verdade(p2.dados.every((x) => !ids1.includes(x.id)));
  });
  await t.caso('página além do fim → dados [] e total preservado', async () => {
    const r = t.sucesso(await t.http('GET', '/pedidos?pagina=999999', { token: adm.token }));
    t.eq(r.dados, []);
    t.verdade(r.total > 0);
  });
  await t.caso('?canal e ?status filtram (insensíveis a maiúsculas)', async () => {
    const on = t.sucesso(await t.http('GET', '/pedidos?canal=online&limite=100', { token: adm.token }));
    t.verdade(on.dados.length > 0 && on.dados.every((x) => x.canal === 'ONLINE'));
    const ab = t.sucesso(await t.http('GET', '/pedidos?status=aberto&limite=100', { token: adm.token }));
    t.verdade(ab.dados.every((x) => x.status === 'ABERTO'));
    const pago = t.sucesso(await t.http('GET', '/pedidos?status=PAGO&canal=PRESENCIAL', { token: adm.token }));
    t.eq(pago.dados, []);
  });
  // Paginação: página >= 1 e limite entre 1 e 100; qualquer outro valor é 400 apontando o parâmetro.
  for (const qs of ['pagina=0', 'pagina=-1', 'pagina=abc', 'pagina=1.5', 'pagina=1000001', 'limite=0', 'limite=101', 'limite=abc', 'limite=-5']) {
    await t.caso(`?${qs} → 400 com campo=${qs.split('=')[0]}`, async () => {
      L.erro(await t.http('GET', `/pedidos?${qs}`, { token: adm.token }), 400, { campo: qs.split('=')[0] });
    });
  }
  await t.caso('?limite=100 (máximo) e ?limite=1 (mínimo) são aceitos', async () => {
    t.sucesso(await t.http('GET', '/pedidos?limite=100', { token: adm.token }));
    t.eq(t.sucesso(await t.http('GET', '/pedidos?limite=1', { token: adm.token })).dados.length, 1);
  });
  await t.caso('?status inválido → 400 campo=status; ?canal inválido → 400 campo=canal', async () => {
    L.erro(await t.http('GET', '/pedidos?status=NADA', { token: adm.token }), 400, { campo: 'status' });
    L.erro(await t.http('GET', '/pedidos?canal=NADA', { token: adm.token }), 400, { campo: 'canal' });
  });
  await t.caso('?pagina= e ?limite= vazios usam o padrão', async () => {
    const r = t.sucesso(await t.http('GET', '/pedidos?pagina=&limite=', { token: adm.token }));
    t.eq([r.pagina, r.limite], [1, 20]);
  });

  // ---------------------------------------------------------------- buscar por id
  await t.caso('GET /pedidos/:id devolve o pedido com itens e pagamentos', async () => {
    const g = t.sucesso(await t.http('GET', `/pedidos/${ped.id}`, { token: adm.token }));
    t.eq(g, ped);
  });
  await t.caso('GET /pedidos/:id inexistente → 404; id inválido → 400', async () => {
    L.erro(await t.http('GET', '/pedidos/2000000000', { token: adm.token }), 404, { mensagem: 'Pedido não encontrado.' });
    for (const id of ['abc', '0', '-1', '1.5']) L.erro(await t.http('GET', `/pedidos/${id}`, { token: adm.token }), 400, { campo: 'id' });
  });
  await t.caso('rotas de pedido sem token → 401', async () => {
    L.erro(await t.http('GET', '/pedidos'), 401);
    L.erro(await t.http('GET', `/pedidos/${ped.id}`), 401);
  });
  await t.caso('não existe DELETE nem PATCH de pedido (404 de rota): não há cancelamento', async () => {
    L.erro(await t.http('DELETE', `/pedidos/${ped.id}`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
    L.erro(await t.http('PATCH', `/pedidos/${ped.id}`, { token: adm.token, body: { status: 'CANCELADO' } }), 404);
    L.erro(await t.http('PATCH', `/pedidos/${ped.id}/cancelar`, { token: adm.token }), 404);
  });
  // Regra decidida: os três perfis criam pedidos e veem os de qualquer usuário (sem filtro por dono).
  await t.caso('caixa e atendente criam e consultam pedidos de qualquer usuário (201/200)', async () => {
    t.sucesso(await pedir([item(pA)], 'PRESENCIAL', at.token), 201);
    t.sucesso(await t.http('GET', `/pedidos/${ped.id}`, { token: at.token }));
    t.sucesso(await t.http('GET', '/pedidos', { token: cx.token }));
  });

  // ---------------------------------------------------------------- pagamentos x perfil
  // Matriz de perfis: o Atendente não vê pagamentos. NENHUMA resposta de pedido (detalhe, listagem, criação) traz a chave
  // `pagamentos` nem dado de pagamento (forma, status do pagamento, valor pago, troco, identificador externo) para ele.
  // Para saber se o pedido está pago o Atendente usa o `status` do próprio pedido. Caixa e Administrador continuam vendo.
  const CHAVES_SEM_PAGAMENTOS = CHAVES_PEDIDO.filter((k) => k !== 'pagamentos');
  const DADOS_DE_PAGAMENTO = ['pagamentos', 'pagamento', 'formaPagamento', 'statusPagamento', 'valorPago', 'troco', 'identificadorExterno'];
  const semDadoDePagamento = (resposta) => {
    const texto = JSON.stringify(resposta);
    for (const chave of DADOS_DE_PAGAMENTO) t.verdade(!texto.includes(`"${chave}"`), `a resposta do atendente traz "${chave}": ${texto.slice(0, 300)}`);
  };
  let pago;
  await t.caso('preparação: pedido com pagamento PIX registrado pelo Caixa (status PAGO)', async () => {
    pago = t.sucesso(await pedir([item(pA, 2)]), 201);
    t.sucesso(await t.http('POST', '/pagamentos', { token: cx.token, body: { pedidoId: pago.id, formaPagamento: 'PIX', valor: pago.total } }), 201);
  });
  await t.caso('GET /pedidos/:id: o atendente NÃO recebe pagamentos (nem dado de pagamento), mas vê o status PAGO do pedido', async () => {
    const r = t.sucesso(await t.http('GET', `/pedidos/${pago.id}`, { token: at.token }));
    t.eq(Object.keys(r).sort(), CHAVES_SEM_PAGAMENTOS);
    semDadoDePagamento(r);
    t.eq(r.status, 'PAGO');
  });
  for (const [nome, u] of [['caixa', cx], ['administrador', adm]]) {
    await t.caso(`GET /pedidos/:id: ${nome} vê os pagamentos do pedido`, async () => {
      const r = t.sucesso(await t.http('GET', `/pedidos/${pago.id}`, { token: u.token }));
      t.eq(Object.keys(r).sort(), CHAVES_PEDIDO);
      t.eq(r.pagamentos.length, 1);
      t.eq([r.pagamentos[0].formaPagamento, r.pagamentos[0].valor], ['PIX', pago.total]);
    });
  }
  await t.caso('GET /pedidos (listagem): o atendente não recebe dado de pagamento (e vê o pedido pago pelo status)', async () => {
    const r = t.sucesso(await t.http('GET', '/pedidos?status=PAGO&limite=100', { token: at.token }));
    semDadoDePagamento(r);
    t.verdade(r.dados.some((p) => p.id === pago.id && p.status === 'PAGO'));
  });
  for (const [nome, u] of [['caixa', cx], ['administrador', adm]]) {
    await t.caso(`GET /pedidos (listagem): ${nome} também não recebe pagamentos (só o detalhe os traz)`, async () => {
      const r = t.sucesso(await t.http('GET', '/pedidos?status=PAGO&limite=100', { token: u.token }));
      t.verdade(r.dados.every((p) => !('pagamentos' in p)));
    });
  }
  await t.caso('POST /pedidos: a resposta do atendente NÃO traz a chave pagamentos; a do caixa e a do administrador trazem (lista vazia)', async () => {
    const a = t.sucesso(await pedir([item(pA)], 'PRESENCIAL', at.token), 201);
    t.eq(Object.keys(a).sort(), CHAVES_SEM_PAGAMENTOS);
    semDadoDePagamento(a);
    for (const u of [cx, adm]) {
      const r = t.sucesso(await pedir([item(pA)], 'PRESENCIAL', u.token), 201);
      t.eq([Object.keys(r).sort(), r.pagamentos], [CHAVES_PEDIDO, []]);
    }
  });
  await t.caso('o atendente não consegue ler pagamentos por outro caminho: GET /pagamentos/pedido/:id → 403', async () => {
    L.erro(await t.http('GET', `/pagamentos/pedido/${pago.id}`, { token: at.token }), 403);
  });

  // ---------------------------------------------------------------- concorrência
  // Concorrência crítica: o updateMany condicional (estoque no WHERE) garante que a última unidade não é vendida duas vezes.
  await t.caso('A ÚLTIMA UNIDADE: 12 pedidos simultâneos de 1 unidade com estoque 1 → exatamente 1 vence', async () => {
    const p = await t.produto({ qtd: 1 });
    const antes = await meusPedidos();
    const rs = await t.paralelo(12, () => pedir([item(p)]));
    t.eq(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join());
    for (const r of rs.filter((x) => x.status !== 201)) L.erro(r, 400, { campo: 'itens', contem: 'Estoque insuficiente' });
    t.eq((await t.saldo(p.id)).quantidadeFisica, 0);
    t.eq(await t.contarMov(p.id), 1);
    t.eq(await meusPedidos(), antes + 1);
  });
  await t.caso('estoque 5 e 15 pedidos simultâneos de 1 unidade → exatamente 5 vencem, físico 0, 5 movimentações', async () => {
    const p = await t.produto({ qtd: 5 });
    const rs = await t.paralelo(15, () => pedir([item(p)]));
    t.eq(rs.filter((r) => r.status === 201).length, 5, rs.map((r) => r.status).join());
    t.eq((await t.saldo(p.id)).quantidadeFisica, 0);
    t.eq(await t.contarMov(p.id), 5);
    t.eq(await t.prisma.itemPedido.count({ where: { produtoId: p.id } }), 5);
  });
  await t.caso('estoque 5 e 6 pedidos simultâneos de 2 unidades → exatamente 2 vencem, sobra 1', async () => {
    const p = await t.produto({ qtd: 5 });
    const rs = await t.paralelo(6, () => pedir([item(p, 2)]));
    t.eq(rs.filter((r) => r.status === 201).length, 2);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 1);
  });
  await t.caso('pedido pelo canal ONLINE e PRESENCIAL disputando a última unidade: só um vence', async () => {
    const p = await t.produto({ qtd: 1 });
    const rs = await t.paralelo(10, (i) => pedir([item(p)], i % 2 ? 'ONLINE' : 'PRESENCIAL', [adm, cx, at][i % 3].token));
    t.eq(rs.filter((r) => r.status === 201).length, 1);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 0);
  });
  // Concorrência + rollback: pedidos que falham no 2º item precisam desfazer a baixa do 1º (p2 só perde as 3 vendas que venceram).
  await t.caso('multi-item sob disputa: p1 com 3 un., p2 com 100; 10 pedidos [p1,p2] → 3 vencem e p2 só perde 3 (falhas desfazem a baixa de p2)', async () => {
    const p1 = await t.produto({ qtd: 3 });
    const p2 = await t.produto({ qtd: 100 });
    const rs = await t.paralelo(10, (i) => pedir(i % 2 ? [item(p1), item(p2)] : [item(p2), item(p1)]));
    t.eq(rs.filter((r) => r.status === 201).length, 3, rs.map((r) => r.status).join());
    t.eq([(await t.saldo(p1.id)).quantidadeFisica, (await t.saldo(p2.id)).quantidadeFisica], [0, 97]);
    t.eq(await t.contarMov(p2.id), 3);
    t.eq(await t.prisma.itemPedido.count({ where: { produtoId: p2.id } }), 3);
  });
  // Deadlock: as baixas são feitas em ordem crescente de produtoId, então pedidos com itens em ordens opostas não travam um ao outro.
  await t.caso('pedidos com os mesmos 2 produtos em ordens opostas (risco de deadlock): todos 201, sem 409/500', async () => {
    const p1 = await t.produto({ qtd: 100 });
    const p2 = await t.produto({ qtd: 100 });
    const rs = await t.paralelo(30, (i) => pedir(i % 2 ? [item(p1), item(p2)] : [item(p2), item(p1)]));
    t.verdade(rs.every((r) => r.status === 201), rs.map((r) => r.status).join());
    t.eq([(await t.saldo(p1.id)).quantidadeFisica, (await t.saldo(p2.id)).quantidadeFisica], [70, 70]);
  });
  await t.caso('pedidos e ajustes de estoque simultâneos: o saldo final fecha com o histórico', async () => {
    const p = await t.produto({ qtd: 50 });
    await t.paralelo(20, (i) => (i % 2 ? pedir([item(p)]) : t.http('PATCH', `/produtos/${p.id}/estoque`, { token: adm.token, body: { tipo: 'ENTRADA', quantidade: 2 } })));
    const soma = (await t.prisma.movimentacaoEstoque.findMany({ where: { produtoId: p.id } })).reduce((s, m) => s + (m.tipo === 'ENTRADA' ? m.quantidade : -m.quantidade), 0);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 50 + soma); // 50 = saldo criado direto no banco, sem movimentação
    t.eq(soma, 10 * 2 - 10);
  });
  await t.caso('o físico nunca fica negativo sob disputa pesada (40 pedidos, estoque 7)', async () => {
    const p = await t.produto({ qtd: 7 });
    await t.paralelo(40, () => pedir([item(p, 1 + Math.floor(Math.random() * 3))]));
    const f = (await t.saldo(p.id)).quantidadeFisica;
    t.verdade(f >= 0 && f <= 7, `físico ${f}`);
    const vendido = (await t.prisma.itemPedido.aggregate({ where: { produtoId: p.id }, _sum: { quantidade: true } }))._sum.quantidade || 0;
    t.eq(7 - vendido, f);
  });

  // ---------------------------------------------------------------- rollback
  await t.caso('ROLLBACK: falha na movimentação do 2º item desfaz a baixa do 1º, o pedido e os itens', async () => {
    const p1 = await t.produto({ qtd: 10 });
    const p2 = await t.produto({ qtd: 100 });
    const antes = await meusPedidos();
    const itensAntes = await t.prisma.itemPedido.count();
    // Rollback: constraint temporária faz falhar a movimentação do 2º item (quantidade 77); a baixa do 1º, o pedido e os itens têm de sumir.
    await t.comConstraint('movimentacoes_estoque', 'chk_tc_ped', `NOT (motivo LIKE 'Venda - pedido%' AND quantidade = 77)`, async () => {
      const r = await pedir([item(p1, 2), item(p2, 77)]);
      t.eq(r.status, 500);
    });
    t.eq([(await t.saldo(p1.id)).quantidadeFisica, (await t.saldo(p2.id)).quantidadeFisica], [10, 100]);
    t.eq(await meusPedidos(), antes);
    t.eq(await t.prisma.itemPedido.count(), itensAntes);
    t.eq([await t.contarMov(p1.id), await t.contarMov(p2.id)], [0, 0]);
  });
  await t.caso('ROLLBACK: falha na baixa do estoque (constraint no estoque) não deixa pedido pela metade', async () => {
    const p = await t.produto({ qtd: 50 });
    const antes = await meusPedidos();
    // Rollback: constraint no saldo (41) faz falhar o UPDATE da baixa; não pode sobrar pedido nem movimentação.
    await t.comConstraint('estoque', 'chk_tc_ped2', `"quantidadeFisica" <> 41`, async () => {
      t.eq((await pedir([item(p, 9)])).status, 500);
    });
    t.eq((await t.saldo(p.id)).quantidadeFisica, 50);
    t.eq(await meusPedidos(), antes);
    t.eq(await t.contarMov(p.id), 0);
  });
  await t.caso('depois da falha forçada (constraint removida) o mesmo pedido passa', async () => {
    const p = await t.produto({ qtd: 50 });
    t.sucesso(await pedir([item(p, 9)]), 201);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 41);
  });

  // ---------------------------------------------------------------- divergências com o PDF
  // Cada asserção abaixo afirma o comportamento ATUAL que conflita com a modelagem; o item Dn está em DIVERGENCIAS.md.
  // [DIVERGE-PDF] D1 (prioritária, a corrigir junto com ReservaEstoque) — a baixa definitiva do estoque ocorre na criação do pedido ABERTO, antes de pagamento.
  await t.diverge('PRIORITÁRIA: a baixa DEFINITIVA do estoque acontece na criação do pedido ABERTO, antes de qualquer pagamento (PDF: só após pagamento aprovado/dinheiro confirmado)', async () => {
    const p = await t.produto({ qtd: 10 });
    const r = t.sucesso(await pedir([item(p, 4)]), 201);
    t.eq(r.status, 'ABERTO');
    t.eq(r.pagamentos, []);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 6);
  });
  // [DIVERGE-PDF] D2 (prioritária) — não existe cancelamento de pedido nem devolução de estoque.
  await t.diverge('PRIORITÁRIA: pedido não pago e sem cancelamento consome estoque para sempre (não existe rota de cancelar/devolver)', async () => {
    L.erro(await t.http('POST', `/pedidos/${ped.id}/cancelar`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
  });
  // [DIVERGE-PDF] D11 — a reserva de estoque (RESERVA_ESTOQUE) não é usada: quantidadeReservada fica em 0.
  await t.diverge('o estoque reservado não é usado: após o pedido, quantidadeReservada continua 0 (PDF: RESERVA_ESTOQUE converte/libera)', async () => {
    const p = await t.produto({ qtd: 5 });
    t.sucesso(await pedir([item(p)]), 201);
    t.eq((await t.saldo(p.id)).quantidadeReservada, 0);
  });
  // [DIVERGE-PDF] D12 — PDF: movimento do tipo venda com id_pedido FK; aqui é SAIDA com o número do pedido só no texto do motivo.
  await t.diverge('a venda é movimentação SAIDA com o texto "Venda - pedido #N" (PDF: tipo VENDA e id_pedido FK na movimentação)', async () => {
    const m = await t.prisma.movimentacaoEstoque.findFirst({ where: { motivo: `Venda - pedido #${ped.id}` } });
    t.eq(m.tipo, 'SAIDA');
    t.verdade(!('pedidoId' in m));
  });
  // [DIVERGE-PDF] D4 — PDF: identificador_unico (UUID UNIQUE) impede pedido duplicado; aqui o reenvio cria outro pedido e baixa o estoque de novo.
  await t.diverge('sem idempotência: o mesmo POST enviado duas vezes cria DOIS pedidos e baixa o estoque duas vezes (PDF: identificador_unico UUID UNIQUE)', async () => {
    const p = await t.produto({ qtd: 10 });
    const a = t.sucesso(await pedir([item(p, 2)]), 201);
    const b = t.sucesso(await pedir([item(p, 2)]), 201);
    t.verdade(a.id !== b.id);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 6);
  });
  // [DIVERGE-PDF] D5 — campos do pedido previstos no PDF que ainda não existem.
  await t.diverge('o pedido não tem nome_contato, telefone_contato, numero_retirada, identificador_unico nem janela (PDF)', async () => {
    for (const k of ['nomeContato', 'telefoneContato', 'numeroRetirada', 'identificadorUnico', 'janelaId']) t.verdade(!(k in ped), k);
  });
  // [DIVERGE-PDF] D8 — PDF: 'origem'; a API usa 'canal'.
  await t.diverge('a origem do pedido se chama "canal" (PDF: "origem"); total e criadoEm no lugar de total/data_hora', async () => {
    t.verdade('canal' in ped && !('origem' in ped));
  });
  // [DIVERGE-PDF] D6 — PDF: id_usuario é FK NULL; aqui todo pedido tem usuarioId.
  await t.diverge('pedido ONLINE exige usuário interno (usuarioId) — PDF: id_usuario é FK NULL e o online não tem usuário', async () => {
    const r = t.sucesso(await pedir([item(pA)], 'ONLINE'), 201);
    t.eq(r.usuarioId, adm.id);
  });
  // [DIVERGE-PDF] D7 — a entidade Cliente e a FK pedidos.clienteId existem, mas o vínculo no pedido ainda não foi feito:
  // criarPedido ignora clienteId do corpo e o pedido não tem nome_contato/telefone_contato (visitante).
  await t.diverge('criarPedido ignora clienteId (pedido nunca é vinculado a um cliente) e o pedido não tem nome_contato/telefone_contato', async () => {
    const cliente = await t.prisma.cliente.create({ data: { nome: 'Cliente do teste', email: `${t.prefixo}d7@teste.local` } });
    const r = t.sucesso(await t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'ONLINE', clienteId: cliente.id, itens: [item(pA)] } }), 201);
    t.eq(r.clienteId, null);
    t.eq((await t.prisma.pedido.findUnique({ where: { id: r.id } })).clienteId, null);
    t.verdade(!('nomeContato' in r) && !('telefoneContato' in r));
  });
  // [DIVERGE-PDF] D13 — PDF: quantidade NUMERIC(12,3).
  await t.diverge('quantidade do item só inteira (PDF: NUMERIC(12,3))', async () => {
    L.erro(await t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: pA.id, quantidade: 0.5 }] } }), 400, { campo: 'itens[0].quantidade' });
  });
  // [DIVERGE-PDF] D3 — PDF: status_pedido e status_pagamento são independentes; aqui o pagamento move o pedido para PAGO.
  await t.diverge('o status do pedido mistura estados de pagamento (PAGO/ESTORNADO) — PDF manda separar status_pedido de status_pagamento', async () => {
    const p = await t.produto({ qtd: 3 });
    const r = t.sucesso(await pedir([item(p)]), 201);
    const pg = await t.http('POST', '/pagamentos', { token: adm.token, body: { pedidoId: r.id, formaPagamento: 'PIX', valor: r.total } });
    t.eq(t.sucesso(pg, 201).pedido.status, 'PAGO');
  });
});
