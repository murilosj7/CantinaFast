// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Tipo Prisma que descreve os campos aceitos ao criar um produto.
import type { Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Valida o id da categoria enviado no corpo.
import { parseId } from "../../utils/parseId";
// produtoInclude carrega categoria/estoque; paraProduto monta a resposta do contrato.
import { paraProduto, produtoInclude } from "./produto.mapper";
// Validações compartilhadas com atualizarProduto.
import {
  garantirCategoriaAtiva,
  garantirCodigoBarrasLivre,
  lerBooleano,
  lerNome,
  lerPreco,
  lerTextoOpcional,
} from "./produto.validacao";

// POST /produtos
// body: { nome, preco, categoriaId, descricao?, codigoBarras?, imagemUrl?, disponivelPresencial?, disponivelOnline? }
// A linha de `estoque` do produto não é criada aqui — quem movimenta estoque é o módulo de Estoque.
export async function criarProduto(req: Request, res: Response) {
  // Pega todos os campos possíveis do corpo (se não veio corpo, usa um objeto vazio).
  const { nome, preco, categoriaId, descricao, codigoBarras, imagemUrl, disponivelPresencial, disponivelOnline } =
    req.body ?? {};

  // Monta o objeto que será gravado, começando pelos 3 campos obrigatórios (já validados).
  const data: Prisma.ProdutoUncheckedCreateInput = {
    // Nome válido e sem espaços nas pontas.
    nome: lerNome(nome),
    // O contrato chama de `preco`; no banco a coluna é `precoVenda`.
    precoVenda: lerPreco(preco),
    // Id da categoria validado como inteiro positivo.
    categoriaId: parseId(categoriaId, "categoriaId"),
  };
  // Confirma que essa categoria existe e está ativa (senão lança 400).
  await garantirCategoriaAtiva(data.categoriaId);

  // Descrição é opcional: só entra no objeto se vier preenchida.
  const descricaoLida = lerTextoOpcional(descricao, "descricao", 5000);
  if (descricaoLida !== null) data.descricao = descricaoLida;

  // URL da imagem é opcional: só entra se vier preenchida.
  const imagemLida = lerTextoOpcional(imagemUrl, "imagemUrl", 500);
  if (imagemLida !== null) data.imagemUrl = imagemLida;

  // Código de barras é opcional...
  const codigoLido = lerTextoOpcional(codigoBarras, "codigoBarras", 80);
  if (codigoLido !== null) {
    // ...mas, se veio, não pode estar repetido em outro produto.
    await garantirCodigoBarrasLivre(codigoLido);
    data.codigoBarras = codigoLido;
  }

  // Disponibilidade no PDV: só muda o padrão (true) se o campo veio no corpo.
  if (disponivelPresencial !== undefined) {
    data.disponivelPresencial = lerBooleano(disponivelPresencial, "disponivelPresencial");
  }
  // Disponibilidade no site: idem.
  if (disponivelOnline !== undefined) {
    data.disponivelOnline = lerBooleano(disponivelOnline, "disponivelOnline");
  }

  // Grava o produto e já traz categoria/estoque para montar a resposta.
  const produto = await prisma.produto.create({ data, include: produtoInclude });
  // Responde 201 (criado) com o produto no formato do contrato.
  res.status(201).json(paraProduto(produto));
}
