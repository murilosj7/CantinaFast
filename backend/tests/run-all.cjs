'use strict';
// Runner das suítes. Uso: npm test   (ou: npm test -- categoria usuario   para rodar só algumas)
//
// Segurança:
//  - lê DATABASE_URL (do .env ou do ambiente) e RECUSA rodar se o host não for localhost/127.0.0.1;
//  - nunca roda contra o banco de desenvolvimento: cria um banco descartável cantinafast_test_<timestamp>
//    no mesmo Postgres local, aplica as migrations, roda tudo nele e o apaga no final (finally e SIGINT);
//  - só passa o DATABASE_URL do banco descartável no ambiente dos processos filhos;
//  - compara as contagens do banco de dev (só SELECT count) antes e depois: se mudarem, falha.
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const lib = require('./_lib.cjs');

const BACKEND = lib.BACKEND;
// Ordem de execução. `servidor: false` = a suíte não usa o servidor compartilhado (seed roda scripts; segurança sobe o seu próprio).
const SUITES = [
  { nome: 'categoria', servidor: true },
  { nome: 'usuario', servidor: true },
  { nome: 'auth', servidor: true },
  { nome: 'cliente', servidor: true },
  { nome: 'produto', servidor: true },
  { nome: 'estoque', servidor: true },
  { nome: 'pedido', servidor: true },
  { nome: 'pagamento', servidor: true },
  { nome: 'saldos', servidor: true },
  { nome: 'movimentacao', servidor: true },
  { nome: 'permissoes', servidor: true },
  { nome: 'seed', servidor: false },
  { nome: 'seguranca', servidor: false }, // sobe o próprio servidor em cada fase
];
const TABELAS = ['usuario', 'cliente', 'categoria', 'produto', 'estoque', 'movimentacaoEstoque', 'pedido', 'itemPedido', 'pagamento'];

// Só o nome gerado por ESTE runner pode ser apagado (trava do DROP DATABASE).
let nomeBancoTeste = null; // só o nome gerado por este runner pode ser apagado
let adminPrisma = null;
let testePrisma = null;
let servidor = null;
let filho = null;
let encerrando = false;

function urlComBanco(urlBase, banco) {
  const u = new URL(urlBase);
  u.pathname = '/' + banco;
  return u.toString();
}

async function contagens(prisma) {
  const r = {};
  for (const t of TABELAS) r[t] = await prisma[t].count();
  return r;
}

// Limpeza que roda no finally e no SIGINT: derruba servidor e suíte em andamento e apaga o banco descartável.
async function limpezaFinal() {
  if (servidor) await servidor.parar().catch(() => {});
  servidor = null;
  if (filho) lib.matarArvore(filho);
  if (testePrisma) await testePrisma.$disconnect().catch(() => {});
  testePrisma = null;
  if (adminPrisma && nomeBancoTeste) {
    // Trava: só apaga o banco que ESTE runner acabou de gerar.
    if (!/^cantinafast_test_\d+$/.test(nomeBancoTeste)) throw new Error('nome de banco inesperado; abortando DROP');
    await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nomeBancoTeste}" WITH (FORCE)`).catch((e) => {
      console.error(`AVISO: não consegui apagar ${nomeBancoTeste}: ${e.message}`);
    });
    console.log(`Banco descartável ${nomeBancoTeste} removido.`);
    nomeBancoTeste = null;
  }
  if (adminPrisma) await adminPrisma.$disconnect().catch(() => {});
  adminPrisma = null;
}

process.on('SIGINT', async () => {
  if (encerrando) return;
  encerrando = true;
  console.log('\nSIGINT: encerrando e limpando...');
  await limpezaFinal();
  process.exit(130);
});

function rodarSuite(nome, env) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(__dirname, `teste-${nome}.cjs`)], { cwd: BACKEND, env, stdio: ['ignore', 'pipe', 'pipe'] });
    filho = proc;
    let saida = '';
    const eco = (d) => {
      saida += d;
      process.stdout.write(d);
    };
    proc.stdout.on('data', eco);
    proc.stderr.on('data', eco);
    proc.on('close', (codigo) => {
      filho = null;
      resolve({ codigo, saida });
    });
  });
}

// Lê a saída de uma suíte; sem a linha RESULTADO (suíte quebrou) conta como 1 falha.
function resumir(nome, { codigo, saida }) {
  const m = saida.match(/^RESULTADO: (\d+) ok, (\d+) falhas/m);
  const pega = (re) => Number((saida.match(re) || [0, 0])[1]);
  const r = {
    nome,
    ok: m ? Number(m[1]) : 0,
    falhas: m ? Number(m[2]) : 1, // sem linha final = a suíte quebrou
    diverge: pega(/^DIVERGE-PDF: (\d+)/m),
    lacunas: pega(/^LACUNAS-CONHECIDAS: (\d+)/m),
    bugs: pega(/^BUGS-CONHECIDOS: (\d+)/m),
    fases: [...saida.matchAll(/^FASE (\S+): (\d+) ok, (\d+) falhas/gm)].map((x) => ({ nome: x[1], ok: Number(x[2]), falhas: Number(x[3]) })),
    linhasFalha: saida.split('\n').filter((l) => l.startsWith('FALHA - ')),
  };
  if (!m || (codigo !== 0 && r.falhas === 0)) r.falhas = Math.max(r.falhas, 1);
  return r;
}

async function main() {
  const filtros = process.argv.slice(2);
  const escolhidas = filtros.length ? SUITES.filter((s) => filtros.includes(s.nome)) : SUITES;
  if (filtros.length && escolhidas.length !== filtros.length) {
    console.error(`Suíte desconhecida em: ${filtros.join(' ')}. Válidas: ${SUITES.map((s) => s.nome).join(', ')}`);
    return 2;
  }

  // 1) Trava de host (antes de qualquer coisa).
  const urlDev = process.env.DATABASE_URL;
  if (!urlDev) {
    console.error('DATABASE_URL não definida (.env). Nada foi feito.');
    return 2;
  }
  const { host, banco: bancoDev } = lib.hostEBanco(urlDev);
  if (!lib.HOSTS_LOCAIS.includes(host)) {
    console.error(`RECUSADO: o host do DATABASE_URL é '${host}'. Os testes só rodam em localhost/127.0.0.1 (nunca em banco remoto).`);
    return 2;
  }
  const { PrismaClient } = require('@prisma/client');
  const clienteEm = (url) => new PrismaClient({ datasources: { db: { url } } });

  adminPrisma = clienteEm(urlComBanco(urlDev, 'postgres'));
  const devPrisma = clienteEm(urlDev);

  // 2) Bancos de testes antigos (execuções interrompidas).
  const orfaos = await adminPrisma.$queryRaw`SELECT datname FROM pg_database WHERE datname LIKE 'cantinafast\_test\_%' ORDER BY datname`;
  if (orfaos.length) {
    console.log(`ATENÇÃO: sobraram ${orfaos.length} banco(s) de testes de execuções interrompidas: ${orfaos.map((o) => o.datname).join(', ')}`);
    console.log('         (não apago sozinho; use DROP DATABASE "<nome>" no psql se quiser removê-los.)');
  }

  // 3) Contagens do banco de dev antes.
  const antes = await contagens(devPrisma);

  // 4) Banco descartável + migrations.
  nomeBancoTeste = `cantinafast_test_${Date.now()}`;
  const urlTeste = urlComBanco(urlDev, nomeBancoTeste);
  await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${nomeBancoTeste}"`);
  console.log(`Banco descartável criado: ${nomeBancoTeste} (dev '${bancoDev}' não será tocado).`);

  const envFilho = { ...process.env, DATABASE_URL: urlTeste, CANTINAFAST_TESTES: '1', NODE_ENV: 'test' };
  const mig = spawnSync(process.execPath, [path.join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: BACKEND, env: envFilho, encoding: 'utf8',
  });
  if (mig.status !== 0) {
    console.error('Falha ao aplicar migrations no banco descartável:\n' + mig.stdout + mig.stderr);
    return 2;
  }
  console.log('Migrations aplicadas no banco descartável.');

  // 5) current_database() pelo mesmo caminho do servidor (PrismaClient lendo DATABASE_URL do ambiente).
  const chk = spawnSync(process.execPath, ['-e', `
    const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
    p.$queryRaw\`SELECT current_database() AS db\`.then(r => { console.log(r[0].db); return p.$disconnect(); });`],
    { cwd: BACKEND, env: envFilho, encoding: 'utf8' });
  const bancoVisto = (chk.stdout || '').trim();
  if (!bancoVisto.startsWith('cantinafast_test_') || bancoVisto !== nomeBancoTeste) {
    console.error(`ABORTADO: current_database() = '${bancoVisto}', esperado '${nomeBancoTeste}'.\n${chk.stderr}`);
    return 2;
  }
  console.log(`current_database() confirmado: ${bancoVisto}`);

  testePrisma = clienteEm(urlTeste);
  // Usuário-marcador (não administrador, senha aleatória): o login dele só funciona se o servidor apontar para o banco descartável.
  // Nasce ativo para essa conferência e é inativado logo depois (ver abaixo).
  const senhaMarcador = require('crypto').randomBytes(12).toString('hex');
  await testePrisma.usuario.create({ data: { nome: 'marcador', login: 'cantinafast_test_marker', senhaHash: require('bcrypt').hashSync(senhaMarcador, 4), perfil: 'ATENDENTE', ativo: true } });

  const resultados = [];
  let falhaGeral = false;

  // 6) Servidor compartilhado (as suítes sem servidor/seguranca rodam depois que ele cair).
  const precisaServidor = escolhidas.some((s) => s.servidor);
  if (precisaServidor) {
    servidor = await lib.subirServidor(envFilho);
    const h = await lib.http('GET', '/health');
    // /health não revela dados: o banco é conferido logando com o marcador (existe só no banco descartável).
    const lg = await lib.http('POST', '/interno/login', { body: { login: 'cantinafast_test_marker', senha: senhaMarcador } });
    if (h.status !== 200 || lg.status !== 200) {
      console.error(`ABORTADO: o servidor não está no banco descartável (/health: ${h.texto}; login do marcador: ${lg.status}).`);
      return 2;
    }
    console.log('Servidor no ar, apontando para o banco descartável (marcador conferido por login).\n');
  }

  // Marcador inativado: some do alcance de qualquer login e mantém o comportamento anterior das suítes.
  await testePrisma.usuario.updateMany({ where: { login: 'cantinafast_test_marker' }, data: { ativo: false } });

  for (const s of escolhidas) {
    if (!s.servidor && servidor) {
      await servidor.parar();
      servidor = null;
    }
    console.log(`\n===== teste-${s.nome} =====`);
    const r = resumir(s.nome, await rodarSuite(s.nome, envFilho));
    resultados.push(r);
    if (r.falhas > 0) falhaGeral = true;
  }
  if (servidor) {
    await servidor.parar();
    servidor = null;
  }

  // 7) Vazamento: nada além do marcador deve sobrar no banco descartável.
  const restos = await contagens(testePrisma);
  const vazou = Object.entries(restos).filter(([t, n]) => n !== (t === 'usuario' ? 1 : 0));
  if (vazou.length) {
    falhaGeral = true;
    console.log(`\nFALHA - dados de teste vazaram (alguma suíte não limpou): ${JSON.stringify(Object.fromEntries(vazou))}`);
  }

  // 8) Banco de dev intacto?
  const depois = await contagens(devPrisma);
  await devPrisma.$disconnect();
  const devIntacto = JSON.stringify(antes) === JSON.stringify(depois);
  if (!devIntacto) falhaGeral = true;

  // 9) Quadro final.
  const lin = '-'.repeat(78);
  console.log(`\n${lin}\nQUADRO FINAL\n${lin}`);
  console.log('suíte'.padEnd(21) + 'ok'.padStart(6) + 'falhas'.padStart(8) + 'DIVERGE-PDF'.padStart(13) + 'lacunas'.padStart(9) + 'bugs'.padStart(7));
  const soma = { ok: 0, falhas: 0, diverge: 0, lacunas: 0, bugs: 0 };
  for (const r of resultados) {
    console.log(`teste-${r.nome}`.padEnd(21) + String(r.ok).padStart(6) + String(r.falhas).padStart(8) + String(r.diverge).padStart(13) + String(r.lacunas).padStart(9) + String(r.bugs).padStart(7));
    for (const f of r.fases) console.log(`   fase ${f.nome}`.padEnd(21) + String(f.ok).padStart(6) + String(f.falhas).padStart(8));
    for (const k of Object.keys(soma)) soma[k] += r[k];
  }
  console.log(lin);
  console.log('TOTAL'.padEnd(21) + String(soma.ok).padStart(6) + String(soma.falhas).padStart(8) + String(soma.diverge).padStart(13) + String(soma.lacunas).padStart(9) + String(soma.bugs).padStart(7));
  console.log(lin);
  console.log(`Banco de dev '${bancoDev}' antes/depois: ${devIntacto ? 'IDÊNTICO' : 'MUDOU! ' + JSON.stringify({ antes, depois })}`);
  console.log(`Vazamento no banco descartável: ${vazou.length ? 'SIM' : 'nenhum'}`);
  const falhas = resultados.flatMap((r) => r.linhasFalha);
  if (falhas.length) console.log(`\nFalhas:\n${falhas.join('\n')}`);
  console.log(`\nRESULTADO GERAL: ${soma.ok} ok, ${soma.falhas} falhas, ${soma.diverge} [DIVERGE-PDF], ${soma.bugs} bug(s) conhecido(s)`);
  return falhaGeral ? 1 : 0;
}

main()
  .then(async (codigo) => {
    await limpezaFinal();
    process.exit(codigo);
  })
  .catch(async (e) => {
    console.error(e);
    await limpezaFinal();
    process.exit(2);
  });
