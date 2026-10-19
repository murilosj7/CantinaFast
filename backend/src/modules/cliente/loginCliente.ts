// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// bcrypt confere a senha digitada contra o hash guardado no banco.
import bcrypt from "bcrypt";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Gera o token do cliente (tipo "cliente", aud "cliente").
import { assinarTokenCliente } from "../../config/jwt";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Montagem da resposta no formato do site.
import { paraClienteSite } from "./cliente.mapper";

// Mensagem ÚNICA para qualquer falha de login: não revela se o e-mail existe, se a conta está inativa
// ou se ela nem tem senha (conta só do Google).
const MENSAGEM_LOGIN_INVALIDO = "E-mail ou senha inválidos.";

// Hash "de mentira", calculado uma vez na inicialização. Quando o login não pode ser verificado de verdade, comparamos
// a senha com ele só para gastar o mesmo tempo do bcrypt; assim o tempo de resposta não denuncia o motivo da falha.
const HASH_FALSO = bcrypt.hashSync("hash-falso-para-igualar-o-tempo-de-resposta", 10);

// POST /clientes/login — body: { email, senha } → 200 { usuario, token }
export async function loginCliente(req: Request, res: Response) {
  // `?? {}` evita erro quando a requisição vem sem corpo.
  const { email, senha } = req.body ?? {};

  // Os dois campos precisam ser texto não vazio; senão é erro de formato (400), não de credencial.
  if (typeof email !== "string" || typeof senha !== "string" || email.trim() === "" || senha === "") {
    throw new AppError("Informe e-mail e senha.", 400);
  }

  // O cadastro guarda o e-mail em minúsculas; o login faz o mesmo para não importar como o cliente digitou.
  const cliente = await prisma.cliente.findUnique({ where: { email: email.trim().toLowerCase() } });

  // Compara a senha com o hash do cliente; se não há hash (e-mail inexistente ou conta sem senha), compara com o falso.
  const senhaConfere = await bcrypt.compare(senha, cliente?.senhaHash ?? HASH_FALSO);

  // Falha se o cliente não existe, está inativo, não tem senha ou a senha não bate — sempre com a MESMA resposta 401.
  if (!cliente || !cliente.ativo || !cliente.senhaHash || !senhaConfere) {
    throw new AppError(MENSAGEM_LOGIN_INVALIDO, 401);
  }

  // Responde 200 com o cliente no formato do site (campo a campo, então senhaHash e loginGoogle nunca vazam) e o token.
  res.json({ usuario: paraClienteSite(cliente), token: assinarTokenCliente(cliente.id) });
}
