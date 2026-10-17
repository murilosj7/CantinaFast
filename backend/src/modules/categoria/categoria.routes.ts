// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Middleware que exige token JWT válido (rotas que alteram dados).
import { autenticar } from "../../middlewares/auth.middleware";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { criarCategoria } from "./criarCategoria";
import { listarCategorias } from "./listarCategorias";
import { atualizarCategoria } from "./atualizarCategoria";
import { inativarCategoria } from "./inativarCategoria";

// Montado em /categorias (server.ts): o GET é o do catálogo do Site Cliente (contrato 2.2), por isso é público.
export const categoriaRoutes = Router();

// POST /categorias -> cadastra uma categoria. PROTEGIDA: precisa de token.
categoriaRoutes.post("/", autenticar, criarCategoria);
// GET /categorias -> lista (com filtros). Pública: o catálogo do site consulta sem login.
categoriaRoutes.get("/", listarCategorias);
// PATCH /categorias/:id -> atualiza campos da categoria (inclusive ativa). PROTEGIDA.
categoriaRoutes.patch("/:id", autenticar, atualizarCategoria);
// PATCH /categorias/:id/inativar -> atalho para inativar. PROTEGIDA.
categoriaRoutes.patch("/:id/inativar", autenticar, inativarCategoria);
