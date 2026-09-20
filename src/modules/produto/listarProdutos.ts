// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo Prisma usado para descrever o filtro (where) da consulta.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id da categoria vindo na URL.
import { parseId } from "../../utils/parseId";
// produtoInclude carrega categoria/estoque; paraProduto monta a resposta do contrato.
import { paraProduto, produtoInclude } from "./produto.mapper";

// GET /produtos?categoriaId=1&busca=texto&canal=online|presencial&status=ativo|inativo|todos
// Todos os filtros são opcionais e combinam entre si (AND). `busca` procura no nome e no código de barras.
// Sem `status`, devolve só os ATIVOS (é o que o catálogo do Site Cliente espera); o admin passa status=todos.
// `canal=online` (contrato 2.2) esconde produtos com disponivelOnline=false; `canal=presencial` faz o
// equivalente com disponivelPresencial, para o PDV.
export async function listarProdutos(req: Request, res: Response) {
  // Os filtros vêm na URL (query string), depois do "?".
  const { categoriaId, busca, canal, status } = req.query;
  // Começa sem nenhuma condição; vamos acrescentando conforme os filtros.
  const where: Prisma.ProdutoWhereInput = {};

  // Filtro por categoria: valida o id e filtra os produtos daquela categoria.
  if (categoriaId !== undefined && categoriaId !== "") {
    where.categoriaId = parseId(categoriaId, "categoriaId");
  }

  // Filtro de busca por texto.
  if (typeof busca === "string" && busca.trim() !== "") {
    // Texto sem espaços nas pontas.
    const termo = busca.trim();
    // OR = basta aparecer no nome OU no código de barras (sem diferenciar maiúsculas).
    where.OR = [
      { nome: { contains: termo, mode: "insensitive" } },
      { codigoBarras: { contains: termo, mode: "insensitive" } },
    ];
  }

  // Filtro por canal de venda.
  if (canal !== undefined && canal !== "") {
    // "online": só produtos liberados para o site.
    if (canal === "online") {
      where.disponivelOnline = true;
    // "presencial": só produtos liberados para o PDV.
    } else if (canal === "presencial") {
      where.disponivelPresencial = true;
    // Qualquer outro valor é inválido.
    } else {
      throw new AppError("Canal inválido. Use: online ou presencial.", 400, "canal");
    }
  }

  // Sem status (ou "ativo"): mostra só os ativos — é o padrão do catálogo.
  if (status === undefined || status === "" || status === "ativo") {
    where.ativo = true;
  // "inativo": mostra só os inativos.
  } else if (status === "inativo") {
    where.ativo = false;
  // Qualquer valor que não seja "todos" é inválido ("todos" simplesmente não filtra por ativo).
  } else if (status !== "todos") {
    throw new AppError("Status inválido. Use: ativo, inativo ou todos.", 400, "status");
  }

  // Busca no banco aplicando os filtros.
  const produtos = await prisma.produto.findMany({
    // Condições montadas acima.
    where,
    // Traz categoria e estoque junto, para montar categoriaNome e quantidadeDisponivel.
    include: produtoInclude,
    // Ordena por nome, de A a Z.
    orderBy: { nome: "asc" },
  });

  // Converte cada produto para o formato do contrato e responde com a lista.
  res.json(produtos.map(paraProduto));
}
