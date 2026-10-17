// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";

// PATCH /categorias/:id/inativar — categoria nunca é deletada, só marcada como inativa.
// Atalho dedicado; atualizarCategoria com { ativa: false } faz o mesmo. Não altera os produtos dela.
export async function inativarCategoria(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);

  // Busca a categoria no banco para confirmar que existe.
  const existente = await prisma.categoria.findUnique({ where: { id } });
  // Se não existe, 404.
  if (!existente) {
    throw new AppError("Categoria não encontrada.", 404);
  }

  // Marca como inativa (ativa = false) em vez de apagar o registro.
  const inativada = await prisma.categoria.update({ where: { id }, data: { ativa: false } });
  // Devolve a categoria já inativada.
  res.json(inativada);
}
