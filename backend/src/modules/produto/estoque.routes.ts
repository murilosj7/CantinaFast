// Router do Express: agrupa as rotas de saldos de estoque num "mini-servidor" que o server.ts pluga em /estoque.
import { Router } from "express";
// Middleware que exige token JWT válido.
import { autenticar } from "../../middlewares/auth.middleware";
// As ações moram cada uma no seu arquivo, dentro do módulo de produto (reaproveitam os dados de Produto + Estoque).
import { listarEstoque } from "./listarEstoque";
import { atualizarEstoqueMinimo } from "./atualizarEstoqueMinimo";

// Montado em /estoque (server.ts). Todas as rotas são PROTEGIDAS (qualquer perfil logado).
export const estoqueRoutes = Router();

// GET /estoque -> saldos de todos os produtos (tela "Saldos"), com filtros.
estoqueRoutes.get("/", autenticar, listarEstoque);
// PATCH /estoque/:produtoId -> atualiza só o estoque mínimo (cria a linha zerada se o produto não tiver).
estoqueRoutes.patch("/:produtoId", autenticar, atualizarEstoqueMinimo);
// PUT /estoque/:produtoId -> mesmo handler: o serviço do frontend (estoqueService.atualizarMinimo) chama por PUT.
estoqueRoutes.put("/:produtoId", autenticar, atualizarEstoqueMinimo);
