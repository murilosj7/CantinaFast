// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";
// produtoInclude carrega categoria/estoque; paraProduto monta a resposta do contrato.
import { paraProduto, produtoInclude } from "./produto.mapper";

// GET /produtos/:id — devolve também produto inativo (o campo `ativo` informa o estado).
export async function buscarProdutoPorId(req: Request, res: Response) {
  // Lê o :id da URL e garante que é um inteiro positivo (senão responde 400).
  const id = parseId(req.params.id);

  // Procura o produto pelo id, já trazendo categoria e estoque.
  const produto = await prisma.produto.findUnique({ where: { id }, include: produtoInclude });
  // Se não existe, responde 404.
  if (!produto) {
    throw new AppError("Produto não encontrado.", 404);
  }

  // Devolve o produto no formato do contrato.
  res.json(paraProduto(produto));
}
