import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";
import { lerPerfil, paraUsuarioInterno } from "./usuario.mapper";

// GET /interno/usuarios?busca=texto&perfil=caixa&status=ativo|inativo
// Todos os filtros são opcionais e combinam entre si (AND). `busca` procura em nome e login.
export async function listarUsuarios(req: Request, res: Response) {
  const { busca, perfil, status } = req.query;
  const where: Prisma.UsuarioWhereInput = {};

  if (typeof busca === "string" && busca.trim() !== "") {
    const termo = busca.trim();
    where.OR = [
      { nome: { contains: termo, mode: "insensitive" } },
      { login: { contains: termo, mode: "insensitive" } },
    ];
  }

  if (perfil !== undefined && perfil !== "") {
    where.perfil = lerPerfil(perfil);
  }

  if (status !== undefined && status !== "") {
    if (status !== "ativo" && status !== "inativo") {
      throw new AppError("Status inválido. Use: ativo ou inativo.", 400, "status");
    }
    where.ativo = status === "ativo";
  }

  const usuarios = await prisma.usuario.findMany({
    where,
    orderBy: { nome: "asc" },
    omit: { senhaHash: true },
  });

  res.json(usuarios.map(paraUsuarioInterno));
}
