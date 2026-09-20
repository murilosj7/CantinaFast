// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { criarCategoria } from "./criarCategoria";
import { listarCategorias } from "./listarCategorias";
import { atualizarCategoria } from "./atualizarCategoria";
import { inativarCategoria } from "./inativarCategoria";

// Montado em /categorias (server.ts): o GET é o do catálogo do Site Cliente (contrato 2.2).
export const categoriaRoutes = Router();

// POST /categorias -> cadastra uma categoria.
categoriaRoutes.post("/", criarCategoria);
// GET /categorias -> lista (com filtros).
categoriaRoutes.get("/", listarCategorias);
// PATCH /categorias/:id -> atualiza campos da categoria (inclusive ativa).
categoriaRoutes.patch("/:id", atualizarCategoria);
// PATCH /categorias/:id/inativar -> atalho para inativar.
categoriaRoutes.patch("/:id/inativar", inativarCategoria);
