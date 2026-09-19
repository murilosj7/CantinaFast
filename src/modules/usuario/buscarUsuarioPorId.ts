import type { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";
import { parseId } from "../../utils/parseId";
import { paraUsuarioInterno } from "./usuario.mapper";

// GET /interno/usuarios/:id
export async function buscarUsuarioPorId(req: Request, res: Response) {
  const id = parseId(req.params.id);

  const usuario = await prisma.usuario.findUnique({ where: { id }, omit: { senhaHash: true } });
  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  res.json(paraUsuarioInterno(usuario));
}
