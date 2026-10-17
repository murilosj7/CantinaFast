'use strict';
// Movimentações de estoque: criar (4 tipos), listar, remover (com bloqueio de vendas), saldo nunca negativo,
// concorrência e rollback.
const L = require('./_lib.cjs');
const t = L.suite('movimentacao');

const MAX = 2147483647;
const CHAVES = ['criadoEm', 'id', 'motivo', 'produto', 'produtoId', 'quantidade', 'tipo', 'usuario', 'usuarioId'];
// Mensagem exata decidida para a recusa de remoção de movimentação de venda.
const MSG_VENDA = 'Esta movimentação está vinculada a uma venda e não pode ser removida diretamente. Cancele o pedido, se aplicável.';
// Efeito de cada tipo no saldo: SAIDA e PERDA subtraem; ENTRADA e AJUSTE somam (o AJUSTE leva o sinal na quantidade).
const efeito = (tipo, q) => (tipo === 'SAIDA' || tipo === 'PERDA' ? -q : q);

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  const mov = (body, token = adm.token) => t.http('POST', '/movimentacoes', { token, body });
  const del = (id, token = adm.token) => t.http('DELETE', `/movimentacoes/${id}`, { token });
  const fisico = async (id) => (await t.saldo(id)).quantidadeFisica;
  const existe = (id) => t.prisma.movimentacaoEstoque.count({ where: { id } });
  // Cria produto + saldo e devolve helper.
  // Produto com saldo inicial semeado direto no banco (sem movimentação), para controlar o ponto de partida de cada caso.
  const comSaldo = (qtd, extra = {}) => t.produto({ qtd, ...extra });

  // ---------------------------------------------------------------- criar: feliz e formato
  let m1;
  const base = await comSaldo(10);
  await t.caso('POST cria movimentação (201) no formato do mapper', async () => {
    m1 = t.sucesso(await mov({ produtoId: base.id, tipo: 'ENTRADA', quantidade: 5, motivo: 'Compra' }), 201);
    t.eq(Object.keys(m1).sort(), CHAVES);
    t.eq([m1.produtoId, m1.usuarioId, m1.tipo, m1.quantidade, m1.motivo], [base.id, adm.id, 'ENTRADA', 5, 'Compra']);
    t.eq(m1.produto, { id: base.id, nome: base.nome });
    t.eq(m1.usuario, { id: adm.id, nome: `Teste ${adm.login}` });
    t.eq(new Date(m1.criadoEm).toISOString(), m1.criadoEm);
    t.eq(await fisico(base.id), 15);
  });
  await t.caso('o tipo na resposta é o enum em maiúsculas (não é traduzido para minúsculas)', async () => {
    t.eq(m1.tipo, m1.tipo.toUpperCase());
  });
  await t.caso('motivo é opcional: ausente/vazio/espaços vira null (sem motivo padrão, diferente do ajuste de estoque)', async () => {
    const p = await comSaldo(5);
    for (const motivo of [undefined, '', '   ', null]) t.eq(t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1, motivo }), 201).motivo, null);
  });
  await t.caso('motivo é aparado; 200 caracteres é aceito; 201 → 400 campo=motivo', async () => {
    const p = await comSaldo(5);
    t.eq(t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1, motivo: '  ok  ' }), 201).motivo, 'ok');
    t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1, motivo: 'm'.repeat(200) }), 201);
    L.erro(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1, motivo: 'm'.repeat(201) }), 400, { campo: 'motivo' });
    L.erro(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1, motivo: 5 }), 400, { campo: 'motivo' });
  });
  await t.caso('o usuário é o do token; usuarioId no corpo é ignorado', async () => {
    const p = await comSaldo(5);
    t.eq(t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1, usuarioId: adm.id }, cx.token), 201).usuarioId, cx.id);
  });
  await t.caso('tipo aceita minúsculas e espaços', async () => {
    const p = await comSaldo(5);
    t.eq(t.sucesso(await mov({ produtoId: p.id, tipo: '  saida ', quantidade: 2 }), 201).tipo, 'SAIDA');
    t.eq(await fisico(p.id), 3);
  });
  await t.caso('produtoId pode vir como texto numérico', async () => {
    const p = await comSaldo(5);
    t.sucesso(await mov({ produtoId: String(p.id), tipo: 'ENTRADA', quantidade: 1 }), 201);
  });
  await t.caso('movimentar produto sem linha de estoque cria a linha', async () => {
    const cat = await t.categoria();
    const p = await t.prisma.produto.create({ data: { nome: t.unico('sem'), precoVenda: '1.00', categoriaId: cat.id } });
    t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 4 }), 201);
    t.eq(await fisico(p.id), 4);
  });
  await t.caso('SAIDA em produto sem linha de estoque → 400 saldo insuficiente (físico atual 0) e a linha é criada vazia', async () => {
    const cat = await t.categoria();
    const p = await t.prisma.produto.create({ data: { nome: t.unico('sem'), precoVenda: '1.00', categoriaId: cat.id } });
    L.erro(await mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 1 }), 400, { campo: 'quantidade', contem: 'físico atual é 0' });
  });
  await t.caso('movimentar produto INATIVO é permitido (comportamento atual)', async () => {
    const p = await comSaldo(2, { ativo: false });
    t.sucesso(await mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 1 }), 201);
  });
  await t.caso('o reservado não limita a saída (só o físico): físico 10, reservado 8, SAIDA de 9 passa', async () => {
    const p = await comSaldo(10, { reservada: 8 });
    t.sucesso(await mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 9 }), 201);
    t.eq(await fisico(p.id), 1);
  });

  // ---------------------------------------------------------------- criar: matriz tipo × quantidade × saldo inicial
  // Matriz tipo × quantidade × saldo inicial: o saldo nunca pode ficar negativo; se ficaria, 400 e nada muda.
  for (const tipo of ['ENTRADA', 'SAIDA', 'PERDA']) {
    for (const inicial of [0, 3, 10]) {
      for (const q of [1, 2, 5, 10]) {
        const novo = inicial + efeito(tipo, q);
        await t.caso(`${tipo} ${q} com saldo ${inicial} → ${novo < 0 ? '400 saldo insuficiente (saldo fica ' + inicial + ')' : '201, saldo ' + novo}`, async () => {
          const p = await comSaldo(inicial);
          const r = await mov({ produtoId: p.id, tipo, quantidade: q });
          if (novo < 0) {
            L.erro(r, 400, { campo: 'quantidade', contem: `Saldo insuficiente: o estoque físico atual é ${inicial} e esta operação retiraria ${q}` });
            t.eq(await t.contarMov(p.id), 0);
          } else {
            t.sucesso(r, 201);
            t.eq(await t.contarMov(p.id), 1);
          }
          t.eq(await fisico(p.id), novo < 0 ? inicial : novo);
        });
      }
    }
  }
  for (const inicial of [0, 3, 10]) {
    // Matriz do AJUSTE com sinal: quantidade negativa reduz o saldo e também respeita o piso zero.
    for (const q of [-10, -5, -3, -1, 1, 5, 10]) {
      const novo = inicial + q;
      await t.caso(`AJUSTE ${q > 0 ? '+' : ''}${q} com saldo ${inicial} → ${novo < 0 ? '400' : '201, saldo ' + novo}`, async () => {
        const p = await comSaldo(inicial);
        const r = await mov({ produtoId: p.id, tipo: 'AJUSTE', quantidade: q });
        if (novo < 0) L.erro(r, 400, { campo: 'quantidade', contem: 'Saldo insuficiente' });
        else t.eq(t.sucesso(r, 201).quantidade, q); // guarda o valor COM sinal
        t.eq(await fisico(p.id), novo < 0 ? inicial : novo);
      });
    }
  }
  await t.caso('AJUSTE negativo é gravado com a quantidade negativa no histórico', async () => {
    const p = await comSaldo(5);
    t.sucesso(await mov({ produtoId: p.id, tipo: 'AJUSTE', quantidade: -2 }), 201);
    t.eq((await t.prisma.movimentacaoEstoque.findFirst({ where: { produtoId: p.id } })).quantidade, -2);
  });
  await t.caso('saldo insuficiente: uma saída que zera exatamente é permitida', async () => {
    const p = await comSaldo(7);
    t.sucesso(await mov({ produtoId: p.id, tipo: 'PERDA', quantidade: 7 }), 201);
    t.eq(await fisico(p.id), 0);
  });
  await t.caso('limite superior: ENTRADA até exatamente 2147483647 passa; +1 → 400 "não pode passar"', async () => {
    const p = await comSaldo(MAX - 5);
    t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 5 }), 201);
    L.erro(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1 }), 400, { campo: 'quantidade', contem: 'não pode passar' });
    L.erro(await mov({ produtoId: p.id, tipo: 'AJUSTE', quantidade: 1 }), 400, { campo: 'quantidade', contem: 'não pode passar' });
    t.eq(await fisico(p.id), MAX);
  });

  // ---------------------------------------------------------------- criar: validação
  // Produto base da matriz de validação: casos inválidos não gravam movimentação nem alteram o saldo.
  const pv = await comSaldo(10);
  const antes = await t.contarMov(pv.id);
  // Matriz de entradas inválidas: produtoId, tipo (só os 4 do enum) e quantidade (por tipo).
  for (const [rotulo, body, campo] of [
    ['produtoId ausente', { tipo: 'ENTRADA', quantidade: 1 }, 'produtoId'], ['produtoId texto', { produtoId: 'abc', tipo: 'ENTRADA', quantidade: 1 }, 'produtoId'],
    ['produtoId zero', { produtoId: 0, tipo: 'ENTRADA', quantidade: 1 }, 'produtoId'], ['produtoId negativo', { produtoId: -3, tipo: 'ENTRADA', quantidade: 1 }, 'produtoId'],
    ['produtoId fracionário', { produtoId: 1.5, tipo: 'ENTRADA', quantidade: 1 }, 'produtoId'], ['produtoId nulo', { produtoId: null, tipo: 'ENTRADA', quantidade: 1 }, 'produtoId'],
    ['produtoId acima de int32', { produtoId: MAX + 1, tipo: 'ENTRADA', quantidade: 1 }, 'produtoId'],
    ['tipo ausente', { produtoId: pv.id, quantidade: 1 }, 'tipo'], ['tipo vazio', { produtoId: pv.id, tipo: '', quantidade: 1 }, 'tipo'],
    ['tipo VENDA', { produtoId: pv.id, tipo: 'VENDA', quantidade: 1 }, 'tipo'], ['tipo RETORNO', { produtoId: pv.id, tipo: 'RETORNO', quantidade: 1 }, 'tipo'],
    ['tipo numérico', { produtoId: pv.id, tipo: 1, quantidade: 1 }, 'tipo'], ['tipo nulo', { produtoId: pv.id, tipo: null, quantidade: 1 }, 'tipo'],
    ['tipo desconhecido', { produtoId: pv.id, tipo: 'ROUBO', quantidade: 1 }, 'tipo'],
    ['quantidade ausente', { produtoId: pv.id, tipo: 'ENTRADA' }, 'quantidade'], ['quantidade texto', { produtoId: pv.id, tipo: 'ENTRADA', quantidade: '2' }, 'quantidade'],
    ['quantidade fracionária', { produtoId: pv.id, tipo: 'ENTRADA', quantidade: 1.5 }, 'quantidade'], ['quantidade nula', { produtoId: pv.id, tipo: 'ENTRADA', quantidade: null }, 'quantidade'],
    ['quantidade booleana', { produtoId: pv.id, tipo: 'SAIDA', quantidade: true }, 'quantidade'],
    ['ENTRADA zero', { produtoId: pv.id, tipo: 'ENTRADA', quantidade: 0 }, 'quantidade'], ['ENTRADA negativa', { produtoId: pv.id, tipo: 'ENTRADA', quantidade: -1 }, 'quantidade'],
    ['SAIDA zero', { produtoId: pv.id, tipo: 'SAIDA', quantidade: 0 }, 'quantidade'], ['SAIDA negativa', { produtoId: pv.id, tipo: 'SAIDA', quantidade: -1 }, 'quantidade'],
    ['PERDA zero', { produtoId: pv.id, tipo: 'PERDA', quantidade: 0 }, 'quantidade'], ['PERDA negativa', { produtoId: pv.id, tipo: 'PERDA', quantidade: -4 }, 'quantidade'],
    ['AJUSTE zero', { produtoId: pv.id, tipo: 'AJUSTE', quantidade: 0 }, 'quantidade'],
    ['quantidade acima de int32', { produtoId: pv.id, tipo: 'ENTRADA', quantidade: MAX + 1 }, 'quantidade'],
    ['AJUSTE abaixo de −int32', { produtoId: pv.id, tipo: 'AJUSTE', quantidade: -(MAX + 1) }, 'quantidade'],
  ]) {
    await t.caso(`${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await mov(body), 400, { campo });
    });
  }
  await t.caso('produto inexistente → 404 campo=produtoId', async () => {
    L.erro(await mov({ produtoId: 2000000000, tipo: 'ENTRADA', quantidade: 1 }), 404, { campo: 'produtoId', mensagem: 'Produto não encontrado.' });
  });
  await t.caso('nenhuma validação com falha gravou movimentação nem mudou o saldo', async () => {
    t.eq([await t.contarMov(pv.id), await fisico(pv.id)], [antes, 10]);
  });
  await t.caso('sem token → 401; token inválido → 401; JSON malformado → 400; corpo vazio → 400 campo=produtoId', async () => {
    L.erro(await t.http('POST', '/movimentacoes', { body: { produtoId: pv.id, tipo: 'ENTRADA', quantidade: 1 } }), 401);
    L.erro(await mov({ produtoId: pv.id, tipo: 'ENTRADA', quantidade: 1 }, 'x.y.z'), 401);
    L.erro(await t.http('POST', '/movimentacoes', { token: adm.token, rawBody: '{' }), 400, { contem: 'JSON' });
    L.erro(await t.http('POST', '/movimentacoes', { token: adm.token }), 400, { campo: 'produtoId' });
  });

  // ---------------------------------------------------------------- listar
  // Três movimentações em sequência para conferir filtro por produto e ordenação (mais recente primeiro).
  const pl = await comSaldo(0);
  const motivos = ['primeira', 'segunda', 'terceira'];
  for (const motivo of motivos) await mov({ produtoId: pl.id, tipo: 'ENTRADA', quantidade: 1, motivo });
  await t.caso('GET /movimentacoes?produtoId filtra e ordena da mais recente para a mais antiga', async () => {
    const r = t.sucesso(await t.http('GET', `/movimentacoes?produtoId=${pl.id}`, { token: adm.token }));
    t.eq(r.map((x) => x.motivo), ['terceira', 'segunda', 'primeira']);
    t.verdade(r.every((x) => x.produtoId === pl.id && JSON.stringify(Object.keys(x).sort()) === JSON.stringify(CHAVES)));
  });
  await t.caso('GET sem filtro devolve movimentações de vários produtos (lista completa, sem paginação)', async () => {
    const r = t.sucesso(await t.http('GET', '/movimentacoes', { token: adm.token }));
    t.verdade(r.length >= 3 && new Set(r.map((x) => x.produtoId)).size > 1);
  });
  await t.caso('GET ?produtoId de produto sem movimentações → []', async () => {
    const p = await comSaldo(1);
    t.eq(t.sucesso(await t.http('GET', `/movimentacoes?produtoId=${p.id}`, { token: adm.token })), []);
  });
  await t.caso('GET ?produtoId= vazio é ignorado', async () => {
    t.verdade(Array.isArray(t.sucesso(await t.http('GET', '/movimentacoes?produtoId=', { token: adm.token }))));
  });
  for (const v of ['abc', '0', '-1', '1.5', '99999999999']) {
    await t.caso(`GET ?produtoId='${v}' → 400 campo=produtoId`, async () => {
      L.erro(await t.http('GET', `/movimentacoes?produtoId=${v}`, { token: adm.token }), 400, { campo: 'produtoId' });
    });
  }
  await t.caso('GET sem token → 401', async () => {
    L.erro(await t.http('GET', '/movimentacoes'), 401);
  });
  await t.caso('histórico completo: nome do produto e do usuário vêm no item', async () => {
    const r = t.sucesso(await t.http('GET', `/movimentacoes?produtoId=${pl.id}`, { token: adm.token }));
    t.eq(r[0].produto.nome, pl.nome);
    t.eq(r[0].usuario.id, adm.id);
  });

  // ---------------------------------------------------------------- remover
  await t.caso('DELETE de ENTRADA (204) desfaz o efeito: saldo cai e a movimentação some', async () => {
    const p = await comSaldo(0);
    const m = t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 6 }), 201);
    const r = await del(m.id);
    t.eq(r.status, 204);
    t.eq(r.texto, '');
    t.eq([await fisico(p.id), await existe(m.id)], [0, 0]);
  });
  for (const [tipo, q, inicial, final] of [['SAIDA', 4, 10, 10], ['PERDA', 3, 10, 10], ['ENTRADA', 5, 0, 0]]) {
    await t.caso(`DELETE de ${tipo} ${q}: o saldo volta a ${final}`, async () => {
      const p = await comSaldo(inicial);
      const m = t.sucesso(await mov({ produtoId: p.id, tipo, quantidade: q }), 201);
      t.eq((await del(m.id)).status, 204);
      t.eq(await fisico(p.id), final);
    });
  }
  await t.caso('DELETE de AJUSTE negativo devolve as unidades; de AJUSTE positivo as retira', async () => {
    const p = await comSaldo(10);
    const neg = t.sucesso(await mov({ produtoId: p.id, tipo: 'AJUSTE', quantidade: -4 }), 201);
    t.eq((await del(neg.id)).status, 204);
    t.eq(await fisico(p.id), 10);
    const pos = t.sucesso(await mov({ produtoId: p.id, tipo: 'AJUSTE', quantidade: 3 }), 201);
    t.eq((await del(pos.id)).status, 204);
    t.eq(await fisico(p.id), 10);
  });
  await t.caso('DELETE de ENTRADA cujas unidades já foram usadas → 409 e NADA muda (movimentação continua existindo)', async () => {
    const p = await comSaldo(0);
    const e = t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 5 }), 201);
    t.sucesso(await mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 4 }), 201);
    L.erro(await del(e.id), 409, { contem: 'registre uma movimentação de correção' });
    t.eq([await fisico(p.id), await existe(e.id)], [1, 1]);
  });
  await t.caso('DELETE parcial: ENTRADA 5 com saldo 5 pode ser removida; com saldo 4 não', async () => {
    const p = await comSaldo(0);
    const e = t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 5 }), 201);
    t.sucesso(await mov({ produtoId: p.id, tipo: 'PERDA', quantidade: 1 }), 201);
    t.eq((await del(e.id)).status, 409);
    await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1 });
    t.eq((await del(e.id)).status, 204);
  });
  await t.caso('DELETE que estouraria 2147483647 (remover SAIDA com saldo no máximo) → 409 e nada muda', async () => {
    const p = await comSaldo(MAX);
    const m = await t.prisma.movimentacaoEstoque.create({ data: { produtoId: p.id, usuarioId: adm.id, tipo: 'SAIDA', quantidade: 5, motivo: 'x' } });
    L.erro(await del(m.id), 409, { contem: 'passaria de' });
    t.eq([await fisico(p.id), await existe(m.id)], [MAX, 1]);
  });
  await t.caso('DELETE inexistente → 404; id inválido → 400 campo=id; sem token → 401', async () => {
    L.erro(await del(2000000000), 404, { mensagem: 'Movimentação não encontrada.' });
    for (const id of ['abc', '0', '-1', '1.5']) L.erro(await del(id), 400, { campo: 'id' });
    L.erro(await t.http('DELETE', `/movimentacoes/${m1.id}`), 401);
  });
  await t.caso('DELETE da mesma movimentação duas vezes: a segunda dá 404 e o efeito é desfeito UMA vez', async () => {
    const p = await comSaldo(0);
    const m = t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 3 }), 201);
    await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 10 });
    t.eq((await del(m.id)).status, 204);
    t.eq((await del(m.id)).status, 404);
    t.eq(await fisico(p.id), 10);
  });
  await t.caso('PATCH/PUT de movimentação não existem (404 de rota): histórico só se corrige com nova movimentação', async () => {
    L.erro(await t.http('PATCH', `/movimentacoes/${m1.id}`, { token: adm.token, body: { quantidade: 1 } }), 404, { contem: 'Rota não encontrada' });
    L.erro(await t.http('PUT', `/movimentacoes/${m1.id}`, { token: adm.token, body: {} }), 404);
  });

  // ---------------------------------------------------------------- regra: movimentação de venda não se remove
  // Cria uma venda real pelo POST /pedidos (que grava a movimentação 'Venda - pedido #N').
  const pedirVenda = async (p, q = 2) => t.sucesso(await t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: p.id, quantidade: q }] } }), 201);
  // Regra decidida: movimentação cujo motivo começa com 'Venda - pedido' não pode ser removida (400). A checagem é pelo texto do motivo, sem vínculo real com o pedido.
  await t.caso('REGRA: DELETE da movimentação criada por um pedido → 400 com a mensagem exata, sem alterar nada', async () => {
    const p = await comSaldo(10);
    const ped = await pedirVenda(p, 3);
    const venda = await t.prisma.movimentacaoEstoque.findFirstOrThrow({ where: { produtoId: p.id } });
    t.eq(venda.motivo, `Venda - pedido #${ped.id}`);
    const r = await del(venda.id);
    L.erro(r, 400, { mensagem: MSG_VENDA, campo: null });
    t.eq([await fisico(p.id), await existe(venda.id)], [7, 1]);
  });
  // Variações que COMEÇAM com o prefixo (inclusive com espaços nas pontas, já aparados na criação): todas bloqueadas.
  for (const motivo of ['Venda - pedido #999', 'Venda - pedido', 'Venda - pedidos antigos', '  Venda - pedido #5  ', 'Venda - pedido #1 (manual)']) {
    await t.caso(`REGRA: motivo "${motivo}" (começa com "Venda - pedido") não pode ser removido → 400`, async () => {
      const p = await comSaldo(10);
      const m = t.sucesso(await mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 1, motivo }), 201);
      L.erro(await del(m.id), 400, { mensagem: MSG_VENDA });
      t.eq([await fisico(p.id), await existe(m.id)], [9, 1]);
    });
  }
  // Variações que NÃO começam com o prefixo exato (caixa diferente, hífen colado etc.): a remoção segue normal.
  for (const motivo of ['venda - pedido #1', 'Venda- pedido #1', 'Venda - ped', 'Pós Venda - pedido', 'Venda', 'Cancelamento - pedido #1']) {
    await t.caso(`REGRA: motivo "${motivo}" NÃO começa com o prefixo exato → remoção normal (204)`, async () => {
      const p = await comSaldo(10);
      const m = t.sucesso(await mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 1, motivo }), 201);
      t.eq((await del(m.id)).status, 204);
      t.eq(await fisico(p.id), 10);
    });
  }
  await t.caso('REGRA: o bloqueio vale para qualquer tipo/perfil (ENTRADA com motivo de venda; caixa tentando remover)', async () => {
    const p = await comSaldo(0);
    const m = t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 2, motivo: 'Venda - pedido #7' }), 201);
    L.erro(await del(m.id, cx.token), 400, { mensagem: MSG_VENDA });
  });
  await t.caso('REGRA: a checagem da venda vem antes da checagem de saldo (400, não 409)', async () => {
    const p = await comSaldo(0);
    const m = await t.prisma.movimentacaoEstoque.create({ data: { produtoId: p.id, usuarioId: adm.id, tipo: 'ENTRADA', quantidade: 9, motivo: 'Venda - pedido #3' } });
    L.erro(await del(m.id), 400, { mensagem: MSG_VENDA });
  });
  await t.caso('REGRA: várias vendas simultâneas — nenhuma movimentação de venda é removida, nem em paralelo', async () => {
    const p = await comSaldo(30);
    for (let i = 0; i < 4; i++) await pedirVenda(p, 2);
    const vendas = await t.prisma.movimentacaoEstoque.findMany({ where: { produtoId: p.id } });
    const rs = await t.paralelo(vendas.length * 2, (i) => del(vendas[i % vendas.length].id));
    t.verdade(rs.every((r) => r.status === 400));
    t.eq([await fisico(p.id), await t.contarMov(p.id)], [22, 4]);
  });

  // ---------------------------------------------------------------- o físico nunca fica negativo (modelo × realidade)
  // Teste baseado em modelo: compara o saldo da API com um modelo local após cada operação; o físico nunca fica negativo.
  await t.caso('MODELO: 120 operações pseudoaleatórias (POST/DELETE) — o saldo da API sempre igual ao do modelo e nunca negativo', async () => {
    let seed = 20261016;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const p = await comSaldo(5);
    let saldo = 5;
    const vivas = [];
    for (let i = 0; i < 120; i++) {
      if (vivas.length && rnd() < 0.3) {
        const k = Math.floor(rnd() * vivas.length);
        const m = vivas[k];
        const r = await del(m.id);
        const novo = saldo - efeito(m.tipo, m.q);
        if (novo < 0) {
          t.eq(r.status, 409);
        } else {
          t.eq(r.status, 204);
          saldo = novo;
          vivas.splice(k, 1);
        }
      } else {
        const tipo = ['ENTRADA', 'SAIDA', 'PERDA', 'AJUSTE'][Math.floor(rnd() * 4)];
        let q = 1 + Math.floor(rnd() * 8);
        if (tipo === 'AJUSTE' && rnd() < 0.5) q = -q;
        const novo = saldo + efeito(tipo, q);
        const r = await mov({ produtoId: p.id, tipo, quantidade: q });
        if (novo < 0) {
          t.eq(r.status, 400);
        } else {
          t.eq(r.status, 201);
          saldo = novo;
          vivas.push({ id: r.body.id, tipo, q });
        }
      }
      const real = await fisico(p.id);
      t.verdade(real >= 0, `negativo na operação ${i}`);
      t.eq(real, saldo, `divergiu do modelo na operação ${i}`);
    }
  });

  // ---------------------------------------------------------------- concorrência
  // Concorrência: o SELECT ... FOR UPDATE serializa as saídas; só cabem 5, as outras 7 recebem 400 e o saldo termina em 0.
  await t.caso('estoque 5 e 12 SAÍDAS simultâneas de 1: exatamente 5 passam, 7 recebem 400, físico 0 (nunca negativo)', async () => {
    const p = await comSaldo(5);
    const rs = await t.paralelo(12, () => mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 1 }));
    t.eq(rs.filter((r) => r.status === 201).length, 5, rs.map((r) => r.status).join());
    for (const r of rs.filter((x) => x.status !== 201)) L.erro(r, 400, { campo: 'quantidade', contem: 'Saldo insuficiente' });
    t.eq([await fisico(p.id), await t.contarMov(p.id)], [0, 5]);
  });
  await t.caso('PERDAs e SAÍDAs misturadas e simultâneas respeitam o mesmo limite', async () => {
    const p = await comSaldo(6);
    const rs = await t.paralelo(14, (i) => mov({ produtoId: p.id, tipo: i % 2 ? 'PERDA' : 'SAIDA', quantidade: 1 }));
    t.eq(rs.filter((r) => r.status === 201).length, 6);
    t.eq(await fisico(p.id), 0);
  });
  await t.caso('saídas de 3 unidades com estoque 10 e 8 requisições simultâneas → 3 passam, sobra 1', async () => {
    const p = await comSaldo(10);
    const rs = await t.paralelo(8, () => mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 3 }));
    t.eq(rs.filter((r) => r.status === 201).length, 3);
    t.eq(await fisico(p.id), 1);
  });
  await t.caso('20 ENTRADAs simultâneas: nenhuma se perde (físico +20, 20 linhas de histórico)', async () => {
    const p = await comSaldo(0);
    const rs = await t.paralelo(20, () => mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1 }));
    t.verdade(rs.every((r) => r.status === 201));
    t.eq([await fisico(p.id), await t.contarMov(p.id)], [20, 20]);
  });
  await t.caso('ENTRADAs e SAÍDAs simultâneas: saldo final = inicial + entradas − saídas aceitas', async () => {
    const p = await comSaldo(5);
    const rs = await t.paralelo(30, (i) => mov({ produtoId: p.id, tipo: i % 3 === 0 ? 'ENTRADA' : 'SAIDA', quantidade: 1 + (i % 3) }));
    const aceitas = (await t.prisma.movimentacaoEstoque.findMany({ where: { produtoId: p.id } })).reduce((s, x) => s + efeito(x.tipo, x.quantidade), 0);
    t.eq(await fisico(p.id), 5 + aceitas);
    t.verdade((await fisico(p.id)) >= 0);
    t.eq(rs.filter((r) => r.status === 201).length, await t.contarMov(p.id));
  });
  // Concorrência entre dois endpoints que alteram o mesmo saldo (movimentação AJUSTE × ajuste do produto).
  await t.caso('AJUSTE (movimentação) e ajuste de estoque do produto simultâneos: histórico fecha com o saldo', async () => {
    const p = await comSaldo(100);
    await t.paralelo(20, (i) => (i % 2 ? mov({ produtoId: p.id, tipo: 'AJUSTE', quantidade: -3 }) : t.http('PATCH', `/produtos/${p.id}/estoque`, { token: adm.token, body: { tipo: 'ENTRADA', quantidade: 2 } })));
    const soma = (await t.prisma.movimentacaoEstoque.findMany({ where: { produtoId: p.id } })).reduce((s, x) => s + efeito(x.tipo, x.quantidade), 0);
    t.eq(await fisico(p.id), 100 + soma);
    t.eq(soma, 10 * 2 - 10 * 3);
  });
  await t.caso('POST e DELETE simultâneos no mesmo produto: o saldo nunca fica negativo e fecha com o histórico', async () => {
    const p = await comSaldo(0);
    const ents = [];
    for (let i = 0; i < 6; i++) ents.push(t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 2 }), 201));
    await t.paralelo(12, (i) => (i < 6 ? del(ents[i].id) : mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 2 })));
    const soma = (await t.prisma.movimentacaoEstoque.findMany({ where: { produtoId: p.id } })).reduce((s, x) => s + efeito(x.tipo, x.quantidade), 0);
    t.eq(await fisico(p.id), soma);
    t.verdade(soma >= 0);
  });
  await t.caso('10 DELETEs simultâneos de ENTRADAs que cabem no saldo: todos 204 e saldo 0', async () => {
    const p = await comSaldo(0);
    const ms = [];
    for (let i = 0; i < 10; i++) ms.push(t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1 }), 201));
    const rs = await t.paralelo(10, (i) => del(ms[i].id));
    t.verdade(rs.every((r) => r.status === 204), rs.map((r) => r.status).join());
    t.eq([await fisico(p.id), await t.contarMov(p.id)], [0, 0]);
  });
  // Concorrência: só 5 remoções cabem sem deixar o saldo negativo; as demais viram 409.
  await t.caso('DELETEs simultâneos que NÃO cabem: saldo 5 de 10 entradas → o saldo nunca fica negativo (alguns 409)', async () => {
    const p = await comSaldo(0);
    const ms = [];
    for (let i = 0; i < 10; i++) ms.push(t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1 }), 201));
    for (let i = 0; i < 5; i++) t.sucesso(await mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 1 }), 201);
    const rs = await t.paralelo(10, (i) => del(ms[i].id));
    t.eq(rs.filter((r) => r.status === 204).length, 5, rs.map((r) => r.status).join());
    t.eq(rs.filter((r) => r.status === 409).length, 5);
    t.eq(await fisico(p.id), 0);
  });
  await t.caso('2 DELETEs simultâneos da MESMA movimentação: 1×204 e 1×404; saldo ajustado uma vez só', async () => {
    const p = await comSaldo(0);
    const m = t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 4 }), 201);
    await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 20 });
    const rs = await t.paralelo(6, () => del(m.id));
    t.eq(rs.filter((r) => r.status === 204).length, 1, rs.map((r) => r.status).join());
    t.eq(rs.filter((r) => r.status === 404).length, 5);
    t.eq(await fisico(p.id), 20);
  });
  await t.caso('movimentações em produtos DIFERENTES não se bloqueiam nem se misturam (10 produtos em paralelo)', async () => {
    const ps = [];
    for (let i = 0; i < 10; i++) ps.push(await comSaldo(i));
    const rs = await t.paralelo(10, (i) => mov({ produtoId: ps[i].id, tipo: 'ENTRADA', quantidade: 100 }));
    t.verdade(rs.every((r) => r.status === 201));
    for (let i = 0; i < 10; i++) t.eq(await fisico(ps[i].id), i + 100);
  });
  await t.caso('pedido (baixa) e SAÍDA manual simultâneos pela última unidade: só um passa', async () => {
    const p = await comSaldo(1);
    const rs = await t.paralelo(10, (i) => (i % 2 ? mov({ produtoId: p.id, tipo: 'SAIDA', quantidade: 1 }) : t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: p.id, quantidade: 1 }] } })));
    t.eq(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join());
    t.eq(await fisico(p.id), 0);
  });

  // ---------------------------------------------------------------- rollback
  await t.caso('ROLLBACK (POST): falha ao gravar a movimentação desfaz a atualização do saldo', async () => {
    const p = await comSaldo(10);
    const marca = t.unico('FALHA');
    // Rollback (POST): a movimentação falha depois do UPDATE do saldo; o saldo tem de voltar.
    await t.comConstraint('movimentacoes_estoque', 'chk_tc_mov1', `motivo IS DISTINCT FROM '${marca}'`, async () => {
      t.eq((await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 5, motivo: marca })).status, 500);
    });
    t.eq([await fisico(p.id), await t.contarMov(p.id)], [10, 0]);
  });
  await t.caso('ROLLBACK (POST): falha ao atualizar o saldo não deixa movimentação gravada', async () => {
    const p = await comSaldo(10);
    // Rollback (POST): o UPDATE do saldo falha; nenhuma movimentação pode ficar gravada.
    await t.comConstraint('estoque', 'chk_tc_mov2', `"quantidadeFisica" <> 4242`, async () => {
      t.eq((await mov({ produtoId: p.id, tipo: 'AJUSTE', quantidade: 4232 })).status, 500);
    });
    t.eq([await fisico(p.id), await t.contarMov(p.id)], [10, 0]);
  });
  await t.caso('ROLLBACK (DELETE): falha ao atualizar o saldo desfaz o apagamento (movimentação continua existindo)', async () => {
    const p = await comSaldo(4247);
    const m = await t.prisma.movimentacaoEstoque.create({ data: { produtoId: p.id, usuarioId: adm.id, tipo: 'ENTRADA', quantidade: 5, motivo: 'x' } });
    // Rollback (DELETE): o apagamento da movimentação acontece antes do UPDATE do saldo; se o UPDATE falha, o apagamento é desfeito.
    await t.comConstraint('estoque', 'chk_tc_mov3', `"quantidadeFisica" <> 4242`, async () => {
      t.eq((await del(m.id)).status, 500);
    });
    t.eq([await fisico(p.id), await existe(m.id)], [4247, 1]);
    t.eq((await del(m.id)).status, 204); // sem a constraint, remove normalmente
    t.eq(await fisico(p.id), 4242);
  });
  await t.caso('ROLLBACK (DELETE 409): a movimentação é apagada e depois restaurada pelo rollback quando o saldo ficaria negativo', async () => {
    const p = await comSaldo(1);
    const m = await t.prisma.movimentacaoEstoque.create({ data: { produtoId: p.id, usuarioId: adm.id, tipo: 'ENTRADA', quantidade: 5, motivo: 'x' } });
    t.eq((await del(m.id)).status, 409);
    t.eq([await fisico(p.id), await existe(m.id)], [1, 1]);
  });

  // ---------------------------------------------------------------- permissões e divergências
  // Lacuna conhecida: qualquer perfil cria, remove e lista movimentações.
  await t.lacuna('caixa cria movimentação (201)', async () => {
    t.sucesso(await mov({ produtoId: pv.id, tipo: 'ENTRADA', quantidade: 1 }, cx.token), 201);
  });
  await t.lacuna('atendente cria movimentação (201)', async () => {
    t.sucesso(await mov({ produtoId: pv.id, tipo: 'ENTRADA', quantidade: 1 }, at.token), 201);
  });
  await t.lacuna('atendente remove movimentação (204)', async () => {
    const m = t.sucesso(await mov({ produtoId: pv.id, tipo: 'ENTRADA', quantidade: 1 }), 201);
    t.eq((await del(m.id, at.token)).status, 204);
  });
  await t.lacuna('qualquer perfil lista o histórico completo (200)', async () => {
    t.sucesso(await t.http('GET', '/movimentacoes', { token: at.token }));
  });
  // [DIVERGE-PDF] D12 — PDF prevê os tipos venda e retorno; a API só aceita ENTRADA, SAIDA, PERDA e AJUSTE.
  await t.diverge('tipos aceitos: só ENTRADA, SAIDA, PERDA e AJUSTE — VENDA e RETORNO do PDF são rejeitados', async () => {
    for (const tipo of ['VENDA', 'RETORNO']) L.erro(await mov({ produtoId: pv.id, tipo, quantidade: 1 }), 400, { campo: 'tipo' });
  });
  // [DIVERGE-PDF] D12 — PDF: id_pedido FK NULL na movimentação; aqui o vínculo é só o texto do motivo (decisão registrada no CLAUDE.md).
  await t.diverge('a movimentação não tem pedidoId: o vínculo com a venda é só o texto do motivo "Venda - pedido #N" (decisão registrada)', async () => {
    t.verdade(!('pedidoId' in m1));
  });
  // [DIVERGE-PDF] D6 — PDF: id_usuario FK NULL.
  await t.diverge('movimentação exige usuário (usuarioId obrigatório); PDF: id_usuario FK NULL', async () => {
    t.verdade(Number.isInteger(m1.usuarioId));
  });
  // [DIVERGE-PDF] D13 — PDF: quantidade NUMERIC(12,3).
  await t.diverge('quantidade de movimentação só inteira (PDF: NUMERIC(12,3))', async () => {
    L.erro(await mov({ produtoId: pv.id, tipo: 'ENTRADA', quantidade: 0.5 }), 400, { campo: 'quantidade' });
  });
  // [DIVERGE-PDF] D15 — o DELETE remove o histórico de estoque sem auditoria.
  await t.diverge('DELETE apaga fisicamente a movimentação sem deixar rastro de auditoria (PDF exige usuário/data/informação de alterações críticas de estoque)', async () => {
    const p = await comSaldo(0);
    const m = t.sucesso(await mov({ produtoId: p.id, tipo: 'ENTRADA', quantidade: 1 }), 201);
    t.eq((await del(m.id)).status, 204);
    t.eq(await existe(m.id), 0);
  });
});
