// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// TipoMovimentacaoEstoque (valor do enum, usado na movimentação) e o tipo Prisma dos campos aceitos ao criar um produto.
import { TipoMovimentacaoEstoque, type Prisma } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
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
  lerQuantidadeInicial,
  lerTextoOpcional,
} from "./produto.validacao";

// POST /produtos (rota protegida)
// body: { nome, preco, categoriaId, quantidadeInicial?, descricao?, codigoBarras?, imagemUrl?, disponivelPresencial?, disponivelOnline? }
// Cria o produto e a linha de `estoque` dele com quantidadeFisica = quantidadeInicial (padrão 0). Se a quantidade
// inicial for maior que zero, registra também uma MovimentacaoEstoque ENTRADA ("Estoque inicial") em nome do usuário
// do token. Com quantidade 0 (ou sem o campo) NÃO cria movimentação: entrada de zero unidades não tem sentido.
// As três tabelas (produto, estoque e movimentação) são gravadas numa ÚNICA operação atômica (escrita aninhada do
// Prisma): se qualquer uma falhar, nenhuma é gravada.
export async function criarProduto(req: Request, res: Response) {
  // Segurança extra: a rota exige autenticação; a movimentação de estoque precisa registrar quem fez a entrada.
  if (!req.usuario) {
    throw new AppError("Não autenticado.", 401);
  }
  // Id de quem está criando o produto, vindo do token.
  const usuarioId = req.usuario.id;

  // Pega todos os campos possíveis do corpo (se não veio corpo, usa um objeto vazio).
  const {
    nome,
    preco,
    categoriaId,
    quantidadeInicial,
    descricao,
    codigoBarras,
    imagemUrl,
    disponivelPresencial,
    disponivelOnline,
  } = req.body ?? {};

  // Valida a quantidade inicial (inteiro >= 0; padrão 0 quando não vem no corpo).
  const quantidade = lerQuantidadeInicial(quantidadeInicial);

  // Monta o objeto que será gravado, começando pelos 3 campos obrigatórios (já validados).
  const data: Prisma.ProdutoUncheckedCreateInput = {
    // Nome válido e sem espaços nas pontas.
    nome: lerNome(nome),
    // O contrato chama de `preco`; no banco a coluna é `precoVenda`.
    precoVenda: lerPreco(preco),
    // Id da categoria validado como inteiro positivo.
    categoriaId: parseId(categoriaId, "categoriaId"),
    // Escrita aninhada: o Prisma cria o produto e a linha de estoque juntos, numa única transação.
    estoque: { create: { quantidadeFisica: quantidade } },
  };

  // Só há entrada de estoque para registrar quando a quantidade inicial é maior que zero.
  if (quantidade > 0) {
    // Também aninhada: entra na MESMA operação atômica do produto e do estoque.
    data.movimentacoesEstoque = {
      create: {
        // Quem cadastrou o produto com estoque (usuário do token).
        usuarioId,
        // Entrada de mercadoria no estoque.
        tipo: TipoMovimentacaoEstoque.ENTRADA,
        // Exatamente a quantidade inicial informada.
        quantidade,
        motivo: "Estoque inicial",
      },
    };
  }

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

  // Grava produto + estoque (+ movimentação, se houver) de uma vez e já traz categoria/estoque para a resposta.
  const produto = await prisma.produto.create({ data, include: produtoInclude });
  // Responde 201 (criado) com o produto no formato do contrato (quantidadeDisponivel já reflete o estoque inicial).
  res.status(201).json(paraProduto(produto));
}
