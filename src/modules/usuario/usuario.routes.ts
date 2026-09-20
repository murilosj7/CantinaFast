// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Middleware que exige token JWT válido (rotas que alteram dados).
import { autenticar } from "../../middlewares/auth.middleware";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { criarUsuario } from "./criarUsuario";
import { listarUsuarios } from "./listarUsuarios";
import { buscarUsuarioPorId } from "./buscarUsuarioPorId";
import { atualizarUsuario } from "./atualizarUsuario";
import { inativarUsuario } from "./inativarUsuario";

// Montado em /interno/usuarios (server.ts), como no contrato do frontend.
export const usuarioRoutes = Router();

// POST /interno/usuarios -> cadastra um usuário. PROTEGIDA: precisa de token.
usuarioRoutes.post("/", autenticar, criarUsuario);
// GET /interno/usuarios -> lista (com filtros). Pública por enquanto, para facilitar teste manual.
usuarioRoutes.get("/", listarUsuarios);
// GET /interno/usuarios/:id -> busca um usuário pelo id. Pública por enquanto.
usuarioRoutes.get("/:id", buscarUsuarioPorId);
// PATCH /interno/usuarios/:id -> atualiza campos do usuário (inclusive ativo). PROTEGIDA.
usuarioRoutes.patch("/:id", autenticar, atualizarUsuario);
// PATCH /interno/usuarios/:id/inativar -> atalho para inativar. PROTEGIDA.
usuarioRoutes.patch("/:id/inativar", autenticar, inativarUsuario);
