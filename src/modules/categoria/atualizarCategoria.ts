import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";
import { parseId } from "../../utils/parseId";

// PATCH /categorias/:id — body com qualquer combinação de: { nome, ativa }
// `ativa: false` inativa e `ativa: true` reativa (mesmo padrão do módulo de usuário).
export async function atualizarCategoria(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const { nome, ativa } = req.body ?? {};

  const existente = await prisma.categoria.findUnique({ where: { id } });
  if (!existente) {
    throw new AppError("Categoria não encontrada.", 404);
  }

  const data: Prisma.CategoriaUpdateInput = {};

  if (nome !== undefined) {
    if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 80) {
      throw new AppError("Informe o nome da categoria (até 80 caracteres).", 400, "nome");
    }
    data.nome = nome.trim();
  }

  if (ativa !== undefined) {
    if (typeof ativa !== "boolean") {
      throw new AppError("O campo 'ativa' deve ser verdadeiro ou falso.", 400, "ativa");
    }
    data.ativa = ativa;
  }

  if (Object.keys(data).length === 0) {
    throw new AppError("Informe ao menos um campo para atualizar: nome ou ativa.");
  }

  const atualizada = await prisma.categoria.update({ where: { id }, data });
  res.json(atualizada);
}
