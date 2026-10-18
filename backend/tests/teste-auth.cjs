'use strict';
// Autenticação: login, /interno/me, validação do JWT, perfil lido do banco, rotas protegidas x públicas.
const L = require('./_lib.cjs');
const t = L.suite('auth');

const MSG_LOGIN = 'Login ou senha inválidos.';

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const inativo = await t.usuario('ATENDENTE', { ativo: false });
  // Atalhos para os dois endpoints de autenticação.
  const login = (body, extra = {}) => t.http('POST', '/interno/login', { body, ...extra });
  const me = (token, headers) => t.http('GET', '/interno/me', { token, headers });

  // ---------------------------------------------------------------- login: caminho feliz
  // Login base: a resposta é reaproveitada para inspecionar o formato e o conteúdo do JWT.
  let resp;
  await t.caso('login válido → 200 com { usuario, token }', async () => {
    resp = t.sucesso(await login({ login: adm.login, senha: adm.senha }));
    t.eq(Object.keys(resp).sort(), ['token', 'usuario']);
    t.eq(resp.usuario.id, adm.id);
    t.eq(resp.usuario.perfil, 'administrador');
  });
  await t.caso('usuario do login tem exatamente os campos do contrato e não expõe senhaHash', async () => {
    t.eq(Object.keys(resp.usuario).sort(), ['ativo', 'criadoEm', 'id', 'login', 'nome', 'perfil']);
  });
  await t.caso('token é JWT HS256 com id e perfil (enum em maiúsculas) e validade de 8h', async () => {
    const [cab] = resp.token.split('.');
    t.eq(JSON.parse(Buffer.from(cab, 'base64url').toString()).alg, 'HS256');
    const p = t.jwt.decode(resp.token);
    t.eq(p.id, adm.id);
    t.eq(p.perfil, 'ADMINISTRADOR');
    t.eq(p.exp - p.iat, 8 * 3600);
    t.eq(Object.keys(p).sort(), ['aud', 'exp', 'iat', 'id', 'perfil', 'tipo']);
    // Claims que separam o token do usuário interno do token do cliente do site.
    t.eq([p.tipo, p.aud], ['usuario', 'interno']);
  });
  await t.caso('token não carrega senha nem hash', async () => {
    t.verdade(!Buffer.from(resp.token.split('.')[1], 'base64url').toString().toLowerCase().includes('senha'));
  });
  await t.caso('perfil caixa → token com perfil CAIXA e usuario.perfil minúsculo', async () => {
    const r = t.sucesso(await login({ login: cx.login, senha: cx.senha }));
    t.eq(t.jwt.decode(r.token).perfil, 'CAIXA');
    t.eq(r.usuario.perfil, 'caixa');
  });
  await t.caso('login com espaços ao redor é aceito (login é aparado)', async () => {
    t.sucesso(await login({ login: `  ${adm.login}  `, senha: adm.senha }));
  });
  await t.caso('senha NÃO é aparada: senha com espaço extra é recusada', async () => {
    L.erro(await login({ login: adm.login, senha: ` ${adm.senha}` }), 401, { mensagem: MSG_LOGIN });
  });
  await t.caso('login diferencia maiúsculas de minúsculas', async () => {
    L.erro(await login({ login: adm.login.toUpperCase(), senha: adm.senha }), 401);
  });
  await t.caso('o token do login é aceito em rota protegida', async () => {
    t.sucesso(await me(resp.token));
  });
  await t.caso('dois logins seguidos geram tokens válidos (podem ser iguais se no mesmo segundo)', async () => {
    const a = t.sucesso(await login({ login: adm.login, senha: adm.senha }));
    t.sucesso(await me(a.token));
  });

  // ---------------------------------------------------------------- login: validação
  // Corpos de login inválidos: qualquer coisa que não seja login e senha em texto não vazio cai em 400 (sem campo).
  const invalidos = [
    ['sem corpo', undefined],
    ['corpo vazio {}', {}],
    ['sem login', { senha: 'x' }],
    ['sem senha', { login: 'x' }],
    ['login vazio', { login: '', senha: 'x' }],
    ['login só espaços', { login: '   ', senha: 'x' }],
    ['senha vazia', { login: 'x', senha: '' }],
    ['login numérico', { login: 1, senha: 'x' }],
    ['senha numérica', { login: 'x', senha: 123 }],
    ['login nulo', { login: null, senha: 'x' }],
    ['senha nula', { login: 'x', senha: null }],
    ['login objeto', { login: { $ne: '' }, senha: 'x' }],
    ['senha objeto', { login: 'x', senha: { $ne: '' } }],
    ['login array', { login: ['a'], senha: 'x' }],
    ['senha booleana', { login: 'x', senha: true }],
  ];
  for (const [rotulo, body] of invalidos) {
    await t.caso(`login ${rotulo} → 400 "Informe login e senha." (sem campo)`, async () => {
      L.erro(await login(body), 400, { mensagem: 'Informe login e senha.', campo: null });
    });
  }
  await t.caso('login com corpo array [] → 400', async () => {
    L.erro(await login(undefined, { rawBody: '[]' }), 400, { mensagem: 'Informe login e senha.' });
  });
  await t.caso('login com JSON malformado → 400 "não é um JSON válido"', async () => {
    L.erro(await login(undefined, { rawBody: '{"login": "a", ' }), 400, { contem: 'JSON' });
  });
  await t.caso('login com corpo "null" → 400', async () => {
    L.erro(await login(undefined, { rawBody: 'null' }), 400);
  });
  await t.caso('login com content-type text/plain → 400 (corpo não é lido)', async () => {
    L.erro(await login(undefined, { rawBody: JSON.stringify({ login: adm.login, senha: adm.senha }), headers: { 'content-type': 'text/plain' } }), 400);
  });
  // Entradas hostis são só credenciais erradas: a consulta usa parâmetros, nunca concatena SQL.
  await t.caso('login com injeção estilo NoSQL/SQL é só uma credencial errada (401)', async () => {
    L.erro(await login({ login: "' OR '1'='1", senha: "' OR '1'='1" }), 401, { mensagem: MSG_LOGIN });
  });
  await t.caso('login com caracteres estranhos (unicode, nulo escapado) não derruba o servidor', async () => {
    L.erro(await login({ login: 'ação😀', senha: 'x' }), 401);
    const r = await login({ login: 'a\u0000b', senha: 'x' });
    t.verdade([400, 401, 500].includes(r.status) && r.status !== 0);
    t.sucesso(await t.http('GET', '/health'));
  });
  // Corpo maior que o limite do express.json (100 kb): 413 no formato { mensagem }, sem cair no 500 genérico.
  await t.caso('corpo acima do limite (100 kb) em POST /interno/login → 413 { mensagem } (não 500)', async () => {
    L.erro(await login({ login: 'x', senha: 'a'.repeat(200 * 1024) }), 413, { mensagem: 'Corpo da requisição grande demais.', campo: null });
  });
  // O 413 vem do parser de corpo, antes da autenticação e das rotas: vale também para rotas protegidas e com token.
  await t.caso('corpo grande em rota protegida com token (POST /categorias) → 413 { mensagem }', async () => {
    L.erro(await t.http('POST', '/categorias', { token: adm.token, body: { nome: 'a'.repeat(200 * 1024) } }), 413, { mensagem: 'Corpo da requisição grande demais.', campo: null });
  });
  await t.caso('corpo grande em POST /pedidos autenticado → 413 e nenhum pedido é criado', async () => {
    const antes = await t.prisma.pedido.count();
    L.erro(await t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: 1, quantidade: 1 }], lixo: 'a'.repeat(200 * 1024) } }), 413, { campo: null });
    t.eq(await t.prisma.pedido.count(), antes);
  });
  await t.caso('corpo grande sem token também é 413 (o limite vale antes da autenticação) e o servidor segue de pé', async () => {
    L.erro(await t.http('POST', '/produtos', { body: { nome: 'a'.repeat(200 * 1024) } }), 413);
    t.sucesso(await t.http('GET', '/health'));
  });
  await t.caso('corpo exatamente abaixo do limite (~90 kb) passa pelo parser e cai na validação normal (400)', async () => {
    L.erro(await t.http('POST', '/categorias', { token: adm.token, body: { nome: 'a'.repeat(90 * 1024) } }), 400, { campo: 'nome' });
  });

  // ---------------------------------------------------------------- login: credenciais erradas
  // Segurança: a mensagem é a mesma para login inexistente, senha errada e usuário inativo (não revela qual campo errou).
  await t.caso('senha errada → 401 com mensagem genérica', async () => {
    L.erro(await login({ login: adm.login, senha: 'errada' }), 401, { mensagem: MSG_LOGIN, campo: null });
  });
  await t.caso('usuário inexistente → 401 com a MESMA mensagem (não revela qual campo errou)', async () => {
    const a = await login({ login: adm.login, senha: 'errada' });
    const b = await login({ login: t.unico('naoexiste'), senha: 'errada' });
    t.eq(a.body, b.body);
    t.eq(a.status, b.status);
  });
  await t.caso('usuário inativo com senha CERTA → 401 com a mesma mensagem genérica', async () => {
    const r = await login({ login: inativo.login, senha: inativo.senha });
    L.erro(r, 401, { mensagem: MSG_LOGIN });
  });
  await t.caso('resposta de erro de login não vaza token nem usuário', async () => {
    const r = await login({ login: adm.login, senha: 'errada' });
    t.eq(Object.keys(r.body), ['mensagem']);
  });
  await t.caso('GET /interno/login → 404 (só POST existe)', async () => {
    L.erro(await t.http('GET', '/interno/login'), 404, { contem: 'Rota não encontrada' });
  });
  await t.caso('login simultâneo: 20 logins válidos em paralelo → todos 200', async () => {
    const rs = await t.paralelo(20, () => login({ login: adm.login, senha: adm.senha }));
    t.verdade(rs.every((r) => r.status === 200 && r.body.token));
  });
  await t.caso('login simultâneo: 20 tentativas erradas em paralelo → todas 401 (sem 429 com NODE_ENV=test)', async () => {
    const rs = await t.paralelo(20, () => login({ login: adm.login, senha: 'errada' }));
    t.verdade(rs.every((r) => r.status === 401));
  });
  await t.caso('mistura de logins certos e errados em paralelo não se confunde', async () => {
    const rs = await t.paralelo(20, (i) => login({ login: adm.login, senha: i % 2 ? adm.senha : 'errada' }));
    rs.forEach((r, i) => t.eq(r.status, i % 2 ? 200 : 401));
  });
  await t.caso('troca de senha invalida a senha antiga no login seguinte', async () => {
    const u = await t.usuario('CAIXA');
    t.sucesso(await t.http('PATCH', `/interno/usuarios/${u.id}`, { token: adm.token, body: { senha: 'novaSenha1' } }));
    L.erro(await login({ login: u.login, senha: u.senha }), 401);
    t.sucesso(await login({ login: u.login, senha: 'novaSenha1' }));
  });

  // ---------------------------------------------------------------- /interno/me
  await t.caso('GET /interno/me devolve o usuário logado sem senhaHash', async () => {
    const u = t.sucesso(await me(adm.token));
    t.eq(u.id, adm.id);
    t.eq(u.login, adm.login);
    t.eq(Object.keys(u).sort(), ['ativo', 'criadoEm', 'id', 'login', 'nome', 'perfil']);
  });
  await t.caso('/me aceita o esquema "bearer" em minúsculas', async () => {
    t.sucesso(await t.http('GET', '/interno/me', { headers: { authorization: `bearer ${adm.token}` } }));
  });
  await t.caso('/me aceita "BEARER"', async () => {
    t.sucesso(await t.http('GET', '/interno/me', { headers: { authorization: `BEARER ${adm.token}` } }));
  });

  // ---------------------------------------------------------------- JWT inválido / ausente
  await t.caso('sem Authorization → 401 "não informado"', async () => {
    L.erro(await me(), 401, { mensagem: 'Token de autenticação não informado.', campo: null });
  });
  // Mensagens exatas do middleware de autenticação.
  const mal = 'Token de autenticação mal formatado. Use: Authorization: Bearer <token>.';
  // Cabeçalhos Authorization malformados: exige exatamente 'Bearer <token>'.
  for (const [rotulo, valor] of [
    ['Basic em vez de Bearer', 'Basic abc'],
    ['só o token, sem esquema', adm.token],
    ['"Bearer" sem token', 'Bearer'],
    ['"Bearer " com token vazio', 'Bearer '],
    ['dois espaços entre esquema e token', `Bearer  ${adm.token}`],
    ['token com parte extra', `Bearer ${adm.token} extra`],
    ['esquema Token', `Token ${adm.token}`],
  ]) {
    await t.caso(`Authorization ${rotulo} → 401 mal formatado`, async () => {
      L.erro(await t.http('GET', '/interno/me', { headers: { authorization: valor } }), 401, { mensagem: mal });
    });
  }
  const invalidoTok = 'Token inválido.';
  // Forja tokens com o segredo real para testar o que o login legítimo nunca emitiria.
  const forja = (payload, opcoes = {}) => t.assinar(payload, opcoes);
  // Tokens que precisam ser recusados como inválidos: outro segredo, alg none, algoritmo diferente de HS256,
  // payload adulterado, tipos errados de id/perfil e nbf no futuro.
  const casos = [
    ['lixo aleatório', 'isto-nao-e-um-jwt'],
    ['três partes vazias', '..'],
    ['JWT de outro segredo', t.jwt.sign({ id: adm.id, perfil: 'ADMINISTRADOR' }, 'outro-segredo-com-mais-de-32-caracteres-xxxxxx', { algorithm: 'HS256', expiresIn: '1h' })],
    ['alg none (sem assinatura)', `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ id: adm.id, perfil: 'ADMINISTRADOR' })).toString('base64url')}.`],
    ['assinado com HS384 (algoritmo não permitido)', t.jwt.sign({ id: adm.id, perfil: 'ADMINISTRADOR' }, process.env.JWT_SECRET, { algorithm: 'HS384', expiresIn: '1h' })],
    ['payload adulterado mantendo a assinatura', (() => {
      const [h, , s] = adm.token.split('.');
      return `${h}.${Buffer.from(JSON.stringify({ id: cx.id, perfil: 'ADMINISTRADOR', iat: 1, exp: 9999999999 })).toString('base64url')}.${s}`;
    })()],
    ['assinatura truncada', adm.token.slice(0, -4)],
    ['id como texto', forja({ id: String(adm.id), perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: '1h' } })],
    ['id decimal', forja({ id: 1.5, perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: '1h' } })],
    ['sem id', forja({ perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: '1h' } })],
    ['sem perfil', forja({ id: adm.id }, { jwt: { expiresIn: '1h' } })],
    ['perfil inexistente', forja({ id: adm.id, perfil: 'ROOT' }, { jwt: { expiresIn: '1h' } })],
    ['perfil em minúsculas', forja({ id: adm.id, perfil: 'administrador' }, { jwt: { expiresIn: '1h' } })],
    ['payload sem objeto útil ({})', forja({}, { jwt: { expiresIn: '1h' } })],
    ['nbf no futuro', forja({ id: adm.id, perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: '2h', notBefore: '1h' } })],
  ];
  for (const [rotulo, tok] of casos) {
    await t.caso(`JWT ${rotulo} → 401 "Token inválido."`, async () => {
      L.erro(await me(tok), 401, { mensagem: invalidoTok });
    });
  }
  await t.caso('JWT expirado → 401 "Sessão expirada. Faça login novamente."', async () => {
    const velho = forja({ id: adm.id, perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: -10 } });
    L.erro(await me(velho), 401, { mensagem: 'Sessão expirada. Faça login novamente.' });
  });
  // Comportamento atual: um token sem expiração, mas assinado com o segredo correto, é aceito. Só o servidor emite tokens, então isso só vale se o segredo vazar.
  await t.caso('JWT sem exp (eterno) assinado com o segredo certo ainda é aceito (comportamento atual)', async () => {
    const eterno = forja({ id: adm.id, perfil: 'ADMINISTRADOR' });
    t.sucesso(await me(eterno));
  });
  await t.caso('JWT de usuário que não existe mais → 401 "Sessão inválida."', async () => {
    const fantasma = forja({ id: 2000000000, perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: '1h' } });
    L.erro(await me(fantasma), 401, { mensagem: 'Sessão inválida. Faça login novamente.' });
  });
  await t.caso('JWT de usuário inativo → 401 "Sessão inválida." (em /me e numa rota que só passa pelo middleware)', async () => {
    const tok = forja({ id: inativo.id, perfil: 'ATENDENTE' }, { jwt: { expiresIn: '1h' } });
    L.erro(await me(tok), 401, { mensagem: 'Sessão inválida. Faça login novamente.' });
    // /interno/me confere o "ativo" de novo por conta própria; a rota abaixo depende só do middleware de autenticação.
    L.erro(await t.http('GET', '/interno/usuarios', { token: tok }), 401, { mensagem: 'Sessão inválida. Faça login novamente.' });
    L.erro(await t.http('POST', '/categorias', { token: tok, body: { nome: 'x' } }), 401, { contem: 'Sessão inválida' });
  });

  // ---------------------------------------------------------------- perfil lido do banco
  // Regra decidida: o perfil usado nas permissões vem do banco a cada requisição, nunca da claim do token.
  await t.caso('perfil vem do BANCO: token dizendo ADMINISTRADOR de um caixa não vale como admin (403)', async () => {
    const tok = forja({ id: cx.id, perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: '1h' } });
    L.erro(await t.http('POST', '/interno/usuarios', { token: tok, body: { nome: 'x', login: t.unico('x'), senha: '123456', perfil: 'caixa' } }), 403);
  });
  await t.caso('perfil vem do banco: token dizendo CAIXA de um admin ainda administra', async () => {
    const tok = forja({ id: adm.id, perfil: 'CAIXA' }, { jwt: { expiresIn: '1h' } });
    t.sucesso(await t.http('GET', '/interno/usuarios', { token: tok }));
  });
  await t.caso('mudança de perfil vale imediatamente com o MESMO token', async () => {
    const u = await t.usuario('ADMINISTRADOR');
    const corpo = { nome: 'x', login: t.unico('mud'), senha: '123456', perfil: 'caixa' };
    t.sucesso(await t.http('POST', '/interno/usuarios', { token: u.token, body: corpo }), 201);
    await t.prisma.usuario.update({ where: { id: u.id }, data: { perfil: 'ATENDENTE' } });
    L.erro(await t.http('POST', '/interno/usuarios', { token: u.token, body: { ...corpo, login: t.unico('mud') } }), 403);
  });
  await t.caso('/me reflete o perfil atual do banco', async () => {
    const u = await t.usuario('CAIXA');
    await t.prisma.usuario.update({ where: { id: u.id }, data: { perfil: 'ATENDENTE' } });
    t.eq(t.sucesso(await me(u.token)).perfil, 'atendente');
  });
  await t.caso('inativar depois do login derruba o token na hora; reativar o devolve', async () => {
    const u = await t.usuario('CAIXA');
    await t.prisma.usuario.update({ where: { id: u.id }, data: { ativo: false } });
    L.erro(await me(u.token), 401, { contem: 'Sessão inválida' });
    // Rota que depende só do middleware (o /me repete a checagem e mascararia uma falha dele).
    L.erro(await t.http('GET', '/interno/usuarios', { token: u.token }), 401, { contem: 'Sessão inválida' });
    await t.prisma.usuario.update({ where: { id: u.id }, data: { ativo: true } });
    t.sucesso(await me(u.token));
    t.sucesso(await t.http('GET', '/interno/usuarios', { token: u.token }));
  });
  await t.caso('apagar o usuário depois do login derruba o token (401)', async () => {
    const u = await t.usuario('CAIXA');
    await t.prisma.usuario.delete({ where: { id: u.id } });
    L.erro(await me(u.token), 401, { contem: 'Sessão inválida' });
  });

  // ---------------------------------------------------------------- rotas protegidas x públicas
  // Inventário das rotas protegidas: todas exigem token (401 sem ele).
  const protegidas = [
    ['GET', '/interno/me'], ['GET', '/interno/usuarios'], ['POST', '/interno/usuarios'], ['GET', '/interno/usuarios/1'],
    ['PATCH', '/interno/usuarios/1'], ['PATCH', '/interno/usuarios/1/inativar'],
    ['POST', '/categorias'], ['PATCH', '/categorias/1'], ['PATCH', '/categorias/1/inativar'],
    ['POST', '/produtos'], ['PATCH', '/produtos/1'], ['PATCH', '/produtos/1/inativar'], ['PATCH', '/produtos/1/estoque'],
    ['GET', '/estoque'], ['PATCH', '/estoque/1'], ['PUT', '/estoque/1'],
    ['GET', '/movimentacoes'], ['POST', '/movimentacoes'], ['DELETE', '/movimentacoes/1'],
    ['GET', '/pedidos'], ['POST', '/pedidos'], ['GET', '/pedidos/1'],
    ['POST', '/pagamentos'], ['GET', '/pagamentos/pedido/1'],
  ];
  for (const [m, rota] of protegidas) {
    await t.caso(`${m} ${rota} sem token → 401`, async () => {
      L.erro(await t.http(m, rota, { body: {} }), 401, { mensagem: 'Token de autenticação não informado.' });
    });
  }
  for (const [m, rota] of protegidas.filter((_, i) => i % 4 === 0)) {
    await t.caso(`${m} ${rota} com token inválido → 401 "Token inválido."`, async () => {
      L.erro(await t.http(m, rota, { token: 'xxx.yyy.zzz', body: {} }), 401, { mensagem: invalidoTok });
    });
  }
  // Rotas públicas (catálogo e saúde): respondem 200 sem token.
  const p = await t.produto({ codigoBarras: t.unico('cb') });
  for (const rota of ['/health', '/categorias', '/produtos', `/produtos/${p.id}`, `/produtos/codigo-barras/${p.codigoBarras}`]) {
    await t.caso(`GET ${rota.replace(p.codigoBarras, ':codigo').replace(String(p.id), ':id')} é público (200 sem token)`, async () => {
      t.sucesso(await t.http('GET', rota));
    });
  }
  await t.caso('GET /health devolve só { status: "ok" } (sem contagem de usuários nem outros dados)', async () => {
    t.eq(t.sucesso(await t.http('GET', '/health')), { status: 'ok' });
  });
  await t.caso('rota inexistente → 404 no formato { mensagem } com método e caminho', async () => {
    L.erro(await t.http('GET', '/nao/existe'), 404, { mensagem: 'Rota não encontrada: GET /nao/existe', campo: null });
  });
  await t.caso('método inexistente em rota existente → 404', async () => {
    L.erro(await t.http('PUT', '/interno/login', { body: {} }), 404);
  });
  await t.caso('rota inexistente com token também é 404 (não 401)', async () => {
    L.erro(await t.http('GET', '/outra-rota', { token: adm.token }), 404);
  });
});
