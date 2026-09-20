// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";

// POST /categorias — body: { nome }
export async function criarCategoria(req: Request, res: Response) {
  // Pega o nome do corpo da requisição (se não veio corpo, usa um objeto vazio).
  const { nome } = req.body ?? {};

  // Nome: precisa ser texto, não vazio e ter no máximo 80 caracteres (tamanho da coluna).
  if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 80) {
    // Recusa com 400 e aponta o campo "nome".
    throw new AppError("Informe o nome da categoria (até 80 caracteres).", 400, "nome");
  }

  // Grava a categoria no banco (o campo `ativa` nasce como true por padrão no schema).
  const categoria = await prisma.categoria.create({ data: { nome: nome.trim() } });
  // Responde 201 (criado) com a categoria.
  res.status(201).json(categoria);
}
