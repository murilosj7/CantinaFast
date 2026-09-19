import { PerfilUsuario } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";

// Regra de negócio: o sistema nunca pode ficar sem ADMINISTRADOR ativo. Validada aqui (controller),
// não por constraint de banco. Usada por atualizarUsuario e inativarUsuario.
// Lança 409 se a mudança de `usuario` para `novo` tirar o último administrador ativo.
export async function garantirUltimoAdministrador(
  usuario: { id: number; perfil: PerfilUsuario; ativo: boolean },
  novo: { perfil: PerfilUsuario; ativo: boolean },
) {
  const eraAdministradorAtivo = usuario.perfil === PerfilUsuario.ADMINISTRADOR && usuario.ativo;
  const seraAdministradorAtivo = novo.perfil === PerfilUsuario.ADMINISTRADOR && novo.ativo;
  if (!eraAdministradorAtivo || seraAdministradorAtivo) return;

  const outrosAdministradores = await prisma.usuario.count({
    where: { perfil: PerfilUsuario.ADMINISTRADOR, ativo: true, id: { not: usuario.id } },
  });
  if (outrosAdministradores === 0) {
    throw new AppError("Não é possível inativar nem alterar o perfil do último administrador ativo.", 409);
  }
}
