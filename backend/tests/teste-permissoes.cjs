'use strict';
// Permissões por perfil das rotas internas: teste guardião (toda rota registrada no Express tem regra) e matriz perfil x rota.
// Perfis: Administrador (A), Caixa (C), Atendente (T). A matriz abaixo é a FONTE DA VERDADE dos testes: src/config/permissoes.ts + as rotas têm de bater com ela.
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./_lib.cjs');
const t = L.suite('permissoes');

const BACKEND = path.resolve(__dirname, '..');
const A = 'ADMINISTRADOR';
const C = 'CAIXA';
const T = 'ATENDENTE';
const ID = 999999999; // id que não existe: a rota liberada responde 400/404 (nunca 401/403) e nada é alterado

// Rotas SEM autenticação interna, permitidas de propósito (cada uma com o motivo).
const PUBLICAS = {
  'GET /health': 'saúde do servidor (só { status })',
  'POST /interno/login': 'login interno',
  'POST /clientes/cadastro': 'cadastro do cliente do site',
  'POST /clientes/login': 'login do cliente do site',
  'GET /categorias': 'cardápio do site',
  'GET /produtos': 'cardápio do site',
  'GET /produtos/codigo-barras/:codigo': 'busca por código de barras (cardápio)',
  'GET /produtos/:id': 'cardápio do site',
};
// Rotas autenticadas SEM exigirPerfil, permitidas de propósito.
const SO_AUTENTICADAS = { 'GET /interno/me': 'dados do próprio usuário interno (qualquer perfil)' };
const DO_CLIENTE = { 'GET /clientes/me': 'dados do próprio cliente do site (autenticarCliente)' };

// Matriz perfil x rota das rotas internas protegidas: quais perfis passam (os demais recebem 403).
const MATRIZ = [
  { rota: 'POST /interno/usuarios', perfis: [A], caminho: '/interno/usuarios', body: {} },
  { rota: 'GET /interno/usuarios', perfis: [A], caminho: '/interno/usuarios' },
  { rota: 'GET /interno/usuarios/:id', perfis: [A], caminho: `/interno/usuarios/${ID}` },
  { rota: 'PATCH /interno/usuarios/:id', perfis: [A], caminho: `/interno/usuarios/${ID}`, body: {} },
  { rota: 'PATCH /interno/usuarios/:id/inativar', perfis: [A], caminho: `/interno/usuarios/${ID}/inativar` },
  { rota: 'GET /interno/clientes', perfis: [A], caminho: '/interno/clientes' },
  { rota: 'PATCH /interno/clientes/:id/ativo', perfis: [A], caminho: `/interno/clientes/${ID}/ativo`, body: { ativo: true } },
  { rota: 'POST /categorias', perfis: [A], caminho: '/categorias', body: {} },
  { rota: 'PATCH /categorias/:id', perfis: [A], caminho: `/categorias/${ID}`, body: {} },
  { rota: 'PATCH /categorias/:id/inativar', perfis: [A], caminho: `/categorias/${ID}/inativar` },
  { rota: 'POST /produtos', perfis: [A], caminho: '/produtos', body: {} },
  { rota: 'PATCH /produtos/:id', perfis: [A], caminho: `/produtos/${ID}`, body: {} },
  { rota: 'PATCH /produtos/:id/inativar', perfis: [A], caminho: `/produtos/${ID}/inativar` },
  { rota: 'PATCH /produtos/:id/estoque', perfis: [A, C, T], caminho: `/produtos/${ID}/estoque`, body: {} },
  { rota: 'GET /estoque', perfis: [A, C, T], caminho: '/estoque' },
  { rota: 'PATCH /estoque/:produtoId', perfis: [A, C, T], caminho: `/estoque/${ID}`, body: {} },
  { rota: 'PUT /estoque/:produtoId', perfis: [A, C, T], caminho: `/estoque/${ID}`, body: {} },
  { rota: 'GET /movimentacoes', perfis: [A, C, T], caminho: '/movimentacoes' },
  { rota: 'POST /movimentacoes', perfis: [A, C, T], caminho: '/movimentacoes', body: { tipo: 'PERDA' } },
  { rota: 'DELETE /movimentacoes/:id', perfis: [A], caminho: `/movimentacoes/${ID}` },
  { rota: 'POST /pedidos', perfis: [A, C, T], caminho: '/pedidos', body: {} },
  { rota: 'GET /pedidos', perfis: [A, C, T], caminho: '/pedidos' },
  { rota: 'GET /pedidos/:id', perfis: [A, C, T], caminho: `/pedidos/${ID}` },
  { rota: 'POST /pagamentos', perfis: [A, C], caminho: '/pagamentos', body: {} },
  { rota: 'GET /pagamentos/pedido/:pedidoId', perfis: [A, C], caminho: `/pagamentos/pedido/${ID}` },
];
const TODOS = [A, C, T];
const MSG_403 = 'Você não tem permissão para realizar esta ação.';

// Carrega o server.ts sem abrir a porta (tests/listar-rotas.cjs) e devolve as rotas registradas, sem duplicatas.
function rotasRegistradas() {
  const r = spawnSync(process.execPath, [path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'tests/listar-rotas.cjs'], {
    cwd: BACKEND, env: process.env, encoding: 'utf8', timeout: 60000,
  });
  const saida = r.stdout || '';
  const i = saida.indexOf('ROTAS_JSON:');
  if (i < 0) throw new Error(`não consegui listar as rotas: ${r.stderr || saida}`);
  const vistas = new Map();
  for (const x of JSON.parse(saida.slice(i + 'ROTAS_JSON:'.length))) vistas.set(`${x.metodo} ${x.caminho}`, x);
  return vistas;
}

L.executar(t, async () => {
  const usuarios = { [A]: await t.usuario(A), [C]: await t.usuario(C), [T]: await t.usuario(T) };
  const cliente = await t.cliente();

  // ---------------------------------------------------------------- guardião
  // Toda rota registrada no Express precisa estar na lista de públicas permitidas OU ter autenticar + exigirPerfil
  // (e bater com a matriz). Uma rota nova sem regra, ou um exigirPerfil removido, derruba este teste.
  let rotas;
  await t.caso('GUARDIÃO: consegue listar as rotas registradas no Express', async () => {
    rotas = rotasRegistradas();
    t.verdade(rotas.size >= MATRIZ.length + Object.keys(PUBLICAS).length, `poucas rotas: ${rotas.size}`);
  });
  if (rotas) {
    await t.caso('GUARDIÃO: nenhuma rota interna sem exigirPerfil fora da lista de públicas permitidas', async () => {
      const sem = [];
      for (const [chave, r] of rotas) {
        if (chave in PUBLICAS || chave in SO_AUTENTICADAS || chave in DO_CLIENTE) continue;
        if (!r.autenticar || !Array.isArray(r.perfis) || r.perfis.length === 0) sem.push(chave);
      }
      t.eq(sem, []);
    });
    await t.caso('GUARDIÃO: toda rota protegida registrada está na matriz, com os mesmos perfis', async () => {
      const esperado = new Map(MATRIZ.map((m) => [m.rota, [...m.perfis].sort()]));
      const desvios = [];
      for (const [chave, r] of rotas) {
        if (chave in PUBLICAS || chave in SO_AUTENTICADAS || chave in DO_CLIENTE) continue;
        const perfis = Array.isArray(r.perfis) ? [...r.perfis].sort() : null;
        const alvo = esperado.get(chave);
        if (!alvo) desvios.push(`${chave}: fora da matriz`);
        else if (JSON.stringify(alvo) !== JSON.stringify(perfis)) desvios.push(`${chave}: esperado ${alvo}, registrado ${perfis}`);
      }
      t.eq(desvios, []);
    });
    await t.caso('GUARDIÃO: as listas de permitidas e a matriz não têm rota que não existe mais', async () => {
      const inexistentes = [...Object.keys(PUBLICAS), ...Object.keys(SO_AUTENTICADAS), ...Object.keys(DO_CLIENTE), ...MATRIZ.map((m) => m.rota)].filter((k) => !rotas.has(k));
      t.eq(inexistentes, []);
    });
    await t.caso('GUARDIÃO: as rotas públicas permitidas realmente não exigem autenticação; /interno/me e /clientes/me só a do seu lado', async () => {
      for (const k of Object.keys(PUBLICAS)) t.eq([k, rotas.get(k).autenticar, rotas.get(k).autenticarCliente], [k, false, false]);
      t.eq([rotas.get('GET /interno/me').autenticar, rotas.get('GET /interno/me').perfis], [true, null]);
      t.eq(rotas.get('GET /clientes/me').autenticarCliente, true);
    });
  }

  // ---------------------------------------------------------------- matriz perfil x rota (HTTP)
  for (const m of MATRIZ) {
    const [metodo] = m.rota.split(' ');
    const chamar = (token) => t.http(metodo, m.caminho, { token, body: m.body });
    await t.caso(`${m.rota} sem token → 401; token inválido → 401`, async () => {
      L.erro(await chamar(undefined), 401);
      L.erro(await chamar('xxx.yyy.zzz'), 401);
    });
    for (const perfil of TODOS) {
      const liberado = m.perfis.includes(perfil);
      await t.caso(`${m.rota} ${perfil.toLowerCase()} → ${liberado ? 'liberado (não é 401/403)' : '403'}`, async () => {
        const r = await chamar(usuarios[perfil].token);
        if (liberado) t.verdade(r.status !== 401 && r.status !== 403, `status ${r.status} (${r.texto})`);
        else L.erro(r, 403, { campo: null, mensagem: MSG_403 });
      });
    }
    await t.caso(`${m.rota} token de CLIENTE → 403 (lado errado)`, async () => {
      L.erro(await chamar(cliente.token), 403, { mensagem: MSG_403 });
    });
  }

  // ---------------------------------------------------------------- o perfil vem do banco, não do token
  await t.caso('token com perfil ADMINISTRADOR forjado no payload de um atendente → 403 (vale o perfil do banco)', async () => {
    const forjado = t.assinar({ id: usuarios[T].id, perfil: A }, { jwt: { expiresIn: '1h' } });
    L.erro(await t.http('GET', '/interno/usuarios', { token: forjado }), 403, { mensagem: MSG_403 });
  });
  await t.caso('rebaixar um administrador vale na hora: o mesmo token passa a receber 403', async () => {
    const adm2 = await t.usuario(A);
    t.verdade((await t.http('GET', '/interno/usuarios', { token: adm2.token })).status === 200);
    await t.prisma.usuario.update({ where: { id: adm2.id }, data: { perfil: T } });
    L.erro(await t.http('GET', '/interno/usuarios', { token: adm2.token }), 403, { mensagem: MSG_403 });
  });
  await t.caso('promover um atendente a caixa vale na hora (passa a poder registrar pagamento: 400, não 403)', async () => {
    const u = await t.usuario(T);
    L.erro(await t.http('POST', '/pagamentos', { token: u.token, body: {} }), 403);
    await t.prisma.usuario.update({ where: { id: u.id }, data: { perfil: C } });
    t.eq((await t.http('POST', '/pagamentos', { token: u.token, body: {} })).status, 400);
  });
  await t.caso('usuário inativado: 401 de sessão inválida (e não 403), mesmo numa rota protegida por perfil', async () => {
    const u = await t.usuario(A);
    await t.prisma.usuario.update({ where: { id: u.id }, data: { ativo: false } });
    L.erro(await t.http('GET', '/interno/usuarios', { token: u.token }), 401, { contem: 'Sessão inválida' });
  });
  await t.caso('o 403 vem antes da validação do corpo e de qualquer consulta (atendente com corpo inválido em rota de administrador)', async () => {
    L.erro(await t.http('POST', '/produtos', { token: usuarios[T].token, rawBody: '{lixo' }), 400); // JSON malformado é do parser, antes das rotas
    L.erro(await t.http('POST', '/produtos', { token: usuarios[T].token, body: { nome: '' } }), 403);
  });
});
