// Enum PerfilUsuario gerado pelo Prisma (ATENDENTE, CAIXA, ADMINISTRADOR) e o tipo da transação interativa.
import { PerfilUsuario, type Prisma } from "@prisma/client";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";

// Primeiro passo da regra do último administrador. Chame SEMPRE como primeira operação da $transaction, antes de reler
// o alvo: trava (FOR UPDATE) as linhas dos administradores ativos, em ordem fixa de id (evita deadlock entre
// transações concorrentes). Quem chegar depois espera o COMMIT de quem chegou antes e então enxerga o estado novo,
// o que fecha a corrida em que duas inativações simultâneas deixavam o sistema sem administrador.
export async function travarAdministradoresAtivos(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM "usuarios" WHERE perfil = 'ADMINISTRADOR' AND ativo = true ORDER BY id FOR UPDATE`;
}

// Regra de negócio: o sistema nunca pode ficar sem ADMINISTRADOR ativo. Validada aqui (controller),
// não por constraint de banco. Usada por atualizarUsuario e inativarUsuario.
// Lança 409 se a mudança de `usuario` para `novo` tirar o último administrador ativo.
// Deve rodar DENTRO da transação, depois de travarAdministradoresAtivos, com `usuario` relido nela (estado atual).
export async function garantirUltimoAdministrador(
  // Transação em que as linhas dos administradores ativos já estão travadas.
  tx: Prisma.TransactionClient,
  // Estado ATUAL do usuário (antes da mudança), lido dentro da transação.
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

  // Conta quantos OUTROS administradores ativos existem (o `not` exclui o próprio usuário). Roda depois da trava,
  // na mesma transação: nenhuma outra inativação/rebaixamento pode estar no meio do caminho.
  const outrosAdministradores = await tx.usuario.count({
    where: { perfil: PerfilUsuario.ADMINISTRADOR, ativo: true, id: { not: usuario.id } },
  });
  // Se não sobra nenhum, essa mudança deixaria o sistema sem administrador.
  if (outrosAdministradores === 0) {
    // 409 = conflito com a regra de negócio; sem "campo" porque a mensagem é geral.
    throw new AppError("Não é possível inativar nem alterar o perfil do último administrador ativo.", 409);
  }
}
