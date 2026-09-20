// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { criarProduto } from "./criarProduto";
import { listarProdutos } from "./listarProdutos";
import { buscarProdutoPorId } from "./buscarProdutoPorId";
import { buscarProdutoPorCodigoBarras } from "./buscarProdutoPorCodigoBarras";
import { atualizarProduto } from "./atualizarProduto";
import { inativarProduto } from "./inativarProduto";

// Montado em /produtos (server.ts): GET / e GET /:id são os do catálogo do Site Cliente (contrato 2.2).
export const produtoRoutes = Router();

// POST /produtos -> cadastra um produto.
produtoRoutes.post("/", criarProduto);
// GET /produtos -> lista (com filtros).
produtoRoutes.get("/", listarProdutos);
// GET /produtos/codigo-barras/:codigo -> busca pelo código de barras (PDV).
produtoRoutes.get("/codigo-barras/:codigo", buscarProdutoPorCodigoBarras);
// GET /produtos/:id -> busca um produto pelo id.
produtoRoutes.get("/:id", buscarProdutoPorId);
// PATCH /produtos/:id -> atualiza campos do produto (inclusive ativo).
produtoRoutes.patch("/:id", atualizarProduto);
// PATCH /produtos/:id/inativar -> atalho para inativar.
produtoRoutes.patch("/:id/inativar", inativarProduto);
