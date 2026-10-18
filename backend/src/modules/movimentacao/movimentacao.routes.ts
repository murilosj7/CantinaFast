// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga em /movimentacoes.
import { Router } from "express";
// Middleware que exige token JWT válido.
import { autenticar, exigirPerfil } from "../../middlewares/auth.middleware";
import { SO_ADMIN, TODOS_INTERNOS } from "../../config/permissoes";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { listarMovimentacoes } from "./listarMovimentacoes";
import { criarMovimentacao } from "./criarMovimentacao";
import { removerMovimentacao } from "./removerMovimentacao";

// Montado em /movimentacoes (server.ts). Todas as rotas são PROTEGIDAS (qualquer perfil logado).
export const movimentacaoRoutes = Router();

// GET /movimentacoes?produtoId= -> histórico de movimentações (mais recentes primeiro), filtro de produto opcional.
movimentacaoRoutes.get("/", autenticar, exigirPerfil(...TODOS_INTERNOS), listarMovimentacoes);
// POST /movimentacoes -> lança ENTRADA, SAIDA, PERDA ou AJUSTE e atualiza o saldo na mesma transação.
movimentacaoRoutes.post("/", autenticar, exigirPerfil(...TODOS_INTERNOS), criarMovimentacao);
// DELETE /movimentacoes/:id -> desfaz o efeito no saldo e apaga o lançamento.
movimentacaoRoutes.delete("/:id", autenticar, exigirPerfil(...SO_ADMIN), removerMovimentacao);
