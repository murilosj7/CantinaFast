// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo Prisma que descreve os campos que podem ser atualizados numa categoria.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";

// PATCH /categorias/:id — body com qualquer combinação de: { nome, ativa }
// `ativa: false` inativa e `ativa: true` reativa (mesmo padrão do módulo de usuário).
export async function atualizarCategoria(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);
  // Pega os campos que podem ser alterados.
  const { nome, ativa } = req.body ?? {};

  // Busca a categoria no banco para confirmar que existe.
  const existente = await prisma.categoria.findUnique({ where: { id } });
  // Se não existe, 404.
  if (!existente) {
    throw new AppError("Categoria não encontrada.", 404);
  }

  // Objeto onde juntamos SÓ os campos que realmente serão atualizados.
  const data: Prisma.CategoriaUpdateInput = {};

  // Se o nome veio no corpo...
  if (nome !== undefined) {
    // ...valida (texto, não vazio, até 80 caracteres).
    if (typeof nome !== "string" || nome.trim() === "" || nome.trim().length > 80) {
      throw new AppError("Informe o nome da categoria (até 80 caracteres).", 400, "nome");
    }
    // Guarda o nome limpo para gravar.
    data.nome = nome.trim();
  }

  // Se o campo ativa veio no corpo...
  if (ativa !== undefined) {
    // ...precisa ser verdadeiro ou falso de verdade (não texto).
    if (typeof ativa !== "boolean") {
      throw new AppError("O campo 'ativa' deve ser verdadeiro ou falso.", 400, "ativa");
    }
    // false inativa a categoria, true reativa.
    data.ativa = ativa;
  }

  // Se nenhum campo válido foi enviado, não há o que atualizar.
  if (Object.keys(data).length === 0) {
    throw new AppError("Informe ao menos um campo para atualizar: nome ou ativa.");
  }

  // Aplica a atualização no banco.
  const atualizada = await prisma.categoria.update({ where: { id }, data });
  // Devolve a categoria já atualizada.
  res.json(atualizada);
}
