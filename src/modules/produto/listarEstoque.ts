// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo Prisma usado para descrever o filtro (where) da consulta.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// saldoSelect carrega o que o saldo precisa; paraSaldoEstoque monta a linha da tela de Saldos.
import { paraSaldoEstoque, saldoSelect } from "./estoque.mapper";

// Lê o filtro somenteBaixoOuZerado da URL: só aceita "true" ou "false" (sem diferenciar maiúsculas); ausente/vazio = false.
function lerSomenteBaixoOuZerado(valor: unknown): boolean {
  if (valor === undefined || valor === "") return false;
  const texto = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (texto === "true") return true;
  if (texto === "false") return false;
  throw new AppError("O campo 'somenteBaixoOuZerado' deve ser true ou false.", 400, "somenteBaixoOuZerado");
}

// GET /estoque?busca=texto&somenteBaixoOuZerado=true&status=ativo|inativo|todos — rota protegida (qualquer perfil logado).
// Lista o saldo de estoque de cada produto para a tela de "Saldos". Os filtros são opcionais e combinam entre si (AND).
//  - busca: procura no nome e no código de barras (sem diferenciar maiúsculas), igual ao GET /produtos.
//  - somenteBaixoOuZerado=true: só produtos com situacao "baixo" ou "zerado" (o checkbox "Só estoque baixo ou zerado").
//  - status: sem ele, só produtos ATIVOS (produto inativo não é vendido, então não deve poluir o painel de reposição);
//    "inativo" e "todos" existem para o admin.
// Produto antigo sem linha em `estoque` NÃO some da lista: aparece com tudo zerado (situacao "zerado").
export async function listarEstoque(req: Request, res: Response) {
  // Os filtros vêm na URL (query string), depois do "?".
  const { busca, somenteBaixoOuZerado, status } = req.query;
  // Valida o checkbox antes de consultar o banco.
  const apenasCriticos = lerSomenteBaixoOuZerado(somenteBaixoOuZerado);
  // Começa sem nenhuma condição; vamos acrescentando conforme os filtros.
  const where: Prisma.ProdutoWhereInput = {};

  // Filtro de busca por texto.
  if (typeof busca === "string" && busca.trim() !== "") {
    // Texto sem espaços nas pontas.
    const termo = busca.trim();
    // OR = basta aparecer no nome OU no código de barras.
    where.OR = [
      { nome: { contains: termo, mode: "insensitive" } },
      { codigoBarras: { contains: termo, mode: "insensitive" } },
    ];
  }

  // Sem status (ou "ativo"): só os ativos.
  if (status === undefined || status === "" || status === "ativo") {
    where.ativo = true;
  // "inativo": só os inativos.
  } else if (status === "inativo") {
    where.ativo = false;
  // Qualquer valor que não seja "todos" é inválido ("todos" simplesmente não filtra por ativo).
  } else if (status !== "todos") {
    throw new AppError("Status inválido. Use: ativo, inativo ou todos.", 400, "status");
  }

  // Busca os produtos com nome, código de barras e a linha de estoque (a relação vem null se a linha não existe).
  const produtos = await prisma.produto.findMany({
    where,
    select: saldoSelect,
    // Ordena por nome, de A a Z.
    orderBy: { nome: "asc" },
  });

  // Monta o formato da tela de Saldos (produto sem linha de estoque vira tudo 0 / "zerado").
  const saldos = produtos.map(paraSaldoEstoque);

  // A situação depende de uma conta entre colunas (físico - reservado <= mínimo), que o filtro do Prisma não expressa;
  // por isso este filtro é feito aqui, depois de calcular. Para o tamanho de uma cantina, o custo é irrelevante.
  res.json(apenasCriticos ? saldos.filter((saldo) => saldo.situacao !== "ok") : saldos);
}
