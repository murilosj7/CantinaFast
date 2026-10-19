// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";
// Regra de negócio: impede tirar o último administrador ativo.
import { garantirUltimoAdministrador, travarAdministradoresAtivos } from "./garantirUltimoAdministrador";
// Monta a resposta do usuário no formato do contrato.
import { paraUsuarioInterno } from "./usuario.mapper";

// PATCH /interno/usuarios/:id/inativar — usuário nunca é deletado, só marcado como inativo.
// Atalho dedicado: o frontend também consegue inativar via PATCH /interno/usuarios/:id { ativo: false }
// (atualizarUsuario), e as duas rotas aplicam a mesma regra do último administrador.
export async function inativarUsuario(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);

  // Checagem rápida de existência (404) sem abrir transação. NÃO serve para decidir a regra do administrador:
  // esse estado pode estar velho quando a transação começar.
  const existente = await prisma.usuario.findUnique({ where: { id }, select: { id: true } });
  // Se não existe, 404.
  if (!existente) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  // Tudo numa transação: travar, reler, conferir a regra e gravar. Sempre trava, porque a leitura de fora
  // pode estar velha (ex.: o alvo virou administrador por outra requisição no meio do caminho).
  const inativado = await prisma.$transaction(async (tx) => {
    // 1º) trava os administradores ativos (ordem fixa de id). Nunca travar o alvo antes disso (risco de deadlock).
    await travarAdministradoresAtivos(tx);
    // 2º) relê o alvo já com a trava: este é o estado que vale para decidir.
    const usuario = await tx.usuario.findUnique({ where: { id } });
    if (!usuario) {
      throw new AppError("Usuário não encontrado.", 404);
    }
    // Se ele for o último administrador ativo, essa função lança 409 e a inativação é barrada.
    await garantirUltimoAdministrador(tx, usuario, { perfil: usuario.perfil, ativo: false });
    // Marca como inativo (ativo = false) em vez de apagar o registro.
    return tx.usuario.update({
      where: { id },
      data: { ativo: false },
      // Não traz o senhaHash.
      omit: { senhaHash: true },
    });
  });

  // Devolve o usuário já inativado no formato do contrato.
  res.json(paraUsuarioInterno(inativado));
}
