'use strict';
// Cliente do site: cadastro, login, /clientes/me, separação dos tokens (interno × cliente), gestão pelo administrador,
// concorrência, rollback e a FK pedidos.clienteId. Os limites de requisições estão no teste-seguranca (fase "clientes").
const crypto = require('crypto');
const L = require('./_lib.cjs');
const t = L.suite('cliente');
const bcrypt = require('bcrypt');

// Campos exatos do "usuario" do site (contrato); a visão interna acrescenta "ativo". Nunca senhaHash nem loginGoogle.
const CHAVES_SITE = ['email', 'id', 'nome', 'telefone'];
const CHAVES_INTERNO = ['ativo', 'email', 'id', 'nome', 'telefone'];
const MSG_LOGIN = 'E-mail ou senha inválidos.';
const MSG_SEM_PERMISSAO = 'Você não tem permissão para realizar esta ação.';

L.executar(t, async () => {
  // Usuários internos (um por perfil), criados pelo próprio teste (senha aleatória, nada do .env).
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  // Senha aleatória usada pelos cadastros desta suíte.
  const senhaC = crypto.randomBytes(9).toString('hex');
  // Corpo válido de cadastro; cada caso sobrescreve só o campo que quer estragar. O e-mail leva o prefixo da suíte
  // (é por ele que a limpeza final acha os clientes criados).
  const corpo = (over = {}) => ({ nome: 'Maria Cliente', email: `${t.unico('e')}@teste.local`, senha: senhaC, telefone: '11999990000', ...over });
  const cadastrar = (body) => t.http('POST', '/clientes/cadastro', { body });
  const entrar = (email, senha) => t.http('POST', '/clientes/login', { body: { email, senha } });
  const meu = (token, headers) => t.http('GET', '/clientes/me', { token, headers });
  const linha = (email) => t.prisma.cliente.findUnique({ where: { email } });
  const claims = (token) => t.jwt.decode(token);

  // ================================================================ cadastro: caminho feliz
  let cad;
  let corpoCad;
  await t.caso('POST /clientes/cadastro → 201 com { usuario, token } e o usuario no formato do site (telefone como texto)', async () => {
    corpoCad = corpo();
    cad = t.sucesso(await cadastrar(corpoCad), 201);
    t.eq(Object.keys(cad).sort(), ['token', 'usuario']);
    t.eq(Object.keys(cad.usuario).sort(), CHAVES_SITE);
    t.eq([cad.usuario.nome, cad.usuario.email, cad.usuario.telefone], ['Maria Cliente', corpoCad.email, '11999990000']);
    t.verdade(Number.isInteger(cad.usuario.id));
  });
  await t.caso('a resposta nunca traz senhaHash, loginGoogle nem ativo', async () => {
    t.verdade(!JSON.stringify(cad).match(/senhaHash|loginGoogle|ativo/i), JSON.stringify(cad));
  });
  await t.caso('a senha é gravada como hash bcrypt (nunca em texto) e loginGoogle fica nulo, ativo=true', async () => {
    const c = await linha(corpoCad.email);
    t.verdade(c.senhaHash.startsWith('$2') && c.senhaHash !== corpoCad.senha);
    t.eq(await bcrypt.compare(corpoCad.senha, c.senhaHash), true);
    t.eq([c.loginGoogle, c.ativo], [null, true]);
  });
  await t.caso('o token do cadastro funciona em /clientes/me', async () => {
    const u = t.sucesso(await meu(cad.token));
    t.eq(u.id, cad.usuario.id);
  });
  await t.caso('o token do cliente é HS256 com id, tipo "cliente" e aud "cliente" (sem perfil) e validade de 8h', async () => {
    const p = claims(cad.token);
    t.eq(Object.keys(p).sort(), ['aud', 'exp', 'iat', 'id', 'tipo']);
    t.eq([p.id, p.tipo, p.aud, p.exp - p.iat], [cad.usuario.id, 'cliente', 'cliente', 8 * 3600]);
    t.eq(JSON.parse(Buffer.from(cad.token.split('.')[0], 'base64url').toString()).alg, 'HS256');
  });
  await t.caso('e-mail é aparado e gravado em minúsculas (resposta e banco)', async () => {
    const e = `${t.unico('Mix')}@Teste.LOCAL`;
    const r = t.sucesso(await cadastrar(corpo({ email: `  ${e}  ` })), 201);
    t.eq(r.usuario.email, e.toLowerCase());
    t.verdade(await linha(e.toLowerCase()));
  });
  await t.caso('e-mail repetido com outra capitalização → 409 campo=email com a mensagem exata, sem criar outra conta', async () => {
    const e = `${t.unico('dup')}@teste.local`;
    t.sucesso(await cadastrar(corpo({ email: e })), 201);
    L.erro(await cadastrar(corpo({ email: e.toUpperCase() })), 409, { campo: 'email', mensagem: 'Já existe um cadastro com esse e-mail.' });
    L.erro(await cadastrar(corpo({ email: `  ${e}  ` })), 409, { campo: 'email' });
    t.eq(await t.prisma.cliente.count({ where: { email: e } }), 1);
  });
  await t.caso('nome é aparado; nome de exatamente 120 caracteres é aceito', async () => {
    t.eq(t.sucesso(await cadastrar(corpo({ nome: '  Ana  ' })), 201).usuario.nome, 'Ana');
    t.eq(t.sucesso(await cadastrar(corpo({ nome: 'n'.repeat(120) })), 201).usuario.nome.length, 120);
  });
  // Telefone é opcional: ausente, null, "" e só espaços viram null no banco e "" na resposta.
  for (const [rotulo, over] of [['ausente', { telefone: undefined }], ['null', { telefone: null }], ['""', { telefone: '' }], ['só espaços', { telefone: '   ' }]]) {
    await t.caso(`telefone ${rotulo} → gravado como null e devolvido como ""`, async () => {
      const b = corpo(over);
      const r = t.sucesso(await cadastrar(b), 201);
      t.eq(r.usuario.telefone, '');
      t.eq((await linha(b.email)).telefone, null);
    });
  }
  await t.caso('telefone de exatamente 20 caracteres é aceito e aparado', async () => {
    t.eq(t.sucesso(await cadastrar(corpo({ telefone: `  ${'9'.repeat(20)}  ` })), 201).usuario.telefone, '9'.repeat(20));
  });
  await t.caso('campos extras do corpo (id, ativo, loginGoogle, senhaHash) são ignorados', async () => {
    const b = corpo({ id: 1, ativo: false, loginGoogle: 'x', senhaHash: 'x' });
    t.sucesso(await cadastrar(b), 201);
    const c = await linha(b.email);
    t.eq([c.ativo, c.loginGoogle, c.id === 1], [true, null, false]);
    t.eq(await bcrypt.compare(b.senha, c.senhaHash), true);
  });

  // ================================================================ cadastro: validação
  // Matriz de entradas inválidas: cada linha quebra um campo e o erro 400 aponta exatamente esse campo.
  const emailLongo = (n) => t.prefixo + 'x'.repeat(n - t.prefixo.length - '@b.com'.length) + '@b.com';
  const antesN = await t.prisma.cliente.count();
  for (const [rotulo, over, campo] of [
    ['nome ausente', { nome: undefined }, 'nome'], ['nome vazio', { nome: '' }, 'nome'], ['nome só espaços', { nome: '   ' }, 'nome'],
    ['nome com 121 caracteres', { nome: 'n'.repeat(121) }, 'nome'], ['nome numérico', { nome: 5 }, 'nome'], ['nome nulo', { nome: null }, 'nome'],
    ['e-mail ausente', { email: undefined }, 'email'], ['e-mail vazio', { email: '' }, 'email'], ['e-mail nulo', { email: null }, 'email'],
    ['e-mail numérico', { email: 7 }, 'email'], ['e-mail sem @', { email: 'semarroba.com' }, 'email'], ['e-mail sem domínio', { email: 'a@b' }, 'email'],
    ['e-mail com ponto final', { email: 'a@b.' }, 'email'], ['e-mail começando em @', { email: '@b.com' }, 'email'], ['e-mail com espaço no meio', { email: 'a b@c.com' }, 'email'],
    ['e-mail com dois @', { email: 'a@@b.com' }, 'email'], ['e-mail "@.com"', { email: 'x@.com' }, 'email'],
    ['e-mail com 161 caracteres', { email: emailLongo(161) }, 'email'],
    ['senha ausente', { senha: undefined }, 'senha'], ['senha com 5 caracteres', { senha: '12345' }, 'senha'], ['senha numérica', { senha: 123456789 }, 'senha'],
    ['senha nula', { senha: null }, 'senha'], ['senha vazia', { senha: '' }, 'senha'],
    ['senha com 73 bytes (73 ASCII)', { senha: 'a'.repeat(73) }, 'senha'], ['senha de 37 "é" (37 caracteres, 74 bytes)', { senha: 'é'.repeat(37) }, 'senha'],
    ['senha de 19 emojis (19 caracteres, 76 bytes)', { senha: '😀'.repeat(19) }, 'senha'],
    ['telefone com 21 caracteres', { telefone: '9'.repeat(21) }, 'telefone'], ['telefone numérico', { telefone: 11999990000 }, 'telefone'], ['telefone objeto', { telefone: {} }, 'telefone'],
  ]) {
    await t.caso(`cadastro com ${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await cadastrar(corpo(over)), 400, { campo });
    });
  }
  await t.caso('limites aceitos: e-mail de exatamente 160 caracteres; senha de 6 caracteres; senha de 72 bytes (ASCII e 36 "é")', async () => {
    t.sucesso(await cadastrar(corpo({ email: emailLongo(160) })), 201);
    t.sucesso(await cadastrar(corpo({ senha: '123456' })), 201);
    t.sucesso(await cadastrar(corpo({ senha: 'a'.repeat(72) })), 201);
    t.sucesso(await cadastrar(corpo({ senha: 'é'.repeat(36) })), 201);
  });
  await t.caso('corpo vazio → 400 (campo=nome, o primeiro obrigatório)', async () => {
    L.erro(await t.http('POST', '/clientes/cadastro'), 400, { campo: 'nome' });
    L.erro(await cadastrar({}), 400, { campo: 'nome' });
  });
  await t.caso('JSON malformado → 400 "não é um JSON válido" (sem campo)', async () => {
    L.erro(await t.http('POST', '/clientes/cadastro', { rawBody: '{"nome": ' }), 400, { campo: null, contem: 'JSON' });
  });
  await t.caso('as validações com falha não criaram nenhuma conta (só as dos casos válidos acima existem)', async () => {
    const agora = await t.prisma.cliente.count();
    t.eq(agora - antesN, 4); // os 4 cadastros de "limites aceitos"
  });

  // ================================================================ cadastro: concorrência e rollback
  // A unicidade do e-mail é do banco: 10 cadastros simultâneos do mesmo e-mail geram uma conta; o resto vira 409 campo=email.
  await t.caso('10 cadastros simultâneos do MESMO e-mail → 1×201 e 9×409 campo=email, uma única linha no banco', async () => {
    const b = corpo();
    const rs = await t.paralelo(10, () => cadastrar(b));
    t.eq(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join());
    for (const r of rs.filter((x) => x.status !== 201)) L.erro(r, 409, { campo: 'email', mensagem: 'Já existe um cadastro com esse e-mail.' });
    t.eq(await t.prisma.cliente.count({ where: { email: b.email } }), 1);
  });
  await t.caso('10 cadastros simultâneos do mesmo e-mail com capitalizações diferentes → ainda uma única conta', async () => {
    const e = `${t.unico('caps')}@teste.local`;
    const rs = await t.paralelo(10, (i) => cadastrar(corpo({ email: i % 2 ? e.toUpperCase() : e })));
    t.eq(rs.filter((r) => r.status === 201).length, 1);
    t.eq(await t.prisma.cliente.count({ where: { email: e } }), 1);
  });
  await t.caso('15 cadastros simultâneos de e-mails diferentes → todos 201 com ids distintos', async () => {
    const rs = await t.paralelo(15, () => cadastrar(corpo()));
    t.verdade(rs.every((r) => r.status === 201));
    t.eq(new Set(rs.map((r) => r.body.usuario.id)).size, 15);
  });
  await t.caso('ROLLBACK: se o INSERT falha (constraint temporária), responde 500 e nada fica gravado; depois volta a funcionar', async () => {
    const marca = t.unico('FALHA');
    const b = corpo({ nome: marca });
    await t.comConstraint('clientes', 'chk_tc_cli', `nome <> '${marca}'`, async () => {
      t.eq((await cadastrar(b)).status, 500);
    });
    t.eq(await linha(b.email), null);
    t.sucesso(await cadastrar(b), 201); // sem a constraint o mesmo cadastro passa
  });

  // ================================================================ login
  const cli = await t.cliente();
  await t.caso('POST /clientes/login → 200 { usuario, token } com o usuario no formato do site', async () => {
    const r = t.sucesso(await entrar(cli.email, cli.senha));
    t.eq(Object.keys(r).sort(), ['token', 'usuario']);
    t.eq(Object.keys(r.usuario).sort(), CHAVES_SITE);
    t.eq(r.usuario.id, cli.id);
    t.eq([claims(r.token).tipo, claims(r.token).aud], ['cliente', 'cliente']);
    t.verdade(!JSON.stringify(r).match(/senhaHash|loginGoogle/));
  });
  await t.caso('o e-mail do login é aparado e não diferencia maiúsculas', async () => {
    t.sucesso(await entrar(`  ${cli.email.toUpperCase()}  `, cli.senha));
  });
  await t.caso('a senha NÃO é aparada nem ignora maiúsculas', async () => {
    L.erro(await entrar(cli.email, ` ${cli.senha}`), 401, { mensagem: MSG_LOGIN });
    L.erro(await entrar(cli.email, cli.senha.toUpperCase()), 401, { mensagem: MSG_LOGIN });
  });
  // Os quatro motivos de falha devolvem a MESMA resposta (status e corpo idênticos): não revelam o motivo.
  const inativo = await t.cliente({ ativo: false });
  const semSenha = await t.cliente({ comSenha: false });
  await t.caso('e-mail inexistente, senha errada, cliente inativo e conta sem senha → 401 com status e corpo IDÊNTICOS', async () => {
    const rs = [
      await entrar(`${t.unico('naoexiste')}@teste.local`, 'qualquer-coisa-1'),
      await entrar(cli.email, 'senha-errada-1'),
      await entrar(inativo.email, inativo.senha),
      await entrar(semSenha.email, 'qualquer-coisa-1'),
    ];
    for (const r of rs) L.erro(r, 401, { mensagem: MSG_LOGIN, campo: null });
    t.eq(rs.map((r) => r.status), [401, 401, 401, 401]);
    t.eq(rs.map((r) => r.body), [rs[0].body, rs[0].body, rs[0].body, rs[0].body]);
    t.eq(Object.keys(rs[0].body), ['mensagem']);
  });
  for (const [rotulo, body] of [
    ['sem corpo', undefined], ['corpo vazio', {}], ['sem e-mail', { senha: 'x' }], ['sem senha', { email: 'a@b.com' }],
    ['e-mail vazio', { email: '', senha: 'x' }], ['e-mail só espaços', { email: '  ', senha: 'x' }], ['senha vazia', { email: 'a@b.com', senha: '' }],
    ['e-mail numérico', { email: 1, senha: 'x' }], ['senha numérica', { email: 'a@b.com', senha: 1 }], ['e-mail objeto', { email: { $ne: '' }, senha: 'x' }],
    ['senha nula', { email: 'a@b.com', senha: null }],
  ]) {
    await t.caso(`login ${rotulo} → 400 "Informe e-mail e senha." (sem campo)`, async () => {
      L.erro(await t.http('POST', '/clientes/login', { body }), 400, { mensagem: 'Informe e-mail e senha.', campo: null });
    });
  }
  await t.caso('login com JSON malformado → 400; com injeção SQL → 401 genérico', async () => {
    L.erro(await t.http('POST', '/clientes/login', { rawBody: '{' }), 400, { contem: 'JSON' });
    L.erro(await entrar("' OR '1'='1", "' OR '1'='1"), 401, { mensagem: MSG_LOGIN });
  });
  await t.caso('conta criada só com login Google (sem senha) não consegue entrar por senha nenhuma (401 genérico)', async () => {
    const g = await t.prisma.cliente.create({ data: { nome: 'Google', email: `${t.unico('g')}@teste.local`, loginGoogle: `${t.prefixo}google-1` } });
    L.erro(await entrar(g.email, 'qualquer-senha-9'), 401, { mensagem: MSG_LOGIN });
  });
  await t.caso('20 logins válidos simultâneos → todos 200 (sem limite com NODE_ENV=test)', async () => {
    const rs = await t.paralelo(20, () => entrar(cli.email, cli.senha));
    t.verdade(rs.every((r) => r.status === 200));
  });
  await t.caso('GET /clientes/login não existe (404 de rota)', async () => {
    L.erro(await t.http('GET', '/clientes/login'), 404, { contem: 'Rota não encontrada' });
  });

  // ================================================================ GET /clientes/me e sessão
  await t.caso('GET /clientes/me devolve o cliente logado no formato do site', async () => {
    const c = await t.cliente({ telefone: '11988887777', nome: 'Pedro' });
    const u = t.sucesso(await meu(c.token));
    t.eq(u, { id: c.id, nome: 'Pedro', email: c.email, telefone: '11988887777' });
  });
  await t.caso('/clientes/me sem token → 401 "não informado"; token lixo → 401 "Token inválido."', async () => {
    L.erro(await meu(), 401, { mensagem: 'Token de autenticação não informado.' });
    L.erro(await meu('lixo'), 401, { mensagem: 'Token inválido.' });
  });
  await t.caso('PATCH/PUT/DELETE /clientes/me não existem (404 de rota): perfil ainda não é editável', async () => {
    for (const m of ['PATCH', 'PUT', 'DELETE']) L.erro(await t.http(m, '/clientes/me', { token: cli.token, body: {} }), 404);
  });
  // O /clientes/me depende SÓ do middleware para saber se o cliente está ativo (a rota não repete a checagem), então este
  // caso prova que o autenticarCliente derruba o token na hora.
  await t.caso('cliente inativado DEPOIS do login perde o token na hora (401 sessão inválida) e volta a valer ao reativar', async () => {
    const c = await t.cliente();
    t.sucesso(await meu(c.token));
    await t.prisma.cliente.update({ where: { id: c.id }, data: { ativo: false } });
    L.erro(await meu(c.token), 401, { mensagem: 'Sessão inválida. Faça login novamente.' });
    await t.prisma.cliente.update({ where: { id: c.id }, data: { ativo: true } });
    t.sucesso(await meu(c.token));
  });
  await t.caso('cliente apagado do banco depois do login → 401 sessão inválida', async () => {
    const c = await t.cliente();
    await t.prisma.cliente.delete({ where: { id: c.id } });
    L.erro(await meu(c.token), 401, { mensagem: 'Sessão inválida. Faça login novamente.' });
  });
  await t.caso('token de cliente expirado → 401 "Sessão expirada"; assinado com outro segredo → 401; alg none → 401', async () => {
    const velho = t.assinar({ id: cli.id, tipo: 'cliente', aud: 'cliente' }, { jwt: { expiresIn: -10 } });
    L.erro(await meu(velho), 401, { contem: 'Sessão expirada' });
    const outro = t.jwt.sign({ id: cli.id, tipo: 'cliente', aud: 'cliente' }, 'x'.repeat(40), { algorithm: 'HS256' });
    L.erro(await meu(outro), 401, { mensagem: 'Token inválido.' });
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    L.erro(await meu(`${b({ alg: 'none', typ: 'JWT' })}.${b({ id: cli.id, tipo: 'cliente', aud: 'cliente' })}.`), 401, { mensagem: 'Token inválido.' });
  });
  await t.caso('id do token como texto ou decimal → 401 "Token inválido."', async () => {
    for (const id of [String(cli.id), 1.5, null]) L.erro(await meu(t.assinar({ id, tipo: 'cliente', aud: 'cliente' }, { jwt: { expiresIn: '1h' } })), 401, { mensagem: 'Token inválido.' });
  });

  // ================================================================ separação dos tokens interno × cliente
  // Regra: tipo ausente/desconhecido ou aud incoerente → 401 "Token inválido."; token legítimo do outro lado → 403.
  const tokCli = (extra = {}) => t.assinar({ id: cli.id, tipo: 'cliente', aud: 'cliente', ...extra }, { jwt: { expiresIn: '1h' } });
  const tokUsu = (extra = {}) => t.assinar({ id: adm.id, perfil: 'ADMINISTRADOR', tipo: 'usuario', aud: 'interno', ...extra }, { jwt: { expiresIn: '1h' } });
  // Rotas internas de vários módulos: o token de cliente é recusado com 403 em todas.
  for (const [m, rota] of [['GET', '/interno/me'], ['GET', '/interno/usuarios'], ['GET', '/interno/clientes'], ['POST', '/categorias'], ['GET', '/pedidos'], ['GET', '/estoque'], ['GET', '/movimentacoes'], ['POST', '/pagamentos'], ['POST', '/produtos']]) {
    await t.caso(`token de CLIENTE em ${m} ${rota} → 403 "${MSG_SEM_PERMISSAO}"`, async () => {
      L.erro(await t.http(m, rota, { token: cli.token, body: {} }), 403, { mensagem: MSG_SEM_PERMISSAO, campo: null });
    });
  }
  await t.caso('token de USUÁRIO INTERNO em /clientes/me → 403 (mesmo sendo administrador)', async () => {
    L.erro(await meu(adm.token), 403, { mensagem: MSG_SEM_PERMISSAO });
    L.erro(await meu(cx.token), 403, { mensagem: MSG_SEM_PERMISSAO });
  });
  // O tipo é conferido ANTES de consultar o banco: com um id que não existe, o resultado continua 403 (e não 401 "sessão inválida").
  await t.caso('tipo conferido antes do banco: token de cliente de id inexistente em rota interna → 403 (não 401 sessão inválida)', async () => {
    L.erro(await t.http('GET', '/interno/me', { token: tokCli({ id: 2000000000 }) }), 403, { mensagem: MSG_SEM_PERMISSAO });
  });
  await t.caso('tipo conferido antes do banco: token de usuário de id inexistente em /clientes/me → 403', async () => {
    L.erro(await meu(tokUsu({ id: 2000000000 })), 403, { mensagem: MSG_SEM_PERMISSAO });
  });
  await t.caso('tipo conferido antes do banco: cliente INATIVO com token legítimo em rota interna → 403 (não 401)', async () => {
    L.erro(await t.http('GET', '/interno/me', { token: tokCli({ id: inativo.id }) }), 403);
  });
  await t.caso('claim perfil forjada num token de cliente não vira administrador (continua 403 nas rotas internas)', async () => {
    L.erro(await t.http('GET', '/interno/clientes', { token: tokCli({ perfil: 'ADMINISTRADOR' }) }), 403);
    L.erro(await t.http('GET', '/interno/usuarios', { token: tokCli({ perfil: 'ADMINISTRADOR' }) }), 403);
  });
  // Tokens que não emitimos (tipo/aud estranhos): 401, em AMBOS os lados.
  const estranhos = [
    ['sem tipo e sem aud (formato antigo { id, perfil })', { id: adm.id, perfil: 'ADMINISTRADOR' }, true],
    ['sem tipo (aud presente)', { id: adm.id, perfil: 'ADMINISTRADOR', aud: 'interno', tipo: undefined }, false],
    ['sem aud (tipo presente)', { id: adm.id, perfil: 'ADMINISTRADOR', tipo: 'usuario', aud: undefined }, false],
    ['tipo desconhecido ("admin")', { id: adm.id, perfil: 'ADMINISTRADOR', tipo: 'admin', aud: 'interno' }, false],
    ['tipo com espaço ("usuario ")', { id: adm.id, perfil: 'ADMINISTRADOR', tipo: 'usuario ', aud: 'interno' }, false],
    ['tipo numérico', { id: adm.id, perfil: 'ADMINISTRADOR', tipo: 1, aud: 'interno' }, false],
    ['tipo nulo', { id: adm.id, perfil: 'ADMINISTRADOR', tipo: null, aud: 'interno' }, false],
    ['tipo "usuario" com aud "cliente"', { id: adm.id, perfil: 'ADMINISTRADOR', tipo: 'usuario', aud: 'cliente' }, false],
    ['tipo "cliente" com aud "interno"', { id: cli.id, tipo: 'cliente', aud: 'interno' }, false],
    ['aud desconhecida', { id: adm.id, perfil: 'ADMINISTRADOR', tipo: 'usuario', aud: 'outro' }, false],
    ['aud como lista ["interno"]', { id: adm.id, perfil: 'ADMINISTRADOR', tipo: 'usuario', aud: ['interno'] }, false],
  ];
  for (const [rotulo, payload, semTipo] of estranhos) {
    await t.caso(`token ${rotulo} → 401 "Token inválido." em /interno/me e em /clientes/me`, async () => {
      const tok = t.assinar(payload, { semTipo, jwt: { expiresIn: '1h' } });
      L.erro(await t.http('GET', '/interno/me', { token: tok }), 401, { mensagem: 'Token inválido.' });
      L.erro(await meu(tok), 401, { mensagem: 'Token inválido.' });
    });
  }
  await t.caso('token de cliente sem tipo ({ id }) → 401 "Token inválido." em /clientes/me', async () => {
    L.erro(await meu(t.assinar({ id: cli.id }, { semTipo: true, jwt: { expiresIn: '1h' } })), 401, { mensagem: 'Token inválido.' });
  });
  await t.caso('o token do login interno carrega tipo/aud e funciona; token antigo (sem tipo) deixa de funcionar', async () => {
    t.sucesso(await t.http('GET', '/interno/me', { token: adm.token }));
    L.erro(await t.http('GET', '/interno/me', { token: t.assinar({ id: adm.id, perfil: 'ADMINISTRADOR' }, { semTipo: true, jwt: { expiresIn: '1h' } }) }), 401, { mensagem: 'Token inválido.' });
  });
  await t.caso('cada lado continua aceitando o próprio token (interno em /interno/me, cliente em /clientes/me)', async () => {
    t.sucesso(await t.http('GET', '/interno/me', { token: tokUsu() }));
    t.sucesso(await meu(tokCli()));
  });
  await t.caso('os dois tokens são independentes: ids iguais em tabelas diferentes não se confundem', async () => {
    // Um cliente e um usuário podem ter o MESMO id numérico; o token de um nunca autentica o outro lado.
    const mesmoId = { id: cli.id };
    L.erro(await t.http('GET', '/interno/me', { token: t.assinar({ ...mesmoId, tipo: 'cliente', aud: 'cliente' }, { jwt: { expiresIn: '1h' } }) }), 403);
    L.erro(await meu(t.assinar({ ...mesmoId, perfil: 'ADMINISTRADOR', tipo: 'usuario', aud: 'interno' }, { jwt: { expiresIn: '1h' } })), 403);
  });

  // ================================================================ gestão pelo administrador
  // Massa: clientes com nomes/e-mails previsíveis (todos com o prefixo da suíte no e-mail, para a busca isolar a suíte).
  const mk = (nome, ativo = true) => t.prisma.cliente.create({ data: { nome, email: `${t.unico('lst')}@teste.local`, ativo, senhaHash: 'x' } });
  const ana1 = await mk('Ana Souza');
  const ana2 = await mk('Ana Souza');
  const bia = await mk('Bia Lima', false);
  const caio = await mk('caio Alves');
  const lista = (qs = '', token = adm.token) => t.http('GET', `/interno/clientes?busca=${encodeURIComponent(t.prefixo + 'lst')}${qs}`, { token });
  await t.caso('GET /interno/clientes (administrador) → { dados, pagina, limite, total, totalPaginas } na visão interna', async () => {
    const r = t.sucesso(await lista());
    t.eq(Object.keys(r).sort(), ['dados', 'limite', 'pagina', 'total', 'totalPaginas']);
    t.eq([r.pagina, r.limite, r.total, r.totalPaginas], [1, 20, 4, 1]);
    t.verdade(r.dados.every((c) => JSON.stringify(Object.keys(c).sort()) === JSON.stringify(CHAVES_INTERNO)));
    t.verdade(!JSON.stringify(r).match(/senhaHash|loginGoogle/));
  });
  await t.caso('ordem estável: por nome (sem diferenciar maiúsculas na ordenação do banco) e, em empate, por id', async () => {
    const r = t.sucesso(await lista('&limite=100')).dados;
    const nomes = r.map((c) => c.nome);
    t.eq(nomes.filter((n) => n === 'Ana Souza').length, 2);
    const iguais = r.filter((c) => c.nome === 'Ana Souza').map((c) => c.id);
    t.eq(iguais, [ana1.id, ana2.id]);
    t.verdade(r.findIndex((c) => c.id === ana2.id) < r.findIndex((c) => c.id === bia.id));
  });
  await t.caso('paginação: limite=2 → 2 páginas sem repetir nem pular registros, com totalPaginas correto', async () => {
    const p1 = t.sucesso(await lista('&limite=2&pagina=1'));
    const p2 = t.sucesso(await lista('&limite=2&pagina=2'));
    const p3 = t.sucesso(await lista('&limite=2&pagina=3'));
    t.eq([p1.dados.length, p2.dados.length, p3.dados.length, p1.totalPaginas, p1.total], [2, 2, 0, 2, 4]);
    t.eq(new Set([...p1.dados, ...p2.dados].map((c) => c.id)).size, 4);
  });
  await t.caso('?status=ativo / inativo / todos / vazio', async () => {
    t.eq(t.sucesso(await lista('&status=ativo')).total, 3);
    t.eq(t.sucesso(await lista('&status=inativo')).dados.map((c) => c.id), [bia.id]);
    t.eq(t.sucesso(await lista('&status=todos')).total, 4);
    t.eq(t.sucesso(await lista('&status=')).total, 4);
  });
  await t.caso('?status inválido → 400 campo=status', async () => {
    L.erro(await lista('&status=xx'), 400, { campo: 'status' });
  });
  await t.caso('?busca acha por nome e por e-mail, sem diferenciar maiúsculas', async () => {
    const porNome = t.sucesso(await t.http('GET', `/interno/clientes?busca=${encodeURIComponent('CAIO alves')}`, { token: adm.token }));
    t.verdade(porNome.dados.some((c) => c.id === caio.id));
    const porEmail = t.sucesso(await t.http('GET', `/interno/clientes?busca=${encodeURIComponent(bia.email.toUpperCase())}`, { token: adm.token }));
    t.eq(porEmail.dados.map((c) => c.id), [bia.id]);
    t.eq(t.sucesso(await t.http('GET', `/interno/clientes?busca=${t.prefixo}nada_zzz`, { token: adm.token })).dados, []);
  });
  for (const qs of ['pagina=0', 'pagina=-1', 'pagina=abc', 'pagina=1.5', 'pagina=1000001', 'limite=0', 'limite=101', 'limite=abc']) {
    await t.caso(`?${qs} → 400 campo=${qs.split('=')[0]}`, async () => {
      L.erro(await lista(`&${qs}`), 400, { campo: qs.split('=')[0] });
    });
  }
  // Só o administrador vê e altera clientes: caixa, atendente e o próprio cliente recebem 403; sem token, 401.
  for (const [nome, token] of [['caixa', cx.token], ['atendente', at.token], ['cliente', cli.token]]) {
    await t.caso(`${nome} NÃO lista clientes → 403`, async () => {
      L.erro(await lista('', token), 403, { mensagem: MSG_SEM_PERMISSAO });
    });
    await t.caso(`${nome} NÃO altera "ativo" de cliente → 403 e nada muda`, async () => {
      L.erro(await t.http('PATCH', `/interno/clientes/${ana1.id}/ativo`, { token, body: { ativo: false } }), 403);
      t.eq((await t.prisma.cliente.findUnique({ where: { id: ana1.id } })).ativo, true);
    });
  }
  await t.caso('sem token → 401 em GET e PATCH de /interno/clientes', async () => {
    L.erro(await t.http('GET', '/interno/clientes'), 401);
    L.erro(await t.http('PATCH', `/interno/clientes/${ana1.id}/ativo`, { body: { ativo: false } }), 401);
  });
  const ativo = (id, body, token = adm.token) => t.http('PATCH', `/interno/clientes/${id}/ativo`, { token, body });
  await t.caso('PATCH /interno/clientes/:id/ativo {ativo:false} inativa (visão interna) e o registro permanece; {ativo:true} reativa', async () => {
    const r = t.sucesso(await ativo(ana1.id, { ativo: false }));
    t.eq(Object.keys(r).sort(), CHAVES_INTERNO);
    t.eq(r.ativo, false);
    t.eq((await t.prisma.cliente.findUnique({ where: { id: ana1.id } })).ativo, false);
    t.eq(t.sucesso(await ativo(ana1.id, { ativo: true })).ativo, true);
  });
  await t.caso('alterar "ativo" é idempotente', async () => {
    t.eq(t.sucesso(await ativo(bia.id, { ativo: false })).ativo, false);
    t.eq(t.sucesso(await ativo(bia.id, { ativo: false })).ativo, false);
  });
  for (const [rotulo, body] of [['ausente', {}], ['texto "false"', { ativo: 'false' }], ['número 0', { ativo: 0 }], ['nulo', { ativo: null }], ['objeto', { ativo: {} }]]) {
    await t.caso(`ativo ${rotulo} → 400 campo=ativo`, async () => {
      L.erro(await ativo(ana1.id, body), 400, { campo: 'ativo' });
    });
  }
  await t.caso('cliente inexistente → 404 "Cliente não encontrado."', async () => {
    L.erro(await ativo(2000000000, { ativo: false }), 404, { mensagem: 'Cliente não encontrado.' });
  });
  for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
    await t.caso(`id inválido '${id}' → 400 campo=id`, async () => {
      L.erro(await ativo(id, { ativo: false }), 400, { campo: 'id' });
    });
  }
  await t.caso('inativar pelo administrador: o cliente não consegue mais logar (401 genérico) e o token dele morre', async () => {
    const c = await t.cliente();
    t.sucesso(await meu(c.token));
    t.eq(t.sucesso(await ativo(c.id, { ativo: false })).ativo, false);
    L.erro(await entrar(c.email, c.senha), 401, { mensagem: MSG_LOGIN });
    L.erro(await meu(c.token), 401, { contem: 'Sessão inválida' });
    t.sucesso(await ativo(c.id, { ativo: true }));
    t.sucesso(await entrar(c.email, c.senha));
  });
  await t.caso('não existe DELETE de cliente (404 de rota): exclusão é lógica', async () => {
    L.erro(await t.http('DELETE', `/interno/clientes/${ana1.id}`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
    L.erro(await t.http('GET', `/interno/clientes/${ana1.id}`, { token: adm.token }), 404);
  });
  await t.caso('2 inativações e 2 reativações simultâneas do mesmo cliente não quebram (200) e o final é um dos dois valores', async () => {
    const rs = await t.paralelo(6, (i) => ativo(caio.id, { ativo: i % 2 === 0 }));
    t.verdade(rs.every((r) => r.status === 200));
  });

  // ================================================================ FK pedidos.clienteId → clientes.id
  await t.caso('FK: pedido com clienteId de cliente INEXISTENTE é recusado pelo banco (P2003)', async () => {
    let erro;
    try {
      await t.prisma.pedido.create({ data: { usuarioId: adm.id, clienteId: 2000000000, canal: 'ONLINE' } });
    } catch (e) {
      erro = e;
    }
    t.eq(erro && erro.code, 'P2003');
  });
  await t.caso('FK: pedido com cliente válido é aceito; clienteId null continua permitido (visitante/presencial)', async () => {
    const p = await t.prisma.pedido.create({ data: { usuarioId: adm.id, clienteId: cli.id, canal: 'ONLINE' } });
    t.eq(p.clienteId, cli.id);
    const v = await t.prisma.pedido.create({ data: { usuarioId: adm.id, canal: 'PRESENCIAL' } });
    t.eq(v.clienteId, null);
  });
  await t.caso('FK Restrict: apagar um cliente que tem pedido é barrado pelo banco (constraint pedidos_clienteId_fkey) e o cliente permanece', async () => {
    let erro;
    try {
      await t.prisma.cliente.delete({ where: { id: cli.id } });
    } catch (e) {
      erro = e;
    }
    t.verdade(erro, 'o banco deveria barrar a exclusão');
    // O Postgres responde 23001 (restrict_violation) e o Prisma o entrega como erro "desconhecido" (sem código P2003);
    // o que vale é que a constraint da FK foi a causa.
    t.verdade(/pedidos_clienteId_fkey/.test(erro.message), `${erro.constructor.name}: ${erro.message}`);
    t.verdade(await t.prisma.cliente.findUnique({ where: { id: cli.id } }));
  });
  await t.caso('FK: depois que o pedido some, o cliente pode ser apagado', async () => {
    const c = await t.cliente();
    const p = await t.prisma.pedido.create({ data: { usuarioId: adm.id, clienteId: c.id, canal: 'ONLINE' } });
    await t.prisma.pedido.delete({ where: { id: p.id } });
    await t.prisma.cliente.delete({ where: { id: c.id } });
  });
  await t.caso('o histórico fica íntegro na exclusão lógica: cliente inativado continua ligado aos pedidos dele', async () => {
    const c = await t.cliente();
    const p = await t.prisma.pedido.create({ data: { usuarioId: adm.id, clienteId: c.id, canal: 'ONLINE' } });
    t.sucesso(await ativo(c.id, { ativo: false }));
    t.eq((await t.prisma.pedido.findUnique({ where: { id: p.id } })).clienteId, c.id);
  });
  // D18: o PDF não define UNIQUE para login_google; a API segue o PDF, então dois clientes podem ter o mesmo loginGoogle.
  await t.caso('login_google sem unicidade (fiel ao PDF, item D18): dois clientes aceitam o mesmo loginGoogle', async () => {
    const g = `${t.prefixo}google-dup`;
    await t.prisma.cliente.create({ data: { nome: 'G1', loginGoogle: g } });
    await t.prisma.cliente.create({ data: { nome: 'G2', loginGoogle: g } });
    t.eq(await t.prisma.cliente.count({ where: { loginGoogle: g } }), 2);
  });
  await t.caso('e-mail é UNIQUE no banco e vários clientes sem e-mail convivem (null não conflita)', async () => {
    const e = `${t.unico('u')}@teste.local`;
    await t.prisma.cliente.create({ data: { nome: 'U1', email: e } });
    let erro;
    try {
      await t.prisma.cliente.create({ data: { nome: 'U2', email: e } });
    } catch (x) {
      erro = x;
    }
    t.eq(erro && erro.code, 'P2002');
    await t.prisma.cliente.create({ data: { nome: 'S1', loginGoogle: `${t.prefixo}g-s1` } });
    await t.prisma.cliente.create({ data: { nome: 'S2', loginGoogle: `${t.prefixo}g-s2` } });
  });
  // [DIVERGE-PDF] D16 — o PDF define id_cliente BIGSERIAL (e id_cliente BIGINT em pedido); a API usa Int/SERIAL em todas as tabelas.
  await t.diverge('clientes.id é INTEGER (SERIAL); o PDF define id_cliente como BIGSERIAL/BIGINT', async () => {
    const col = await t.prisma.$queryRaw`SELECT data_type FROM information_schema.columns WHERE table_name = 'clientes' AND column_name = 'id'`;
    t.eq(col[0].data_type, 'integer');
  });
  // D17 (contrato do frontend, não é o PDF): o usuário do site usa "telefone"; o contrato fala em "whatsapp".
  await t.caso('o usuário do site expõe "telefone" (o contrato do frontend diz "whatsapp": item D17)', async () => {
    t.verdade('telefone' in cad.usuario && !('whatsapp' in cad.usuario));
  });
});
