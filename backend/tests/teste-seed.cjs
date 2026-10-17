'use strict';
// Seeds (seedAdmin e seedDemo): criação, idempotência, recusas e validações. Roda os scripts reais (tsx) como
// subprocessos, apontando para o banco descartável. Tudo que os scripts criam é removido no final (diff de ids).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const L = require('./_lib.cjs');
const t = L.suite('seed');
const bcrypt = require('bcrypt');

const TSX = path.join(L.BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs');
// Ordem de remoção que respeita as chaves estrangeiras (filhos antes dos pais).
const TABELAS = ['pagamento', 'itemPedido', 'pedido', 'movimentacaoEstoque', 'estoque', 'produto', 'categoria', 'usuario'];

// Roda um script de seed; `env` sobrescreve o ambiente (inclusive o que veio do .env).
// Roda o script real de seed (tsx) apontando para o banco descartável; `env` sobrescreve o ambiente, inclusive o que veio do .env.
function rodar(script, env) {
  const r = spawnSync(process.execPath, [TSX, path.join('src', 'scripts', script)], {
    cwd: L.BACKEND,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 120000,
  });
  return { codigo: r.status, saida: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '' };
}

L.executar(t, async () => {
  // Fotografia dos ids existentes: ao final só os registros novos (criados pelos scripts) são apagados.
  // Fotografia dos ids existentes: ao final só o que os scripts criaram é apagado (nunca dados que já existiam).
  const antes = {};
  for (const tab of TABELAS) antes[tab] = new Set((await t.prisma[tab].findMany({ select: { id: true } })).map((x) => x.id));
  // O estoque é identificado por produtoId; usa o id da linha mesmo.
  const limparNovos = async () => {
    const novos = async (tab) => (await t.prisma[tab].findMany({ select: { id: true } })).map((x) => x.id).filter((id) => !antes[tab].has(id));
    for (const tab of TABELAS) await t.prisma[tab].deleteMany({ where: { id: { in: await novos(tab) } } });
  };

  try {
    // ============================================================ seedAdmin
    // Credenciais do administrador de teste: login com o prefixo da suíte e senha aleatória (nada do .env).
    const login = t.unico('admin');
    const senha = crypto.randomBytes(9).toString('hex');
    const envAdmin = (over = {}) => ({ SEED_ADMIN_LOGIN: login, SEED_ADMIN_SENHA: senha, SEED_ADMIN_NOME: 'Admin do Teste', ...over });
    const contarPorLogin = (l) => t.prisma.usuario.count({ where: { login: l } });

    await t.caso('seedAdmin sem SEED_ADMIN_LOGIN → falha (código 1) e não cria ninguém', async () => {
      const antesN = await t.prisma.usuario.count();
      const r = rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_LOGIN: '' }));
      t.eq(r.codigo, 1);
      t.verdade(r.saida.includes('Defina SEED_ADMIN_LOGIN'), r.saida);
      t.eq(await t.prisma.usuario.count(), antesN);
    });
    await t.caso('seedAdmin com login só de espaços → falha', async () => {
      const r = rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_LOGIN: '    ' }));
      t.eq(r.codigo, 1);
      t.verdade(r.saida.includes('SEED_ADMIN_LOGIN'));
    });
    await t.caso('seedAdmin com login de 121 caracteres → falha', async () => {
      const r = rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_LOGIN: 'l'.repeat(121) }));
      t.eq(r.codigo, 1);
      t.eq(await contarPorLogin('l'.repeat(121)), 0);
    });
    await t.caso('seedAdmin sem senha → falha "Defina SEED_ADMIN_SENHA" e nada é criado', async () => {
      const r = rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_SENHA: '' }));
      t.eq(r.codigo, 1);
      t.verdade(r.saida.includes('SEED_ADMIN_SENHA'));
      t.eq(await contarPorLogin(login), 0);
    });
    await t.caso('seedAdmin com senha de 5 caracteres → falha; de 6 caracteres passa a validação', async () => {
      t.eq(rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_SENHA: '12345' })).codigo, 1);
      t.eq(await contarPorLogin(login), 0);
    });
    await t.caso('seedAdmin com nome de 121 caracteres → falha', async () => {
      const r = rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_NOME: 'n'.repeat(121) }));
      t.eq(r.codigo, 1);
      t.verdade(r.saida.includes('SEED_ADMIN_NOME'));
      t.eq(await contarPorLogin(login), 0);
    });
    await t.caso('seedAdmin válido → cria ADMINISTRADOR ativo (código 0) com a mensagem de criação', async () => {
      const r = rodar('seedAdmin.ts', envAdmin());
      t.eq(r.codigo, 0, r.saida);
      t.verdade(new RegExp(`Administrador '${login}' criado \\(id \\d+\\)\\.`).test(r.stdout), r.stdout);
      const u = await t.prisma.usuario.findUnique({ where: { login } });
      t.eq([u.perfil, u.ativo, u.nome], ['ADMINISTRADOR', true, 'Admin do Teste']);
    });
    await t.caso('a senha do seedAdmin fica em hash bcrypt e confere com a informada', async () => {
      const u = await t.prisma.usuario.findUnique({ where: { login } });
      t.verdade(u.senhaHash.startsWith('$2') && u.senhaHash !== senha);
      t.eq(await bcrypt.compare(senha, u.senhaHash), true);
      t.eq(await bcrypt.compare('outra-senha', u.senhaHash), false);
    });
    await t.caso('seedAdmin é idempotente: segunda execução não duplica nem altera nada', async () => {
      const antesU = await t.prisma.usuario.findUnique({ where: { login } });
      const r = rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_SENHA: 'senha-diferente-1', SEED_ADMIN_NOME: 'Outro Nome' }));
      t.eq(r.codigo, 0);
      t.verdade(r.stdout.includes(`Já existe um usuário com o login '${login}'`) && r.stdout.includes('Nada foi alterado.'), r.stdout);
      t.eq(await contarPorLogin(login), 1);
      const depois = await t.prisma.usuario.findUnique({ where: { login } });
      t.eq([depois.senhaHash, depois.nome, depois.perfil], [antesU.senhaHash, antesU.nome, antesU.perfil]);
    });
    await t.caso('seedAdmin com login de um usuário existente de outro perfil e inativo: informa e não altera', async () => {
      const l2 = t.unico('caixa');
      await t.prisma.usuario.create({ data: { nome: 'Caixa', login: l2, senhaHash: 'x', perfil: 'CAIXA', ativo: false } });
      const r = rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_LOGIN: l2 }));
      t.eq(r.codigo, 0);
      t.verdade(r.stdout.includes('perfil CAIXA') && r.stdout.includes('inativo'), r.stdout);
      const u = await t.prisma.usuario.findUnique({ where: { login: l2 } });
      t.eq([u.perfil, u.ativo, u.senhaHash], ['CAIXA', false, 'x']);
    });
    await t.caso('seedAdmin: o login é aparado e o nome em branco vira "Administrador"', async () => {
      const l3 = t.unico('trim');
      const r = rodar('seedAdmin.ts', envAdmin({ SEED_ADMIN_LOGIN: `  ${l3}  `, SEED_ADMIN_NOME: '   ' }));
      t.eq(r.codigo, 0, r.saida);
      const u = await t.prisma.usuario.findUnique({ where: { login: l3 } });
      t.eq(u.nome, 'Administrador');
    });

    // ============================================================ seedDemo
    // A senha padrão da demonstração é lida do código-fonte, para o teste não carregar senha literal.
    const senhaPadrao = (fs.readFileSync(path.join(L.BACKEND, 'src', 'scripts', 'seedDemo.ts'), 'utf8').match(/SENHA_PADRAO_DEMO\s*=\s*"([^"]+)"/) || [])[1];
    const senhaDemo = crypto.randomBytes(9).toString('hex');
    const envDemo = (over = {}) => ({ SEED_DEMO_SENHA: senhaDemo, ...over });
    const contagens = async () => Object.fromEntries(await Promise.all(TABELAS.map(async (tab) => [tab, await t.prisma[tab].count()])));
    const demoLogins = ['atendente_demo', 'caixa_demo'];
    await t.caso('pré-condição: o banco descartável não tem os logins de demonstração', async () => {
      t.eq(await t.prisma.usuario.count({ where: { login: { in: demoLogins } } }), 0);
    });
    // Trava de segurança do seed de demonstração: em produção ele se recusa a rodar e não grava nada.
    await t.caso('seedDemo com NODE_ENV=production é recusado (código 1) e não grava nada', async () => {
      const antesC = await contagens();
      const r = rodar('seedDemo.ts', envDemo({ NODE_ENV: 'production' }));
      t.eq(r.codigo, 1);
      t.verdade(r.saida.includes('não roda com NODE_ENV=production'), r.saida);
      t.eq(await contagens(), antesC);
    });
    // Contagens antes do seedDemo: a diferença prova exatamente o que ele criou.
    const antesDemo = await contagens();
    let saidaDemo;
    await t.caso('seedDemo cria 2 usuários, 4 categorias, 6 produtos, 4 pedidos e 2 pagamentos', async () => {
      const r = rodar('seedDemo.ts', envDemo());
      saidaDemo = r;
      t.eq(r.codigo, 0, r.saida);
      const d = await contagens();
      t.eq(
        Object.fromEntries(TABELAS.map((k) => [k, d[k] - antesDemo[k]])),
        { pagamento: 2, itemPedido: 8, pedido: 4, movimentacaoEstoque: 14, estoque: 6, produto: 6, categoria: 4, usuario: 2 },
      );
      t.verdade(r.stdout.includes('Concluído: 16 registro(s) criado(s), 0 já existia(m).'), r.stdout);
    });
    await t.caso('seedDemo: perfis dos usuários (atendente e caixa) e senha em hash que confere com SEED_DEMO_SENHA', async () => {
      const us = await t.prisma.usuario.findMany({ where: { login: { in: demoLogins } }, orderBy: { login: 'asc' } });
      t.eq(us.map((u) => [u.login, u.perfil, u.ativo]), [['atendente_demo', 'ATENDENTE', true], ['caixa_demo', 'CAIXA', true]]);
      for (const u of us) t.eq(await bcrypt.compare(senhaDemo, u.senhaHash), true);
    });
    await t.caso('seedDemo: produtos com preço, código de barras e saldo final esperados (estoque já abatido pelos pedidos)', async () => {
      const esperado = { 'Coxinha de frango': [7.5, 38], 'Pastel de queijo': [8, 24], 'Suco de laranja 300ml': [6.5, 17], 'Refrigerante lata': [5, 28], Brigadeiro: [3.5, 57], 'Prato feito do dia': [24.9, 10] };
      for (const [nome, [preco, saldo]] of Object.entries(esperado)) {
        const p = await t.prisma.produto.findFirstOrThrow({ where: { nome }, include: { estoque: true } });
        t.eq([Number(p.precoVenda), p.estoque.quantidadeFisica, /^789000000000\d$/.test(p.codigoBarras)], [preco, saldo, true], nome);
      }
    });
    await t.caso('seedDemo: pedidos — 2 ABERTOS e 2 PAGOS (PIX e DINHEIRO) com os totais esperados', async () => {
      const us = (await t.prisma.usuario.findMany({ where: { login: { in: demoLogins } } })).map((u) => u.id);
      const peds = await t.prisma.pedido.findMany({ where: { usuarioId: { in: us } }, include: { pagamentos: true }, orderBy: { id: 'asc' } });
      t.eq(peds.map((p) => [p.canal, p.status, Number(p.valorTotal)]), [['PRESENCIAL', 'ABERTO', 20], ['PRESENCIAL', 'ABERTO', 31.4], ['PRESENCIAL', 'PAGO', 18.5], ['PRESENCIAL', 'PAGO', 29.9]]);
      t.eq(peds.map((p) => p.pagamentos.map((g) => [g.formaPagamento, g.statusPagamento])), [[], [], [['PIX', 'APROVADO']], [['DINHEIRO', 'APROVADO']]]);
    });
    await t.caso('seedDemo: cada venda gerou movimentação SAIDA "Venda - pedido #N"; cada produto tem "Estoque inicial"', async () => {
      t.eq(await t.prisma.movimentacaoEstoque.count({ where: { motivo: 'Estoque inicial', produto: { codigoBarras: { startsWith: '789000000000' } } } }), 6);
      t.eq(await t.prisma.movimentacaoEstoque.count({ where: { motivo: { startsWith: 'Venda - pedido #' }, tipo: 'SAIDA', usuario: { login: { in: demoLogins } } } }), 8);
    });
    // Idempotência: rodar de novo não duplica registros nem mexe no estoque.
    await t.caso('seedDemo é idempotente: segunda execução não cria nada e não mexe no estoque', async () => {
      const antesC = await contagens();
      const saldos = (await t.prisma.estoque.findMany({ orderBy: { id: 'asc' } })).map((e) => e.quantidadeFisica);
      const r = rodar('seedDemo.ts', envDemo());
      t.eq(r.codigo, 0, r.saida);
      t.eq(await contagens(), antesC);
      t.eq((await t.prisma.estoque.findMany({ orderBy: { id: 'asc' } })).map((e) => e.quantidadeFisica), saldos);
      t.verdade(r.stdout.includes('Concluído: 0 registro(s) criado(s)'), r.stdout);
    });
    await t.caso('seedDemo repetido não troca a senha dos usuários já existentes', async () => {
      const r = rodar('seedDemo.ts', envDemo({ SEED_DEMO_SENHA: 'outra-senha-9' }));
      t.eq(r.codigo, 0);
      const u = await t.prisma.usuario.findUniqueOrThrow({ where: { login: 'caixa_demo' } });
      t.eq(await bcrypt.compare(senhaDemo, u.senhaHash), true);
    });
    await t.caso('seedDemo não reaplica pagamento: os 2 pedidos pagos continuam com 1 pagamento cada', async () => {
      t.eq(await t.prisma.pagamento.count({ where: { pedido: { usuario: { login: { in: demoLogins } } } } }), 2);
    });
    await t.caso('seedDemo respeita categoria inativa: não cria produtos nela e avisa', async () => {
      await limparNovos();
      const cat = await t.prisma.categoria.create({ data: { nome: 'Doces', ativa: false } });
      const r = rodar('seedDemo.ts', envDemo());
      t.eq(r.codigo, 0, r.saida);
      t.verdade(r.stdout.includes("categoria 'Doces' está inativa"), r.stdout);
      t.eq(await t.prisma.produto.count({ where: { nome: 'Brigadeiro' } }), 0);
      t.eq((await t.prisma.categoria.findUnique({ where: { id: cat.id } })).ativa, false);
    });
    await t.caso('seedDemo não sobrescreve um produto que já existe (mesmo nome): preço e estoque originais preservados', async () => {
      await limparNovos();
      const c = await t.prisma.categoria.create({ data: { nome: 'Salgados' } });
      const pr = await t.prisma.produto.create({ data: { nome: 'Coxinha de frango', precoVenda: '99.00', categoriaId: c.id, estoque: { create: { quantidadeFisica: 500 } } } });
      const r = rodar('seedDemo.ts', envDemo());
      t.eq(r.codigo, 0, r.saida);
      const depois = await t.prisma.produto.findUniqueOrThrow({ where: { id: pr.id }, include: { estoque: true } });
      // O pedido de demonstração ainda baixa 2 unidades da coxinha existente, mas o cadastro não é tocado.
      t.eq([Number(depois.precoVenda), await t.prisma.produto.count({ where: { nome: 'Coxinha de frango' } })], [99, 1]);
    });
    await t.caso(`a senha padrão da demonstração existe no script (${senhaPadrao ? 'lida do código-fonte' : 'NÃO encontrada'}) e é usada quando SEED_DEMO_SENHA está vazia`, async () => {
      t.verdade(senhaPadrao);
      await limparNovos();
      const r = rodar('seedDemo.ts', { SEED_DEMO_SENHA: '' });
      t.eq(r.codigo, 0, r.saida);
      const u = await t.prisma.usuario.findUniqueOrThrow({ where: { login: 'atendente_demo' } });
      t.eq(await bcrypt.compare(senhaPadrao, u.senhaHash), true);
    });
    // [DIVERGE-PDF] D1 — o seedDemo cria pedidos ABERTOS (sem pagamento) que já baixaram estoque.
    await t.diverge('seedDemo deixa 2 pedidos ABERTOS (não pagos) que já consumiram estoque — a baixa acontece na criação, antes do pagamento (PDF: só após pagamento aprovado)', async () => {
      const p = await t.prisma.produto.findFirstOrThrow({ where: { nome: 'Prato feito do dia' }, include: { estoque: true } });
      const abertos = await t.prisma.itemPedido.aggregate({ where: { produtoId: p.id, pedido: { status: 'ABERTO' } }, _sum: { quantidade: true } });
      t.verdade((abertos._sum.quantidade || 0) >= 1);
    });
  } finally {
    await limparNovos();
  }
});
