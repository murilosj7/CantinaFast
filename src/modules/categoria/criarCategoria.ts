import type { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";

// POST /categorias — body: { nome }
export async function criarCategoria(req: Request, res: Response) {
  const { nome } = req.body ?? {};

  if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 80) {
    throw new AppError("Informe o nome da categoria (até 80 caracteres).", 400, "nome");
  }

  const categoria = await prisma.categoria.create({ data: { nome: nome.trim() } });
  res.status(201).json(categoria);
}
