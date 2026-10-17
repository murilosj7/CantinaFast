// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Middleware que exige token JWT válido.
import { autenticar } from "../../middlewares/auth.middleware";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { login } from "./login";
import { me } from "./me";

// Montado em /interno (server.ts), como no contrato do frontend.
export const authRoutes = Router();

// POST /interno/login -> público (é por ele que se obtém o token).
authRoutes.post("/login", login);
// GET /interno/me -> protegido: `autenticar` valida o token antes de `me` rodar.
authRoutes.get("/me", autenticar, me);
