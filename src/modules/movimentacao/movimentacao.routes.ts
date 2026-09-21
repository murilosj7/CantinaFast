// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga em /movimentacoes.
import { Router } from "express";
// Middleware que exige token JWT válido.
import { autenticar } from "../../middlewares/auth.middleware";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { listarMovimentacoes } from "./listarMovimentacoes";
import { criarMovimentacao } from "./criarMovimentacao";
import { removerMovimentacao } from "./removerMovimentacao";

// Montado em /movimentacoes (server.ts). Todas as rotas são PROTEGIDAS (qualquer perfil logado).
export const movimentacaoRoutes = Router();

// GET /movimentacoes?produtoId= -> histórico de movimentações (mais recentes primeiro), filtro de produto opcional.
movimentacaoRoutes.get("/", autenticar, listarMovimentacoes);
// POST /movimentacoes -> lança ENTRADA, SAIDA, PERDA ou AJUSTE e atualiza o saldo na mesma transação.
movimentacaoRoutes.post("/", autenticar, criarMovimentacao);
// DELETE /movimentacoes/:id -> desfaz o efeito no saldo e apaga o lançamento.
movimentacaoRoutes.delete("/:id", autenticar, removerMovimentacao);
