// Seed de DEMONSTRAÇÃO (só para ambiente local). Rode com: npm run seed:demo
// Cria categorias, produtos (já com estoque e movimentação de entrada), dois usuários de teste e alguns pedidos
// (uns abertos, uns pagos) para as telas do sistema terem o que mostrar.
// É idempotente: rodar de novo não duplica nada (categoria por nome, produto por código de barras/nome, usuário por login).
// Reaproveita os handlers reais da API (criarProduto, criarPedido, registrarPagamento...), então estoque, movimentações e
// pagamentos seguem exatamente as mesmas regras. A senha dos usuários vem de SEED_DEMO_SENHA (com padrão de demonstração).

// Carrega o arquivo .env para dentro de process.env (é de lá que pode sair a SEED_DEMO_SENHA).
import "dotenv/config";
// Tipos do Express usados só para montar o req/res mínimo que os handlers precisam.
import type { Request, Response } from "express";
// Enum de perfis do Prisma (ATENDENTE e CAIXA).
import { PerfilUsuario } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../config/prisma";
// Handlers reais da API: cada um já contém validação, regras de negócio e gravação.
import { criarUsuario } from "../modules/usuario/criarUsuario";
import { criarCategoria } from "../modules/categoria/criarCategoria";
import { criarProduto } from "../modules/produto/criarProduto";
import { criarPedido } from "../modules/pedido/criarPedido";
import { registrarPagamento } from "../modules/pagamento/registrarPagamento";

// Senha dos usuários de demonstração quando SEED_DEMO_SENHA não é informada (é só ambiente local de demo).
const SENHA_PADRAO_DEMO = "demo1234";

// Categorias da demonstração.
const CATEGORIAS = ["Salgados", "Bebidas", "Doces", "Almoço"];

// Produtos da demonstração: `chave` é só um apelido usado nos pedidos abaixo; o código de barras é fictício e único.
const PRODUTOS = [
  { chave: "coxinha", nome: "Coxinha de frango", preco: 7.5, categoria: "Salgados", quantidadeInicial: 40 },
  { chave: "pastel", nome: "Pastel de queijo", preco: 8, categoria: "Salgados", quantidadeInicial: 25 },
  { chave: "suco", nome: "Suco de laranja 300ml", preco: 6.5, categoria: "Bebidas", quantidadeInicial: 18 },
  { chave: "refri", nome: "Refrigerante lata", preco: 5, categoria: "Bebidas", quantidadeInicial: 30 },
  { chave: "brigadeiro", nome: "Brigadeiro", preco: 3.5, categoria: "Doces", quantidadeInicial: 60 },
  { chave: "prato", nome: "Prato feito do dia", preco: 24.9, categoria: "Almoço", quantidadeInicial: 12 },
];

// Usuários de teste (login fixo, senha vem do ambiente).
const USUARIOS = [
  { chave: "atendente", nome: "Atendente Demo", login: "atendente_demo", perfil: "atendente" },
  { chave: "caixa", nome: "Caixa Demo", login: "caixa_demo", perfil: "caixa" },
];

// Pedidos de exemplo: quem atende, os itens (apelido do produto + quantidade) e, se houver, a forma de pagamento.
// Sem `pagamento` o pedido fica ABERTO (recém-criado, sem pagar); com `pagamento` é pago de verdade pelo registrarPagamento.
const PEDIDOS = [
  { usuario: "atendente", itens: [["coxinha", 2], ["refri", 1]], pagamento: null },
  { usuario: "atendente", itens: [["prato", 1], ["suco", 1]], pagamento: null },
  { usuario: "caixa", itens: [["brigadeiro", 3], ["pastel", 1]], pagamento: "PIX" },
  { usuario: "caixa", itens: [["prato", 1], ["refri", 1]], pagamento: "DINHEIRO" },
] as const;

// Quem está "logado" ao chamar um handler (o handler lê req.usuario.id para registrar a autoria).
type UsuarioDemo = { id: number; perfil: PerfilUsuario };

// Formato dos handlers da API (função assíncrona que recebe req e res).
type Handler = (req: Request, res: Response) => Promise<void>;

// Executa um handler REAL da API sem servidor HTTP: monta um req com corpo e usuário, captura o que ele responderia.
// Se o handler recusar (AppError), o erro é lançado daqui com a mesma mensagem da API.
async function chamar(handler: Handler, usuario: UsuarioDemo | undefined, body: unknown) {
  // Corpo que o handler "responderia" em res.json(...).
  let corpo: unknown;
  // req mínimo: só o que os handlers usam (body e usuario).
  const req = { body, usuario } as unknown as Request;
  // res mínimo: status() e json() encadeáveis, guardando o corpo.
  const res = {
    status() {
      return res;
    },
    json(valor: unknown) {
      corpo = valor;
      return res;
    },
  } as unknown as Response;
  // Roda o handler; se ele lançar erro, sobe para quem chamou.
  await handler(req, res);
  return corpo as Record<string, any>;
}

// Faz o trabalho do seed; qualquer erro lançado aqui é tratado no final do arquivo.
async function seedDemo() {
  // Trava de segurança: esta demo cria usuários com senha de demonstração, nunca deve rodar em produção.
  if (process.env.NODE_ENV === "production") {
    throw new Error("O seed de demonstração não roda com NODE_ENV=production.");
  }

  // Senha dos usuários de teste: SEED_DEMO_SENHA se informada (não vazia), senão o padrão de demonstração.
  const senha = (process.env.SEED_DEMO_SENHA ?? "").trim() || SENHA_PADRAO_DEMO;
  // Contadores para o resumo final.
  const resumo = { criados: 0, existentes: 0 };

  // ---------- Usuários ----------
  console.log("Usuários:");
  // Guarda o usuário (id e perfil) de cada apelido, para usar depois nos handlers.
  const usuarios: Record<string, UsuarioDemo> = {};
  for (const u of USUARIOS) {
    // Login é único no banco: se já existe, não cria de novo (e não altera senha nem perfil).
    const existente = await prisma.usuario.findUnique({ where: { login: u.login } });
    if (existente) {
      usuarios[u.chave] = { id: existente.id, perfil: existente.perfil };
      resumo.existentes++;
      console.log(`  = ${u.login} já existe (id ${existente.id}, ${existente.perfil}, ${existente.ativo ? "ativo" : "inativo"})`);
      continue;
    }
    // Não existe: cria pelo handler real (valida, gera o hash da senha e grava).
    const criado = await chamar(criarUsuario, undefined, { nome: u.nome, login: u.login, senha, perfil: u.perfil });
    usuarios[u.chave] = { id: criado.id, perfil: u.perfil.toUpperCase() as PerfilUsuario };
    resumo.criados++;
    console.log(`  + ${u.login} criado (id ${criado.id}, ${u.perfil})`);
  }
  // O caixa de demonstração é quem "dá a entrada" do estoque inicial dos produtos.
  const responsavelEstoque = usuarios.caixa!;

  // ---------- Categorias ----------
  console.log("Categorias:");
  // Guarda id e situação (ativa) de cada categoria pelo nome.
  const categorias: Record<string, { id: number; ativa: boolean }> = {};
  for (const nome of CATEGORIAS) {
    // Procura pelo nome, sem diferenciar maiúsculas de minúsculas (o nome não é único no banco, então conferimos aqui).
    const existente = await prisma.categoria.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } });
    if (existente) {
      categorias[nome] = { id: existente.id, ativa: existente.ativa };
      resumo.existentes++;
      console.log(`  = ${nome} já existe (id ${existente.id}${existente.ativa ? "" : ", INATIVA"})`);
      continue;
    }
    // Não existe: cria pelo handler real.
    const criada = await chamar(criarCategoria, undefined, { nome });
    categorias[nome] = { id: criada.id, ativa: true };
    resumo.criados++;
    console.log(`  + ${nome} criada (id ${criada.id})`);
  }

  // ---------- Produtos ----------
  console.log("Produtos:");
  // Guarda o id de cada produto pelo apelido (`chave`), seja ele novo ou já existente.
  const produtos: Record<string, number> = {};
  for (const [indice, p] of PRODUTOS.entries()) {
    // Código de barras fictício e único: 78900000000 + número sequencial de 2 dígitos (13 dígitos, como um EAN).
    const codigoBarras = `78900000000${String(indice + 1).padStart(2, "0")}`;
    // Já existe? Confere pelo código de barras OU pelo nome (sem diferenciar maiúsculas), para não duplicar.
    const existente = await prisma.produto.findFirst({
      where: { OR: [{ codigoBarras }, { nome: { equals: p.nome, mode: "insensitive" } }] },
    });
    if (existente) {
      produtos[p.chave] = existente.id;
      resumo.existentes++;
      console.log(`  = ${p.nome} já existe (id ${existente.id}); estoque não alterado`);
      continue;
    }
    // A categoria precisa estar ativa para receber produto (regra do criarProduto); se estiver inativa, avisa e pula.
    const categoria = categorias[p.categoria]!;
    if (!categoria.ativa) {
      console.log(`  ! ${p.nome} NÃO criado: a categoria '${p.categoria}' está inativa`);
      continue;
    }
    // Cria pelo handler real: já grava o estoque com a quantidade inicial e a movimentação ENTRADA "Estoque inicial".
    const criado = await chamar(criarProduto, responsavelEstoque, {
      nome: p.nome,
      preco: p.preco,
      categoriaId: categoria.id,
      quantidadeInicial: p.quantidadeInicial,
      codigoBarras,
    });
    produtos[p.chave] = criado.id;
    resumo.criados++;
    console.log(`  + ${p.nome} criado (id ${criado.id}, R$ ${p.preco.toFixed(2)}, ${p.quantidadeInicial} un., cód. ${codigoBarras})`);
  }

  // ---------- Pedidos ----------
  console.log("Pedidos:");
  // Pedidos que os usuários de demonstração já têm, do mais antigo ao mais novo (é como sabemos o que já foi semeado).
  const jaSemeados = await prisma.pedido.findMany({
    where: { usuarioId: { in: Object.values(usuarios).map((u) => u.id) } },
    orderBy: { id: "asc" },
    include: { pagamentos: { select: { id: true } } },
  });
  for (const [indice, plano] of PEDIDOS.entries()) {
    // O pedido de número `indice` já foi criado por uma execução anterior? Então reaproveita em vez de criar outro.
    let pedido = jaSemeados[indice] ? { id: jaSemeados[indice].id, status: jaSemeados[indice].status, pagamentos: jaSemeados[indice].pagamentos.length, total: Number(jaSemeados[indice].valorTotal) } : undefined;
    if (pedido) {
      resumo.existentes++;
      console.log(`  = pedido #${pedido.id} já existe (${pedido.status})`);
    } else {
      // Monta os itens com o id de cada produto; se algum produto não foi criado (categoria inativa), não dá para montar.
      const itens = plano.itens.map(([chave, quantidade]) => ({ produtoId: produtos[chave], quantidade }));
      if (itens.some((item) => item.produtoId === undefined)) {
        console.log(`  ! pedido ${indice + 1} NÃO criado: falta algum produto`);
        continue;
      }
      // Cria pelo handler real: valida, baixa o estoque e registra a movimentação SAIDA de cada item.
      const criado = await chamar(criarPedido, usuarios[plano.usuario], { canal: "PRESENCIAL", itens });
      pedido = { id: criado.id, status: criado.status, pagamentos: 0, total: criado.total };
      resumo.criados++;
      console.log(`  + pedido #${pedido.id} criado por ${plano.usuario}_demo (${pedido.status}, total R$ ${pedido.total.toFixed(2)})`);
    }
    // Pedido que deve estar pago: paga pelo handler real se ainda estiver ABERTO e sem nenhum pagamento (idempotente).
    if (plano.pagamento && pedido.status === "ABERTO" && pedido.pagamentos === 0) {
      // O valor precisa ser igual ao total do pedido (regra do registrarPagamento).
      await chamar(registrarPagamento, usuarios[plano.usuario], { pedidoId: pedido.id, formaPagamento: plano.pagamento, valor: pedido.total });
      console.log(`    pedido #${pedido.id} pago em ${plano.pagamento} (PAGO)`);
    }
  }

  // Resumo final (a senha nunca é impressa).
  console.log(`\nConcluído: ${resumo.criados} registro(s) criado(s), ${resumo.existentes} já existia(m).`);
  console.log("Logins de teste: atendente_demo e caixa_demo (senha: SEED_DEMO_SENHA, ou o padrão do script se não informada).");
}

// Executa o seed.
seedDemo()
  // Se algo deu errado, mostra a mensagem e marca o processo com código de saída 1 (falha).
  .catch((erro) => {
    console.error("Falha ao executar o seed de demonstração:", erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  // Em qualquer caso, fecha a conexão com o banco para o processo poder terminar.
  .finally(() => prisma.$disconnect());
