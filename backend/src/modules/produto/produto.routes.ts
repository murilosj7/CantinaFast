// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Middleware que exige token JWT válido (rotas que alteram dados).
import { autenticar } from "../../middlewares/auth.middleware";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { criarProduto } from "./criarProduto";
import { listarProdutos } from "./listarProdutos";
import { buscarProdutoPorId } from "./buscarProdutoPorId";
import { buscarProdutoPorCodigoBarras } from "./buscarProdutoPorCodigoBarras";
import { atualizarProduto } from "./atualizarProduto";
import { inativarProduto } from "./inativarProduto";
import { ajustarEstoque } from "./ajustarEstoque";

// Montado em /produtos (server.ts): GET / e GET /:id são os do catálogo do Site Cliente (contrato 2.2), por isso são públicos.
export const produtoRoutes = Router();

// POST /produtos -> cadastra um produto. PROTEGIDA: precisa de token.
produtoRoutes.post("/", autenticar, criarProduto);
// GET /produtos -> lista (com filtros). Pública: o catálogo do site consulta sem login.
produtoRoutes.get("/", listarProdutos);
// GET /produtos/codigo-barras/:codigo -> busca pelo código de barras (PDV). Pública por enquanto.
produtoRoutes.get("/codigo-barras/:codigo", buscarProdutoPorCodigoBarras);
// GET /produtos/:id -> busca um produto pelo id. Pública: o catálogo do site consulta sem login.
produtoRoutes.get("/:id", buscarProdutoPorId);
// PATCH /produtos/:id -> atualiza campos do produto (inclusive ativo). PROTEGIDA.
produtoRoutes.patch("/:id", autenticar, atualizarProduto);
// PATCH /produtos/:id/inativar -> atalho para inativar. PROTEGIDA.
produtoRoutes.patch("/:id/inativar", autenticar, inativarProduto);
// PATCH /produtos/:id/estoque -> reposição (ENTRADA) ou correção de contagem (AJUSTE) do estoque. PROTEGIDA (qualquer perfil logado).
produtoRoutes.patch("/:id/estoque", autenticar, ajustarEstoque);
