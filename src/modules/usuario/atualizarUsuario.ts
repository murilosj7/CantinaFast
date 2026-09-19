import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../middlewares/errorHandler";
import { parseId } from "../../utils/parseId";
import { garantirUltimoAdministrador } from "./garantirUltimoAdministrador";
import { lerPerfil, paraUsuarioInterno } from "./usuario.mapper";

// PATCH /interno/usuarios/:id — body com qualquer combinação de: { nome, senha, perfil, ativo }
// Segue o contrato do frontend: `ativo` também passa por aqui (false = inativar, true = reativar).
// O login não é editável.
export async function atualizarUsuario(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const { nome, senha, perfil, ativo } = req.body ?? {};

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  const data: Prisma.UsuarioUpdateInput = {};

  if (nome !== undefined) {
    if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 120) {
      throw new AppError("Informe o nome (até 120 caracteres).", 400, "nome");
    }
    data.nome = nome.trim();
  }

  if (senha !== undefined) {
    if (typeof senha !== "string" || senha.length < 6) {
      throw new AppError("A senha deve ter pelo menos 6 caracteres.", 400, "senha");
    }
    data.senhaHash = await bcrypt.hash(senha, 10);
  }

  if (perfil !== undefined) {
    data.perfil = lerPerfil(perfil);
  }

  if (ativo !== undefined) {
    if (typeof ativo !== "boolean") {
      throw new AppError("O campo 'ativo' deve ser verdadeiro ou falso.", 400, "ativo");
    }
    data.ativo = ativo;
  }

  if (Object.keys(data).length === 0) {
    throw new AppError("Informe ao menos um campo para atualizar: nome, senha, perfil ou ativo.");
  }

  await garantirUltimoAdministrador(usuario, {
    perfil: (data.perfil as typeof usuario.perfil | undefined) ?? usuario.perfil,
    ativo: (data.ativo as boolean | undefined) ?? usuario.ativo,
  });

  const atualizado = await prisma.usuario.update({ where: { id }, data, omit: { senhaHash: true } });
  res.json(paraUsuarioInterno(atualizado));
}
