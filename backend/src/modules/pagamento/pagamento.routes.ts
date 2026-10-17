// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Middleware que exige token JWT válido.
import { autenticar } from "../../middlewares/auth.middleware";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { registrarPagamento } from "./registrarPagamento";
import { listarPagamentosPorPedido } from "./listarPagamentosPorPedido";

// Montado em /pagamentos (server.ts).
export const pagamentoRoutes = Router();

// TODAS as rotas deste módulo exigem token (qualquer perfil logado pode registrar e ver pagamentos).
pagamentoRoutes.use(autenticar);

// POST /pagamentos -> registra o pagamento (simulado como aprovado) e marca o pedido como PAGO.
pagamentoRoutes.post("/", registrarPagamento);
// GET /pagamentos/pedido/:pedidoId -> lista os pagamentos de um pedido.
pagamentoRoutes.get("/pedido/:pedidoId", listarPagamentosPorPedido);
