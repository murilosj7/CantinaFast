// Cria o conjunto de rotas deste módulo.
import { Router } from "express";
// Enum de perfis do Prisma, usado para restringir a rota ao administrador.
import { PerfilUsuario } from "@prisma/client";
// autenticar = token do usuário INTERNO (token de cliente aqui dá 403); exigirPerfil = restringe por perfil.
import { autenticar, exigirPerfil } from "../../middlewares/auth.middleware";
// Ações do módulo (um arquivo por ação).
import { listarClientes } from "./listarClientes";
import { alterarAtivoCliente } from "./alterarAtivoCliente";

// Rotas de gestão de clientes pelo painel, montadas em /interno/clientes no server.ts.
export const clienteInternoRoutes = Router();

// Só o administrador vê e altera clientes (dados pessoais).
const soAdministrador = exigirPerfil(PerfilUsuario.ADMINISTRADOR);

clienteInternoRoutes.get("/", autenticar, soAdministrador, listarClientes);
clienteInternoRoutes.patch("/:id/ativo", autenticar, soAdministrador, alterarAtivoCliente);
