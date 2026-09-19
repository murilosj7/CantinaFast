import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";
import { lerPerfil, paraUsuarioInterno } from "./usuario.mapper";

// POST /interno/usuarios — body: { nome, login, senha, perfil }
export async function criarUsuario(req: Request, res: Response) {
  const { nome, login, senha, perfil } = req.body ?? {};

  if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 120) {
    throw new AppError("Informe o nome (até 120 caracteres).", 400, "nome");
  }
  if (typeof login !== "string" || login.trim() === "" || login.trim().length > 120) {
    throw new AppError("Informe o login (até 120 caracteres).", 400, "login");
  }
  if (typeof senha !== "string" || senha.length < 6) {
    throw new AppError("A senha deve ter pelo menos 6 caracteres.", 400, "senha");
  }
  const perfilEnum = lerPerfil(perfil);

  const loginLimpo = login.trim();
  const existente = await prisma.usuario.findUnique({ where: { login: loginLimpo } });
  if (existente) {
    throw new AppError("Já existe um usuário com esse login.", 409, "login");
  }

  const usuario = await prisma.usuario.create({
    data: {
      nome: nome.trim(),
      login: loginLimpo,
      senhaHash: await bcrypt.hash(senha, 10),
      perfil: perfilEnum,
    },
    omit: { senhaHash: true },
  });

  res.status(201).json(paraUsuarioInterno(usuario));
}
