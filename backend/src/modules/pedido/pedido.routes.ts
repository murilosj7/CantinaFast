// Router do Express: agrupa as rotas deste módulo num "mini-servidor" que o server.ts pluga.
import { Router } from "express";
// Middleware que exige token JWT válido.
import { autenticar } from "../../middlewares/auth.middleware";
// Cada ação do módulo mora no seu próprio arquivo; aqui só ligamos cada rota à sua função.
import { criarPedido } from "./criarPedido";
import { listarPedidos } from "./listarPedidos";
import { buscarPedidoPorId } from "./buscarPedidoPorId";

// Montado em /pedidos (server.ts).
export const pedidoRoutes = Router();

// TODAS as rotas deste módulo exigem token (qualquer perfil logado pode criar e ver pedidos).
pedidoRoutes.use(autenticar);

// POST /pedidos -> cria um pedido com seus itens e dá baixa no estoque.
pedidoRoutes.post("/", criarPedido);
// GET /pedidos -> lista paginada (com filtros de status e canal).
pedidoRoutes.get("/", listarPedidos);
// GET /pedidos/:id -> detalhe do pedido (itens, produtos e pagamentos).
pedidoRoutes.get("/:id", buscarPedidoPorId);
