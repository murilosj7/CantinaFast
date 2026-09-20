// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Enum de tipos de movimentação gravados no histórico do estoque.
import { TipoMovimentacaoEstoque } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id que veio na URL.
import { parseId } from "../../utils/parseId";
// produtoInclude carrega categoria/estoque; paraProduto monta a resposta do contrato.
import { paraProduto, produtoInclude } from "./produto.mapper";
// Texto opcional (o motivo): vazio vira null, texto longo demais é recusado.
import { lerTextoOpcional } from "./produto.validacao";

// Maior valor que cabe na coluna inteira do banco (quantidadeFisica é Int de 32 bits).
const MAXIMO_INTEIRO = 2147483647;

// Os dois tipos de operação aceitos por esta rota (não são o mesmo enum do histórico: no histórico a direção vira ENTRADA/SAIDA).
type TipoAjuste = "ENTRADA" | "AJUSTE";

// Valida o tipo ("ENTRADA" ou "AJUSTE", aceitando minúsculas) e devolve o valor normalizado.
function lerTipo(valor: unknown): TipoAjuste {
  // Se for texto: tira espaços e põe em maiúsculo; senão vira "" (que será recusado abaixo).
  const tipo = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  // Só esses dois valores: SAIDA e PERDA não são feitos por aqui (SAIDA nasce da venda).
  if (tipo !== "ENTRADA" && tipo !== "AJUSTE") {
    throw new AppError('Tipo inválido. Use: ENTRADA ou AJUSTE.', 400, "tipo");
  }
  return tipo;
}

// Valida a quantidade conforme o tipo: inteiro; ENTRADA precisa ser maior que zero, AJUSTE aceita zero (estoque zerado).
function lerQuantidade(valor: unknown, tipo: TipoAjuste): number {
  // Precisa ser número inteiro de verdade (recusa texto, null, decimal, NaN e infinito) e caber na coluna do banco.
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor > MAXIMO_INTEIRO) {
    throw new AppError("A quantidade deve ser um número inteiro.", 400, "quantidade");
  }
  // Entrada de zero unidades não tem sentido: exige pelo menos 1.
  if (tipo === "ENTRADA" && valor < 1) {
    throw new AppError("Na entrada, a quantidade deve ser um inteiro maior que zero.", 400, "quantidade");
  }
  // Ajuste define o estoque contado: pode ser 0, mas nunca negativo.
  if (tipo === "AJUSTE" && valor < 0) {
    throw new AppError("No ajuste, a quantidade (estoque contado) deve ser um inteiro de 0 em diante.", 400, "quantidade");
  }
  return valor;
}

// PATCH /produtos/:id/estoque — body: { tipo: "ENTRADA" | "AJUSTE", quantidade, motivo? }. Rota protegida (qualquer perfil logado).
//  - ENTRADA: SOMA `quantidade` ao estoque físico (reposição de mercadoria). Grava uma movimentação ENTRADA dessa quantidade.
//  - AJUSTE: DEFINE o estoque físico como `quantidade` (contagem/inventário; não soma). Grava uma movimentação com a DIFERENÇA
//    entre o valor antigo e o novo: ENTRADA se o estoque subiu, SAIDA se desceu (sempre em valor positivo). Se a contagem for
//    igual ao estoque atual, nada mudou e nenhuma movimentação é criada (movimento de zero unidades não faz sentido).
// O usuário do token vai em toda movimentação. Atualizar o estoque e gravar a movimentação acontecem na MESMA transação.
export async function ajustarEstoque(req: Request, res: Response) {
  // Segurança extra: a rota exige autenticação; a movimentação precisa registrar quem a fez.
  if (!req.usuario) {
    throw new AppError("Não autenticado.", 401);
  }
  // Id de quem está mexendo no estoque, vindo do token.
  const usuarioId = req.usuario.id;

  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);
  // Pega os campos do corpo (se não veio corpo, usa um objeto vazio).
  const { tipo: tipoBruto, quantidade: quantidadeBruta, motivo: motivoBruto } = req.body ?? {};
  // Valida tipo, quantidade (que depende do tipo) e motivo (opcional, até 200 caracteres).
  const tipo = lerTipo(tipoBruto);
  const quantidade = lerQuantidade(quantidadeBruta, tipo);
  const motivoInformado = lerTextoOpcional(motivoBruto, "motivo", 200);
  // Sem motivo informado, usa um texto padrão que explica a origem do registro.
  const motivo = motivoInformado ?? (tipo === "ENTRADA" ? "Reposição de estoque" : "Ajuste manual de estoque");

  // Tudo abaixo roda numa transação: ou atualiza o estoque E registra a movimentação, ou não grava nada.
  const produto = await prisma.$transaction(async (tx) => {
    // Confere que o produto existe (produto inativo também pode ter o estoque corrigido).
    const existente = await tx.produto.findUnique({ where: { id }, select: { id: true } });
    if (!existente) {
      throw new AppError("Produto não encontrado.", 404);
    }

    // Produto antigo sem linha de estoque: cria a linha zerada. `skipDuplicates` (INSERT ... ON CONFLICT DO NOTHING)
    // faz dois ajustes simultâneos não brigarem pela criação; se a linha já existe, não muda nada.
    await tx.estoque.createMany({ data: [{ produtoId: id }], skipDuplicates: true });

    // Lê o estoque atual TRAVANDO a linha até o fim da transação (SELECT ... FOR UPDATE). Sem isso, uma venda que
    // baixasse o estoque entre a leitura e a escrita faria a diferença do ajuste ficar errada e o histórico não fecharia.
    // Quem chegar nesse intervalo (vendas, outros ajustes) espera a transação terminar e aplica sobre o valor novo.
    const linhas = await tx.$queryRaw<{ quantidadeFisica: number }[]>`
      SELECT "quantidadeFisica" FROM "estoque" WHERE "produtoId" = ${id} FOR UPDATE`;
    // Estoque físico antes da operação.
    const atual = linhas[0]!.quantidadeFisica;

    // Estoque físico depois: entrada soma; ajuste substitui.
    const novo = tipo === "ENTRADA" ? atual + quantidade : quantidade;
    // A soma não pode estourar a coluna inteira do banco (senão viraria erro 500).
    if (novo > MAXIMO_INTEIRO) {
      throw new AppError(`O estoque total não pode passar de ${MAXIMO_INTEIRO} unidades.`, 400, "quantidade");
    }

    // Diferença entre o novo e o atual: positiva = estoque subiu; negativa = desceu; zero = não mudou.
    const diferenca = novo - atual;
    // Só há o que gravar se o estoque realmente mudou.
    if (diferenca !== 0) {
      // Grava o novo estoque físico (a linha está travada por nós, então o valor lido continua valendo).
      await tx.estoque.update({ where: { produtoId: id }, data: { quantidadeFisica: novo } });
      // Registra o que foi movimentado: quantidade sempre positiva (Math.abs) e a DIREÇÃO no tipo (subiu = ENTRADA, desceu = SAIDA).
      await tx.movimentacaoEstoque.create({
        data: {
          produtoId: id,
          usuarioId,
          tipo: diferenca > 0 ? TipoMovimentacaoEstoque.ENTRADA : TipoMovimentacaoEstoque.SAIDA,
          quantidade: Math.abs(diferenca),
          motivo,
        },
      });
    }

    // Devolve o produto já atualizado (com categoria e estoque) para montar a resposta.
    return tx.produto.findUniqueOrThrow({ where: { id }, include: produtoInclude });
  });

  // 200 com o produto no formato do contrato (quantidadeDisponivel já recalculado pelo mapper).
  res.json(paraProduto(produto));
}
