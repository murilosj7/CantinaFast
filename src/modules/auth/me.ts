// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Monta o usuário no formato UsuarioInterno do contrato.
import { paraUsuarioInterno } from "../usuario/usuario.mapper";

// GET /interno/me — devolve o usuário dono do token.
// O header Authorization: Bearer <token> é lido e validado pelo middleware `autenticar` (aplicado em
// auth.routes.ts), que deixa o id e o perfil em req.usuario; aqui só buscamos o usuário atual no banco.
export async function me(req: Request, res: Response) {
  // Segurança extra: se a rota for montada sem o middleware, req.usuario não existe.
  if (!req.usuario) {
    throw new AppError("Não autenticado.", 401);
  }

  // Busca o usuário pelo id que estava no token, sem trazer o senhaHash.
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, omit: { senhaHash: true } });

  // Token de alguém que foi removido ou inativado depois do login não vale mais (contrato: inativo não autentica).
  if (!usuario || !usuario.ativo) {
    throw new AppError("Sessão inválida. Faça login novamente.", 401);
  }

  // Devolve o usuário atual (dados frescos do banco) no formato do contrato.
  res.json(paraUsuarioInterno(usuario));
}
