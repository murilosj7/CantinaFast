'use strict';
// Segurança em 4 fases. CADA fase sobe o seu próprio servidor com variáveis de ambiente diferentes, só naquele
// processo filho (nada do .env nem do código é alterado):
//   básico     — headers (helmet), JWT inválido/ausente, rate limit do login (e leitura de LOGIN_RATE_LIMIT_MAX)
//   geral      — rate limit geral (100/min por IP)
//   desativado — NODE_ENV=test: sem rate limit
//   origens    — CORS_ALLOWED_ORIGINS com lista
//   clientes   — limites do cliente do site (login por IP + e-mail, cadastro por sucesso, geral fora do login/cadastro)
//   proxy      — TRUST_PROXY (número exato de proxies da hospedagem) e os tetos por alvo com IPs distintos
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
  // Para depurar ou rodar mutações mais rápido: SEGURANCA_FASES=clientes,proxy roda só essas fases (sem a variável, roda todas).
  // As sub-fases (ex.: "clientes-limite-3") seguem a fase-mãe (o nome antes do primeiro hífen).
  const fasesAtivas = process.env.SEGURANCA_FASES ? new Set(process.env.SEGURANCA_FASES.split(',').map((x) => x.trim())) : null;
  async function fase(nome, env, fn) {
    if (fasesAtivas && !fasesAtivas.has(nome.split('-')[0])) return { nome, ok: 0, falhas: 0 };
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
    // Limite do login interno: a chave é IP + login (nunca só o IP). Só tentativas FALHAS contam (skipSuccessfulRequests); a 6ª
    // falha do MESMO login no MESMO IP em 15 minutos recebe 429. Outros logins do mesmo IP seguem livres.
    // CENÁRIO DA CANTINA: o IP é compartilhado, então várias pessoas errando (cada uma o seu login) não podem travar ninguém.
    await t.caso('CANTINA: 60 falhas de logins DISTINTOS (1 cada) no mesmo IP não bloqueiam ninguém: o login correto do administrador → 200 em seguida', async () => {
      for (let i = 0; i < 60; i++) L.erro(await login({ login: t.unico('fantasma'), senha: 'errada' }), 401, { mensagem: 'Login ou senha inválidos.' });
      t.sucesso(await login({ login: adm.login, senha }));
    });
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
    await t.caso('bloqueado: até o login CORRETO do MESMO login recebe 429 (o par IP + login está esgotado)', async () => {
      L.erro(await login({ login: adm.login, senha }), 429, { mensagem: MSG_LOGIN_429 });
    });
    // Mudou em relação à regra antiga (só por IP): quem está bloqueado é só o par, não o IP inteiro.
    await t.caso('OUTRO login do mesmo IP NÃO é bloqueado: o login correto → 200 e o errado → 401 (não 429)', async () => {
      t.sucesso(await login({ login: cx.login, senha }));
      L.erro(await login({ login: cx.login, senha: 'errada' }), 401, { mensagem: 'Login ou senha inválidos.' });
    });
    await t.caso('o login é aparado e compartilha o contador (" login " também 429), mas o login interno DIFERENCIA maiúsculas (outro balde → 401)', async () => {
      L.erro(await login({ login: `  ${adm.login}  `, senha }), 429, { mensagem: MSG_LOGIN_429 });
      L.erro(await login({ login: adm.login.toUpperCase(), senha: 'errada' }), 401, { mensagem: 'Login ou senha inválidos.' });
    });
    // Corpo sem login em texto (ausente, número, objeto, nulo) usa o alvo fixo "sem-alvo": só afeta outras requisições malformadas.
    await t.caso('corpo sem login em texto → 400 (não derruba o servidor); a 6ª requisição malformada → 429, e o login legítimo segue livre', async () => {
      const ruins = [{ senha: 'x' }, { login: 7, senha: 'x' }, { login: { a: 1 }, senha: 'x' }, { login: null, senha: 'x' }, {}];
      for (const body of ruins) L.erro(await login(body), 400, { mensagem: 'Informe login e senha.' });
      L.erro(await login({ login: [1], senha: 'x' }), 429, { mensagem: MSG_LOGIN_429 });
      t.sucesso(await login({ login: cx.login, senha }));
      t.sucesso(await t.http('GET', '/health'));
    });
    await t.caso('o bloqueio do login não afeta as outras rotas (GET /health e /interno/me seguem 200)', async () => {
      t.sucesso(await t.http('GET', '/health'));
      t.sucesso(await me(adm.token));
    });
    await t.caso('o rate limit do login vale só para POST /interno/login (GET /categorias segue 200)', async () => {
      t.sucesso(await t.http('GET', '/categorias'));
    });

    // O express-rate-limit valida a configuração e registra "ERR_ERL_*" no log (chave sem ipKeyGenerator, contagem dupla, trust proxy...).
    await t.caso('o servidor não registrou nenhum erro de validação do express-rate-limit (ERR_ERL_*) com os limitadores em série', async () => {
      t.verdade(!srv.log.includes('ERR_ERL'), srv.log);
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
  // Fase geral: limite geral por IP em todas as rotas comuns, exceto os logins e o cadastro (que têm limitadores próprios).
  // É o ÚNICO limite só por IP, por isso o teto é altíssimo (só protege contra cliente descontrolado). O número NÃO é fixado
  // aqui: é lido da política informada pelo servidor (RateLimit-Policy) e o teste manda exatamente esse total.
  const f2 = await fase('geral', { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: '' }, async () => {
    const origem = { origin: 'http://localhost:5174' };
    // Manda `n` GETs a /health em lotes paralelos de 100 e confere que todos passam.
    const mandar = async (n) => {
      for (let falta = n; falta > 0; falta -= 100) {
        const rs = await L.paralelo(Math.min(100, falta), () => t.http('GET', '/health'));
        t.verdade(rs.every((r) => r.status === 200), `status: ${[...new Set(rs.map((r) => r.status))]}`);
      }
    };
    // O polling de /health que sobe o servidor já gasta requisições do limite: parte-se do "remaining" informado pelo servidor.
    let primeira;
    let restantes;
    let teto;
    await t.caso('a 1ª requisição mostra a política "<teto>;w=60" nos headers RateLimit (RFC draft-7) e o "remaining"', async () => {
      primeira = await t.http('GET', '/health');
      t.eq(primeira.status, 200);
      const politica = /^(\d+);w=60/.exec(primeira.headers.get('ratelimit-policy') || '');
      t.verdade(politica, `ratelimit-policy: ${primeira.headers.get('ratelimit-policy')}`);
      teto = Number(politica[1]);
      restantes = Number((/remaining=(\d+)/.exec(primeira.headers.get('ratelimit') || '') || [])[1]);
      t.verdade(Number.isInteger(restantes) && restantes >= 0 && restantes < teto, `remaining=${restantes} teto=${teto}`);
    });
    // Piso, não valor exato: numa rede compartilhada (escola inteira atrás de um IP) um teto baixo deixa uma pessoa travar todos.
    await t.caso('o teto geral é alto o bastante para uma rede compartilhada (pelo menos 1000 por minuto por IP)', async () => {
      t.verdade(teto >= 1000, `teto=${teto}`);
    });
    await t.caso('exatamente "remaining" requisições seguintes passam (o total da janela é o teto da política) e o contador chega a 0', async () => {
      await mandar(Math.max(0, restantes - 3));
      let r;
      for (let i = 0; i < Math.min(3, restantes); i++) {
        r = await t.http('GET', '/health');
        t.eq(r.status, 200);
      }
      if (r) t.verdade(/remaining=0/.test(r.headers.get('ratelimit') || ''), r.headers.get('ratelimit'));
    });
    let r101;
    await t.caso('a requisição seguinte ao total da janela → 429 no formato { mensagem }', async () => {
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
    await t.caso('com o geral esgotado, os logins e o cadastro ficam FORA dele: POST /interno/login e POST /clientes/login → 401 próprio; POST /clientes/cadastro → 201', async () => {
      L.erro(await login({ login: adm.login, senha: 'errada' }), 401, { mensagem: 'Login ou senha inválidos.' });
      L.erro(await t.http('POST', '/clientes/login', { body: { email: `${t.unico('x')}@teste.local`, senha: 'qualquer-1' } }), 401, { mensagem: 'E-mail ou senha inválidos.' });
      const r = await t.http('POST', '/clientes/cadastro', { body: { nome: 'Geral', email: `${t.unico('geral')}@teste.local`, senha: 'senha-de-teste-1' } });
      t.eq(r.status, 201, r.texto);
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
    // Com NODE_ENV=test o login do cliente e o cadastro também ficam sem limite (as suítes fazem centenas de chamadas).
    await t.caso('NODE_ENV=test: 20 logins ERRADOS do cliente seguidos → todos 401 (limite 2 ignorado)', async () => {
      const email = `${t.unico('off')}@teste.local`;
      await t.prisma.cliente.create({ data: { nome: 'Off', email, senhaHash: await bcrypt.hash('x'.repeat(8), 4) } });
      for (let i = 0; i < 20; i++) L.erro(await t.http('POST', '/clientes/login', { body: { email, senha: 'errada-1' } }), 401);
    });
    await t.caso('NODE_ENV=test: 25 cadastros de cliente seguidos → nenhum 429 (limite de 20/hora desligado)', async () => {
      for (let i = 0; i < 25; i++) {
        const r = await t.http('POST', '/clientes/cadastro', { body: { nome: 'Off', email: `${t.unico('offc')}@teste.local`, senha: 'senha-de-teste-1' } });
        t.eq(r.status, 201);
      }
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

  // ================================================================ FASE 5: clientes
  // Limites do cliente do site (NODE_ENV=development e LOGIN_RATE_LIMIT_MAX=5 só no processo filho). Princípio: nenhum bloqueio usa só o IP.
  //  - login: chave IP + e-mail (a 6ª falha do MESMO e-mail no MESMO IP → 429); outros e-mails do mesmo IP seguem livres;
  //  - cadastro: só cadastros bem-sucedidos contam, teto de 100 por hora por IP; erro de validação e e-mail repetido não gastam;
  //  - login e cadastro ficam fora do limite geral;
  //  - estourar um dos logins (interno ou cliente) não bloqueia o outro.
  const MSG_CADASTRO_429 = 'Muitos cadastros a partir deste endereço. Tente novamente mais tarde.';
  const senhaCli = crypto.randomBytes(9).toString('hex');
  // Cliente criado direto no banco (hash bcrypt de custo baixo), com o e-mail marcado pelo prefixo da suíte.
  const mkCliente = async () => {
    const email = `${t.unico('cli')}@teste.local`;
    const c = await t.prisma.cliente.create({ data: { nome: 'Cliente Seg', email, senhaHash: await bcrypt.hash(senhaCli, 4) } });
    return { id: c.id, email };
  };
  const loginCli = (email, s = senhaCli) => t.http('POST', '/clientes/login', { body: { email, senha: s } });
  const cadastroCli = (over = {}) => t.http('POST', '/clientes/cadastro', { body: { nome: 'Cliente Seg', email: `${t.unico('cad')}@teste.local`, senha: senhaCli, ...over } });
  // Lê o "remaining" do limite geral (a própria chamada a /health gasta 1).
  const restanteGeral = async () => Number((/remaining=(\d+)/.exec((await t.http('GET', '/health')).headers.get('ratelimit') || '') || [])[1]);
  const f5 = await fase('clientes', { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: '' }, async (srv) => {
    const cliA = await mkCliente();
    const cliB = await mkCliente();
    const cliC = await mkCliente();
    // ---- cadastro: só os SUCESSOS contam (teto de 100 por hora por IP)
    let geralAntes;
    await t.caso('cadastro: 30 requisições que FALHAM (20 inválidas + 10 com e-mail repetido) NÃO gastam o limite', async () => {
      geralAntes = await restanteGeral();
      const repetido = `${t.unico('dup')}@teste.local`;
      t.sucesso(await cadastroCli({ email: repetido }), 201); // o 1º sucesso (1 de 100)
      for (let i = 0; i < 20; i++) L.erro(await cadastroCli({ nome: '' }), 400, { campo: 'nome' });
      for (let i = 0; i < 10; i++) L.erro(await cadastroCli({ email: repetido }), 409, { campo: 'email' });
    });
    await t.caso('mais 99 cadastros VÁLIDOS → todos 201 (com o 1º são 100 sucessos, o teto da janela)', async () => {
      for (let lote = 0; lote < 9; lote++) {
        const rs = await t.paralelo(11, () => cadastroCli());
        t.verdade(rs.every((r) => r.status === 201), `status: ${rs.map((r) => r.status)}`);
      }
    });
    let r101;
    await t.caso('o 101º cadastro válido → 429 { mensagem } (30 falhas e 100 sucessos: só os sucessos contaram)', async () => {
      r101 = await cadastroCli();
      L.erro(r101, 429, { mensagem: MSG_CADASTRO_429, campo: null });
    });
    await t.caso('o 429 do cadastro traz Retry-After, a política 100/hora e os headers do helmet', async () => {
      t.verdade(Number(r101.headers.get('retry-after')) > 0);
      t.verdade((r101.headers.get('ratelimit-policy') || '').startsWith('100;w=3600'), r101.headers.get('ratelimit-policy'));
      t.eq(r101.headers.get('x-content-type-options'), 'nosniff');
    });
    // O cadastro fica fora do limite geral: as 131 requisições acima não podem ter gastado o contador geral.
    await t.caso('o limite GERAL não interfere no cadastro: as 131 requisições de cadastro não gastaram o contador geral', async () => {
      const depois = await restanteGeral();
      t.verdade(geralAntes - depois <= 3, `geral antes=${geralAntes} depois=${depois}`);
    });
    await t.caso('cadastro bloqueado: as próximas tentativas seguem em 429 e NENHUMA conta nova é criada; login e demais rotas seguem normais', async () => {
      const antes = await t.prisma.cliente.count({ where: { email: { startsWith: t.prefixo } } });
      L.erro(await cadastroCli(), 429, { mensagem: MSG_CADASTRO_429 });
      t.eq(await t.prisma.cliente.count({ where: { email: { startsWith: t.prefixo } } }), antes);
      t.sucesso(await loginCli(cliA.email));
      t.sucesso(await t.http('GET', '/categorias'));
    });
    // ---- limite GERAL esgotado: lê o teto da política, manda exatamente o total e a seguinte é 429
    await t.caso('o limite geral se esgota em rotas comuns: manda exatamente o total da política e a seguinte → 429 geral', async () => {
      const r0 = await t.http('GET', '/health');
      const restantes = Number((/remaining=(\d+)/.exec(r0.headers.get('ratelimit') || '') || [])[1]);
      t.verdade(Number.isInteger(restantes), r0.headers.get('ratelimit'));
      for (let falta = restantes; falta > 0; falta -= 100) {
        const rs = await t.paralelo(Math.min(100, falta), () => t.http('GET', '/health'));
        t.verdade(rs.every((r) => r.status === 200), `status: ${[...new Set(rs.map((r) => r.status))]}`);
      }
      L.erro(await t.http('GET', '/health'), 429, { mensagem: MSG_GERAL_429 });
    });
    await t.caso('com o geral esgotado: POST /clientes/login fica fora (200) e o cadastro devolve o 429 DO CADASTRO, não o do geral', async () => {
      t.sucesso(await loginCli(cliB.email));
      L.erro(await cadastroCli(), 429, { mensagem: MSG_CADASTRO_429 });
    });
    await t.caso('o limite geral continua valendo para as demais rotas do cliente (GET /clientes/me → 429 geral)', async () => {
      const tok = t.sucesso(await loginCli(cliB.email)).token;
      L.erro(await t.http('GET', '/clientes/me', { token: tok }), 429, { mensagem: MSG_GERAL_429 });
    });
    // ---- login do cliente: chave IP + e-mail
    // CENÁRIO DA ESCOLA: o IP é compartilhado; muitos alunos errando a senha (cada um a sua) não podem travar ninguém.
    await t.caso('ESCOLA: 60 falhas de e-mails DISTINTOS (1 cada) do mesmo IP não bloqueiam nada: o login correto de outro aluno → 200 em seguida', async () => {
      for (let i = 0; i < 60; i++) L.erro(await loginCli(`${t.unico('fantasma')}@teste.local`, 'errada-1'), 401, { mensagem: 'E-mail ou senha inválidos.' });
      t.sucesso(await loginCli(cliC.email));
    });
    await t.caso('login CORRETO do cliente não gasta o limite: 8 logins válidos seguidos → todos 200', async () => {
      for (let i = 0; i < 8; i++) t.sucesso(await loginCli(cliA.email));
    });
    let bloq;
    await t.caso('as 5 primeiras tentativas ERRADAS do mesmo e-mail → 401 (com a política 5 nos headers RateLimit)', async () => {
      let r;
      for (let i = 0; i < 5; i++) {
        r = await loginCli(cliA.email, `errada-${i}`);
        L.erro(r, 401, { mensagem: 'E-mail ou senha inválidos.' });
      }
      t.verdade((r.headers.get('ratelimit-policy') || '').startsWith('5;'), r.headers.get('ratelimit-policy'));
    });
    await t.caso('o 6º login errado do MESMO e-mail no mesmo IP → 429 { mensagem } com Retry-After', async () => {
      bloq = await loginCli(cliA.email, 'errada-5');
      L.erro(bloq, 429, { mensagem: MSG_LOGIN_429, campo: null });
      t.verdade(Number(bloq.headers.get('retry-after')) > 0);
    });
    await t.caso('bloqueado o par: até o login CORRETO desse e-mail recebe 429, inclusive com outra capitalização e espaços (mesmo contador)', async () => {
      L.erro(await loginCli(cliA.email), 429, { mensagem: MSG_LOGIN_429 });
      L.erro(await loginCli(`  ${cliA.email.toUpperCase()}  `), 429, { mensagem: MSG_LOGIN_429 });
    });
    // Mudou em relação à regra antiga (só por IP): outro e-mail do mesmo IP NÃO é afetado.
    await t.caso('e-mail DIFERENTE do mesmo IP não é afetado: login correto → 200 e errado → 401 (não 429)', async () => {
      t.sucesso(await loginCli(cliB.email));
      L.erro(await loginCli(cliB.email, 'errada-0'), 401, { mensagem: 'E-mail ou senha inválidos.' });
    });
    await t.caso('e-mail INEXISTENTE gasta o próprio contador igual ao existente (não revela se a conta existe): 5 erros → 401 e a 6ª → 429', async () => {
      const fantasma = `${t.unico('naoexiste')}@teste.local`;
      for (let i = 0; i < 5; i++) L.erro(await loginCli(fantasma, `errada-${i}`), 401, { mensagem: 'E-mail ou senha inválidos.' });
      L.erro(await loginCli(fantasma, 'errada-5'), 429, { mensagem: MSG_LOGIN_429 });
    });
    // Corpo sem e-mail em texto usa o alvo fixo "sem-alvo": só afeta outras requisições malformadas, nunca logins legítimos.
    await t.caso('corpo sem e-mail / e-mail numérico / objeto / nulo → 400 (não derruba o servidor); a 6ª malformada → 429; login legítimo segue livre', async () => {
      const ruins = [{ senha: 'x' }, { email: 7, senha: 'x' }, { email: { a: 1 }, senha: 'x' }, { email: null, senha: 'x' }, {}];
      for (const body of ruins) L.erro(await t.http('POST', '/clientes/login', { body }), 400, { mensagem: 'Informe e-mail e senha.' });
      L.erro(await t.http('POST', '/clientes/login', { body: { email: [1], senha: 'x' } }), 429, { mensagem: MSG_LOGIN_429 });
      t.sucesso(await loginCli(cliC.email));
      t.sucesso(await t.http('POST', '/interno/login', { body: { login: adm.login, senha } }));
    });
    await t.caso('estourar o login do CLIENTE não bloqueia o login INTERNO (contadores separados)', async () => {
      L.erro(await login({ login: adm.login, senha: 'errada' }), 401, { mensagem: 'Login ou senha inválidos.' });
      t.sucesso(await login({ login: adm.login, senha }));
    });
    await t.caso('o servidor não registrou erros de validação do express-rate-limit (ERR_ERL_*) com os limitadores do cliente em série', async () => {
      t.verdade(!srv.log.includes('ERR_ERL'), srv.log);
    });
  });
  // O contrário: estourar o login INTERNO não bloqueia o login do cliente. Servidor novo (contadores zerados).
  const f5b = await fase('clientes-inverso', { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: '' }, async () => {
    const cli = await mkCliente();
    await t.caso('estourar o limite do login INTERNO (6 erros → 429) não bloqueia o login do cliente (200) nem os erros dele (401)', async () => {
      for (let i = 0; i < 5; i++) L.erro(await login({ login: adm.login, senha: 'errada' }), 401);
      L.erro(await login({ login: adm.login, senha: 'errada' }), 429, { mensagem: MSG_LOGIN_429 });
      t.sucesso(await loginCli(cli.email));
      L.erro(await loginCli(cli.email, 'errada-0'), 401, { mensagem: 'E-mail ou senha inválidos.' });
    });
  });
  // As sub-fases abaixo reiniciam o servidor com outro LOGIN_RATE_LIMIT_MAX (valida a leitura do mesmo valor no limitador do cliente).
  const limites = [];
  for (const [valor, esperado] of [['3', 3], ['abc', 5]]) {
    limites.push(await fase(`clientes-limite-${valor}`, { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: valor, CORS_ALLOWED_ORIGINS: '' }, async () => {
      const cli = await mkCliente();
      await t.caso(`LOGIN_RATE_LIMIT_MAX=${JSON.stringify(valor)} vale também para o login do cliente: o 429 vem na tentativa errada nº ${esperado + 1}`, async () => {
        for (let i = 0; i < esperado; i++) L.erro(await loginCli(cli.email, `errada-${i}`), 401);
        L.erro(await loginCli(cli.email, 'errada-final'), 429, { mensagem: MSG_LOGIN_429 });
      });
    }));
  }
  // O quadro mostra tudo isto como uma única fase "clientes".
  const partes = [f5, f5b, ...limites];
  resultados.push({ nome: 'clientes', ok: partes.reduce((s, p) => s + p.ok, 0), falhas: partes.reduce((s, p) => s + p.falhas, 0) });

  // ================================================================ FASE 6: proxy (TRUST_PROXY)
  // TRUST_PROXY = número EXATO de proxies da hospedagem (inteiro de 1 a 10). Atrás de um proxy o IP real vem no X-Forwarded-For; sem
  // confiar nele todos teriam o IP do proxy e a chave IP + alvo dos limites não separaria ninguém. Valor inválido (true, 0, listas...)
  // NÃO confia em nada (avisa no log): forjar o X-Forwarded-For não pode ajudar a escapar dos limites.
  // Cada requisição deste teste manda o seu X-Forwarded-For (o teste faz o papel do proxy).
  const xff = (ip) => ({ 'x-forwarded-for': ip });
  const loginCliIp = (ip, email, s = 'errada-1') => t.http('POST', '/clientes/login', { body: { email, senha: s }, headers: xff(ip) });
  const loginIntIp = (ip, lg, s = 'errada-1') => t.http('POST', '/interno/login', { body: { login: lg, senha: s }, headers: xff(ip) });
  // Manda 6 logins errados do MESMO e-mail, cada um com um X-Forwarded-For diferente. Se o cabeçalho for ignorado (nenhuma confiança),
  // todos têm o mesmo IP e a 6ª é 429; se for honrado, são 6 IPs distintos e nenhuma é 429.
  const seisComIpsDistintos = async (email) => {
    const status = [];
    for (let i = 1; i <= 6; i++) status.push((await loginCliIp(`10.20.0.${i}`, email)).status);
    return status;
  };
  const f6 = await fase('proxy', { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: '', TRUST_PROXY: '1' }, async (srv) => {
    await t.caso('TRUST_PROXY=1 é válida: nenhum aviso no log', async () => {
      t.verdade(!srv.log.includes('TRUST_PROXY'), srv.log);
    });
    await t.caso('com TRUST_PROXY=1 o X-Forwarded-For é honrado: 6 falhas do mesmo e-mail de 6 IPs distintos → nenhuma é 429', async () => {
      const c = await mkCliente();
      t.eq(await seisComIpsDistintos(c.email), [401, 401, 401, 401, 401, 401]);
    });
    await t.caso('contadores por IP: o MESMO IP repetindo 6 falhas → a 6ª é 429, e outro IP com o mesmo e-mail continua livre', async () => {
      const c = await mkCliente();
      for (let i = 0; i < 5; i++) L.erro(await loginCliIp('10.30.0.1', c.email), 401);
      L.erro(await loginCliIp('10.30.0.1', c.email), 429, { mensagem: MSG_LOGIN_429 });
      L.erro(await loginCliIp('10.30.0.2', c.email), 401);
      t.sucesso(await loginCliIp('10.30.0.2', c.email, senhaCli));
    });
    // Com 1 proxy confiável, o IP do cliente é a ENTRADA MAIS À DIREITA (a que o proxy da hospedagem acrescentou). O que o cliente
    // escreve à esquerda pode ser forjado e não pode mudar o IP usado nos limites.
    await t.caso('entradas forjadas à esquerda do X-Forwarded-For não mudam o IP: "10.99.0.<n>, 203.0.113.9" ×6 → a 6ª é 429', async () => {
      const c = await mkCliente();
      const status = [];
      for (let i = 1; i <= 6; i++) status.push((await loginCliIp(`10.99.0.${i}, 203.0.113.9`, c.email)).status);
      t.eq(status, [401, 401, 401, 401, 401, 429]);
    });
    // UM IP SOZINHO NÃO PODE TRAVAR UM ALVO PARA OS OUTROS. O teto por alvo (100 falhas, todos os IPs) existe para o ataque
    // DISTRIBUÍDO (20 IPs ou mais, cada um limitado a 5 pelo par). Se o teto contasse também as requisições que o par já barrou
    // (429), um único IP com ~100 tentativas esgotaria o teto e bloquearia o alvo para todo mundo por até 15 minutos
    // (por exemplo, o login do administrador). Por isso o teto só pode contar o que o par deixou passar.
    await t.caso('UM IP SOZINHO (150 tentativas erradas no mesmo e-mail) não trava o alvo: outro IP entra (200) e outro e-mail do mesmo IP segue livre (401)', async () => {
      const alvo = await mkCliente();
      const outro = await mkCliente();
      let barradas = 0;
      for (let i = 0; i < 150; i++) {
        const r = await loginCliIp('10.70.0.1', alvo.email);
        if (r.status === 429) barradas++;
        else t.eq(r.status, 401);
      }
      t.eq(barradas, 145); // 5 passam pelo par, as 145 seguintes são barradas pelo par
      t.sucesso(await loginCliIp('10.70.0.2', alvo.email, senhaCli));
      L.erro(await loginCliIp('10.70.0.1', outro.email), 401, { mensagem: 'E-mail ou senha inválidos.' });
    });
    await t.caso('UM IP SOZINHO (150 tentativas erradas no mesmo login) não trava o login interno: outro IP entra (200) e outro login do mesmo IP segue livre (401)', async () => {
      const alvo = await mk('CAIXA');
      const outro = await mk('CAIXA');
      let barradas = 0;
      for (let i = 0; i < 150; i++) {
        const r = await loginIntIp('10.71.0.1', alvo.login);
        if (r.status === 429) barradas++;
        else t.eq(r.status, 401);
      }
      t.eq(barradas, 145);
      t.sucesso(await loginIntIp('10.71.0.2', alvo.login, senha));
      L.erro(await loginIntIp('10.71.0.1', outro.login), 401, { mensagem: 'Login ou senha inválidos.' });
    });
    // Teto por alvo (todos os IPs): 20 IPs × 5 falhas no MESMO e-mail somam 100. O IP seguinte, mesmo novo, recebe 429.
    await t.caso('TETO por e-mail: 20 IPs × 5 falhas no MESMO e-mail → o próximo IP NOVO recebe 429; um e-mail diferente segue livre', async () => {
      const alvo = await mkCliente();
      const outro = await mkCliente();
      for (let ip = 1; ip <= 20; ip++) {
        for (let k = 0; k < 5; k++) L.erro(await loginCliIp(`10.40.${ip}.1`, alvo.email), 401);
      }
      const rTeto = await loginCliIp('10.40.99.1', alvo.email);
      L.erro(rTeto, 429, { mensagem: MSG_LOGIN_429 });
      // O teto vem DEPOIS do par e sem cabeçalhos RateLimit-*: a política que o cliente vê continua a do par ("5;w=900"),
      // mas o Retry-After do teto é escrito à mão.
      t.verdade(Number(rTeto.headers.get('retry-after')) > 0, 'sem Retry-After no 429 do teto');
      t.verdade((rTeto.headers.get('ratelimit-policy') || '').startsWith('5;'), rTeto.headers.get('ratelimit-policy'));
      // Contrapartida aceita da defesa distribuída: até o login CORRETO desse e-mail, de um IP novo, fica bloqueado por até 15 min.
      L.erro(await loginCliIp('10.40.98.1', alvo.email, senhaCli), 429, { mensagem: MSG_LOGIN_429 });
      // Outro e-mail, mesmo IP novo: livre.
      L.erro(await loginCliIp('10.40.99.1', outro.email), 401);
      t.sucesso(await loginCliIp('10.40.99.1', outro.email, senhaCli));
    });
    await t.caso('TETO por login interno: 20 IPs × 5 falhas no MESMO login → o próximo IP novo recebe 429; outro login segue livre', async () => {
      for (let ip = 1; ip <= 20; ip++) {
        for (let k = 0; k < 5; k++) L.erro(await loginIntIp(`10.50.${ip}.1`, cx.login), 401);
      }
      L.erro(await loginIntIp('10.50.99.1', cx.login), 429, { mensagem: MSG_LOGIN_429 });
      L.erro(await loginIntIp('10.50.99.1', adm.login), 401);
      t.sucesso(await loginIntIp('10.50.99.1', adm.login, senha));
    });
    await t.caso('o teto do login do cliente e o do login interno são independentes (prefixos "cli-email:" e "int-login:")', async () => {
      const c = await mkCliente();
      t.sucesso(await loginCliIp('10.60.0.1', c.email, senhaCli));
      t.sucesso(await loginIntIp('10.60.0.1', adm.login, senha));
    });
    await t.caso('o servidor não registrou erros de validação do express-rate-limit (ERR_ERL_*) com TRUST_PROXY=1', async () => {
      t.verdade(!srv.log.includes('ERR_ERL'), srv.log);
    });

    // ---- as demais configurações reiniciam o servidor SÓ com a env do processo (a porta é fixa: o da fase cai antes)
    await srv.parar();
    // Ausente ou vazia: nada é confiado, SEM aviso (comportamento de desenvolvimento local). O X-Forwarded-For é ignorado.
    for (const [rotulo, valor] of [['ausente', undefined], ['vazia', ''], ['só espaços', '   ']]) {
      await subFase(`TRUST_PROXY ${rotulo}`, { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: '', TRUST_PROXY: valor }, async (s) => {
        await t.caso(`TRUST_PROXY ${rotulo}: sem aviso no log e o X-Forwarded-For é IGNORADO (6 falhas com IPs "diferentes" → a 6ª é 429)`, async () => {
          t.verdade(!s.log.includes('TRUST_PROXY'), s.log);
          const c = await mkCliente();
          t.eq(await seisComIpsDistintos(c.email), [401, 401, 401, 401, 401, 429]);
        });
      });
    }
    // Inválida: nunca aceita true nem listas; avisa no log e NÃO confia em nada (forjar o X-Forwarded-For não ajuda).
    for (const valor of ['true', 'false', '0', '-1', '1.5', '1e3', '11', '100', 'abc', '1,2', '1 2', 'loopback', '127.0.0.1', '0x2', '+1']) {
      await subFase(`TRUST_PROXY=${JSON.stringify(valor)}`, { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: '', TRUST_PROXY: valor }, async (s) => {
        await t.caso(`TRUST_PROXY=${JSON.stringify(valor)} é inválida: avisa no log, não confia em nada e o X-Forwarded-For é ignorado`, async () => {
          t.verdade(s.log.includes('TRUST_PROXY inválida'), s.log);
          const c = await mkCliente();
          t.eq(await seisComIpsDistintos(c.email), [401, 401, 401, 401, 401, 429]);
        });
      });
    }
    // Válida: inteiro de 1 a 10 em dígitos puros (aparado). Sem aviso; o cabeçalho passa a valer.
    for (const valor of ['1', ' 1 ', '10', '2']) {
      await subFase(`TRUST_PROXY=${JSON.stringify(valor)}`, { NODE_ENV: 'development', LOGIN_RATE_LIMIT_MAX: '5', CORS_ALLOWED_ORIGINS: '', TRUST_PROXY: valor }, async (s) => {
        await t.caso(`TRUST_PROXY=${JSON.stringify(valor)} é válida: sem aviso no log e o servidor sobe`, async () => {
          t.verdade(!s.log.includes('TRUST_PROXY'), s.log);
          t.sucesso(await t.http('GET', '/health'));
        });
        if (valor.trim() === '2') {
          // Com 2 proxies o IP do cliente é a 2ª entrada contando da direita: "<cliente>, <proxy 1>" (o proxy 2 é o que conectou).
          await t.caso('TRUST_PROXY=2: o IP é a 2ª entrada da direita — clientes diferentes atrás do mesmo proxy têm contadores separados', async () => {
            const c = await mkCliente();
            const status = [];
            for (let i = 1; i <= 6; i++) status.push((await loginCliIp(`198.51.100.${i}, 203.0.113.9`, c.email)).status);
            t.eq(status, [401, 401, 401, 401, 401, 401]);
            // E o mesmo cliente (entrada da esquerda igual) repetindo 6 falhas é bloqueado.
            const c2 = await mkCliente();
            const status2 = [];
            for (let i = 1; i <= 6; i++) status2.push((await loginCliIp('198.51.100.77, 203.0.113.9', c2.email)).status);
            t.eq(status2, [401, 401, 401, 401, 401, 429]);
          });
        }
      });
    }
  });
  resultados.push(f6);

  somarFases([], ...resultados);
  for (const f of resultados) console.log(`FASE ${f.nome}: ${f.ok} ok, ${f.falhas} falhas`);
});
