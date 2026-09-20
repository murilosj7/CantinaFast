// Tipos do Express usados pelo middleware.
import type { NextFunction, Request, Response } from "express";
// Biblioteca que confere a assinatura e a validade do token JWT.
import jwt from "jsonwebtoken";
// Enum de perfis do Prisma (ATENDENTE, CAIXA, ADMINISTRADOR), usado como tipo e como valor.
import { PerfilUsuario } from "@prisma/client";
// Segredo e algoritmo usados na conferência (os mesmos do login).
import { JWT_ALGORITMO, JWT_SECRET } from "../config/jwt";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "./errorHandler";

// Ensina o TypeScript que, depois deste middleware, a requisição passa a ter `req.usuario`.
declare global {
  namespace Express {
    interface Request {
      // Preenchido só nas rotas protegidas; nas públicas continua undefined.
      usuario?: { id: number; perfil: PerfilUsuario };
    }
  }
}

// Protege uma rota: exige "Authorization: Bearer <token>" válido e anexa req.usuario (id e perfil).
// Token ausente, malformado, adulterado ou expirado responde 401 no formato { mensagem }.
export function autenticar(req: Request, res: Response, next: NextFunction) {
  // Lê o cabeçalho Authorization (ex.: "Bearer eyJhbGciOi...").
  const cabecalho = req.headers.authorization;
  // Sem cabeçalho não há como saber quem é o usuário.
  if (!cabecalho) {
    throw new AppError("Token de autenticação não informado.", 401);
  }

  // Separa o cabeçalho em duas partes: o esquema ("Bearer") e o token.
  const [esquema, token, ...sobra] = cabecalho.split(" ");
  // Exige exatamente "Bearer <token>": esquema certo, token presente e nada além disso.
  if (esquema?.toLowerCase() !== "bearer" || !token || sobra.length > 0) {
    throw new AppError("Token de autenticação mal formatado. Use: Authorization: Bearer <token>.", 401);
  }

  // Resultado da conferência (texto ou objeto com os dados do token).
  let payload: string | jwt.JwtPayload;
  try {
    // Confere assinatura (com o nosso segredo), algoritmo permitido e prazo de validade.
    payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITMO] });
  } catch (erro) {
    // Token válido em formato, mas com o prazo vencido: mensagem própria para o frontend pedir novo login.
    if (erro instanceof jwt.TokenExpiredError) {
      throw new AppError("Sessão expirada. Faça login novamente.", 401);
    }
    // Qualquer outra falha (assinatura errada, token adulterado, lixo): inválido.
    throw new AppError("Token inválido.", 401);
  }

  // O payload precisa ser um objeto com id inteiro e um perfil que exista no enum.
  if (
    typeof payload !== "object" ||
    !Number.isInteger(payload.id) ||
    !Object.values(PerfilUsuario).includes(payload.perfil)
  ) {
    throw new AppError("Token inválido.", 401);
  }

  // Anexa quem está logado à requisição, para as rotas seguintes usarem.
  req.usuario = { id: payload.id, perfil: payload.perfil };
  // Libera a requisição para seguir para a rota.
  next();
}
