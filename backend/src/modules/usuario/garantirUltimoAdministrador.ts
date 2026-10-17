// Enum PerfilUsuario gerado pelo Prisma (ATENDENTE, CAIXA, ADMINISTRADOR).
import { PerfilUsuario } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";

// Regra de negócio: o sistema nunca pode ficar sem ADMINISTRADOR ativo. Validada aqui (controller),
// não por constraint de banco. Usada por atualizarUsuario e inativarUsuario.
// Lança 409 se a mudança de `usuario` para `novo` tirar o último administrador ativo.
export async function garantirUltimoAdministrador(
  // Estado ATUAL do usuário (antes da mudança).
  usuario: { id: number; perfil: PerfilUsuario; ativo: boolean },
  // Estado que ele terá DEPOIS da mudança.
  novo: { perfil: PerfilUsuario; ativo: boolean },
) {
  // Hoje ele é administrador e está ativo?
  const eraAdministradorAtivo = usuario.perfil === PerfilUsuario.ADMINISTRADOR && usuario.ativo;
  // Depois da mudança ele continuará administrador e ativo?
  const seraAdministradorAtivo = novo.perfil === PerfilUsuario.ADMINISTRADOR && novo.ativo;
  // Se ele não era admin ativo, ou continuará sendo, a mudança não afeta a regra: pode seguir.
  if (!eraAdministradorAtivo || seraAdministradorAtivo) return;

  // Conta quantos OUTROS administradores ativos existem (o `not` exclui o próprio usuário).
  const outrosAdministradores = await prisma.usuario.count({
    where: { perfil: PerfilUsuario.ADMINISTRADOR, ativo: true, id: { not: usuario.id } },
  });
  // Se não sobra nenhum, essa mudança deixaria o sistema sem administrador.
  if (outrosAdministradores === 0) {
    // 409 = conflito com a regra de negócio; sem "campo" porque a mensagem é geral.
    throw new AppError("Não é possível inativar nem alterar o perfil do último administrador ativo.", 409);
  }
}
