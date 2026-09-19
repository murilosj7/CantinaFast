import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";

// GET /categorias?busca=texto&status=ativa|inativa|todas
// Sem `status`, devolve só as ATIVAS: é o que o catálogo do Site Cliente espera (contrato 2.2).
// O painel administrativo passa status=todas (ou inativa) para ver também as inativadas.
export async function listarCategorias(req: Request, res: Response) {
  const { busca, status } = req.query;
  const where: Prisma.CategoriaWhereInput = {};

  if (typeof busca === "string" && busca.trim() !== "") {
    where.nome = { contains: busca.trim(), mode: "insensitive" };
  }

  if (status === undefined || status === "" || status === "ativa") {
    where.ativa = true;
  } else if (status === "inativa") {
    where.ativa = false;
  } else if (status !== "todas") {
    throw new AppError("Status inválido. Use: ativa, inativa ou todas.", 400, "status");
  }

  const categorias = await prisma.categoria.findMany({ where, orderBy: { nome: "asc" } });
  res.json(categorias);
}
