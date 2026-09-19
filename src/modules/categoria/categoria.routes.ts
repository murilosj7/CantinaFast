import { Router } from "express";
import { criarCategoria } from "./criarCategoria";
import { listarCategorias } from "./listarCategorias";
import { atualizarCategoria } from "./atualizarCategoria";
import { inativarCategoria } from "./inativarCategoria";

// Montado em /categorias (server.ts): o GET é o do catálogo do Site Cliente (contrato 2.2).
export const categoriaRoutes = Router();

categoriaRoutes.post("/", criarCategoria);
categoriaRoutes.get("/", listarCategorias);
categoriaRoutes.patch("/:id", atualizarCategoria);
categoriaRoutes.patch("/:id/inativar", inativarCategoria);
