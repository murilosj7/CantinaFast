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

// PATCH /produtos/:id/inativar — produto nunca é deletado (o histórico de pedidos continua apontando
// para ele), só marcado como inativo. Atalho dedicado; atualizarProduto com { ativo: false } faz o mesmo.
export async function inativarProduto(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);

  // Busca o produto no banco para confirmar que existe.
  const existente = await prisma.produto.findUnique({ where: { id } });
  // Se não existe, 404.
  if (!existente) {
    throw new AppError("Produto não encontrado.", 404);
  }

  // Marca como inativo (ativo = false) em vez de apagar o registro.
  const inativado = await prisma.produto.update({
    where: { id },
    data: { ativo: false },
    // Traz categoria/estoque para montar a resposta.
    include: produtoInclude,
  });

  // Devolve o produto já inativado no formato do contrato.
  res.json(paraProduto(inativado));
}
