// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Mensagem de sessão inválida, a mesma que o middleware usa.
import { MENSAGEM_SESSAO_INVALIDA } from "../../middlewares/auth.middleware";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Monta o usuário no formato UsuarioInterno do contrato.
import { paraUsuarioInterno } from "../usuario/usuario.mapper";

// GET /interno/me — devolve o usuário dono do token.
// O header Authorization: Bearer <token> é lido e validado pelo middleware `autenticar` (aplicado em
// auth.routes.ts), que também confirma que o usuário existe e está ativo e deixa id e perfil em req.usuario;
// aqui só buscamos os dados completos do usuário para devolver.
export async function me(req: Request, res: Response) {
  // Segurança extra: se a rota for montada sem o middleware, req.usuario não existe.
  if (!req.usuario) {
    throw new AppError("Não autenticado.", 401);
  }

  // Busca o usuário pelo id que estava no token, sem trazer o senhaHash.
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, omit: { senhaHash: true } });

  // O middleware já barra usuário removido/inativo; esta checagem é uma rede de segurança (e satisfaz o TypeScript).
  if (!usuario || !usuario.ativo) {
    throw new AppError(MENSAGEM_SESSAO_INVALIDA, 401);
  }

  // Devolve o usuário atual (dados frescos do banco) no formato do contrato.
  res.json(paraUsuarioInterno(usuario));
}
