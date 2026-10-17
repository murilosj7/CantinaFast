// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Enum de tipos de movimentação do banco (ENTRADA, SAIDA, PERDA, AJUSTE), usado como tipo e como valor.
import { TipoMovimentacaoEstoque } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o produtoId vindo no corpo.
import { parseId } from "../../utils/parseId";
// Texto opcional (o motivo): vazio vira null, texto longo demais é recusado.
import { lerTextoOpcional } from "../produto/produto.validacao";
// movimentacaoInclude carrega produto/usuário; paraMovimentacao monta a resposta.
import { movimentacaoInclude, paraMovimentacao } from "./movimentacao.mapper";
// Regras do saldo: limite da coluna, efeito de cada tipo e o lock da linha de estoque.
import { MAXIMO_INTEIRO, efeitoNoSaldo, travarEstoque } from "./saldoEstoque";

// Valida o tipo (aceita minúsculas, como o ajustarEstoque) e devolve o valor do enum.
function lerTipo(valor: unknown): TipoMovimentacaoEstoque {
  // Se for texto: tira espaços e põe em maiúsculo; senão vira "" (que será recusado abaixo).
  const tipo = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  // Só os quatro valores do enum são aceitos.
  if (!Object.values(TipoMovimentacaoEstoque).includes(tipo as TipoMovimentacaoEstoque)) {
    throw new AppError("Tipo inválido. Use: ENTRADA, SAIDA, PERDA ou AJUSTE.", 400, "tipo");
  }
  return tipo as TipoMovimentacaoEstoque;
}

// Valida a quantidade conforme o tipo. Precisa ser número inteiro de verdade (recusa texto, null, decimal, NaN e
// infinito) e caber na coluna. ENTRADA/SAIDA/PERDA: maior que zero (a direção já está no tipo).
// AJUSTE: diferente de zero, podendo ser negativa (soma ao físico se positiva, subtrai se negativa).
function lerQuantidade(valor: unknown, tipo: TipoMovimentacaoEstoque): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || Math.abs(valor) > MAXIMO_INTEIRO) {
    throw new AppError("A quantidade deve ser um número inteiro.", 400, "quantidade");
  }
  if (tipo === "AJUSTE") {
    // Ajuste de zero unidades não muda nada: não faz sentido registrar. (-0 também cai aqui, pois -0 === 0.)
    if (valor === 0) {
      throw new AppError("No ajuste, a quantidade deve ser um inteiro diferente de zero (negativo diminui o estoque).", 400, "quantidade");
    }
  } else if (valor < 1) {
    throw new AppError("A quantidade deve ser um inteiro maior que zero (a direção já vem do tipo).", 400, "quantidade");
  }
  return valor;
}

// POST /movimentacoes — body: { produtoId, tipo: "ENTRADA" | "SAIDA" | "PERDA" | "AJUSTE", quantidade, motivo? }.
// Rota protegida (qualquer perfil logado). O usuário gravado é SEMPRE o do token: um `usuarioId` enviado no corpo é ignorado.
//  - ENTRADA soma `quantidade` ao estoque físico; SAIDA e PERDA subtraem; AJUSTE soma o valor com sinal (delta).
//  - O físico nunca fica negativo: se a operação deixaria, responde 400 informando o saldo atual.
//  - Produto antigo sem linha em `estoque` ganha a linha zerada (e, se a operação falhar, a linha também é desfeita).
// Tudo numa transação com a linha de estoque TRAVADA (SELECT ... FOR UPDATE, mesmo padrão do ajustarEstoque): ou muda
// o saldo E grava a movimentação, ou não muda nada.
export async function criarMovimentacao(req: Request, res: Response) {
  // Segurança extra: a rota exige autenticação; a movimentação precisa registrar quem a fez.
  if (!req.usuario) {
    throw new AppError("Não autenticado.", 401);
  }
  // Id de quem está lançando, vindo do token (nunca do corpo).
  const usuarioId = req.usuario.id;

  // Pega os campos do corpo (se não veio corpo, usa um objeto vazio). `usuarioId` do corpo nem é lido.
  const { produtoId: produtoIdBruto, tipo: tipoBruto, quantidade: quantidadeBruta, motivo: motivoBruto } = req.body ?? {};
  // Valida tudo antes de abrir a transação.
  const produtoId = parseId(produtoIdBruto, "produtoId");
  const tipo = lerTipo(tipoBruto);
  const quantidade = lerQuantidade(quantidadeBruta, tipo);
  const motivo = lerTextoOpcional(motivoBruto, "motivo", 200);
  // Quanto o estoque físico sobe (+) ou desce (-) com esta movimentação.
  const efeito = efeitoNoSaldo(tipo, quantidade);

  // Tudo abaixo roda numa transação: ou atualiza o estoque E registra a movimentação, ou não grava nada.
  const criada = await prisma.$transaction(async (tx) => {
    // Confere que o produto existe (produto inativo também pode ter o estoque movimentado).
    const existente = await tx.produto.findUnique({ where: { id: produtoId }, select: { id: true } });
    if (!existente) {
      throw new AppError("Produto não encontrado.", 404, "produtoId");
    }

    // Cria a linha zerada se faltar e trava a linha; devolve o estoque físico antes da operação.
    const atual = await travarEstoque(tx, produtoId);
    // Estoque físico depois da operação.
    const novo = atual + efeito;
    // O físico nunca fica negativo; a mensagem diz quanto há e quanto a operação tiraria.
    if (novo < 0) {
      throw new AppError(`Saldo insuficiente: o estoque físico atual é ${atual} e esta operação retiraria ${-efeito}.`, 400, "quantidade");
    }
    // A soma não pode estourar a coluna inteira do banco (senão viraria erro 500).
    if (novo > MAXIMO_INTEIRO) {
      throw new AppError(`O estoque total não pode passar de ${MAXIMO_INTEIRO} unidades (atual: ${atual}).`, 400, "quantidade");
    }

    // Grava o novo estoque físico (a linha está travada por nós, então o valor lido continua valendo).
    await tx.estoque.update({ where: { produtoId }, data: { quantidadeFisica: novo } });
    // Registra a movimentação: quantidade como enviada (com sinal só no AJUSTE) e o usuário do token.
    return tx.movimentacaoEstoque.create({
      data: { produtoId, usuarioId, tipo, quantidade, motivo },
      include: movimentacaoInclude,
    });
  });

  // 201 com a movimentação criada, no mesmo formato da listagem.
  res.status(201).json(paraMovimentacao(criada));
}
