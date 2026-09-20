// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// bcrypt confere a senha digitada contra o hash guardado no banco.
import bcrypt from "bcrypt";
// jsonwebtoken gera (assina) o token JWT.
import jwt from "jsonwebtoken";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Segredo, algoritmo e validade do token (vêm do .env / config).
import { JWT_ALGORITMO, JWT_EXPIRA_EM, JWT_SECRET } from "../../config/jwt";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Monta o usuário no formato UsuarioInterno do contrato (sem senhaHash).
import { paraUsuarioInterno } from "../usuario/usuario.mapper";

// Mensagem ÚNICA para qualquer falha de login: não revela se o erro foi o login, a senha ou o usuário inativo.
const MENSAGEM_LOGIN_INVALIDO = "Login ou senha inválidos.";

// Hash "de mentira", calculado uma vez na inicialização. Quando o login não existe, comparamos a senha
// com ele só para gastar o mesmo tempo do bcrypt; assim o tempo de resposta não denuncia se o login existe.
const HASH_FALSO = bcrypt.hashSync("hash-falso-para-igualar-o-tempo-de-resposta", 10);

// POST /interno/login — body: { login, senha } — resposta: { usuario, token }
export async function login(req: Request, res: Response) {
  // Pega login e senha do corpo da requisição (se não veio corpo, usa um objeto vazio).
  const { login: loginDigitado, senha } = req.body ?? {};

  // Os dois campos precisam existir e ser texto; senão o pedido está malformado (400, sem dizer mais nada).
  if (typeof loginDigitado !== "string" || typeof senha !== "string" || loginDigitado.trim() === "" || senha === "") {
    throw new AppError("Informe login e senha.", 400);
  }

  // Procura o usuário pelo login (sem espaços nas pontas, como foi gravado no cadastro). Aqui precisamos do senhaHash.
  const usuario = await prisma.usuario.findUnique({ where: { login: loginDigitado.trim() } });

  // Compara a senha com o hash do usuário; se ele não existe, compara com o hash falso (mesmo custo de tempo).
  const senhaConfere = await bcrypt.compare(senha, usuario?.senhaHash ?? HASH_FALSO);

  // Falha se o usuário não existe, se está inativo ou se a senha não bate — sempre com a MESMA resposta 401.
  if (!usuario || !usuario.ativo || !senhaConfere) {
    throw new AppError(MENSAGEM_LOGIN_INVALIDO, 401);
  }

  // Gera o token JWT com id e perfil no payload, assinado com o segredo e com prazo de validade.
  const token = jwt.sign({ id: usuario.id, perfil: usuario.perfil }, JWT_SECRET, {
    // Algoritmo de assinatura.
    algorithm: JWT_ALGORITMO,
    // Depois desse prazo o token deixa de valer.
    expiresIn: JWT_EXPIRA_EM,
  });

  // Responde 200 com o usuário no formato do contrato (paraUsuarioInterno escolhe campo a campo, então o senhaHash nunca vaza) e o token.
  res.json({ usuario: paraUsuarioInterno(usuario), token });
}
