'use strict';
// Ajuste de estoque pelo produto: PATCH /produtos/:id/estoque (ENTRADA e AJUSTE).
const L = require('./_lib.cjs');
const t = L.suite('estoque');

const MAX = 2147483647;

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  // Atalho para PATCH /produtos/:id/estoque.
  const ajustar = (id, body, token = adm.token) => t.http('PATCH', `/produtos/${id}/estoque`, { token, body });
  // Histórico do produto em ordem de criação, para conferir as movimentações geradas.
  const movs = (produtoId) => t.prisma.movimentacaoEstoque.findMany({ where: { produtoId }, orderBy: { id: 'asc' } });
  // Produto criado direto no banco SEM linha de estoque (a API cria a linha sob demanda).
  const semEstoque = async () => {
    const cat = await t.categoria();
    return t.prisma.produto.create({ data: { nome: t.unico('sem'), precoVenda: '5.00', categoriaId: cat.id } });
  };

  // ---------------------------------------------------------------- ENTRADA
  await t.caso('ENTRADA soma ao físico e devolve o produto com quantidadeDisponivel atualizada', async () => {
    const p = await t.produto({ qtd: 10 });
    const r = t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 5 }));
    t.eq(r.id, p.id);
    t.eq(r.quantidadeDisponivel, 15);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 15);
  });
  await t.caso('ENTRADA grava UMA movimentação ENTRADA com a quantidade, usuário do token e motivo padrão', async () => {
    const p = await t.produto({ qtd: 1 });
    t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 4 }, adm.token));
    const [m] = await movs(p.id);
    t.eq([m.tipo, m.quantidade, m.motivo, m.usuarioId], ['ENTRADA', 4, 'Reposição de estoque', adm.id]);
  });
  await t.caso('motivo informado é gravado (aparado)', async () => {
    const p = await t.produto();
    t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1, motivo: '  Compra NF 123 ' }));
    t.eq((await movs(p.id))[0].motivo, 'Compra NF 123');
  });
  await t.caso('motivo vazio/espaços/null cai no motivo padrão', async () => {
    const p = await t.produto();
    for (const motivo of ['', '   ', null]) t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1, motivo }));
    t.eq((await movs(p.id)).map((m) => m.motivo), ['Reposição de estoque', 'Reposição de estoque', 'Reposição de estoque']);
  });
  await t.caso('tipo aceita minúsculas e espaços ("  entrada ")', async () => {
    const p = await t.produto();
    t.sucesso(await ajustar(p.id, { tipo: '  entrada ', quantidade: 2 }));
    t.eq((await t.saldo(p.id)).quantidadeFisica, 2);
  });
  await t.caso('ENTRADA em produto sem linha de estoque cria a linha', async () => {
    const p = await semEstoque();
    t.eq(await t.prisma.estoque.count({ where: { produtoId: p.id } }), 0);
    t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 3 }));
    t.eq((await t.saldo(p.id)).quantidadeFisica, 3);
  });
  await t.caso('ENTRADA não mexe no estoque reservado nem no mínimo', async () => {
    const p = await t.produto({ qtd: 5, reservada: 2, minimo: 9 });
    t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1 }));
    const s = await t.saldo(p.id);
    t.eq([s.quantidadeFisica, s.quantidadeReservada, s.estoqueMinimo], [6, 2, 9]);
  });
  await t.caso('ENTRADA em produto INATIVO é permitida (comportamento atual)', async () => {
    const p = await t.produto({ ativo: false });
    t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1 }));
  });
  await t.caso('ENTRADA que chega exatamente a 2147483647 é aceita', async () => {
    const p = await t.produto({ qtd: MAX - 1 });
    t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1 }));
    t.eq((await t.saldo(p.id)).quantidadeFisica, MAX);
  });
  await t.caso('ENTRADA que ultrapassa 2147483647 → 400 campo=quantidade e nada muda', async () => {
    const p = await t.produto({ qtd: MAX });
    L.erro(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1 }), 400, { campo: 'quantidade', contem: 'não pode passar' });
    t.eq((await t.saldo(p.id)).quantidadeFisica, MAX);
    t.eq(await t.contarMov(p.id), 0);
  });

  // ---------------------------------------------------------------- AJUSTE
  // AJUSTE = 'estoque contado': o físico vira o valor informado; a diferença vira ENTRADA (positiva) ou SAIDA (negativa).
  // Diferença zero não grava movimentação.
  await t.caso('AJUSTE para MAIS: físico vira o valor contado; movimentação ENTRADA com a diferença', async () => {
    const p = await t.produto({ qtd: 4 });
    t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 10 }));
    t.eq((await t.saldo(p.id)).quantidadeFisica, 10);
    const [m] = await movs(p.id);
    t.eq([m.tipo, m.quantidade, m.motivo], ['ENTRADA', 6, 'Ajuste manual de estoque']);
  });
  await t.caso('AJUSTE para MENOS: físico vira o valor contado; movimentação SAIDA com a diferença', async () => {
    const p = await t.produto({ qtd: 10 });
    t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 3 }));
    t.eq((await t.saldo(p.id)).quantidadeFisica, 3);
    const [m] = await movs(p.id);
    t.eq([m.tipo, m.quantidade], ['SAIDA', 7]);
  });
  await t.caso('AJUSTE para zero é permitido', async () => {
    const p = await t.produto({ qtd: 6 });
    t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 0 }));
    t.eq((await t.saldo(p.id)).quantidadeFisica, 0);
  });
  await t.caso('AJUSTE igual ao físico: nada muda e NÃO gera movimentação', async () => {
    const p = await t.produto({ qtd: 5 });
    t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 5 }));
    t.eq(await t.contarMov(p.id), 0);
  });
  await t.caso('AJUSTE 0 em produto já zerado e sem linha de estoque: cria a linha, sem movimentação', async () => {
    const p = await semEstoque();
    t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 0 }));
    t.eq(await t.prisma.estoque.count({ where: { produtoId: p.id } }), 1);
    t.eq(await t.contarMov(p.id), 0);
  });
  await t.caso('AJUSTE motivo informado substitui o padrão', async () => {
    const p = await t.produto({ qtd: 2 });
    t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 1, motivo: 'Inventário de outubro' }));
    t.eq((await movs(p.id))[0].motivo, 'Inventário de outubro');
  });
  await t.caso('AJUSTE abaixo do reservado é aceito; disponível fica 0 (nunca negativo)', async () => {
    const p = await t.produto({ qtd: 10, reservada: 6 });
    const r = t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 2 }));
    t.eq(r.quantidadeDisponivel, 0);
  });
  await t.caso('AJUSTE para exatamente 2147483647 é aceito', async () => {
    const p = await t.produto({ qtd: 1 });
    t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: MAX }));
    t.eq((await t.saldo(p.id)).quantidadeFisica, MAX);
  });
  await t.caso('o saldo registrado = saldo inicial + soma dos efeitos das movimentações geradas', async () => {
    const p = await t.produto({ qtd: 0 });
    for (const [tipo, q] of [['ENTRADA', 10], ['AJUSTE', 4], ['ENTRADA', 3], ['AJUSTE', 20], ['AJUSTE', 0]]) t.sucesso(await ajustar(p.id, { tipo, quantidade: q }));
    const soma = (await movs(p.id)).reduce((s, m) => s + (m.tipo === 'ENTRADA' ? m.quantidade : -m.quantidade), 0);
    t.eq(soma, (await t.saldo(p.id)).quantidadeFisica);
    t.eq(soma, 0);
  });

  // ---------------------------------------------------------------- validação
  // Produto alvo da matriz de validação: nenhum caso inválido pode alterar saldo nem criar movimentação.
  const p0 = await t.produto({ qtd: 8 });
  // Matriz de validação: tipo (só ENTRADA/AJUSTE), quantidade (inteira; ENTRADA >= 1; AJUSTE >= 0) e motivo (até 200).
  for (const [rotulo, body, campo] of [
    ['tipo ausente', { quantidade: 1 }, 'tipo'], ['tipo vazio', { tipo: '', quantidade: 1 }, 'tipo'],
    ['tipo SAIDA (só ENTRADA/AJUSTE aqui)', { tipo: 'SAIDA', quantidade: 1 }, 'tipo'], ['tipo PERDA', { tipo: 'PERDA', quantidade: 1 }, 'tipo'],
    ['tipo VENDA', { tipo: 'VENDA', quantidade: 1 }, 'tipo'], ['tipo RETORNO', { tipo: 'RETORNO', quantidade: 1 }, 'tipo'],
    ['tipo numérico', { tipo: 1, quantidade: 1 }, 'tipo'], ['tipo nulo', { tipo: null, quantidade: 1 }, 'tipo'],
    ['quantidade ausente', { tipo: 'ENTRADA' }, 'quantidade'], ['quantidade texto "5"', { tipo: 'ENTRADA', quantidade: '5' }, 'quantidade'],
    ['quantidade fracionária', { tipo: 'ENTRADA', quantidade: 1.5 }, 'quantidade'], ['quantidade nula', { tipo: 'AJUSTE', quantidade: null }, 'quantidade'],
    ['quantidade booleana', { tipo: 'AJUSTE', quantidade: true }, 'quantidade'], ['quantidade acima de int32', { tipo: 'ENTRADA', quantidade: MAX + 1 }, 'quantidade'],
    ['ENTRADA zero', { tipo: 'ENTRADA', quantidade: 0 }, 'quantidade'], ['ENTRADA negativa', { tipo: 'ENTRADA', quantidade: -2 }, 'quantidade'],
    ['AJUSTE negativo', { tipo: 'AJUSTE', quantidade: -1 }, 'quantidade'],
    ['motivo numérico', { tipo: 'ENTRADA', quantidade: 1, motivo: 5 }, 'motivo'], ['motivo com 201 caracteres', { tipo: 'ENTRADA', quantidade: 1, motivo: 'm'.repeat(201) }, 'motivo'],
  ]) {
    await t.caso(`${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await ajustar(p0.id, body), 400, { campo });
    });
  }
  await t.caso('motivo com exatamente 200 caracteres é aceito', async () => {
    t.sucesso(await ajustar(p0.id, { tipo: 'ENTRADA', quantidade: 1, motivo: 'm'.repeat(200) }));
  });
  await t.caso('nenhuma validação com falha alterou saldo ou criou movimentação', async () => {
    t.eq((await t.saldo(p0.id)).quantidadeFisica, 9);
    t.eq(await t.contarMov(p0.id), 1);
  });
  await t.caso('sem corpo → 400 campo=tipo', async () => {
    L.erro(await t.http('PATCH', `/produtos/${p0.id}/estoque`, { token: adm.token }), 400, { campo: 'tipo' });
  });
  await t.caso('produto inexistente → 404 "Produto não encontrado."', async () => {
    L.erro(await ajustar(2000000000, { tipo: 'ENTRADA', quantidade: 1 }), 404, { mensagem: 'Produto não encontrado.' });
  });
  for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
    await t.caso(`id inválido '${id}' → 400 campo=id`, async () => {
      L.erro(await ajustar(id, { tipo: 'ENTRADA', quantidade: 1 }), 400, { campo: 'id' });
    });
  }
  await t.caso('sem token → 401; token inválido → 401', async () => {
    L.erro(await t.http('PATCH', `/produtos/${p0.id}/estoque`, { body: { tipo: 'ENTRADA', quantidade: 1 } }), 401);
    L.erro(await ajustar(p0.id, { tipo: 'ENTRADA', quantidade: 1 }, 'lixo'), 401);
  });
  await t.caso('JSON malformado → 400', async () => {
    L.erro(await t.http('PATCH', `/produtos/${p0.id}/estoque`, { token: adm.token, rawBody: '{tipo' }), 400, { contem: 'JSON' });
  });
  // Permissões: os três perfis controlam estoque (ajuste); a movimentação grava o usuário do TOKEN de quem ajustou.
  for (const [nome, u] of [['administrador', adm], ['caixa', cx], ['atendente', at]]) {
    await t.caso(`${nome} ajusta estoque (200) e a movimentação grava o usuário do token`, async () => {
      const p = await t.produto({ qtd: 1 });
      t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 2 }, u.token));
      t.eq((await t.saldo(p.id)).quantidadeFisica, 3);
      const [m] = await movs(p.id);
      t.eq(m.usuarioId, u.id);
    });
  }

  // ---------------------------------------------------------------- concorrência
  // Concorrência: o SELECT ... FOR UPDATE serializa os ajustes; nenhum incremento se perde.
  await t.caso('20 ENTRADAs de +1 em paralelo: físico exato (+20) e 20 movimentações', async () => {
    const p = await t.produto({ qtd: 0 });
    const rs = await t.paralelo(20, () => ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1 }));
    t.verdade(rs.every((r) => r.status === 200), rs.map((r) => r.status).join());
    t.eq((await t.saldo(p.id)).quantidadeFisica, 20);
    t.eq(await t.contarMov(p.id), 20);
  });
  // Concorrência: ajustes concorrentes têm um vencedor, e o histórico precisa fechar com o saldo final.
  await t.caso('AJUSTEs simultâneos para valores diferentes: vence um valor e o histórico fecha com o saldo', async () => {
    const p = await t.produto({ qtd: 50 });
    const alvos = [10, 20, 30, 40, 5, 60];
    const rs = await t.paralelo(alvos.length, (i) => ajustar(p.id, { tipo: 'AJUSTE', quantidade: alvos[i] }));
    t.verdade(rs.every((r) => r.status === 200));
    const fim = (await t.saldo(p.id)).quantidadeFisica;
    t.verdade(alvos.includes(fim), `físico final ${fim} não é um dos valores pedidos`);
    const soma = (await movs(p.id)).reduce((s, m) => s + (m.tipo === 'ENTRADA' ? m.quantidade : -m.quantidade), 0);
    t.eq(50 + soma, fim);
  });
  await t.caso('ajuste (ENTRADA) e movimentação (SAIDA) simultâneos: saldo = inicial + entradas − saídas', async () => {
    const p = await t.produto({ qtd: 100 });
    const rs = await t.paralelo(20, (i) =>
      i % 2 === 0
        ? ajustar(p.id, { tipo: 'ENTRADA', quantidade: 3 })
        : t.http('POST', '/movimentacoes', { token: adm.token, body: { produtoId: p.id, tipo: 'SAIDA', quantidade: 2 } }),
    );
    t.verdade(rs.every((r) => r.status === 200 || r.status === 201), rs.map((r) => r.status).join());
    t.eq((await t.saldo(p.id)).quantidadeFisica, 100 + 10 * 3 - 10 * 2);
    t.eq(await t.contarMov(p.id), 20);
  });
  await t.caso('AJUSTE e ENTRADA simultâneos: histórico sempre reconstitui o saldo', async () => {
    const p = await t.produto({ qtd: 10 });
    await t.paralelo(10, (i) => (i % 2 ? ajustar(p.id, { tipo: 'ENTRADA', quantidade: 5 }) : ajustar(p.id, { tipo: 'AJUSTE', quantidade: 7 })));
    const soma = (await movs(p.id)).reduce((s, m) => s + (m.tipo === 'ENTRADA' ? m.quantidade : -m.quantidade), 0);
    t.eq(10 + soma, (await t.saldo(p.id)).quantidadeFisica);
  });
  await t.caso('o físico nunca fica negativo: 10 AJUSTEs para 0 e ENTRADAs misturados', async () => {
    const p = await t.produto({ qtd: 5 });
    await t.paralelo(10, (i) => (i % 2 ? ajustar(p.id, { tipo: 'AJUSTE', quantidade: 0 }) : ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1 })));
    t.verdade((await t.saldo(p.id)).quantidadeFisica >= 0);
  });
  await t.caso('ENTRADAs simultâneas em produto SEM linha de estoque criam uma única linha', async () => {
    const p = await semEstoque();
    const rs = await t.paralelo(8, () => ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1 }));
    t.verdade(rs.every((r) => r.status === 200), rs.map((r) => r.status).join());
    t.eq(await t.prisma.estoque.count({ where: { produtoId: p.id } }), 1);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 8);
  });

  // ---------------------------------------------------------------- rollback
  await t.caso('rollback: falha ao gravar a movimentação desfaz a atualização do estoque', async () => {
    const p = await t.produto({ qtd: 10 });
    const marca = t.unico('FALHA');
    // Rollback: constraint temporária impede a movimentação (motivo marcado); o UPDATE do saldo já feito na transação tem de ser desfeito.
    await t.comConstraint('movimentacoes_estoque', 'chk_tc_est1', `motivo IS DISTINCT FROM '${marca}'`, async () => {
      const r = await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 5, motivo: marca });
      t.eq(r.status, 500);
    });
    t.eq((await t.saldo(p.id)).quantidadeFisica, 10);
    t.eq(await t.contarMov(p.id), 0);
  });
  await t.caso('rollback: falha no UPDATE do estoque não deixa movimentação órfã', async () => {
    const p = await t.produto({ qtd: 1 });
    // Rollback: constraint temporária impede o saldo 4242; a transação falha antes de gravar qualquer movimentação.
    await t.comConstraint('estoque', 'chk_tc_est2', `"quantidadeFisica" <> 4242`, async () => {
      t.eq((await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 4242 })).status, 500);
    });
    t.eq((await t.saldo(p.id)).quantidadeFisica, 1);
    t.eq(await t.contarMov(p.id), 0);
  });
  await t.caso('rollback: a linha de estoque criada dentro da transação também some', async () => {
    const p = await semEstoque();
    const marca = t.unico('FALHA');
    await t.comConstraint('movimentacoes_estoque', 'chk_tc_est3', `motivo IS DISTINCT FROM '${marca}'`, async () => {
      t.eq((await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 2, motivo: marca })).status, 500);
    });
    t.eq(await t.prisma.estoque.count({ where: { produtoId: p.id } }), 0);
  });
  await t.caso('depois da falha forçada (constraint removida) a operação volta a funcionar', async () => {
    const p = await t.produto({ qtd: 1 });
    t.sucesso(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 1 }));
  });

  // ---------------------------------------------------------------- divergências
  // [DIVERGE-PDF] D12 — o PDF prevê movimentos de tipo ajuste/venda/retorno; a API grava só ENTRADA ou SAIDA.
  await t.diverge('AJUSTE a menor é gravado como movimentação SAIDA e a maior como ENTRADA — nunca existe o tipo AJUSTE/VENDA/RETORNO do PDF', async () => {
    const p = await t.produto({ qtd: 5 });
    t.sucesso(await ajustar(p.id, { tipo: 'AJUSTE', quantidade: 2 }));
    t.eq((await movs(p.id))[0].tipo, 'SAIDA');
  });
  // [DIVERGE-PDF] D13 — o PDF define quantidade como NUMERIC(12,3).
  await t.diverge('estoque aceita só inteiros (PDF: NUMERIC(12,3), permite fração)', async () => {
    const p = await t.produto();
    L.erro(await ajustar(p.id, { tipo: 'ENTRADA', quantidade: 0.5 }), 400, { campo: 'quantidade' });
  });
  // [DIVERGE-PDF] D15 — o PDF exige auditoria de alterações críticas de estoque; só existe a movimentação.
  await t.diverge('ajuste de estoque não registra auditoria além da movimentação (PDF exige trilha de auditoria)', async () => {
    const t1 = await t.prisma.$queryRaw`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%auditoria%'`;
    t.eq(t1.length, 0);
  });
});
