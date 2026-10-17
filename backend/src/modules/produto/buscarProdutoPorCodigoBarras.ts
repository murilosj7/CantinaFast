// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// produtoInclude carrega categoria/estoque; paraProduto monta a resposta do contrato.
import { paraProduto, produtoInclude } from "./produto.mapper";

// GET /produtos/codigo-barras/:codigo — leitura do código no PDV.
// Devolve também produto inativo; o PDV decide o que fazer com `ativo: false`.
export async function buscarProdutoPorCodigoBarras(req: Request, res: Response) {
  // Lê o :codigo da URL; se não for texto, vira "" (que será recusado abaixo). Tira espaços das pontas.
  const codigo = typeof req.params.codigo === "string" ? req.params.codigo.trim() : "";
  // Código vazio ou maior que a coluna (80 caracteres) é inválido.
  if (codigo === "" || codigo.length > 80) {
    throw new AppError("Informe um código de barras válido (até 80 caracteres).", 400, "codigo");
  }

  // Procura o produto pelo código de barras (campo único), já trazendo categoria e estoque.
  const produto = await prisma.produto.findUnique({ where: { codigoBarras: codigo }, include: produtoInclude });
  // Nenhum produto com esse código: 404.
  if (!produto) {
    throw new AppError("Nenhum produto encontrado com esse código de barras.", 404);
  }

  // Devolve o produto no formato do contrato.
  res.json(paraProduto(produto));
}
