// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";
// pedidoCompletoInclude carrega itens (com o produto) e pagamentos; paraPedido monta a resposta (e tira os pagamentos do Atendente).
import { paraPedido, pedidoCompletoInclude } from "./pedido.mapper";

// GET /pedidos/:id — o pedido com seus itens, os produtos de cada item e os pagamentos (lista vazia se não houver).
// O ATENDENTE recebe o pedido SEM a chave `pagamentos` (a matriz de perfis não lhe dá acesso a pagamentos).
export async function buscarPedidoPorId(req: Request, res: Response) {
  // Rota protegida: o perfil vem do banco (autenticar) e decide se os pagamentos aparecem.
  if (!req.usuario) {
    throw new AppError("Não autenticado.", 401);
  }
  const perfil = req.usuario.perfil;
  // Lê o :id da URL e garante que é um inteiro positivo (senão responde 400).
  const id = parseId(req.params.id);

  // Procura o pedido pelo id, já trazendo itens, produtos e pagamentos.
  const pedido = await prisma.pedido.findUnique({ where: { id }, include: pedidoCompletoInclude });
  // Se não existe, responde 404.
  if (!pedido) {
    throw new AppError("Pedido não encontrado.", 404);
  }

  // Devolve o pedido no formato da API.
  res.json(paraPedido(pedido, perfil));
}
