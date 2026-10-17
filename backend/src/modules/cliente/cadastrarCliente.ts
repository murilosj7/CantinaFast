// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// bcrypt gera o hash da senha (a senha nunca é guardada em texto).
import bcrypt from "bcrypt";
// Prisma: o erro conhecido do banco (P2002 = valor único repetido).
import { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Gera o token do cliente (tipo "cliente", aud "cliente").
import { assinarTokenCliente } from "../../config/jwt";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Seleção segura de campos e montagem da resposta no formato do site.
import { clienteSelect, paraClienteSite } from "./cliente.mapper";

// Formato simples de e-mail: algo@algo.algo, sem espaços. Não tenta cobrir toda a RFC.
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// O bcrypt só usa os primeiros 72 BYTES da senha (o resto é ignorado em silêncio); por isso o limite é em bytes, não em caracteres.
const MAX_BYTES_SENHA = 72;

// POST /clientes/cadastro — body: { nome, telefone?, email, senha }
// Cria a conta do cliente do site e já devolve o token (201), como o login. A unicidade do e-mail é do banco.
export async function cadastrarCliente(req: Request, res: Response) {
  // `?? {}` evita erro quando a requisição vem sem corpo.
  const { nome, telefone, email, senha } = req.body ?? {};

  // Nome obrigatório, texto, até 120 caracteres (aparado).
  if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 120) {
    throw new AppError("Informe o nome (até 120 caracteres).", 400, "nome");
  }

  // E-mail obrigatório, texto, em formato simples e até 160 caracteres.
  if (typeof email !== "string" || email.trim() === "") {
    throw new AppError("Informe o e-mail.", 400, "email");
  }
  // Aparado e em minúsculas: "Ana@Escola.com" e "ana@escola.com" são a mesma conta.
  const emailLimpo = email.trim().toLowerCase();
  if (emailLimpo.length > 160 || !FORMATO_EMAIL.test(emailLimpo)) {
    throw new AppError("Informe um e-mail válido (até 160 caracteres).", 400, "email");
  }

  // Senha: texto com pelo menos 6 caracteres...
  if (typeof senha !== "string" || senha.length < 6) {
    throw new AppError("A senha deve ter pelo menos 6 caracteres.", 400, "senha");
  }
  // ...e no máximo 72 bytes (limite real do bcrypt; acentos e emojis ocupam mais de 1 byte).
  if (Buffer.byteLength(senha, "utf8") > MAX_BYTES_SENHA) {
    throw new AppError(`A senha deve ter no máximo ${MAX_BYTES_SENHA} bytes (acentos e emojis ocupam mais de 1).`, 400, "senha");
  }

  // Telefone é opcional: ausente, null ou texto vazio viram null.
  let telefoneLimpo: string | null = null;
  if (telefone !== undefined && telefone !== null) {
    if (typeof telefone !== "string") {
      throw new AppError("O telefone deve ser um texto (até 20 caracteres).", 400, "telefone");
    }
    // Aparado; vazio vira null.
    const aparado = telefone.trim();
    if (aparado.length > 20) {
      throw new AppError("O telefone aceita no máximo 20 caracteres.", 400, "telefone");
    }
    telefoneLimpo = aparado === "" ? null : aparado;
  }

  // Gera o hash da senha (custo 10, o mesmo dos usuários internos).
  const senhaHash = await bcrypt.hash(senha, 10);

  try {
    // Cria o cliente. Sem pré-checagem de e-mail: a checagem e o cadastro seriam duas operações separadas e dois
    // cadastros simultâneos poderiam passar juntos; a constraint UNIQUE do banco decide, de forma atômica.
    const cliente = await prisma.cliente.create({
      data: { nome: nome.trim(), email: emailLimpo, telefone: telefoneLimpo, senhaHash },
      // Só os campos públicos (nunca senhaHash nem loginGoogle).
      select: clienteSelect,
    });
    // 201 com o cliente no formato do site e o token de login.
    res.status(201).json({ usuario: paraClienteSite(cliente), token: assinarTokenCliente(cliente.id) });
  } catch (erro) {
    // P2002 = violação de campo único: o e-mail já está cadastrado (a unicidade é só do e-mail neste create).
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      throw new AppError("Já existe um cadastro com esse e-mail.", 409, "email");
    }
    // Qualquer outro erro segue para o errorHandler.
    throw erro;
  }
}
