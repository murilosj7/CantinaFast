import { Router } from "express";
import { criarUsuario } from "./criarUsuario";
import { listarUsuarios } from "./listarUsuarios";
import { buscarUsuarioPorId } from "./buscarUsuarioPorId";
import { atualizarUsuario } from "./atualizarUsuario";
import { inativarUsuario } from "./inativarUsuario";

// Montado em /interno/usuarios (server.ts), como no contrato do frontend.
export const usuarioRoutes = Router();

usuarioRoutes.post("/", criarUsuario);
usuarioRoutes.get("/", listarUsuarios);
usuarioRoutes.get("/:id", buscarUsuarioPorId);
usuarioRoutes.patch("/:id", atualizarUsuario);
usuarioRoutes.patch("/:id/inativar", inativarUsuario);
