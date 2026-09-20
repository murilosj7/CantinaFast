// Tipos do Express usados pelos middlewares.
import type { NextFunction, Request, Response } from "express";
// Biblioteca que confere a assinatura e a validade do token JWT.
import jwt from "jsonwebtoken";
// Enum de perfis do Prisma (ATENDENTE, CAIXA, ADMINISTRADOR), usado como tipo e como valor.
import { PerfilUsuario } from "@prisma/client";
// Instância única do Prisma: o middleware consulta o banco para confirmar que o usuário ainda está ativo.
import { prisma } from "../config/prisma";
// Segredo e algoritmo usados na conferência (os mesmos do login).
import { JWT_ALGORITMO, JWT_SECRET } from "../config/jwt";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "./errorHandler";

// Mensagem de token de usuário que não existe mais ou foi inativado; a rota /interno/me usa a mesma.
export const MENSAGEM_SESSAO_INVALIDA = "Sessão inválida. Faça login novamente.";

// Ensina o TypeScript que, depois deste middleware, a requisição passa a ter `req.usuario`.
declare global {
  namespace Express {
    interface Request {
      // Preenchido só nas rotas protegidas; nas públicas continua undefined.
      usuario?: { id: number; perfil: PerfilUsuario };
    }
  }
}

// Protege uma rota: exige "Authorization: Bearer <token>" válido, de um usuário que ainda existe e está ativo,
// e anexa req.usuario (id e perfil). Qualquer falha responde 401 no formato { mensagem }.
export async function autenticar(req: Request, res: Response, next: NextFunction) {
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

  // Confirma no banco quem é o dono do token AGORA (o token pode ter sido emitido horas atrás).
  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.id },
    // Só precisamos destes três campos.
    select: { id: true, perfil: true, ativo: true },
  });
  // Usuário removido ou inativado depois do login: o token deixa de valer na hora.
  if (!usuario || !usuario.ativo) {
    throw new AppError(MENSAGEM_SESSAO_INVALIDA, 401);
  }

  // Anexa quem está logado à requisição. O perfil vem do BANCO (não do token), para que uma mudança
  // de perfil (ex.: administrador rebaixado) valha imediatamente, sem esperar o token expirar.
  req.usuario = { id: usuario.id, perfil: usuario.perfil };
  // Libera a requisição para seguir para a rota.
  next();
}

// Restringe uma rota a certos perfis. Use SEMPRE depois de `autenticar`:
//   router.post("/", autenticar, exigirPerfil(PerfilUsuario.ADMINISTRADOR), criarUsuario)
// Perfil sem permissão responde 403 no formato { mensagem }.
export function exigirPerfil(...perfisPermitidos: PerfilUsuario[]) {
  // Devolve o middleware de fato, já "sabendo" quais perfis podem passar.
  return (req: Request, res: Response, next: NextFunction) => {
    // Se `autenticar` não rodou antes, não sabemos quem é o usuário: trata como não autenticado.
    if (!req.usuario) {
      throw new AppError("Não autenticado.", 401);
    }
    // Perfil do usuário logado fora da lista permitida: 403 (autenticado, mas sem permissão).
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      throw new AppError("Você não tem permissão para realizar esta ação.", 403);
    }
    // Perfil permitido: libera a requisição para seguir para a rota.
    next();
  };
}
