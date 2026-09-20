// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";
// Monta a resposta do pagamento no formato da API.
import { paraPagamento } from "./pagamento.mapper";

// GET /pagamentos/pedido/:pedidoId — todos os pagamentos (tentativas/registros) de UM pedido, do mais antigo ao mais novo.
// Um pedido sem pagamento devolve lista vazia; um pedido que não existe devolve 404.
export async function listarPagamentosPorPedido(req: Request, res: Response) {
  // Lê o :pedidoId da URL e garante que é um inteiro positivo (senão responde 400).
  const pedidoId = parseId(req.params.pedidoId, "pedidoId");

  // Confere que o pedido existe (só o id interessa), para distinguir "sem pagamentos" de "pedido inexistente".
  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId }, select: { id: true } });
  // Não existe: 404 (aqui o id está na URL, então o recurso não foi encontrado).
  if (!pedido) {
    throw new AppError("Pedido não encontrado.", 404);
  }

  // Busca os pagamentos do pedido em ordem de registro (id crescente).
  const pagamentos = await prisma.pagamento.findMany({ where: { pedidoId }, orderBy: { id: "asc" } });
  // Devolve a lista (vazia se não houver nenhum).
  res.json(pagamentos.map(paraPagamento));
}
