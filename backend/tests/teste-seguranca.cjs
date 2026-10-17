'use strict';
// Segurança em 4 fases. CADA fase sobe o seu próprio servidor com variáveis de ambiente diferentes, só naquele
// processo filho (nada do .env nem do código é alterado):
//   básico     — headers (helmet), JWT inválido/ausente, rate limit do login (e leitura de LOGIN_RATE_LIMIT_MAX)
//   geral      — rate limit geral (100/min por IP)
//   desativado — NODE_ENV=test: sem rate limit
//   origens    — CORS_ALLOWED_ORIGINS com lista
const http = require('http');
const crypto = require('crypto');
const L = require('./_lib.cjs');
const t = L.suite('seguranca');
const bcrypt = require('bcrypt');

// Mensagens exatas dos dois limitadores de requisições.
const MSG_LOGIN_429 = 'Muitas tentativas de login. Tente novamente em alguns minutos.';
const MSG_GERAL_429 = 'Muitas requisições. Tente novamente em instantes.';

// GET/OPTIONS com cabeçalhos livres (inclusive Origin, que o fetch pode tratar como proibido).
// Requisição HTTP crua: permite enviar o cabeçalho Origin livremente (o fetch pode tratá-lo como proibido).
function bruto(metodo, caminho, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: L.PORTA, path: caminho, method: metodo, headers }, (res) => {
      let corpo = '';
      res.on('data', (d) => (corpo += d));
      res.on('end', () => {
        let json;
        try {
          json = corpo ? JSON.parse(corpo) : undefined;
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, texto: corpo });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

L.executar(t, async () => {
  const login = (b, extra) => t.http('POST', '/interno/login', { body: b, ...extra });
  const resultados = [];

  // Usuários criados direto no banco (não dependem do servidor nem de senha do .env); tokens assinados localmente.
  // Usuários criados direto no banco com senha aleatória e tokens assinados localmente: não dependem do servidor nem do .env.
  const senha = crypto.randomBytes(9).toString('hex');
  const mk = async (perfil, ativo = true) => {
    const u = await t.prisma.usuario.create({ data: { nome: 'Seg', login: t.unico('u'), senhaHash: await bcrypt.hash(senha, 4), perfil, ativo } });
    return { ...u, token: t.assinar({ id: u.id, perfil }, { jwt: { expiresIn: '1h' } }) };
  };
  const adm = await mk('ADMINISTRADOR');
  const cx = await mk('CAIXA');
  const inativo = await mk('ATENDENTE', false);

  // Executa uma fase: sobe o servidor com `env`, roda `fn`, derruba o servidor e registra o placar da fase.
  // Executa uma fase: sobe o servidor com a env da fase (só nesse processo filho), roda os casos e derruba o servidor.
  async function fase(nome, env, fn) {
    const ok0 = t.placar.ok;
    const f0 = t.placar.falhas;
    console.log(`\n--- fase ${nome} (${Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}) ---`);
    let srv;
    try {
      srv = await L.subirServidor({ ...env });
      await fn(srv);
    } catch (e) {
      t.placar.falhas++;
      console.log(`FALHA - fase ${nome}: ${e && e.message}`);
    } finally {
      if (srv) await srv.parar();
    }
    return { nome, ok: t.placar.ok - ok0, falhas: t.placar.falhas - f0 };
  }
  // Reinicia o servidor com outra env dentro da mesma fase (o server.ts tem porta fixa, então um servidor por vez).
  async function subFase(nome, env, fn) {
    // Reinicia o servidor com outro ambiente dentro da mesma fase (conta no placar da fase atual).
    let srv;
    try {
      srv = await L.subirServidor({ ...env });
      await fn(srv);
    } catch (e) {
      t.placar.falhas++;
      console.log(`FALHA - ${nome}: ${e && e.message}`);
    } finally {
      if (srv) await srv.parar();
    }
  }
  const somarFases = (acc, ...rs) => acc.push(...rs);

  // ================================================================ FASE 1: básico
  const f1 = await fase('basico', { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: 'http://front.test' }, async (srv) => {
    const H = (r, k) => r.headers.get(k);
    // ---- helmet
    // helmet: cabeçalhos de segurança em todas as respostas, inclusive de erro; o X-Powered-By é removido.
    const h = await t.http('GET', '/health');
    await t.caso('helmet: X-Content-Type-Options nosniff', async () => t.eq(H(h, 'x-content-type-options'), 'nosniff'));
    await t.caso('helmet: X-Frame-Options SAMEORIGIN', async () => t.eq(H(h, 'x-frame-options'), 'SAMEORIGIN'));
    await t.caso('helmet: Strict-Transport-Security presente com max-age', async () => t.verdade(/max-age=\d+/.test(H(h, 'strict-transport-security') || '')));
    await t.caso('helmet: Content-Security-Policy presente com default-src \'self\'', async () => t.verdade((H(h, 'content-security-policy') || '').includes("default-src 'self'")));
    await t.caso('helmet: remove X-Powered-By (não revela o Express)', async () => t.eq(H(h, 'x-powered-by'), null));
    await t.caso('helmet: Referrer-Policy no-referrer', async () => t.eq(H(h, 'referrer-policy'), 'no-referrer'));
    await t.caso('helmet: Cross-Origin-Opener-Policy e Cross-Origin-Resource-Policy same-origin', async () => {
      t.eq(H(h, 'cross-origin-opener-policy'), 'same-origin');
      t.eq(H(h, 'cross-origin-resource-policy'), 'same-origin');
    });
    await t.caso('helmet: X-DNS-Prefetch-Control off e X-Download-Options noopen', async () => {
      t.eq(H(h, 'x-dns-prefetch-control'), 'off');
      t.eq(H(h, 'x-download-options'), 'noopen');
    });
    await t.caso('os headers de segurança também vêm em respostas 404', async () => {
      const r = await t.http('GET', '/nao-existe');
      t.eq([r.status, H(r, 'x-content-type-options'), H(r, 'x-powered-by')], [404, 'nosniff', null]);
    });
    await t.caso('os headers de segurança também vêm em respostas 401', async () => {
      const r = await t.http('GET', '/interno/me');
      t.eq([r.status, H(r, 'x-content-type-options'), H(r, 'x-powered-by')], [401, 'nosniff', null]);
    });
    await t.caso('o erro 500/JSON malformado não vaza stack trace nem caminhos', async () => {
      const r = await t.http('POST', '/interno/login', { rawBody: '{' });
      t.verdade(!/\.ts|node_modules|at \w+/.test(r.texto), r.texto);
    });
    await t.caso('respostas JSON têm Content-Type application/json', async () => {
      t.verdade((H(await t.http('GET', '/health'), 'content-type') || '').startsWith('application/json'));
    });

    // ---- JWT ausente / inválido
    const invalidoTok = 'Token inválido.';
    const me = (token, headers) => t.http('GET', '/interno/me', { token, headers });
    await t.caso('sem token → 401 "não informado"', async () => L.erro(await me(), 401, { mensagem: 'Token de autenticação não informado.' }));
    await t.caso('Basic em vez de Bearer → 401 mal formatado', async () => L.erro(await me(undefined, { authorization: 'Basic abc' }), 401, { contem: 'mal formatado' }));
    await t.caso('token lixo → 401 "Token inválido."', async () => L.erro(await me('lixo'), 401, { mensagem: invalidoTok }));
    await t.caso('token assinado com outro segredo → 401', async () => {
      L.erro(await me(t.jwt.sign({ id: adm.id, perfil: 'ADMINISTRADOR' }, 'x'.repeat(40), { algorithm: 'HS256' })), 401, { mensagem: invalidoTok });
    });
    await t.caso('token alg=none → 401', async () => {
      const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      L.erro(await me(`${b({ alg: 'none', typ: 'JWT' })}.${b({ id: adm.id, perfil: 'ADMINISTRADOR' })}.`), 401, { mensagem: invalidoTok });
    });
    await t.caso('token expirado → 401 "Sessão expirada"', async () => {
      L.erro(await me(t.assinar({ id: adm.id, perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: -5 } })), 401, { contem: 'Sessão expirada' });
    });
    await t.caso('token de usuário inativo → 401 "Sessão inválida"', async () => {
      L.erro(await me(t.assinar({ id: inativo.id, perfil: 'ATENDENTE' }, { jwt: { expiresIn: '1h' } })), 401, { contem: 'Sessão inválida' });
    });
    await t.caso('token com payload adulterado (perfil trocado) → 401', async () => {
      const [a, , c] = cx.token.split('.');
      const p = Buffer.from(JSON.stringify({ id: cx.id, perfil: 'ADMINISTRADOR' })).toString('base64url');
      L.erro(await me(`${a}.${p}.${c}`), 401, { mensagem: invalidoTok });
    });
    await t.caso('perfil vem do banco: token de caixa com claim ADMINISTRADOR forjada → 403 em rota de administrador', async () => {
      const forjado = t.assinar({ id: cx.id, perfil: 'ADMINISTRADOR' }, { jwt: { expiresIn: '1h' } });
      L.erro(await t.http('POST', '/interno/usuarios', { token: forjado, body: {} }), 403);
    });
    await t.caso('rotas protegidas recusam sem token (amostra): produtos, pedidos, movimentações', async () => {
      for (const [m, r] of [['POST', '/produtos'], ['GET', '/pedidos'], ['POST', '/movimentacoes'], ['POST', '/pagamentos'], ['GET', '/estoque']]) L.erro(await t.http(m, r, { body: {} }), 401);
    });
    await t.caso('token válido funciona (200 em /interno/me)', async () => t.sucesso(await me(adm.token)));

    // ---- rate limit do login (limite 5)
    // Limite do login: só tentativas FALHAS contam (skipSuccessfulRequests); a 6ª falha em 15 minutos recebe 429, por IP.
    await t.caso('login CORRETO não gasta o limite: 8 logins válidos seguidos → todos 200', async () => {
      for (let i = 0; i < 8; i++) t.sucesso(await login({ login: adm.login, senha }));
    });
    let ultima;
    await t.caso('as 5 primeiras tentativas ERRADAS recebem 401 (e mostram os headers RateLimit)', async () => {
      for (let i = 0; i < 5; i++) {
        ultima = await login({ login: adm.login, senha: 'errada' });
        L.erro(ultima, 401, { mensagem: 'Login ou senha inválidos.' });
      }
      t.verdade(ultima.headers.get('ratelimit') || ultima.headers.get('ratelimit-policy'), 'sem headers RateLimit');
      t.verdade((ultima.headers.get('ratelimit-policy') || '').startsWith('5;'), `policy: ${ultima.headers.get('ratelimit-policy')}`);
    });
    let bloq;
    await t.caso('a 6ª tentativa errada → 429 no formato { mensagem }', async () => {
      bloq = await login({ login: adm.login, senha: 'errada' });
      L.erro(bloq, 429, { mensagem: MSG_LOGIN_429, campo: null });
    });
    await t.caso('o 429 traz Retry-After e os headers de segurança do helmet', async () => {
      t.verdade(Number(bloq.headers.get('retry-after')) > 0);
      t.eq(bloq.headers.get('x-content-type-options'), 'nosniff');
    });
    await t.caso('bloqueado: até o login CORRETO recebe 429 (limite por IP)', async () => {
      L.erro(await login({ login: adm.login, senha }), 429, { mensagem: MSG_LOGIN_429 });
    });
    await t.caso('bloqueado: outro usuário no mesmo IP também recebe 429', async () => {
      L.erro(await login({ login: cx.login, senha }), 429);
    });
    await t.caso('o bloqueio do login não afeta as outras rotas (GET /health e /interno/me seguem 200)', async () => {
      t.sucesso(await t.http('GET', '/health'));
      t.sucesso(await me(adm.token));
    });
    await t.caso('o rate limit do login vale só para POST /interno/login (GET /categorias segue 200)', async () => {
      t.sucesso(await t.http('GET', '/categorias'));
    });

    // ---- LOGIN_RATE_LIMIT_MAX: leitura do valor (cada caso reinicia o servidor SÓ com a env do processo)
    await srv.parar(); // a porta é fixa: o servidor da fase cai antes de subir os das sub-fases
    // Conta quantas tentativas erradas passam antes do primeiro 429, para descobrir o limite efetivo.
    const bateu = async (qtdEsperada) => {
      let k = 0;
      for (;;) {
        const r = await login({ login: adm.login, senha: 'errada' });
        if (r.status === 429) return k;
        t.eq(r.status, 401);
        if (++k > 30) return k;
      }
    };
    // Leitura de LOGIN_RATE_LIMIT_MAX: só inteiro >= 1 em dígitos puros vale; qualquer outra coisa cai no padrão 5 (com aviso no log).
    // A variável é passada só para o processo filho; o .env e o código não são alterados.
    for (const [valor, esperado] of [['3', 3], ['abc', 5], ['0', 5], ['-2', 5], ['2.5', 5], ['1e3', 5], ['', 5], ['  7  ', 7]]) {
      await subFase(`LOGIN_RATE_LIMIT_MAX=${JSON.stringify(valor)}`, { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: valor }, async (srv) => {
        await t.caso(`LOGIN_RATE_LIMIT_MAX=${JSON.stringify(valor)} → limite efetivo ${esperado}${esperado === 5 && valor !== '' ? ' (inválido cai no padrão 5 e avisa no log)' : ''}`, async () => {
          t.eq(await bateu(), esperado);
          if (esperado === 5 && valor !== '' && valor !== undefined) t.verdade(srv.log.includes('LOGIN_RATE_LIMIT_MAX inválida'), srv.log);
        });
      });
    }
    await subFase('LOGIN_RATE_LIMIT_MAX ausente', { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: undefined }, async () => {
      await t.caso('LOGIN_RATE_LIMIT_MAX removida do ambiente (o .env não é lido por cima do ambiente do processo): padrão efetivo = valor do .env ou 5', async () => {
        // Com a variável indefinida no processo filho, o dotenv pode preencher a partir do .env; aceita o valor do .env ou o padrão 5.
        const n = await bateu();
        t.verdade(n >= 1, `limite efetivo ${n}`);
      });
    });
  });
  resultados.push(f1);

  // ================================================================ FASE 2: geral
  // Fase geral: 100 requisições por minuto por IP em todas as rotas, exceto POST /interno/login (que tem limitador próprio).
  const f2 = await fase('geral', { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: '' }, async () => {
    const origem = { origin: 'http://localhost:5174' };
    // O polling de /health que sobe o servidor já gasta requisições do limite: parte-se do "remaining" informado pelo servidor.
    let primeira;
    let restantes;
    await t.caso('a 1ª requisição mostra a política 100/60s nos headers RateLimit (RFC draft-7)', async () => {
      primeira = await t.http('GET', '/health');
      t.eq(primeira.status, 200);
      t.verdade((primeira.headers.get('ratelimit-policy') || '').startsWith('100;w=60'), primeira.headers.get('ratelimit-policy'));
      restantes = Number((/remaining=(\d+)/.exec(primeira.headers.get('ratelimit') || '') || [])[1]);
      t.verdade(Number.isInteger(restantes) && restantes >= 90 && restantes <= 99, `remaining=${restantes}`);
    });
    await t.caso('exatamente "remaining" requisições seguintes passam (o total da janela é 100) e o contador chega a 0', async () => {
      let r;
      for (let i = 0; i < restantes; i++) {
        r = await t.http('GET', '/health');
        t.eq(r.status, 200, `requisição ${i + 1} após a primeira`);
      }
      t.verdade(/remaining=0/.test(r.headers.get('ratelimit') || ''), r.headers.get('ratelimit'));
    });
    let r101;
    await t.caso('a requisição seguinte ao limite (a 101ª da janela) → 429 no formato { mensagem }', async () => {
      r101 = await bruto('GET', '/health', origem);
      L.erro(r101 && { status: r101.status, body: r101.body, texto: r101.texto }, 429, { mensagem: MSG_GERAL_429, campo: null });
    });
    await t.caso('o 429 geral traz Retry-After', async () => t.verdade(Number(r101.headers['retry-after']) > 0));
    await t.caso('o 429 geral também leva os headers de segurança (helmet)', async () => t.eq(r101.headers['x-content-type-options'], 'nosniff'));
    await t.caso('o 429 geral leva os headers CORS (o navegador do frontend consegue ler a mensagem)', async () => {
      t.eq(r101.headers['access-control-allow-origin'], 'http://localhost:5174');
    });
    await t.caso('depois do limite, QUALQUER rota comum recebe 429 (GET /categorias, GET /interno/me)', async () => {
      L.erro(await t.http('GET', '/categorias'), 429, { mensagem: MSG_GERAL_429 });
      L.erro(await t.http('GET', '/interno/me', { token: adm.token }), 429, { mensagem: MSG_GERAL_429 });
    });
    await t.caso('o POST /interno/login fica FORA do limite geral (usa só o limitador do login): 401, não 429 geral', async () => {
      L.erro(await login({ login: adm.login, senha: 'errada' }), 401, { mensagem: 'Login ou senha inválidos.' });
    });
    await t.caso('login correto continua funcionando com o limite geral estourado', async () => {
      t.sucesso(await login({ login: adm.login, senha }));
    });
    await t.caso('o limite geral continua valendo: rota comum segue 429 mesmo após o login', async () => {
      L.erro(await t.http('GET', '/health'), 429);
    });
    await t.caso('rota inexistente também conta/recebe 429 (o limite vem antes do roteamento)', async () => {
      L.erro(await t.http('GET', '/nao-existe'), 429, { mensagem: MSG_GERAL_429 });
    });
  });
  resultados.push(f2);

  // ================================================================ FASE 3: desativado
  // Fase desativado: com NODE_ENV=test os dois limitadores são pulados, para as suítes poderem fazer centenas de chamadas.
  const f3 = await fase('desativado', { NODE_ENV: 'test', LOGIN_RATE_LIMIT_MAX: '2', CORS_ALLOWED_ORIGINS: '' }, async () => {
    await t.caso('NODE_ENV=test: 250 requisições seguidas a /health → nenhuma 429', async () => {
      const lote = async () => L.paralelo(50, () => t.http('GET', '/health'));
      for (let i = 0; i < 5; i++) t.verdade((await lote()).every((r) => r.status === 200));
    });
    await t.caso('NODE_ENV=test: sem limite geral também em rotas protegidas (130 chamadas a /interno/me)', async () => {
      const rs = await L.paralelo(130, () => t.http('GET', '/interno/me', { token: adm.token }));
      t.verdade(rs.every((r) => r.status === 200));
    });
    await t.caso('NODE_ENV=test: 20 logins ERRADOS seguidos → todos 401 (limite 2 ignorado)', async () => {
      for (let i = 0; i < 20; i++) L.erro(await login({ login: adm.login, senha: 'errada' }), 401);
    });
    await t.caso('NODE_ENV=test: 20 logins errados em paralelo → nenhum 429', async () => {
      const rs = await L.paralelo(20, () => login({ login: adm.login, senha: 'errada' }));
      t.verdade(rs.every((r) => r.status === 401));
    });
    await t.caso('NODE_ENV=test: depois do "estouro" o login correto funciona', async () => {
      t.sucesso(await login({ login: adm.login, senha }));
    });
    await t.caso('NODE_ENV=test: as respostas não trazem headers RateLimit (limitador pulado)', async () => {
      const r = await t.http('GET', '/health');
      t.eq([r.headers.get('ratelimit'), r.headers.get('ratelimit-policy'), r.headers.get('retry-after')], [null, null, null]);
    });
    await t.caso('NODE_ENV=test: os demais controles de segurança continuam ligados (helmet e JWT)', async () => {
      const r = await t.http('GET', '/interno/me');
      t.eq([r.status, r.headers.get('x-content-type-options')], [401, 'nosniff']);
    });
  });
  resultados.push(f3);

  // ================================================================ FASE 4: origens (CORS)
  // Fase origens: CORS por lista (CORS_ALLOWED_ORIGINS). Itens vazios e a barra final são normalizados; origem fora da lista recebe 403.
  const f4 = await fase('origens', { NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: ' http://a.test:3001 ,http://b.test/,, ' }, async (srv) => {
    const get = (origin, extra = {}) => bruto('GET', '/health', origin === undefined ? extra : { origin, ...extra });
    await t.caso('origem da lista (a.test:3001) → 200 com Access-Control-Allow-Origin igual à origem', async () => {
      const r = await get('http://a.test:3001');
      t.eq([r.status, r.headers['access-control-allow-origin']], [200, 'http://a.test:3001']);
    });
    await t.caso('origem da lista com barra final no .env (b.test/) é normalizada: "http://b.test" é aceita', async () => {
      const r = await get('http://b.test');
      t.eq([r.status, r.headers['access-control-allow-origin']], [200, 'http://b.test']);
    });
    await t.caso('espaços e itens vazios da lista são ignorados (nenhuma origem vazia liberada)', async () => {
      const r = await get('');
      t.verdade(r.status === 403 || r.headers['access-control-allow-origin'] === undefined);
    });
    await t.caso('credenciais permitidas (Access-Control-Allow-Credentials: true) e Vary: Origin', async () => {
      const r = await get('http://a.test:3001');
      t.eq(r.headers['access-control-allow-credentials'], 'true');
      t.verdade((r.headers.vary || '').includes('Origin'));
    });
    await t.caso('origem FORA da lista → 403 { mensagem: "Origem não permitida." } sem header CORS', async () => {
      const r = await get('http://evil.test');
      L.erro({ status: r.status, body: r.body, texto: r.texto }, 403, { mensagem: 'Origem não permitida.' });
      t.eq(r.headers['access-control-allow-origin'], undefined);
    });
    for (const [rotulo, origem] of [
      ['mesma máquina, porta diferente', 'http://a.test:3002'], ['esquema diferente (https)', 'https://a.test:3001'],
      ['subdomínio', 'http://x.a.test:3001'], ['prefixo da origem', 'http://a.test:30011'], ['maiúsculas (comparação exata)', 'HTTP://A.TEST:3001'],
      ['com barra final (navegador nunca envia)', 'http://b.test/'], ['"null" (arquivo local/sandbox)', 'null'], ['localhost padrão (não está na lista)', 'http://localhost:5174'],
    ]) {
      await t.caso(`origem ${rotulo} → 403`, async () => {
        const r = await get(origem);
        t.eq(r.status, 403);
        t.eq(r.headers['access-control-allow-origin'], undefined);
      });
    }
    await t.caso('a recusa vale também para rotas protegidas e a rota nem executa (403 antes do 401)', async () => {
      const r = await bruto('GET', '/interno/me', { origin: 'http://evil.test' });
      t.eq(r.status, 403);
    });
    await t.caso('a recusa vale para escrita: POST de origem proibida → 403 e nada é criado', async () => {
      const antes = await t.prisma.categoria.count();
      const r = await new Promise((res, rej) => {
        const rq = http.request({ host: '127.0.0.1', port: L.PORTA, path: '/categorias', method: 'POST', headers: { origin: 'http://evil.test', 'content-type': 'application/json', authorization: `Bearer ${adm.token}` } }, (x) => {
          x.resume();
          x.on('end', () => res(x.statusCode));
        });
        rq.on('error', rej);
        rq.end(JSON.stringify({ nome: t.unico('cors') }));
      });
      t.eq(r, 403);
      t.eq(await t.prisma.categoria.count(), antes);
    });
    await t.caso('sem cabeçalho Origin (curl/Postman/servidor) → segue normal, sem header CORS', async () => {
      const r = await get(undefined);
      t.eq([r.status, r.headers['access-control-allow-origin']], [200, undefined]);
    });
    await t.caso('preflight OPTIONS de origem permitida → 204 com métodos e headers permitidos', async () => {
      const r = await bruto('OPTIONS', '/produtos', { origin: 'http://a.test:3001', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' });
      t.eq(r.status, 204);
      t.eq(r.headers['access-control-allow-origin'], 'http://a.test:3001');
      t.verdade(['POST', 'PATCH', 'DELETE', 'PUT'].every((m) => (r.headers['access-control-allow-methods'] || '').includes(m)));
      t.verdade(/authorization/i.test(r.headers['access-control-allow-headers'] || ''));
    });
    await t.caso('preflight de origem proibida → 403', async () => {
      const r = await bruto('OPTIONS', '/produtos', { origin: 'http://evil.test', 'access-control-request-method': 'POST' });
      t.eq(r.status, 403);
      t.eq(r.headers['access-control-allow-origin'], undefined);
    });
    await t.caso('preflight não exige token (OPTIONS em rota protegida de origem permitida não dá 401)', async () => {
      const r = await bruto('OPTIONS', '/interno/usuarios', { origin: 'http://b.test', 'access-control-request-method': 'POST' });
      t.eq(r.status, 204);
    });
    await t.caso('a resposta de erro (404) de origem permitida também leva o header CORS', async () => {
      const r = await bruto('GET', '/nao-existe', { origin: 'http://a.test:3001' });
      t.eq([r.status, r.headers['access-control-allow-origin']], [404, 'http://a.test:3001']);
    });
    await t.caso('a resposta de erro 401 de origem permitida leva o header CORS (o frontend lê a mensagem)', async () => {
      const r = await bruto('GET', '/interno/me', { origin: 'http://a.test:3001' });
      t.eq([r.status, r.headers['access-control-allow-origin']], [401, 'http://a.test:3001']);
    });
    await t.caso('uma lista com 2 origens libera AMBAS e só elas (a.test e b.test; c.test não)', async () => {
      t.eq((await get('http://a.test:3001')).status, 200);
      t.eq((await get('http://b.test')).status, 200);
      t.eq((await get('http://c.test')).status, 403);
    });

    // ---- variável ausente/vazia → padrão de desenvolvimento
    await srv.parar(); // a porta é fixa: derruba o servidor da fase antes das sub-fases
    // Variável vazia, em branco ou só com vírgulas cai no padrão de desenvolvimento (http://localhost:5174).
    for (const [rotulo, valor] of [['vazia', ''], ['só espaços', '   '], ['só vírgulas', ',, ,']]) {
      await subFase(`CORS ${rotulo}`, { NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: valor }, async () => {
        await t.caso(`CORS_ALLOWED_ORIGINS ${rotulo} → cai no padrão: libera só http://localhost:5174`, async () => {
          t.eq((await get('http://localhost:5174')).status, 200);
          t.eq((await get('http://localhost:5173')).status, 403);
          t.eq((await get('http://a.test:3001')).status, 403);
        });
      });
    }
  });
  resultados.push(f4);

  somarFases([], ...resultados);
  for (const f of resultados) console.log(`FASE ${f.nome}: ${f.ok} ok, ${f.falhas} falhas`);
});
