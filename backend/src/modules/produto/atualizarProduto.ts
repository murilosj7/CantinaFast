// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo Prisma que descreve os campos que podem ser atualizados num produto.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida ids (o da URL e o da categoria).
import { parseId } from "../../utils/parseId";
// produtoInclude carrega categoria/estoque; paraProduto monta a resposta do contrato.
import { paraProduto, produtoInclude } from "./produto.mapper";
// Validações compartilhadas com criarProduto.
import {
  garantirCategoriaAtiva,
  garantirCodigoBarrasLivre,
  lerBooleano,
  lerNome,
  lerPreco,
  lerTextoOpcional,
} from "./produto.validacao";

// PATCH /produtos/:id — qualquer combinação de:
// { nome, preco, categoriaId, descricao, codigoBarras, imagemUrl, disponivelPresencial, disponivelOnline, ativo }
// Texto vazio ou null em descricao/codigoBarras/imagemUrl limpa o campo.
// `ativo: false` inativa e `ativo: true` reativa (mesmo padrão de usuário e categoria).
export async function atualizarProduto(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);
  // Guarda o corpo inteiro (se não veio corpo, usa um objeto vazio) para olhar campo a campo.
  const body = req.body ?? {};

  // Busca o produto atual no banco.
  const existente = await prisma.produto.findUnique({ where: { id } });
  // Se não existe, 404.
  if (!existente) {
    throw new AppError("Produto não encontrado.", 404);
  }

  // Objeto onde juntamos SÓ os campos que realmente serão atualizados.
  const data: Prisma.ProdutoUncheckedUpdateInput = {};

  // Cada campo só entra em `data` se veio no corpo; por isso o PATCH aceita atualização parcial.
  if (body.nome !== undefined) data.nome = lerNome(body.nome);
  // O contrato chama de `preco`; no banco a coluna é `precoVenda`.
  if (body.preco !== undefined) data.precoVenda = lerPreco(body.preco);

  // Troca de categoria.
  if (body.categoriaId !== undefined) {
    // Valida o id enviado.
    const categoriaId = parseId(body.categoriaId, "categoriaId");
    // Só valida a categoria se ela mudou: um produto já existente pode continuar numa categoria inativada.
    if (categoriaId !== existente.categoriaId) await garantirCategoriaAtiva(categoriaId);
    data.categoriaId = categoriaId;
  }

  // Descrição e imagem: texto vazio ou null viram null (limpam o campo).
  if (body.descricao !== undefined) data.descricao = lerTextoOpcional(body.descricao, "descricao", 5000);
  if (body.imagemUrl !== undefined) data.imagemUrl = lerTextoOpcional(body.imagemUrl, "imagemUrl", 500);

  // Código de barras.
  if (body.codigoBarras !== undefined) {
    // Valida o texto (vazio/null vira null e limpa o campo).
    const codigo = lerTextoOpcional(body.codigoBarras, "codigoBarras", 80);
    // Se sobrou um código, confere se não é de OUTRO produto (o próprio id é ignorado).
    if (codigo !== null) await garantirCodigoBarrasLivre(codigo, id);
    data.codigoBarras = codigo;
  }

  // Disponibilidade no PDV.
  if (body.disponivelPresencial !== undefined) {
    data.disponivelPresencial = lerBooleano(body.disponivelPresencial, "disponivelPresencial");
  }
  // Disponibilidade no site.
  if (body.disponivelOnline !== undefined) {
    data.disponivelOnline = lerBooleano(body.disponivelOnline, "disponivelOnline");
  }
  // Ativar/inativar o produto (false inativa, true reativa).
  if (body.ativo !== undefined) data.ativo = lerBooleano(body.ativo, "ativo");

  // Se nenhum campo válido foi enviado, não há o que atualizar.
  if (Object.keys(data).length === 0) {
    throw new AppError(
      "Informe ao menos um campo para atualizar: nome, preco, categoriaId, descricao, codigoBarras, imagemUrl, disponivelPresencial, disponivelOnline ou ativo.",
    );
  }

  // Aplica a atualização no banco e já traz categoria/estoque para montar a resposta.
  const atualizado = await prisma.produto.update({ where: { id }, data, include: produtoInclude });
  // Devolve o produto atualizado no formato do contrato.
  res.json(paraProduto(atualizado));
}
