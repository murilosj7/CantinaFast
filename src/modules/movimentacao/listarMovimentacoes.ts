// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo Prisma usado para descrever o filtro (where) da consulta.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Valida o id do produto vindo na URL.
import { parseId } from "../../utils/parseId";
// movimentacaoInclude carrega produto/usuário; paraMovimentacao monta a resposta.
import { movimentacaoInclude, paraMovimentacao } from "./movimentacao.mapper";

// GET /movimentacoes?produtoId=1 — rota protegida (qualquer perfil logado). Sem paginação (o frontend espera a lista inteira).
// `produtoId` é opcional: com ele, só as movimentações daquele produto (produto sem movimentação, ou inexistente, dá lista vazia).
// Ordem: a mais recente primeiro (em caso de mesmo instante, a de maior id).
export async function listarMovimentacoes(req: Request, res: Response) {
  // Os filtros vêm na URL (query string), depois do "?".
  const { produtoId } = req.query;
  // Começa sem nenhuma condição.
  const where: Prisma.MovimentacaoEstoqueWhereInput = {};

  // Filtro por produto: valida o id (400 se não for inteiro positivo) e filtra.
  if (produtoId !== undefined && produtoId !== "") {
    where.produtoId = parseId(produtoId, "produtoId");
  }

  // Busca no banco aplicando o filtro.
  const movimentacoes = await prisma.movimentacaoEstoque.findMany({
    where,
    // Traz produto e usuário junto (nome de cada um).
    include: movimentacaoInclude,
    // Mais recente primeiro; o id desempata movimentações gravadas no mesmo instante.
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
  });

  // Converte cada movimentação para o formato da resposta.
  res.json(movimentacoes.map(paraMovimentacao));
}
