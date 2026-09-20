// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo Prisma usado para descrever o filtro (where) da consulta.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";

// GET /categorias?busca=texto&status=ativa|inativa|todas
// Sem `status`, devolve só as ATIVAS: é o que o catálogo do Site Cliente espera (contrato 2.2).
// O painel administrativo passa status=todas (ou inativa) para ver também as inativadas.
export async function listarCategorias(req: Request, res: Response) {
  // Os filtros vêm na URL (query string), depois do "?".
  const { busca, status } = req.query;
  // Começa sem nenhuma condição; vamos acrescentando conforme os filtros.
  const where: Prisma.CategoriaWhereInput = {};

  // Se veio um texto de busca não vazio...
  if (typeof busca === "string" && busca.trim() !== "") {
    // ...filtra categorias cujo nome contém o texto, sem diferenciar maiúsculas de minúsculas.
    where.nome = { contains: busca.trim(), mode: "insensitive" };
  }

  // Sem status (ou "ativa"): mostra só as ativas — é o padrão do catálogo.
  if (status === undefined || status === "" || status === "ativa") {
    where.ativa = true;
  // "inativa": mostra só as inativas.
  } else if (status === "inativa") {
    where.ativa = false;
  // Qualquer valor que não seja "todas" é inválido ("todas" simplesmente não aplica filtro de ativa).
  } else if (status !== "todas") {
    throw new AppError("Status inválido. Use: ativa, inativa ou todas.", 400, "status");
  }

  // Busca no banco aplicando os filtros, ordenando por nome de A a Z.
  const categorias = await prisma.categoria.findMany({ where, orderBy: { nome: "asc" } });
  // Responde com a lista.
  res.json(categorias);
}
