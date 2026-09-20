// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { criarUsuario } from "./criarUsuario";
import { listarUsuarios } from "./listarUsuarios";
import { buscarUsuarioPorId } from "./buscarUsuarioPorId";
import { atualizarUsuario } from "./atualizarUsuario";
import { inativarUsuario } from "./inativarUsuario";

// Montado em /interno/usuarios (server.ts), como no contrato do frontend.
export const usuarioRoutes = Router();

// POST /interno/usuarios -> cadastra um usuário.
usuarioRoutes.post("/", criarUsuario);
// GET /interno/usuarios -> lista (com filtros).
usuarioRoutes.get("/", listarUsuarios);
// GET /interno/usuarios/:id -> busca um usuário pelo id.
usuarioRoutes.get("/:id", buscarUsuarioPorId);
// PATCH /interno/usuarios/:id -> atualiza campos do usuário (inclusive ativo).
usuarioRoutes.patch("/:id", atualizarUsuario);
// PATCH /interno/usuarios/:id/inativar -> atalho para inativar.
usuarioRoutes.patch("/:id/inativar", inativarUsuario);
