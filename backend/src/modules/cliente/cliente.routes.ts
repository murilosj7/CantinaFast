// Cria o conjunto de rotas deste módulo.
import { Router } from "express";
// Protege rotas do CLIENTE do site (token de cliente).
import { autenticarCliente } from "../../middlewares/auth.middleware";
// Ações do módulo (um arquivo por ação).
import { cadastrarCliente } from "./cadastrarCliente";
import { loginCliente } from "./loginCliente";
import { meuPerfil } from "./meuPerfil";

// Rotas do cliente do site, montadas em /clientes no server.ts.
export const clienteRoutes = Router();

// Públicas. Os limitadores de requisições (server.ts) rodam ANTES: login (falhas por IP) e cadastro (20 por hora por IP).
clienteRoutes.post("/cadastro", cadastrarCliente);
clienteRoutes.post("/login", loginCliente);
// Protegida pelo token de cliente. Declarada antes de qualquer rota com :id, para "me" não ser lido como id.
clienteRoutes.get("/me", autenticarCliente, meuPerfil);
