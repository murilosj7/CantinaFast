'use strict';
// Biblioteca compartilhada das suítes (não é uma suíte). Node puro, sem framework.
// As suítes só rodam contra um banco DESCARTÁVEL local (cantinafast_test_<timestamp>) criado pelo run-all.cjs.
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
// Carrega o .env só para ler segredos que a API usa (ex.: JWT_SECRET para forjar tokens); não sobrescreve o ambiente já definido.
require('dotenv').config({ path: path.join(BACKEND, '.env'), quiet: true });

const PORTA = 3000; // fixa em src/server.ts
const BASE = `http://127.0.0.1:${PORTA}`;
const HOSTS_LOCAIS = ['localhost', '127.0.0.1'];
const PADRAO_BANCO_TESTE = /^cantinafast_test_\d+$/;

// ---------------------------------------------------------------- trava de segurança
function hostEBanco(url) {
  const u = new URL(url);
  return { host: u.hostname, banco: decodeURIComponent(u.pathname.replace(/^\//, '')) };
}

// Recusa rodar contra qualquer coisa que não seja um banco de teste em localhost.
// Trava de cada suíte: só roda dentro do runner, com host local e banco cantinafast_test_<número>.
function exigirBancoDeTeste() {
  const url = process.env.DATABASE_URL;
  if (process.env.CANTINAFAST_TESTES !== '1' || !url) {
    console.error('RECUSADO: rode as suítes pelo runner (npm test); ele cria o banco descartável.');
    process.exit(2);
  }
  const { host, banco } = hostEBanco(url);
  if (!HOSTS_LOCAIS.includes(host) || !PADRAO_BANCO_TESTE.test(banco)) {
    console.error(`RECUSADO: o banco precisa ser local e cantinafast_test_<n> (host='${host}', banco='${banco}').`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- HTTP
async function http(metodo, caminho, { token, body, headers, rawBody, base } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.authorization = `Bearer ${token}`;
  let corpo;
  if (rawBody !== undefined) {
    corpo = rawBody;
    if (!h['content-type']) h['content-type'] = 'application/json';
  } else if (body !== undefined && metodo !== 'GET' && metodo !== 'HEAD') {
    corpo = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }
  const r = await fetch((base || BASE) + caminho, { method: metodo, headers: h, body: corpo, redirect: 'manual' });
  const texto = await r.text();
  let json;
  try {
    json = texto ? JSON.parse(texto) : undefined;
  } catch {
    json = undefined;
  }
  return { status: r.status, body: json, texto, headers: r.headers };
}

const paralelo = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- asserções
function eq(atual, esperado, msg) {
  assert.deepStrictEqual(atual, esperado, msg);
}
function verdade(cond, msg) {
  assert.ok(cond, msg || 'condição falsa');
}
// Confere uma resposta de erro no formato { mensagem, campo? }.
// Confere o formato de erro da API: { mensagem, campo? } e nenhuma outra chave.
function erro(res, status, { campo, mensagem, contem } = {}) {
  assert.strictEqual(res.status, status, `status esperado ${status}, veio ${res.status} (${res.texto})`);
  assert.ok(res.body && typeof res.body.mensagem === 'string' && res.body.mensagem !== '', `sem 'mensagem': ${res.texto}`);
  const chaves = Object.keys(res.body).filter((k) => k !== 'mensagem' && k !== 'campo');
  assert.deepStrictEqual(chaves, [], `chaves inesperadas no erro: ${chaves}`);
  if (campo === null) assert.ok(!('campo' in res.body), `não deveria ter campo, veio '${res.body.campo}'`);
  else if (campo !== undefined) assert.strictEqual(res.body.campo, campo, `campo esperado '${campo}', veio '${res.body.campo}'`);
  if (mensagem !== undefined) assert.strictEqual(res.body.mensagem, mensagem);
  if (contem !== undefined) assert.ok(res.body.mensagem.includes(contem), `mensagem '${res.body.mensagem}' sem '${contem}'`);
}
function sucesso(res, status = 200) {
  assert.strictEqual(res.status, status, `status esperado ${status}, veio ${res.status} (${res.texto})`);
  return res.body;
}

// ---------------------------------------------------------------- servidor
function matarArvore(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGKILL');
}

async function portaLivre() {
  try {
    await fetch(BASE + '/health', { signal: AbortSignal.timeout(1500) });
    return false; // alguém respondeu
  } catch (e) {
    // Conexão recusada = livre; timeout/reset = algo escuta lá.
    const causa = e && e.cause && e.cause.code;
    return causa === 'ECONNREFUSED';
  }
}

// Sobe src/server.ts (tsx) com o ambiente do processo + envExtra, SÓ para esse processo filho.
// Sobe src/server.ts (tsx) com o ambiente do processo mais `envExtra`, que vale só para esse processo filho.
async function subirServidor(envExtra = {}) {
  assert.ok(await portaLivre(), `a porta ${PORTA} já está em uso (o server.ts tem porta fixa); libere-a e rode de novo.`);
  const proc = spawn(process.execPath, [path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/server.ts'], {
    cwd: BACKEND,
    env: { ...process.env, ...envExtra },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const srv = { proc, get log() { return log; }, parar: () => pararServidor(srv) };
  const limite = Date.now() + 40000;
  while (Date.now() < limite) {
    if (proc.exitCode !== null) throw new Error(`servidor encerrou ao subir:\n${log}`);
    try {
      const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(1500) });
      if (r.status === 200) return srv;
    } catch {}
    await dormir(250);
  }
  matarArvore(proc);
  throw new Error(`servidor não respondeu em 40s:\n${log}`);
}

async function pararServidor(srv) {
  matarArvore(srv.proc);
  const limite = Date.now() + 10000;
  while (Date.now() < limite && !(await portaLivre())) await dormir(200);
}

// ---------------------------------------------------------------- suíte
function suite(nome) {
  exigirBancoDeTeste();
  const { PrismaClient } = require('@prisma/client');
  const bcrypt = require('bcrypt');
  const jwt = require('jsonwebtoken');
  const prisma = new PrismaClient();
  const prefixo = `tc_${nome}_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}_`;
  const placar = { ok: 0, falhas: 0, diverge: 0, lacunas: 0, bugs: 0 };
  let seq = 0;
  const unico = (p = '') => `${prefixo}${p}${++seq}`;

  async function rodar(rotulo, nomeCaso, fn, tipo) {
    try {
      await fn();
      placar.ok++;
      if (tipo) placar[tipo]++;
      console.log(`ok - ${rotulo}${nomeCaso}`);
    } catch (e) {
      if (tipo === 'bugs') {
        placar.bugs++;
        console.log(`BUG-REAL (conhecido) - ${nomeCaso}\n    ${String(e.message).split('\n')[0]}`);
        return;
      }
      placar.falhas++;
      console.log(`FALHA - ${rotulo}${nomeCaso}\n    ${String(e.message).split('\n').slice(0, 4).join('\n    ')}`);
    }
  }
  const t = {
    prisma,
    prefixo,
    unico,
    http,
    eq,
    verdade,
    erro,
    sucesso,
    paralelo,
    dormir,
    jwt,
    placar,
    // Caso normal.
    caso: (n, fn) => rodar('', n, fn),
    // Asserção do comportamento ATUAL que conflita com o PDF de modelagem (ver DIVERGENCIAS.md).
    diverge: (n, fn) => rodar('[DIVERGE-PDF] ', n, fn, 'diverge'),
    // Permissão por perfil: comportamento atual, lacuna conhecida.
    lacuna: (n, fn) => rodar('[comportamento atual (lacuna conhecida)] ', n, fn, 'lacunas'),
    // Bug real conhecido da API: afirma o comportamento CORRETO; se falhar, conta como bug (não como falha da suíte).
    bug: (n, fn) => rodar('[BUG-REAL] ', n, fn, 'bugs'),

    // Usuário criado pelo teste (senha aleatória, nunca do .env) + token obtido pelo login real.
    async usuario(perfil = 'ADMINISTRADOR', { ativo = true, nome } = {}) {
      const senha = crypto.randomBytes(9).toString('hex');
      const login = unico('u');
      const u = await prisma.usuario.create({
        data: { nome: nome || `Teste ${login}`, login, senhaHash: await bcrypt.hash(senha, 4), perfil, ativo },
      });
      let token;
      if (ativo) {
        const r = await http('POST', '/interno/login', { body: { login, senha } });
        token = sucesso(r).token;
      }
      return { id: u.id, login, senha, perfil, token };
    },
    async categoria({ nome, ativa = true } = {}) {
      return prisma.categoria.create({ data: { nome: nome || unico('cat'), ativa } });
    },
    // Produto direto no banco (sem passar pela API), com estoque; devolve o registro.
    async produto({ nome, preco = '10.00', qtd = 0, reservada = 0, minimo = 0, categoriaId, ativo = true, codigoBarras, online = true, presencial = true } = {}) {
      const cat = categoriaId || (await t.categoria()).id;
      return prisma.produto.create({
        data: {
          nome: nome || unico('prod'),
          precoVenda: String(preco),
          categoriaId: cat,
          ativo,
          codigoBarras,
          disponivelOnline: online,
          disponivelPresencial: presencial,
          estoque: { create: { quantidadeFisica: qtd, quantidadeReservada: reservada, estoqueMinimo: minimo } },
        },
      });
    },
    // Cliente do site criado direto no banco (senha aleatória, e-mail com o prefixo da suíte) + token obtido pelo login real.
    async cliente({ ativo = true, nome = 'Cliente do teste', telefone = null, comSenha = true } = {}) {
      const senha = crypto.randomBytes(9).toString('hex');
      const email = `${unico('c')}@teste.local`;
      const c = await prisma.cliente.create({
        data: { nome, email, telefone, ativo, senhaHash: comSenha ? await bcrypt.hash(senha, 4) : null },
      });
      let token;
      if (ativo && comSenha) {
        const r = await http('POST', '/clientes/login', { body: { email, senha } });
        token = sucesso(r).token;
      }
      return { id: c.id, email, senha, token };
    },
    saldo: (produtoId) => prisma.estoque.findUnique({ where: { produtoId } }),
    contarMov: (produtoId) => prisma.movimentacaoEstoque.count({ where: { produtoId } }),
    // Token forjado com o segredo real (para testar expiração etc.).
    // Por padrão acrescenta as claims do usuário interno (tipo "usuario", aud "interno"), como o login real emite.
    // O payload pode sobrescrever tipo/aud (ex.: token de cliente); `opcoes.semTipo` emite um token sem essas claims
    // (formato antigo) e `opcoes.jwt` repassa opções ao jwt.sign (expiresIn, notBefore...).
    assinar(payload, opcoes = {}) {
      const claims = opcoes.semTipo ? payload : { tipo: 'usuario', aud: 'interno', ...payload };
      return jwt.sign(claims, opcoes.secret || process.env.JWT_SECRET, { algorithm: 'HS256', ...opcoes.jwt });
    },

    // Remove só o que esta suíte criou (tudo com o prefixo único).
    async limpar() {
      const us = (await prisma.usuario.findMany({ where: { login: { startsWith: prefixo, mode: 'insensitive' } }, select: { id: true } })).map((x) => x.id);
      const ps = (await prisma.produto.findMany({ where: { nome: { startsWith: prefixo } }, select: { id: true } })).map((x) => x.id);
      const peds = (
        await prisma.pedido.findMany({
          where: { OR: [{ usuarioId: { in: us } }, { itens: { some: { produtoId: { in: ps } } } }] },
          select: { id: true },
        })
      ).map((x) => x.id);
      await prisma.pagamento.deleteMany({ where: { pedidoId: { in: peds } } });
      await prisma.itemPedido.deleteMany({ where: { OR: [{ pedidoId: { in: peds } }, { produtoId: { in: ps } }] } });
      await prisma.pedido.deleteMany({ where: { id: { in: peds } } });
      await prisma.movimentacaoEstoque.deleteMany({ where: { OR: [{ usuarioId: { in: us } }, { produtoId: { in: ps } }] } });
      await prisma.estoque.deleteMany({ where: { produtoId: { in: ps } } });
      await prisma.produto.deleteMany({ where: { id: { in: ps } } });
      await prisma.categoria.deleteMany({ where: { nome: { startsWith: prefixo } } });
      // Clientes criados pela suíte (e-mail começa com o prefixo); os pedidos que os referenciam já foram apagados acima.
      // Contas só com login Google (sem e-mail) são marcadas pelo prefixo no loginGoogle.
      await prisma.cliente.deleteMany({
        where: { OR: [{ email: { startsWith: prefixo, mode: 'insensitive' } }, { loginGoogle: { startsWith: prefixo } }] },
      });
      await prisma.usuario.deleteMany({ where: { id: { in: us } } });
    },

    // Constraint temporária para forçar falha no meio de uma $transaction; sempre removida no finally.
    async comConstraint(tabela, nomeConstraint, expressao, fn) {
      const nomeC = `${nomeConstraint}_${Date.now().toString(36)}`;
      await prisma.$executeRawUnsafe(`ALTER TABLE "${tabela}" ADD CONSTRAINT "${nomeC}" CHECK (${expressao})`);
      try {
        return await fn();
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${tabela}" DROP CONSTRAINT IF EXISTS "${nomeC}"`);
      }
    },

    async fim() {
      try {
        await t.limpar();
      } catch (e) {
        placar.falhas++;
        console.log(`FALHA - limpeza final: ${e.message}`);
      }
      await prisma.$disconnect();
      console.log(`DIVERGE-PDF: ${placar.diverge}`);
      console.log(`LACUNAS-CONHECIDAS: ${placar.lacunas}`);
      console.log(`BUGS-CONHECIDOS: ${placar.bugs}`);
      console.log(`RESULTADO: ${placar.ok} ok, ${placar.falhas} falhas`);
      process.exitCode = placar.falhas > 0 ? 1 : 0;
    },
  };
  return t;
}

// Executa a função principal da suíte garantindo a limpeza e um código de saída coerente.
async function executar(t, principal) {
  try {
    await principal();
  } catch (e) {
    t.placar.falhas++;
    console.log(`FALHA - erro fatal da suíte: ${e && e.stack ? e.stack : e}`);
  } finally {
    await t.fim();
  }
}

module.exports = {
  BACKEND, BASE, PORTA, HOSTS_LOCAIS, PADRAO_BANCO_TESTE, hostEBanco, exigirBancoDeTeste,
  http, paralelo, dormir, eq, verdade, erro, sucesso,
  subirServidor, pararServidor, matarArvore, portaLivre, suite, executar,
};
