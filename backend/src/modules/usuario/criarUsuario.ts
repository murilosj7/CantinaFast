// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// bcrypt gera o "hash" da senha, para nunca guardar a senha em texto puro no banco.
import bcrypt from "bcrypt";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo) que o errorHandler transforma em resposta.
import { AppError } from "../../middlewares/errorHandler";
// lerPerfil traduz "administrador" -> ADMINISTRADOR; paraUsuarioInterno monta a resposta do contrato.
import { lerPerfil, paraUsuarioInterno } from "./usuario.mapper";

// POST /interno/usuarios — body: { nome, login, senha, perfil }
export async function criarUsuario(req: Request, res: Response) {
  // Pega os quatro campos do corpo da requisição (se não veio corpo, usa um objeto vazio).
  const { nome, login, senha, perfil } = req.body ?? {};

  // Nome: precisa ser texto, não pode ser vazio e cabe até 120 caracteres (limite da API).
  if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 120) {
    // Recusa com 400 e aponta o campo "nome" para o frontend.
    throw new AppError("Informe o nome (até 120 caracteres).", 400, "nome");
  }
  // Login: mesma regra do nome.
  if (typeof login !== "string" || login.trim() === "" || login.trim().length > 120) {
    throw new AppError("Informe o login (até 120 caracteres).", 400, "login");
  }
  // Senha: precisa ser texto com pelo menos 6 caracteres.
  if (typeof senha !== "string" || senha.length < 6) {
    throw new AppError("A senha deve ter pelo menos 6 caracteres.", 400, "senha");
  }
  // Perfil: valida e converte para o enum do banco (lança 400 se não for atendente/caixa/administrador).
  const perfilEnum = lerPerfil(perfil);

  // Login sem espaços nas pontas: é este valor que será comparado e gravado.
  const loginLimpo = login.trim();
  // Procura no banco se já existe alguém com esse login (login é único).
  const existente = await prisma.usuario.findUnique({ where: { login: loginLimpo } });
  // Se achou, não pode cadastrar de novo.
  if (existente) {
    // 409 = conflito; o campo "login" faz o frontend mostrar o erro embaixo do input de login.
    throw new AppError("Já existe um usuário com esse login.", 409, "login");
  }

  // Grava o novo usuário no banco.
  const usuario = await prisma.usuario.create({
    data: {
      // Nome sem espaços nas pontas.
      nome: nome.trim(),
      // Login já limpo.
      login: loginLimpo,
      // Transforma a senha em hash (o 10 é o "custo" do cálculo: quanto maior, mais lento e mais seguro).
      senhaHash: await bcrypt.hash(senha, 10),
      // Perfil já convertido para o enum.
      perfil: perfilEnum,
    },
    // Pede ao Prisma para NÃO trazer o senhaHash de volta, assim ele nunca vaza na resposta.
    omit: { senhaHash: true },
  });

  // Responde 201 (criado) com o usuário no formato do contrato (perfil em minúsculo, data em ISO).
  res.status(201).json(paraUsuarioInterno(usuario));
}
