// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";
// Seleção segura de campos e montagem da resposta na visão interna.
import { clienteSelect, paraClienteInterno } from "./cliente.mapper";

// PATCH /interno/clientes/:id/ativo — body: { ativo: boolean } — só administrador (a rota aplica exigirPerfil).
// Exclusão lógica: o cliente nunca é apagado (os pedidos dele continuam apontando para ele); false inativa, true reativa.
export async function alterarAtivoCliente(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);
  // `?? {}` evita erro quando a requisição vem sem corpo.
  const { ativo } = req.body ?? {};

  // Precisa ser verdadeiro ou falso de verdade (não texto nem número).
  if (typeof ativo !== "boolean") {
    throw new AppError("O campo 'ativo' deve ser verdadeiro ou falso.", 400, "ativo");
  }

  // Confere que o cliente existe antes de alterar.
  const existente = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
  if (!existente) {
    throw new AppError("Cliente não encontrado.", 404);
  }

  // Grava a nova situação e devolve só os campos públicos.
  const atualizado = await prisma.cliente.update({ where: { id }, data: { ativo }, select: clienteSelect });

  // Devolve o cliente na visão interna.
  res.json(paraClienteInterno(atualizado));
}
