import type { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";
import { parseId } from "../../utils/parseId";
import { garantirUltimoAdministrador } from "./garantirUltimoAdministrador";
import { paraUsuarioInterno } from "./usuario.mapper";

// PATCH /interno/usuarios/:id/inativar — usuário nunca é deletado, só marcado como inativo.
// Atalho dedicado: o frontend também consegue inativar via PATCH /interno/usuarios/:id { ativo: false }
// (atualizarUsuario), e as duas rotas aplicam a mesma regra do último administrador.
export async function inativarUsuario(req: Request, res: Response) {
  const id = parseId(req.params.id);

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  await garantirUltimoAdministrador(usuario, { perfil: usuario.perfil, ativo: false });

  const inativado = await prisma.usuario.update({
    where: { id },
    data: { ativo: false },
    omit: { senhaHash: true },
  });

  res.json(paraUsuarioInterno(inativado));
}
