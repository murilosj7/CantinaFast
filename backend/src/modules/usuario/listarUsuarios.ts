// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo Prisma usado para descrever o filtro (where) da consulta.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// lerPerfil valida/converte o perfil; paraUsuarioInterno monta a resposta do contrato.
import { lerPerfil, paraUsuarioInterno } from "./usuario.mapper";

// GET /interno/usuarios?busca=texto&perfil=caixa&status=ativo|inativo
// Todos os filtros são opcionais e combinam entre si (AND). `busca` procura em nome e login.
export async function listarUsuarios(req: Request, res: Response) {
  // Os filtros vêm na URL (query string), depois do "?".
  const { busca, perfil, status } = req.query;
  // Começa sem nenhuma condição; vamos acrescentando conforme os filtros que vieram.
  const where: Prisma.UsuarioWhereInput = {};

  // Se veio um texto de busca não vazio...
  if (typeof busca === "string" && busca.trim() !== "") {
    // ...tira os espaços das pontas.
    const termo = busca.trim();
    // OR = basta o termo aparecer no nome OU no login.
    where.OR = [
      // "contains" = contém o texto; "insensitive" = não diferencia maiúsculas de minúsculas.
      { nome: { contains: termo, mode: "insensitive" } },
      { login: { contains: termo, mode: "insensitive" } },
    ];
  }

  // Se veio um perfil na URL...
  if (perfil !== undefined && perfil !== "") {
    // ...valida e converte para o enum (400 se for um perfil inexistente) e filtra por ele.
    where.perfil = lerPerfil(perfil);
  }

  // Se veio um status na URL...
  if (status !== undefined && status !== "") {
    // ...só aceitamos "ativo" ou "inativo".
    if (status !== "ativo" && status !== "inativo") {
      throw new AppError("Status inválido. Use: ativo ou inativo.", 400, "status");
    }
    // "ativo" vira ativo = true; "inativo" vira ativo = false.
    where.ativo = status === "ativo";
  }

  // Busca no banco os usuários que passam nos filtros.
  const usuarios = await prisma.usuario.findMany({
    // Aplica as condições montadas acima.
    where,
    // Ordena por nome, de A a Z.
    orderBy: { nome: "asc" },
    // Não traz o senhaHash.
    omit: { senhaHash: true },
  });

  // Converte cada usuário para o formato do contrato e responde com a lista.
  res.json(usuarios.map(paraUsuarioInterno));
}
