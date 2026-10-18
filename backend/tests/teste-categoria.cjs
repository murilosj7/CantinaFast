'use strict';
// Categorias: CRUD, validação, filtros, exclusão lógica, permissões.
const L = require('./_lib.cjs');
const t = L.suite('categoria');

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  // Atalho para POST /categorias (administrador por padrão).
  const criar = (nome, token = adm.token) => t.http('POST', '/categorias', { token, body: { nome } });

  // ---- criar
  // Categoria base reaproveitada pelos casos de edição e de permissão.
  let cat;
  await t.caso('POST cria categoria (201) com id, nome e ativa=true', async () => {
    const r = await criar(t.unico('A'));
    cat = t.sucesso(r, 201);
    t.verdade(Number.isInteger(cat.id));
    t.eq(cat.ativa, true);
    t.eq(Object.keys(cat).sort(), ['ativa', 'id', 'nome']);
  });
  await t.caso('POST apara espaços do nome', async () => {
    const r = await criar(`  ${t.unico('trim')}  `);
    const c = t.sucesso(r, 201);
    t.eq(c.nome, c.nome.trim());
    t.verdade(c.nome.startsWith(t.prefixo));
  });
  await t.caso('POST aceita nome de exatamente 80 caracteres', async () => {
    const nome = (t.prefixo + 'x'.repeat(80)).slice(0, 80);
    t.eq(t.sucesso(await criar(nome), 201).nome.length, 80);
  });
  await t.caso('POST aceita nomes repetidos (não há unicidade de nome)', async () => {
    const nome = t.unico('dup');
    t.sucesso(await criar(nome), 201);
    t.sucesso(await criar(nome), 201);
  });
  await t.caso('POST aceita acentos e emoji', async () => {
    t.sucesso(await criar(t.unico('Pão de queijo 🧀')), 201);
  });
  // Nomes inválidos: o validador exige texto não vazio de até 80 caracteres; o erro é 400 e aponta campo=nome.
  const invalidos = [
    ['nome ausente', undefined],
    ['nome vazio', ''],
    ['nome só espaços', '    '],
    ['nome numérico', 123],
    ['nome nulo', null],
    ['nome booleano', true],
    ['nome objeto', { a: 1 }],
    ['nome array', ['a']],
    ['nome com 81 caracteres', 'y'.repeat(81)],
  ];
  for (const [rotulo, nome] of invalidos) {
    await t.caso(`POST ${rotulo} → 400 campo=nome`, async () => {
      L.erro(await t.http('POST', '/categorias', { token: adm.token, body: nome === undefined ? {} : { nome } }), 400, { campo: 'nome' });
    });
  }
  await t.caso('POST sem corpo → 400 campo=nome', async () => {
    L.erro(await t.http('POST', '/categorias', { token: adm.token }), 400, { campo: 'nome' });
  });
  await t.caso('POST com JSON malformado → 400 sem campo', async () => {
    L.erro(await t.http('POST', '/categorias', { token: adm.token, rawBody: '{"nome": ' }), 400, { campo: null, contem: 'JSON' });
  });
  await t.caso('POST sem token → 401', async () => {
    L.erro(await t.http('POST', '/categorias', { body: { nome: 'x' } }), 401);
  });

  // ---- listar (pública)
  await t.caso('GET /categorias é público (sem token) e devolve lista', async () => {
    const r = await t.http('GET', '/categorias');
    t.verdade(Array.isArray(t.sucesso(r)));
  });
  await t.caso('GET lista só ativas por padrão e ordena por nome', async () => {
    const b = await t.categoria({ nome: t.unico('ord-b') });
    const a = await t.categoria({ nome: t.unico('ord-a') });
    const r = t.sucesso(await t.http('GET', `/categorias?busca=${encodeURIComponent(t.prefixo + 'ord-')}`));
    t.eq(r.map((c) => c.id), [a.id, b.id].sort((x, y) => (x === a.id ? -1 : 1)));
    t.verdade(r.every((c) => c.ativa));
  });
  // Categoria inativa semeada direto no banco, para os filtros de status e a reativação.
  const inativa = await t.categoria({ nome: t.unico('inat'), ativa: false });
  await t.caso('GET ?status=inativa traz só inativas', async () => {
    const r = t.sucesso(await t.http('GET', `/categorias?status=inativa&busca=${t.prefixo}`));
    t.verdade(r.length >= 1 && r.every((c) => !c.ativa));
    t.verdade(r.some((c) => c.id === inativa.id));
  });
  await t.caso('GET ?status=todas traz ativas e inativas', async () => {
    const r = t.sucesso(await t.http('GET', `/categorias?status=todas&busca=${t.prefixo}`));
    t.verdade(r.some((c) => c.ativa) && r.some((c) => !c.ativa));
  });
  await t.caso('GET ?status=ativa explícito = padrão', async () => {
    const r = t.sucesso(await t.http('GET', `/categorias?status=ativa&busca=${t.prefixo}`));
    t.verdade(r.every((c) => c.ativa));
  });
  await t.caso('GET ?status vazio = padrão (ativas)', async () => {
    const r = t.sucesso(await t.http('GET', `/categorias?status=&busca=${t.prefixo}`));
    t.verdade(r.every((c) => c.ativa));
  });
  await t.caso('GET ?status inválido → 400 campo=status', async () => {
    L.erro(await t.http('GET', '/categorias?status=xyz'), 400, { campo: 'status' });
  });
  await t.caso('GET ?busca é parcial e ignora maiúsculas', async () => {
    const nome = t.unico('BuscaCase');
    await t.categoria({ nome });
    const r = t.sucesso(await t.http('GET', `/categorias?busca=${encodeURIComponent(nome.toUpperCase())}`));
    t.eq(r.length, 1);
    t.eq(r[0].nome, nome);
  });
  await t.caso('GET ?busca sem resultado → lista vazia', async () => {
    t.eq(t.sucesso(await t.http('GET', `/categorias?busca=${t.prefixo}naoexiste_zzz`)), []);
  });
  await t.caso('GET ?busca só espaços é ignorada', async () => {
    t.verdade(Array.isArray(t.sucesso(await t.http('GET', '/categorias?busca=%20%20'))));
  });

  // ---- atualizar
  await t.caso('PATCH atualiza o nome', async () => {
    const novo = t.unico('novo');
    const r = t.sucesso(await t.http('PATCH', `/categorias/${cat.id}`, { token: adm.token, body: { nome: novo } }));
    t.eq(r.nome, novo);
    t.eq(r.ativa, true);
  });
  await t.caso('PATCH reativa categoria inativa (ativa=true)', async () => {
    const r = t.sucesso(await t.http('PATCH', `/categorias/${inativa.id}`, { token: adm.token, body: { ativa: true } }));
    t.eq(r.ativa, true);
  });
  await t.caso('PATCH desativa via ativa=false', async () => {
    const r = t.sucesso(await t.http('PATCH', `/categorias/${inativa.id}`, { token: adm.token, body: { ativa: false } }));
    t.eq(r.ativa, false);
  });
  // Matriz de PATCH inválido: cada valor viola tipo ou tamanho e o erro aponta o campo certo.
  const patchRuins = [
    ['ativa string', { ativa: 'true' }, 'ativa'],
    ['ativa número', { ativa: 1 }, 'ativa'],
    ['ativa nula', { ativa: null }, 'ativa'],
    ['nome vazio', { nome: '' }, 'nome'],
    ['nome longo', { nome: 'z'.repeat(81) }, 'nome'],
    ['nome nulo', { nome: null }, 'nome'],
  ];
  for (const [rotulo, body, campo] of patchRuins) {
    await t.caso(`PATCH ${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await t.http('PATCH', `/categorias/${cat.id}`, { token: adm.token, body }), 400, { campo });
    });
  }
  await t.caso('PATCH sem campos → 400 (sem campo)', async () => {
    L.erro(await t.http('PATCH', `/categorias/${cat.id}`, { token: adm.token, body: {} }), 400, { campo: null, contem: 'ao menos um campo' });
  });
  await t.caso('PATCH ignora campos desconhecidos (só id/nome/ativa mudam)', async () => {
    const r = t.sucesso(await t.http('PATCH', `/categorias/${cat.id}`, { token: adm.token, body: { nome: cat.nome + 'z', id: 999999, lixo: 1 } }));
    t.eq(r.id, cat.id);
  });
  await t.caso('PATCH de id inexistente → 404', async () => {
    L.erro(await t.http('PATCH', '/categorias/2000000000', { token: adm.token, body: { nome: 'x' } }), 404, { contem: 'não encontrada' });
  });
  // Ids que o parseId recusa: não numérico, zero, negativo, decimal, acima de int32 e notação científica.
  for (const id of ['abc', '0', '-1', '1.5', '2147483648', '1e3']) {
    await t.caso(`PATCH com id inválido '${id}' → 400 campo=id`, async () => {
      L.erro(await t.http('PATCH', `/categorias/${id}`, { token: adm.token, body: { nome: 'x' } }), 400, { campo: 'id' });
    });
  }

  // ---- inativar (exclusão lógica)
  await t.caso('PATCH /:id/inativar marca ativa=false e mantém o registro', async () => {
    const c = await t.categoria();
    const r = t.sucesso(await t.http('PATCH', `/categorias/${c.id}/inativar`, { token: adm.token }));
    t.eq(r.ativa, false);
    t.eq((await t.prisma.categoria.findUnique({ where: { id: c.id } })).ativa, false);
  });
  await t.caso('inativar é idempotente', async () => {
    const c = await t.categoria({ ativa: false });
    t.eq(t.sucesso(await t.http('PATCH', `/categorias/${c.id}/inativar`, { token: adm.token })).ativa, false);
  });
  await t.caso('inativar categoria inexistente → 404', async () => {
    L.erro(await t.http('PATCH', '/categorias/2000000000/inativar', { token: adm.token }), 404);
  });
  await t.caso('inativar com id inválido → 400', async () => {
    L.erro(await t.http('PATCH', '/categorias/xx/inativar', { token: adm.token }), 400, { campo: 'id' });
  });
  await t.caso('inativar categoria não afeta produtos já existentes dela', async () => {
    const c = await t.categoria();
    const p = await t.produto({ categoriaId: c.id });
    t.sucesso(await t.http('PATCH', `/categorias/${c.id}/inativar`, { token: adm.token }));
    t.eq((await t.prisma.produto.findUnique({ where: { id: p.id } })).ativo, true);
  });
  await t.caso('categoria inativada some da lista padrão', async () => {
    const c = await t.categoria();
    t.sucesso(await t.http('PATCH', `/categorias/${c.id}/inativar`, { token: adm.token }));
    const r = t.sucesso(await t.http('GET', `/categorias?busca=${c.nome}`));
    t.eq(r, []);
  });
  await t.caso('não existe DELETE de categoria (404 de rota)', async () => {
    L.erro(await t.http('DELETE', `/categorias/${cat.id}`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
  });

  // ---- autenticação / permissões
  // Rotas de escrita exigem token: sem Authorization a resposta é 401 antes de qualquer validação.
  for (const [m, rota, body] of [['PATCH', `/categorias/${cat.id}`, { nome: 'x' }], ['PATCH', `/categorias/${cat.id}/inativar`, undefined]]) {
    await t.caso(`${m} ${rota.replace(cat.id, ':id')} sem token → 401`, async () => {
      L.erro(await t.http(m, rota, { body }), 401);
    });
  }
  // Permissões: criar, editar e inativar categoria é só do administrador (caixa e atendente → 403; a leitura segue pública).
  for (const [nome, u] of [['caixa', cx], ['atendente', at]]) {
    await t.caso(`${nome} não cria categoria → 403`, async () => {
      const antes = await t.prisma.categoria.count();
      L.erro(await criar(t.unico('x'), u.token), 403, { campo: null, contem: 'permissão' });
      t.eq(await t.prisma.categoria.count(), antes);
    });
    await t.caso(`${nome} não edita categoria → 403`, async () => {
      L.erro(await t.http('PATCH', `/categorias/${cat.id}`, { token: u.token, body: { nome: t.unico('x') } }), 403);
    });
    await t.caso(`${nome} não inativa categoria → 403 (e ela segue ativa)`, async () => {
      const c = await t.categoria();
      L.erro(await t.http('PATCH', `/categorias/${c.id}/inativar`, { token: u.token }), 403);
      t.eq((await t.prisma.categoria.findUnique({ where: { id: c.id } })).ativa, true);
    });
  }
  await t.caso('administrador cria e inativa categoria (201/200)', async () => {
    const c = t.sucesso(await criar(t.unico('adm')), 201);
    t.sucesso(await t.http('PATCH', `/categorias/${c.id}/inativar`, { token: adm.token }));
  });
  // [DIVERGE-PDF] D8 — a API expõe o campo como 'ativa'; o PDF chama o campo de 'ativo'.
  await t.diverge('o campo de situação da categoria se chama "ativa" (PDF: "ativo")', async () => {
    const c = t.sucesso(await criar(t.unico('campo')), 201);
    t.verdade('ativa' in c && !('ativo' in c));
  });

  // ---- concorrência
  // Concorrência: criações paralelas não colidem em id nem se perdem.
  await t.caso('criação simultânea de 10 categorias: todas 201 com ids distintos', async () => {
    const rs = await t.paralelo(10, (i) => criar(t.unico('par' + i)));
    t.verdade(rs.every((r) => r.status === 201));
    t.eq(new Set(rs.map((r) => r.body.id)).size, 10);
  });
});
