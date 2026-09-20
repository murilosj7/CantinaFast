// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// bcrypt gera o hash da nova senha, caso ela seja alterada.
import bcrypt from "bcrypt";
// Tipo Prisma que descreve os campos que podem ser atualizados num usuário.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";
// Regra de negócio: impede tirar o último administrador ativo.
import { garantirUltimoAdministrador } from "./garantirUltimoAdministrador";
// lerPerfil valida/converte o perfil; paraUsuarioInterno monta a resposta do contrato.
import { lerPerfil, paraUsuarioInterno } from "./usuario.mapper";

// PATCH /interno/usuarios/:id — body com qualquer combinação de: { nome, senha, perfil, ativo }
// Segue o contrato do frontend: `ativo` também passa por aqui (false = inativar, true = reativar).
// O login não é editável.
export async function atualizarUsuario(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);
  // Pega só os campos que podem ser alterados (login fica de fora de propósito).
  const { nome, senha, perfil, ativo } = req.body ?? {};

  // Busca o usuário atual no banco (precisamos do estado antigo para aplicar as regras).
  const usuario = await prisma.usuario.findUnique({ where: { id } });
  // Se não existe, 404.
  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  // Objeto onde vamos juntar SÓ os campos que realmente serão atualizados.
  const data: Prisma.UsuarioUpdateInput = {};

  // Se o nome veio no corpo...
  if (nome !== undefined) {
    // ...valida (texto, não vazio, até 120 caracteres).
    if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 120) {
      throw new AppError("Informe o nome (até 120 caracteres).", 400, "nome");
    }
    // Guarda o nome limpo para gravar.
    data.nome = nome.trim();
  }

  // Se a senha veio no corpo...
  if (senha !== undefined) {
    // ...valida (texto com pelo menos 6 caracteres).
    if (typeof senha !== "string" || senha.length < 6) {
      throw new AppError("A senha deve ter pelo menos 6 caracteres.", 400, "senha");
    }
    // Grava o HASH da senha nova, nunca a senha em texto.
    data.senhaHash = await bcrypt.hash(senha, 10);
  }

  // Se o perfil veio no corpo...
  if (perfil !== undefined) {
    // ...valida e converte para o enum.
    data.perfil = lerPerfil(perfil);
  }

  // Se o campo ativo veio no corpo...
  if (ativo !== undefined) {
    // ...precisa ser verdadeiro ou falso de verdade (não texto).
    if (typeof ativo !== "boolean") {
      throw new AppError("O campo 'ativo' deve ser verdadeiro ou falso.", 400, "ativo");
    }
    // false inativa o usuário, true reativa.
    data.ativo = ativo;
  }

  // Se nenhum campo válido foi enviado, não há o que atualizar.
  if (Object.keys(data).length === 0) {
    throw new AppError("Informe ao menos um campo para atualizar: nome, senha, perfil ou ativo.");
  }

  // Confere a regra do último administrador comparando o estado ANTES com o estado DEPOIS da mudança.
  await garantirUltimoAdministrador(usuario, {
    // Perfil final: o novo (se veio) ou o que já era.
    perfil: (data.perfil as typeof usuario.perfil | undefined) ?? usuario.perfil,
    // Ativo final: o novo (se veio) ou o que já era.
    ativo: (data.ativo as boolean | undefined) ?? usuario.ativo,
  });

  // Aplica a atualização no banco, sem trazer o senhaHash.
  const atualizado = await prisma.usuario.update({ where: { id }, data, omit: { senhaHash: true } });
  // Devolve o usuário já atualizado no formato do contrato.
  res.json(paraUsuarioInterno(atualizado));
}
