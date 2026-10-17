// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Enum de perfis do Prisma, usado para dizer quem pode gerenciar usuários.
import { PerfilUsuario } from "@prisma/client";
// autenticar exige token válido; exigirPerfil restringe a certos perfis.
import { autenticar, exigirPerfil } from "../../middlewares/auth.middleware";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { criarUsuario } from "./criarUsuario";
import { listarUsuarios } from "./listarUsuarios";
import { buscarUsuarioPorId } from "./buscarUsuarioPorId";
import { atualizarUsuario } from "./atualizarUsuario";
import { inativarUsuario } from "./inativarUsuario";

// Montado em /interno/usuarios (server.ts), como no contrato do frontend.
export const usuarioRoutes = Router();

// Atalho para as rotas que só o ADMINISTRADOR pode usar (criar, atualizar e inativar usuários).
const soAdministrador = exigirPerfil(PerfilUsuario.ADMINISTRADOR);

// POST /interno/usuarios -> cadastra um usuário. Precisa de token E de perfil ADMINISTRADOR.
usuarioRoutes.post("/", autenticar, soAdministrador, criarUsuario);
// GET /interno/usuarios -> lista (com filtros). Precisa de token (qualquer perfil).
usuarioRoutes.get("/", autenticar, listarUsuarios);
// GET /interno/usuarios/:id -> busca um usuário pelo id. Precisa de token (qualquer perfil).
usuarioRoutes.get("/:id", autenticar, buscarUsuarioPorId);
// PATCH /interno/usuarios/:id -> atualiza campos do usuário (inclusive ativo). Token E perfil ADMINISTRADOR.
usuarioRoutes.patch("/:id", autenticar, soAdministrador, atualizarUsuario);
// PATCH /interno/usuarios/:id/inativar -> atalho para inativar. Token E perfil ADMINISTRADOR.
usuarioRoutes.patch("/:id/inativar", autenticar, soAdministrador, inativarUsuario);
