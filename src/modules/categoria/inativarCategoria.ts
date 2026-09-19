import type { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";
import { parseId } from "../../utils/parseId";

// PATCH /categorias/:id/inativar — categoria nunca é deletada, só marcada como inativa.
// Atalho dedicado; atualizarCategoria com { ativa: false } faz o mesmo. Não altera os produtos dela.
export async function inativarCategoria(req: Request, res: Response) {
  const id = parseId(req.params.id);

  const existente = await prisma.categoria.findUnique({ where: { id } });
  if (!existente) {
    throw new AppError("Categoria não encontrada.", 404);
  }

  const inativada = await prisma.categoria.update({ where: { id }, data: { ativa: false } });
  res.json(inativada);
}
