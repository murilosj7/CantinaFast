// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Enums do Prisma para validar os filtros, e o tipo do filtro (where) da consulta.
import { CanalPedido, Prisma, StatusPedido } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// paraPedido monta a resposta; pedidoComItensInclude carrega os itens de cada pedido.
import { paraPedido, pedidoComItensInclude } from "./pedido.mapper";

// Lê um parâmetro inteiro da URL (ex.: pagina=2). Sem valor usa o padrão; fora da faixa ou não numérico dá 400.
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

// GET /pedidos?pagina=1&limite=20&status=ABERTO&canal=PRESENCIAL
// Paginação simples (pagina começa em 1; limite máximo 100), do pedido mais novo para o mais antigo.
// Os filtros de status e canal são opcionais, combinam entre si e aceitam minúsculas.
export async function listarPedidos(req: Request, res: Response) {
  // Os parâmetros vêm na URL (query string), depois do "?".
  const { pagina: paginaBruta, limite: limiteBruto, status, canal } = req.query;

  // Página pedida (padrão 1) e quantidade por página (padrão 20, máximo 100).
  const pagina = lerInteiro(paginaBruta, "pagina", 1, 1, 1000000);
  const limite = lerInteiro(limiteBruto, "limite", 20, 1, 100);

  // Começa sem nenhuma condição; acrescentamos conforme os filtros.
  const where: Prisma.PedidoWhereInput = {};

  // Filtro por status.
  if (status !== undefined && status !== "") {
    // Texto em maiúsculo, para aceitar "pago" ou "PAGO".
    const valor = typeof status === "string" ? status.trim().toUpperCase() : "";
    // Precisa ser um dos valores do enum StatusPedido.
    if (!Object.values(StatusPedido).includes(valor as StatusPedido)) {
      throw new AppError(`Status inválido. Use: ${Object.values(StatusPedido).join(", ")}.`, 400, "status");
    }
    where.status = valor as StatusPedido;
  }

  // Filtro por canal.
  if (canal !== undefined && canal !== "") {
    // Texto em maiúsculo, para aceitar "online" ou "ONLINE".
    const valor = typeof canal === "string" ? canal.trim().toUpperCase() : "";
    // Precisa ser um dos valores do enum CanalPedido.
    if (!Object.values(CanalPedido).includes(valor as CanalPedido)) {
      throw new AppError(`Canal inválido. Use: ${Object.values(CanalPedido).join(" ou ")}.`, 400, "canal");
    }
    where.canal = valor as CanalPedido;
  }

  // Busca a página de pedidos e, em paralelo, quantos pedidos existem no total com esses filtros.
  const [pedidos, total] = await Promise.all([
    prisma.pedido.findMany({
      where,
      // Já traz os itens de cada pedido.
      include: pedidoComItensInclude,
      // Mais novos primeiro (o id desempata pedidos criados no mesmo instante).
      orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
      // Pula os pedidos das páginas anteriores...
      skip: (pagina - 1) * limite,
      // ...e traz só a quantidade da página.
      take: limite,
    }),
    prisma.pedido.count({ where }),
  ]);

  // Responde com a página, os dados de paginação e o total de páginas.
  res.json({ dados: pedidos.map(paraPedido), pagina, limite, total, totalPaginas: Math.ceil(total / limite) });
}
