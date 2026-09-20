// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";
// Regra de negócio: impede tirar o último administrador ativo.
import { garantirUltimoAdministrador } from "./garantirUltimoAdministrador";
// Monta a resposta do usuário no formato do contrato.
import { paraUsuarioInterno } from "./usuario.mapper";

// PATCH /interno/usuarios/:id/inativar — usuário nunca é deletado, só marcado como inativo.
// Atalho dedicado: o frontend também consegue inativar via PATCH /interno/usuarios/:id { ativo: false }
// (atualizarUsuario), e as duas rotas aplicam a mesma regra do último administrador.
export async function inativarUsuario(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);

  // Busca o usuário atual no banco.
  const usuario = await prisma.usuario.findUnique({ where: { id } });
  // Se não existe, 404.
  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  // Se ele for o último administrador ativo, essa função lança 409 e a inativação é barrada.
  await garantirUltimoAdministrador(usuario, { perfil: usuario.perfil, ativo: false });

  // Marca como inativo (ativo = false) em vez de apagar o registro.
  const inativado = await prisma.usuario.update({
    where: { id },
    data: { ativo: false },
    // Não traz o senhaHash.
    omit: { senhaHash: true },
  });

  // Devolve o usuário já inativado no formato do contrato.
  res.json(paraUsuarioInterno(inativado));
}
