// Tipos do Express usados pelos middlewares.
import type { NextFunction, Request, Response } from "express";
// Biblioteca que confere a assinatura e a validade do token JWT.
import jwt from "jsonwebtoken";
// Enum de perfis do Prisma (ATENDENTE, CAIXA, ADMINISTRADOR), usado como tipo e como valor.
import { PerfilUsuario } from "@prisma/client";
// Instância única do Prisma: os middlewares consultam o banco para confirmar que o dono do token ainda está ativo.
import { prisma } from "../config/prisma";
// Segredo e algoritmo usados na conferência (os mesmos do login) e os valores de tipo/aud dos dois lados.
import { AUD_CLIENTE, AUD_INTERNO, JWT_ALGORITMO, JWT_SECRET, TIPO_CLIENTE, TIPO_USUARIO } from "../config/jwt";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "./errorHandler";

// Mensagem de token de usuário/cliente que não existe mais ou foi inativado; a rota /interno/me usa a mesma.
export const MENSAGEM_SESSAO_INVALIDA = "Sessão inválida. Faça login novamente.";
// Mensagem de token válido, mas do lado errado (cliente em rota interna ou usuário interno em rota de cliente).
// É a mesma do exigirPerfil: o token é legítimo, só não tem permissão para esta rota.
export const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";

// Ensina o TypeScript que, depois destes middlewares, a requisição passa a ter `req.usuario` ou `req.cliente`.
declare global {
  namespace Express {
    interface Request {
      // Preenchido só nas rotas internas protegidas (autenticar); nas demais continua undefined.
      usuario?: { id: number; perfil: PerfilUsuario };
      // Preenchido só nas rotas protegidas do cliente (autenticarCliente); nas demais continua undefined.
      cliente?: { id: number };
    }
  }
}

// Passos comuns aos dois lados: lê o cabeçalho Authorization e confere assinatura, algoritmo e validade do token.
// Devolve o payload (objeto). Qualquer falha responde 401 no formato { mensagem }. Ainda NÃO consulta o banco.
function lerPayload(req: Request): jwt.JwtPayload {
  // Lê o cabeçalho Authorization (ex.: "Bearer eyJhbGciOi...").
  const cabecalho = req.headers.authorization;
  // Sem cabeçalho não há como saber quem é o dono do token.
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
    // Confere assinatura (com o nosso segredo), algoritmo permitido e prazo de validade. A audiência NÃO é conferida
    // aqui (opção `audience`): ela devolveria 401 onde queremos 403; tipo e aud são conferidos à mão em conferirLado.
    payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITMO] });
  } catch (erro) {
    // Token válido em formato, mas com o prazo vencido: mensagem própria para o frontend pedir novo login.
    if (erro instanceof jwt.TokenExpiredError) {
      throw new AppError("Sessão expirada. Faça login novamente.", 401);
    }
    // Qualquer outra falha (assinatura errada, token adulterado, lixo): inválido.
    throw new AppError("Token inválido.", 401);
  }

  // O payload precisa ser um objeto (um token assinado com texto puro não serve).
  if (typeof payload !== "object") {
    throw new AppError("Token inválido.", 401);
  }
  return payload;
}

// Confere `tipo` e `aud` do payload ANTES de qualquer consulta ao banco.
//  - tipo ausente/desconhecido, ou aud que não combina com o tipo → 401 "Token inválido." (token que não emitimos);
//  - tipo válido, mas de outro lado que o da rota → 403 (token legítimo, sem permissão para esta rota).
function conferirLado(payload: jwt.JwtPayload, tipoEsperado: typeof TIPO_USUARIO | typeof TIPO_CLIENTE) {
  // Cada tipo só combina com a sua audiência: usuario ↔ interno, cliente ↔ cliente.
  const audienciaDoTipo = payload.tipo === TIPO_USUARIO ? AUD_INTERNO : payload.tipo === TIPO_CLIENTE ? AUD_CLIENTE : undefined;
  // Tipo desconhecido/ausente ou aud incoerente (ex.: tipo "usuario" com aud "cliente"): token inválido.
  if (audienciaDoTipo === undefined || payload.aud !== audienciaDoTipo) {
    throw new AppError("Token inválido.", 401);
  }
  // Token legítimo do outro lado: cliente numa rota interna ou usuário interno numa rota de cliente.
  if (payload.tipo !== tipoEsperado) {
    throw new AppError(MENSAGEM_SEM_PERMISSAO, 403);
  }
}

// Protege uma rota INTERNA: exige "Authorization: Bearer <token>" válido, de um usuário que ainda existe e está ativo,
// e anexa req.usuario (id e perfil). Falhas de token respondem 401; token de cliente responde 403.
export async function autenticar(req: Request, res: Response, next: NextFunction) {
  // 1º) cabeçalho, assinatura, algoritmo e validade.
  const payload = lerPayload(req);
  // 2º) tipo e aud, antes de tocar no banco: token de cliente → 403; tipo/aud estranhos → 401.
  conferirLado(payload, TIPO_USUARIO);

  // 3º) o payload do usuário precisa trazer um id inteiro e um perfil que exista no enum.
  if (!Number.isInteger(payload.id) || !Object.values(PerfilUsuario).includes(payload.perfil)) {
    throw new AppError("Token inválido.", 401);
  }

  // 4º) confirma no banco quem é o dono do token AGORA (o token pode ter sido emitido horas atrás).
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

// Protege uma rota do CLIENTE do site: mesmo caminho do `autenticar`, mas o token tem de ser de cliente e a consulta
// vai para a tabela clientes. Anexa req.cliente (id). Token de usuário interno responde 403.
export async function autenticarCliente(req: Request, res: Response, next: NextFunction) {
  // 1º) cabeçalho, assinatura, algoritmo e validade.
  const payload = lerPayload(req);
  // 2º) tipo e aud, antes de tocar no banco: token de usuário interno → 403; tipo/aud estranhos → 401.
  conferirLado(payload, TIPO_CLIENTE);

  // 3º) o payload do cliente precisa trazer um id inteiro.
  if (!Number.isInteger(payload.id)) {
    throw new AppError("Token inválido.", 401);
  }

  // 4º) confirma no banco que o cliente ainda existe e está ativo.
  const cliente = await prisma.cliente.findUnique({
    where: { id: payload.id },
    // Só precisamos destes dois campos.
    select: { id: true, ativo: true },
  });
  // Cliente removido ou inativado depois do login: o token deixa de valer na hora.
  if (!cliente || !cliente.ativo) {
    throw new AppError(MENSAGEM_SESSAO_INVALIDA, 401);
  }

  // Anexa o cliente logado à requisição.
  req.cliente = { id: cliente.id };
  // Libera a requisição para seguir para a rota.
  next();
}

// Restringe uma rota a certos perfis. Use SEMPRE depois de `autenticar`:
//   router.post("/", autenticar, exigirPerfil(PerfilUsuario.ADMINISTRADOR), criarUsuario)
// Perfil sem permissão responde 403 no formato { mensagem }.
export function exigirPerfil(...perfisPermitidos: PerfilUsuario[]) {
  // Devolve o middleware de fato, já "sabendo" quais perfis podem passar.
  const middleware = (req: Request, res: Response, next: NextFunction) => {
    // Se `autenticar` não rodou antes, não sabemos quem é o usuário: trata como não autenticado.
    if (!req.usuario) {
      throw new AppError("Não autenticado.", 401);
    }
    // Perfil do usuário logado fora da lista permitida: 403 (autenticado, mas sem permissão).
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      throw new AppError(MENSAGEM_SEM_PERMISSAO, 403);
    }
    // Perfil permitido: libera a requisição para seguir para a rota.
    next();
  };
  // Expõe a lista de perfis na função: o teste guardião (tests/teste-permissoes.cjs) lê daqui a regra de cada rota registrada.
  return Object.assign(middleware, { perfisPermitidos });
}
