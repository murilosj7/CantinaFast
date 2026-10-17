'use strict';
// Usuários internos: CRUD, validação, permissões, exclusão lógica, último administrador, concorrência.
const L = require('./_lib.cjs');
const t = L.suite('usuario');

// Campos exatos do UsuarioInterno do contrato; senhaHash nunca pode aparecer.
const CHAVES = ['ativo', 'criadoEm', 'id', 'login', 'nome', 'perfil'];

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  // Corpo válido de cadastro; cada caso sobrescreve só o campo que quer estragar.
  const base = (over = {}) => ({ nome: 'Fulano de Tal', login: t.unico('l'), senha: 'abc123', perfil: 'caixa', ...over });
  const post = (body, token = adm.token) => t.http('POST', '/interno/usuarios', { token, body });
  const patch = (id, body, token = adm.token) => t.http('PATCH', `/interno/usuarios/${id}`, { token, body });
  const inativar = (id, token = adm.token) => t.http('PATCH', `/interno/usuarios/${id}/inativar`, { token });
  const login = (l, s) => t.http('POST', '/interno/login', { body: { login: l, senha: s } });

  // ---- criar
  // Usuário base: serve de alvo para duplicidade de login e para os testes de permissão.
  let criado;
  await t.caso('POST cria usuário (201), perfil em minúsculo, ativo=true, criadoEm ISO, sem senhaHash', async () => {
    const b = base();
    criado = t.sucesso(await post(b), 201);
    t.eq(Object.keys(criado).sort(), CHAVES);
    t.eq(criado.perfil, 'caixa');
    t.eq(criado.ativo, true);
    t.eq(criado.login, b.login);
    t.eq(new Date(criado.criadoEm).toISOString(), criado.criadoEm);
  });
  await t.caso('senha gravada como hash bcrypt (nunca em texto puro)', async () => {
    const u = await t.prisma.usuario.findUnique({ where: { id: criado.id } });
    t.verdade(u.senhaHash.startsWith('$2') && u.senhaHash !== 'abc123');
  });
  await t.caso('usuário recém-criado consegue logar com a senha informada', async () => {
    const b = base({ senha: 'senhaNova99' });
    t.sucesso(await post(b), 201);
    t.sucesso(await login(b.login, 'senhaNova99'));
  });
  // O perfil aceita qualquer capitalização e é devolvido em minúsculo pelo mapper.
  for (const [entrada, saida] of [['administrador', 'administrador'], ['ADMINISTRADOR', 'administrador'], [' Caixa ', 'caixa'], ['ATENDENTE', 'atendente'], ['atendente', 'atendente']]) {
    await t.caso(`perfil '${entrada}' é aceito e traduzido para '${saida}'`, async () => {
      t.eq(t.sucesso(await post(base({ perfil: entrada })), 201).perfil, saida);
    });
  }
  await t.caso('nome e login são aparados', async () => {
    const l = t.unico('trim');
    const u = t.sucesso(await post(base({ nome: '  Maria  ', login: `  ${l}  ` })), 201);
    t.eq(u.nome, 'Maria');
    t.eq(u.login, l);
  });
  await t.caso('nome e login com exatamente 120 caracteres são aceitos', async () => {
    t.sucesso(await post(base({ nome: 'n'.repeat(120), login: (t.prefixo + 'l'.repeat(120)).slice(0, 120) })), 201);
  });
  await t.caso('senha com exatamente 6 caracteres é aceita', async () => {
    t.sucesso(await post(base({ senha: '123456' })), 201);
  });
  await t.caso('login diferencia maiúsculas de minúsculas (comportamento atual)', async () => {
    const l = t.unico('Case');
    t.sucesso(await post(base({ login: l })), 201);
    t.sucesso(await post(base({ login: l.toUpperCase() })), 201);
  });
  // Matriz de cadastro inválido: cada linha quebra uma regra de nome, login, senha ou perfil (400 com o campo certo).
  const ruins = [
    ['nome ausente', { nome: undefined }, 'nome'],
    ['nome vazio', { nome: '' }, 'nome'],
    ['nome só espaços', { nome: '   ' }, 'nome'],
    ['nome numérico', { nome: 5 }, 'nome'],
    ['nome com 121 caracteres', { nome: 'n'.repeat(121) }, 'nome'],
    ['login ausente', { login: undefined }, 'login'],
    ['login vazio', { login: '' }, 'login'],
    ['login só espaços', { login: '  ' }, 'login'],
    ['login numérico', { login: 7 }, 'login'],
    ['login com 121 caracteres', { login: 'l'.repeat(121) }, 'login'],
    ['senha ausente', { senha: undefined }, 'senha'],
    ['senha com 5 caracteres', { senha: '12345' }, 'senha'],
    ['senha numérica', { senha: 123456 }, 'senha'],
    ['senha nula', { senha: null }, 'senha'],
    ['perfil ausente', { perfil: undefined }, 'perfil'],
    ['perfil inválido', { perfil: 'gerente' }, 'perfil'],
    ['perfil vazio', { perfil: '' }, 'perfil'],
    ['perfil numérico', { perfil: 1 }, 'perfil'],
    ['perfil nulo', { perfil: null }, 'perfil'],
  ];
  for (const [rotulo, over, campo] of ruins) {
    await t.caso(`POST ${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await post(base(over)), 400, { campo });
    });
  }
  await t.caso('POST com login repetido → 409 campo=login', async () => {
    L.erro(await post(base({ login: criado.login })), 409, { campo: 'login' });
  });
  await t.caso('POST com JSON malformado → 400', async () => {
    L.erro(await t.http('POST', '/interno/usuarios', { token: adm.token, rawBody: '{nome:' }), 400, { contem: 'JSON' });
  });
  await t.caso('POST ignora campos extras (ativo/id no corpo não têm efeito)', async () => {
    const u = t.sucesso(await post({ ...base(), ativo: false, id: 1, criadoEm: '2000-01-01' }), 201);
    t.eq(u.ativo, true);
    t.verdade(u.id !== 1 && !u.criadoEm.startsWith('2000'));
  });
  // Concorrência: o mesmo login enviado em paralelo gera exatamente um usuário; o resto vira 409 campo=login.
  await t.caso('cadastros duplicados em paralelo (8x o mesmo login): 1×201 e 7×409 campo=login', async () => {
    const b = base();
    const rs = await t.paralelo(8, () => post(b));
    t.eq(rs.filter((r) => r.status === 201).length, 1);
    const outros = rs.filter((r) => r.status !== 201);
    t.eq(outros.length, 7);
    for (const r of outros) L.erro(r, 409, { campo: 'login' });
    t.eq(await t.prisma.usuario.count({ where: { login: b.login } }), 1);
  });

  // ---- permissões
  // Permissões: só o administrador cria, edita e inativa. Consultar (GET) é aberto a qualquer perfil autenticado.
  for (const [nome, u] of [['caixa', cx], ['atendente', at]]) {
    await t.caso(`${nome} não cria usuário → 403`, async () => {
      L.erro(await post(base(), u.token), 403, { campo: null, contem: 'permissão' });
    });
    await t.caso(`${nome} não edita usuário → 403`, async () => {
      L.erro(await patch(criado.id, { nome: 'x' }, u.token), 403);
    });
    await t.caso(`${nome} não inativa usuário → 403`, async () => {
      L.erro(await inativar(criado.id, u.token), 403);
    });
    // Lacuna conhecida: listar e consultar usuários não exige perfil de administrador.
    await t.lacuna(`${nome} consegue listar usuários (200)`, async () => {
      t.verdade(Array.isArray(t.sucesso(await t.http('GET', '/interno/usuarios', { token: u.token }))));
    });
    await t.lacuna(`${nome} consegue ver um usuário por id (200)`, async () => {
      t.sucesso(await t.http('GET', `/interno/usuarios/${criado.id}`, { token: u.token }));
    });
  }
  for (const [m, rota] of [['POST', '/interno/usuarios'], ['GET', '/interno/usuarios'], ['GET', `/interno/usuarios/${criado.id}`], ['PATCH', `/interno/usuarios/${criado.id}`], ['PATCH', `/interno/usuarios/${criado.id}/inativar`]]) {
    await t.caso(`${m} ${rota.replace(criado.id, ':id')} sem token → 401`, async () => {
      L.erro(await t.http(m, rota, { body: {} }), 401);
    });
  }

  // ---- listar / buscar
  // Massa para os filtros: três usuários com perfis e situações diferentes, todos com o prefixo da suíte.
  const lista = [
    await t.usuario('ATENDENTE', { nome: `${t.prefixo}Zeca Silva` }),
    await t.usuario('CAIXA', { nome: `${t.prefixo}Ana Souza` }),
    await t.usuario('CAIXA', { nome: `${t.prefixo}Bia Lima`, ativo: false }),
  ];
  // Atalho de listagem restrito aos usuários desta suíte (busca pelo prefixo).
  const listar = async (qs) => t.sucesso(await t.http('GET', `/interno/usuarios?busca=${encodeURIComponent(t.prefixo)}${qs}`, { token: adm.token }));
  await t.caso('GET lista ordenada por nome e sem senhaHash', async () => {
    const r = await listar('');
    const nomes = r.map((u) => u.nome);
    t.verdade(r.every((u) => !('senhaHash' in u) && JSON.stringify(Object.keys(u).sort()) === JSON.stringify(CHAVES)));
    const iA = nomes.findIndex((n) => n.includes('Ana Souza'));
    const iZ = nomes.findIndex((n) => n.includes('Zeca'));
    t.verdade(iA >= 0 && iZ > iA);
  });
  await t.caso('GET ?perfil=caixa filtra', async () => {
    const r = await listar('&perfil=caixa');
    t.verdade(r.length >= 2 && r.every((u) => u.perfil === 'caixa'));
  });
  await t.caso('GET ?perfil=ATENDENTE (maiúsculo) também filtra', async () => {
    t.verdade((await listar('&perfil=ATENDENTE')).every((u) => u.perfil === 'atendente'));
  });
  await t.caso('GET ?status=inativo traz só inativos', async () => {
    const r = await listar('&status=inativo');
    t.verdade(r.length >= 1 && r.every((u) => !u.ativo));
  });
  await t.caso('GET ?status=ativo traz só ativos', async () => {
    t.verdade((await listar('&status=ativo')).every((u) => u.ativo));
  });
  await t.caso('GET sem status traz ativos e inativos (diferente de categorias/produtos)', async () => {
    const r = await listar('');
    t.verdade(r.some((u) => u.ativo) && r.some((u) => !u.ativo));
  });
  await t.caso('GET ?busca acha pelo nome (sem diferenciar maiúsculas)', async () => {
    const r = t.sucesso(await t.http('GET', `/interno/usuarios?busca=${encodeURIComponent((t.prefixo + 'zeca').toUpperCase())}`, { token: adm.token }));
    t.eq(r.length, 1);
  });
  await t.caso('GET ?busca acha pelo login', async () => {
    const r = t.sucesso(await t.http('GET', `/interno/usuarios?busca=${encodeURIComponent(lista[0].login)}`, { token: adm.token }));
    t.eq(r.map((u) => u.id), [lista[0].id]);
  });
  await t.caso('GET combina perfil + status', async () => {
    const r = await listar('&perfil=caixa&status=inativo');
    t.verdade(r.length === 1 && r[0].id === lista[2].id);
  });
  await t.caso('GET ?perfil inválido → 400 campo=perfil', async () => {
    L.erro(await t.http('GET', '/interno/usuarios?perfil=xx', { token: adm.token }), 400, { campo: 'perfil' });
  });
  await t.caso('GET ?status inválido → 400 campo=status', async () => {
    L.erro(await t.http('GET', '/interno/usuarios?status=xx', { token: adm.token }), 400, { campo: 'status' });
  });
  await t.caso('GET ?perfil= vazio é ignorado', async () => {
    t.verdade((await listar('&perfil=')).length >= 3);
  });
  await t.caso('GET /:id devolve o usuário', async () => {
    const u = t.sucesso(await t.http('GET', `/interno/usuarios/${lista[1].id}`, { token: adm.token }));
    t.eq(u.id, lista[1].id);
    t.eq(Object.keys(u).sort(), CHAVES);
  });
  await t.caso('GET /:id inexistente → 404', async () => {
    L.erro(await t.http('GET', '/interno/usuarios/2000000000', { token: adm.token }), 404);
  });
  for (const id of ['abc', '0', '-3', '2.5', '99999999999']) {
    await t.caso(`GET /:id com id inválido '${id}' → 400 campo=id`, async () => {
      L.erro(await t.http('GET', `/interno/usuarios/${id}`, { token: adm.token }), 400, { campo: 'id' });
    });
  }

  // ---- atualizar
  // Usuário que sofre as edições (PATCH) abaixo.
  const alvo = await t.usuario('ATENDENTE');
  await t.caso('PATCH atualiza nome', async () => {
    t.eq(t.sucesso(await patch(alvo.id, { nome: '  Novo Nome ' })).nome, 'Novo Nome');
  });
  await t.caso('PATCH atualiza perfil (qualquer capitalização)', async () => {
    t.eq(t.sucesso(await patch(alvo.id, { perfil: 'CAIXA' })).perfil, 'caixa');
  });
  await t.caso('PATCH troca a senha: a antiga deixa de logar e a nova loga', async () => {
    t.sucesso(await patch(alvo.id, { senha: 'trocada987' }));
    L.erro(await login(alvo.login, alvo.senha), 401);
    t.sucesso(await login(alvo.login, 'trocada987'));
  });
  await t.caso('PATCH não altera o login (campo ignorado) e retorna sem senhaHash', async () => {
    const r = t.sucesso(await patch(alvo.id, { nome: 'Outro', login: 'hackeado' }));
    t.eq(r.login, alvo.login);
    t.verdade(!('senhaHash' in r));
  });
  await t.caso('PATCH só com login (ignorado) → 400 por falta de campos', async () => {
    L.erro(await patch(alvo.id, { login: 'x' }), 400, { campo: null });
  });
  await t.caso('PATCH {} → 400', async () => {
    L.erro(await patch(alvo.id, {}), 400, { contem: 'ao menos um campo' });
  });
  // Matriz de PATCH inválido: tipo ou tamanho errado em nome, senha, perfil ou ativo.
  const patchRuins = [
    ['nome vazio', { nome: '' }, 'nome'],
    ['nome longo', { nome: 'n'.repeat(121) }, 'nome'],
    ['nome numérico', { nome: 3 }, 'nome'],
    ['senha curta', { senha: '123' }, 'senha'],
    ['senha numérica', { senha: 1234567 }, 'senha'],
    ['perfil inválido', { perfil: 'dono' }, 'perfil'],
    ['perfil numérico', { perfil: 2 }, 'perfil'],
    ['ativo string', { ativo: 'false' }, 'ativo'],
    ['ativo número', { ativo: 0 }, 'ativo'],
    ['ativo nulo', { ativo: null }, 'ativo'],
  ];
  for (const [rotulo, body, campo] of patchRuins) {
    await t.caso(`PATCH ${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await patch(alvo.id, body), 400, { campo });
    });
  }
  await t.caso('PATCH inexistente → 404', async () => {
    L.erro(await patch(2000000000, { nome: 'x' }), 404);
  });
  await t.caso('PATCH com id inválido → 400 campo=id', async () => {
    L.erro(await patch('abc', { nome: 'x' }), 400, { campo: 'id' });
  });
  await t.caso('edição inválida não altera nada (nome válido + senha curta → nada muda)', async () => {
    const antes = await t.prisma.usuario.findUnique({ where: { id: alvo.id } });
    L.erro(await patch(alvo.id, { nome: 'Mudou?', senha: '1' }), 400, { campo: 'senha' });
    t.eq((await t.prisma.usuario.findUnique({ where: { id: alvo.id } })).nome, antes.nome);
  });

  // ---- inativar / exclusão lógica
  // Usuário usado nos testes de inativação (exclusão lógica): o registro e o histórico permanecem.
  const vitima = await t.usuario('CAIXA');
  await t.caso('PATCH /:id/inativar → ativo=false e o registro permanece', async () => {
    t.eq(t.sucesso(await inativar(vitima.id)).ativo, false);
    t.verdade(await t.prisma.usuario.findUnique({ where: { id: vitima.id } }));
  });
  await t.caso('inativar é idempotente', async () => {
    t.eq(t.sucesso(await inativar(vitima.id)).ativo, false);
  });
  await t.caso('usuário inativo não faz login (401 genérico)', async () => {
    L.erro(await login(vitima.login, vitima.senha), 401, { mensagem: 'Login ou senha inválidos.' });
  });
  await t.caso('token de usuário inativado deixa de valer na hora (401)', async () => {
    L.erro(await t.http('GET', '/interno/me', { token: vitima.token }), 401, { contem: 'Sessão inválida' });
    // Rota protegida só pelo middleware (o /me repete a checagem de "ativo" e mascararia uma falha dele).
    L.erro(await t.http('GET', '/interno/usuarios', { token: vitima.token }), 401, { contem: 'Sessão inválida' });
  });
  await t.caso('PATCH ativo=true reativa e o token antigo volta a valer', async () => {
    t.eq(t.sucesso(await patch(vitima.id, { ativo: true })).ativo, true);
    t.sucesso(await t.http('GET', '/interno/me', { token: vitima.token }));
  });
  await t.caso('inativar inexistente → 404 / id inválido → 400', async () => {
    L.erro(await inativar(2000000000), 404);
    L.erro(await inativar('x'), 400, { campo: 'id' });
  });
  await t.caso('não existe DELETE de usuário (404 de rota)', async () => {
    L.erro(await t.http('DELETE', `/interno/usuarios/${vitima.id}`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
  });
  await t.caso('histórico continua vinculado ao usuário inativado', async () => {
    const p = await t.produto({ qtd: 5 });
    const mv = await t.prisma.movimentacaoEstoque.create({ data: { produtoId: p.id, usuarioId: vitima.id, tipo: 'ENTRADA', quantidade: 1 } });
    t.sucesso(await inativar(vitima.id));
    t.eq((await t.prisma.movimentacaoEstoque.findUnique({ where: { id: mv.id } })).usuarioId, vitima.id);
    await patch(vitima.id, { ativo: true });
  });
  await t.caso('rebaixar um administrador vale imediatamente (perfil lido do banco)', async () => {
    const a2 = await t.usuario('ADMINISTRADOR');
    t.sucesso(await post(base(), a2.token), 201);
    t.sucesso(await patch(a2.id, { perfil: 'caixa' }));
    L.erro(await post(base(), a2.token), 403);
  });

  // ---- último administrador ativo
  // Banco descartável: só os administradores desta suíte existem. Deixa só `adm` ativo.
  // Regra decidida: o último administrador ativo não pode ser inativado nem rebaixado.
  // Deixa `adm` como único administrador ativo (direto no banco descartável) para exercitar a regra.
  await t.prisma.usuario.updateMany({ where: { perfil: 'ADMINISTRADOR', ativo: true, id: { not: adm.id } }, data: { ativo: false } });
  await t.caso('último administrador: inativar a si mesmo → 409', async () => {
    L.erro(await inativar(adm.id), 409, { contem: 'último administrador' });
    t.eq((await t.prisma.usuario.findUnique({ where: { id: adm.id } })).ativo, true);
  });
  await t.caso('último administrador: PATCH ativo=false → 409', async () => {
    L.erro(await patch(adm.id, { ativo: false }), 409, { contem: 'último administrador' });
  });
  await t.caso('último administrador: PATCH perfil=caixa → 409', async () => {
    L.erro(await patch(adm.id, { perfil: 'caixa' }), 409);
    t.eq((await t.prisma.usuario.findUnique({ where: { id: adm.id } })).perfil, 'ADMINISTRADOR');
  });
  await t.caso('último administrador: PATCH perfil=caixa + ativo=false juntos → 409', async () => {
    L.erro(await patch(adm.id, { perfil: 'caixa', ativo: false }), 409);
  });
  await t.caso('último administrador: PATCH que mantém administrador/ativo (só nome) é permitido', async () => {
    t.sucesso(await patch(adm.id, { nome: 'Admin Renomeado' }));
    t.sucesso(await patch(adm.id, { perfil: 'administrador', ativo: true }));
  });
  await t.caso('usuários não administradores podem ser inativados normalmente', async () => {
    const x = await t.usuario('CAIXA');
    t.sucesso(await inativar(x.id));
  });
  // Segundo administrador: com dois ativos a inativação de um deles passa a ser permitida.
  const adm2 = await t.usuario('ADMINISTRADOR');
  await t.caso('com dois administradores ativos, é possível inativar um', async () => {
    t.eq(t.sucesso(await inativar(adm2.id)).ativo, false);
  });
  await t.caso('depois disso o restante vira o último e é protegido', async () => {
    L.erro(await inativar(adm.id), 409);
  });
  await t.caso('administrador inativo não conta como "outro administrador"', async () => {
    L.erro(await patch(adm.id, { perfil: 'atendente' }), 409);
  });
  await t.caso('reativar o outro administrador libera inativar o primeiro', async () => {
    t.sucesso(await patch(adm2.id, { ativo: true }));
    t.eq(t.sucesso(await inativar(adm.id, adm2.token)).ativo, false);
    t.sucesso(await patch(adm.id, { ativo: true }, adm2.token));
  });
  await t.caso('PATCH com perfil igual + ativo=false no último administrador → 409', async () => {
    await t.prisma.usuario.update({ where: { id: adm2.id }, data: { ativo: false } });
    L.erro(await patch(adm.id, { perfil: 'administrador', ativo: false }), 409);
    await t.prisma.usuario.update({ where: { id: adm2.id }, data: { ativo: true } });
  });

  // Corrida: dois administradores se inativando ao mesmo tempo. A checagem de "último administrador" não é
  // atômica (count + update sem trava), então as duas requisições podem passar e deixar o sistema SEM administrador.
  // Regra do último administrador sob concorrência. A decisão é tomada dentro de uma transação que trava (FOR UPDATE, em
  // ordem de id) os administradores ativos, relê o alvo e só então confere se sobra outro administrador. Cada caso abaixo
  // repete a disputa 10 vezes (a corrida é probabilística) e afirma que sempre sobra pelo menos 1 administrador ativo.
  // Os tokens são de A e B; se um deles for inativado no meio, as requisições seguintes podem dar 401, o que não muda a regra.
  const RODADAS = 10;
  // Deixa só A e B como administradores ativos do banco (os demais desta suíte ficam inativos).
  await t.prisma.usuario.updateMany({ where: { perfil: 'ADMINISTRADOR', ativo: true, id: { notIn: [adm.id, adm2.id] } }, data: { ativo: false } });
  const reiniciar = (perfilB = 'ADMINISTRADOR') => Promise.all([
    t.prisma.usuario.update({ where: { id: adm.id }, data: { perfil: 'ADMINISTRADOR', ativo: true } }),
    t.prisma.usuario.update({ where: { id: adm2.id }, data: { perfil: perfilB, ativo: true } }),
  ]);
  const administradoresAtivos = () => t.prisma.usuario.count({ where: { perfil: 'ADMINISTRADOR', ativo: true, login: { startsWith: t.prefixo } } });
  // Executa a disputa `RODADAS` vezes e devolve em quantas o sistema ficou sem administrador ativo.
  const corrida = async (perfilB, operacoes) => {
    let zerou = 0;
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      await reiniciar(perfilB);
      await t.paralelo(operacoes.length, (i) => operacoes[i]());
      if ((await administradoresAtivos()) === 0) zerou++;
    }
    await reiniciar();
    return zerou;
  };
  // Atalhos: A e B agem com o token do outro para as chamadas poderem ser simultâneas.
  const inativaA = () => inativar(adm.id, adm2.token);
  const inativaB = () => inativar(adm2.id, adm.token);
  const rebaixaA = () => patch(adm.id, { perfil: 'caixa' }, adm2.token);
  const rebaixaB = () => patch(adm2.id, { perfil: 'caixa' }, adm.token);
  await t.caso('CORRIDA: duas inativações simultâneas (A e B) nunca deixam 0 administradores ativos (10 rodadas)', async () => {
    const zerou = await corrida('ADMINISTRADOR', [inativaA, inativaB]);
    t.eq(zerou, 0, `em ${zerou}/${RODADAS} rodadas não sobrou nenhum administrador ativo`);
  });
  await t.caso('CORRIDA: dois rebaixamentos de perfil simultâneos via PATCH (A e B → caixa) nunca deixam 0 administradores (10 rodadas)', async () => {
    const zerou = await corrida('ADMINISTRADOR', [rebaixaA, rebaixaB]);
    t.eq(zerou, 0, `em ${zerou}/${RODADAS} rodadas não sobrou nenhum administrador ativo`);
  });
  await t.caso('CORRIDA: duas inativações via PATCH {ativo:false} simultâneas nunca deixam 0 administradores (10 rodadas)', async () => {
    const zerou = await corrida('ADMINISTRADOR', [() => patch(adm.id, { ativo: false }, adm2.token), () => patch(adm2.id, { ativo: false }, adm.token)]);
    t.eq(zerou, 0, `em ${zerou}/${RODADAS} rodadas não sobrou nenhum administrador ativo`);
  });
  await t.caso('CORRIDA mista: um inativa (A) enquanto o outro é rebaixado (B → caixa) nunca deixa 0 administradores (10 rodadas)', async () => {
    const zerou = await corrida('ADMINISTRADOR', [inativaA, rebaixaB]);
    t.eq(zerou, 0, `em ${zerou}/${RODADAS} rodadas não sobrou nenhum administrador ativo`);
  });
  await t.caso('CORRIDA mista invertida: B inativa enquanto A é rebaixado (10 rodadas)', async () => {
    const zerou = await corrida('ADMINISTRADOR', [inativaB, rebaixaA]);
    t.eq(zerou, 0, `em ${zerou}/${RODADAS} rodadas não sobrou nenhum administrador ativo`);
  });
  // Leitura velha: B é lido como atendente fora da transação e é promovido a administrador por outra requisição no meio.
  // Se a decisão usasse essa leitura, "inativar B" não seria checada e "inativar A" contaria B como administrador:
  // os dois passariam e o sistema ficaria sem administrador.
  await t.caso('CORRIDA: promover B a administrador + inativar B + inativar A ao mesmo tempo sempre deixa pelo menos 1 administrador (10 rodadas)', async () => {
    const zerou = await corrida('ATENDENTE', [
      () => patch(adm2.id, { perfil: 'administrador' }, adm.token),
      () => patch(adm2.id, { ativo: false }, adm.token),
      () => inativar(adm.id, adm.token),
    ]);
    t.eq(zerou, 0, `em ${zerou}/${RODADAS} rodadas não sobrou nenhum administrador ativo`);
  });
  await t.caso('CORRIDA: variante com a rota dedicada inativar para B, promoção de B e inativação de A (10 rodadas)', async () => {
    const zerou = await corrida('ATENDENTE', [
      () => patch(adm2.id, { perfil: 'administrador' }, adm.token),
      () => inativar(adm2.id, adm.token),
      () => inativar(adm.id, adm.token),
    ]);
    t.eq(zerou, 0, `em ${zerou}/${RODADAS} rodadas não sobrou nenhum administrador ativo`);
  });
  // Testes DETERMINÍSTICOS (sem depender de sorte): o próprio teste segura, numa transação, o lock da linha do
  // administrador A. Isso congela as requisições exatamente no ponto da trava e permite forçar a ordem dos eventos.
  // `segurar(aoLiberar)` devolve { liberar, concluida }; `aoLiberar(tx)` roda DENTRO da transação do teste, ainda com o lock.
  const segurar = async (aoLiberar) => {
    let liberar;
    const portao = new Promise((r) => (liberar = r));
    let travou;
    const pronto = new Promise((r) => (travou = r));
    const concluida = t.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "usuarios" WHERE id = ${adm.id} FOR UPDATE`;
      travou();
      await portao;
      if (aoLiberar) await aoLiberar(db);
    }, { timeout: 30000, maxWait: 10000 });
    await pronto;
    return { liberar, concluida };
  };
  // Resolve com 'pendente' se a requisição ainda não terminou depois de `ms`; senão devolve a resposta.
  const aguardar = (req, ms = 700) => Promise.race([req, t.dormir(ms).then(() => 'pendente')]);
  await t.caso('TRAVA: com o lock do administrador A segurado por outra transação, inativar B FICA ESPERANDO e termina depois da liberação', async () => {
    await reiniciar();
    const s = await segurar();
    const req = inativaB();
    t.eq(await aguardar(req), 'pendente', 'a inativação não deveria terminar enquanto o administrador ativo está travado');
    s.liberar();
    await s.concluida;
    t.eq((await req).status, 200); // A continua ativo, então B pode ser inativado
    await reiniciar();
  });
  await t.caso('TRAVA: o rebaixamento (PATCH perfil) também espera pelo lock; PATCH só de nome NÃO espera', async () => {
    await reiniciar();
    const s = await segurar();
    const rebaixa = rebaixaB();
    const soNome = patch(adm2.id, { nome: 'Sem trava' }, adm.token);
    t.eq((await aguardar(soNome)).status, 200, 'editar só o nome não deve esperar pela trava');
    t.eq(await aguardar(rebaixa), 'pendente', 'o rebaixamento deveria esperar pela trava');
    s.liberar();
    await s.concluida;
    t.eq((await rebaixa).status, 200);
    await reiniciar();
  });
  // Leitura velha determinística: B é lido como atendente fora da transação; enquanto a requisição espera pela trava,
  // o teste promove B a administrador e inativa A. A decisão tem de usar o estado RELIDO de B (administrador, último
  // ativo) e responder 409; com a leitura velha, B seria inativado e o sistema ficaria sem administrador.
  await t.caso('LEITURA VELHA: alvo lido como atendente e promovido a administrador enquanto espera a trava → a regra usa o estado relido (409, sobra 1 administrador)', async () => {
    await reiniciar('ATENDENTE');
    const s = await segurar(async (db) => {
      await db.usuario.update({ where: { id: adm2.id }, data: { perfil: 'ADMINISTRADOR' } });
      await db.usuario.update({ where: { id: adm.id }, data: { ativo: false } });
    });
    const req = patch(adm2.id, { ativo: false }, adm.token);
    t.eq(await aguardar(req), 'pendente');
    s.liberar();
    await s.concluida;
    L.erro(await req, 409, { contem: 'último administrador' });
    t.eq(await administradoresAtivos(), 1);
    await reiniciar();
  });
  await t.caso('as disputas não deixam travas penduradas: depois delas a regra segue respondendo 200/409 normalmente', async () => {
    await reiniciar();
    t.eq(t.sucesso(await inativar(adm2.id, adm.token)).ativo, false);
    L.erro(await inativar(adm.id, adm.token), 409, { contem: 'último administrador' });
    await reiniciar();
  });
  await t.caso('PATCH só de nome/senha em administrador não passa pela trava e funciona normalmente (200)', async () => {
    t.sucesso(await patch(adm.id, { nome: 'Admin Renomeado 2' }));
    t.sucesso(await patch(adm.id, { senha: 'novaSenha77' }));
  });
  // [DIVERGE-PDF] D15 — o PDF exige auditoria de alterações de usuários; a entidade Auditoria não existe.
  await t.diverge('inativação/edição de usuário não gera registro de auditoria (PDF exige rastreabilidade; entidade Auditoria não existe)', async () => {
    const tabelas = await t.prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ILIKE '%auditoria%'`;
    t.eq(tabelas.length, 0);
  });
});
