// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo do filtro (where) da consulta.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Seleção segura de campos e montagem da resposta na visão interna.
import { clienteSelect, paraClienteInterno } from "./cliente.mapper";

// Lê um parâmetro inteiro da URL (ex.: pagina=2). Sem valor usa o padrão; fora da faixa ou não numérico dá 400.
// (Mesma regra do listarPedidos.)
function lerInteiro(valor: unknown, campo: string, padrao: number, minimo: number, maximo: number): number {
  // Não veio na URL: usa o padrão.
  if (valor === undefined || valor === "") return padrao;
  // Precisa ser só dígitos (recusa "abc", "1.5", "-1").
  if (typeof valor !== "string" || !/^\d+$/.test(valor)) {
    throw new AppError(`O parâmetro '${campo}' deve ser um número inteiro entre ${minimo} e ${maximo}.`, 400, campo);
  }
  // Converte para número.
  const numero = Number(valor);
  // Confere a faixa permitida.
  if (numero < minimo || numero > maximo) {
    throw new AppError(`O parâmetro '${campo}' deve ser um número inteiro entre ${minimo} e ${maximo}.`, 400, campo);
  }
  return numero;
}

// GET /interno/clientes?pagina=1&limite=20&busca=ana&status=ativo — só administrador (a rota aplica exigirPerfil).
// Paginação simples (pagina começa em 1; limite máximo 100), ordenada por nome e, em empate, por id (ordem estável).
export async function listarClientes(req: Request, res: Response) {
  // Os parâmetros vêm na URL (query string), depois do "?".
  const { pagina: paginaBruta, limite: limiteBruto, busca, status } = req.query;

  // Página pedida (padrão 1) e quantidade por página (padrão 20, máximo 100).
  const pagina = lerInteiro(paginaBruta, "pagina", 1, 1, 1000000);
  const limite = lerInteiro(limiteBruto, "limite", 20, 1, 100);

  // Começa sem nenhuma condição; acrescentamos conforme os filtros.
  const where: Prisma.ClienteWhereInput = {};

  // Busca parcial no nome ou no e-mail, sem diferenciar maiúsculas.
  if (typeof busca === "string" && busca.trim() !== "") {
    const termo = busca.trim();
    where.OR = [
      { nome: { contains: termo, mode: "insensitive" } },
      { email: { contains: termo, mode: "insensitive" } },
    ];
  }

  // Situação da conta: sem filtro (padrão) ou "todos" traz tudo; "ativo" e "inativo" filtram.
  if (status === "ativo") {
    where.ativo = true;
  } else if (status === "inativo") {
    where.ativo = false;
  } else if (status !== undefined && status !== "" && status !== "todos") {
    throw new AppError("Status inválido. Use: ativo, inativo ou todos.", 400, "status");
  }

  // Busca a página e o total ao mesmo tempo (o total ignora a paginação).
  const [clientes, total] = await Promise.all([
    prisma.cliente.findMany({
      where,
      // Só os campos públicos (nunca senhaHash nem loginGoogle).
      select: clienteSelect,
      // Nome primeiro; o id desempata para a paginação nunca repetir nem pular registros.
      orderBy: [{ nome: "asc" }, { id: "asc" }],
      skip: (pagina - 1) * limite,
      take: limite,
    }),
    prisma.cliente.count({ where }),
  ]);

  // Resposta no mesmo formato do listarPedidos.
  res.json({ dados: clientes.map(paraClienteInterno), pagina, limite, total, totalPaginas: Math.ceil(total / limite) });
}
