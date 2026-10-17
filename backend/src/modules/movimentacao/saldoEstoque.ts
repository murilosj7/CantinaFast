// Tipos do Prisma: o cliente que roda dentro de uma transação e o enum de tipos de movimentação.
import type { Prisma, TipoMovimentacaoEstoque } from "@prisma/client";

// Maior valor que cabe na coluna inteira do banco (quantidadeFisica é Int de 32 bits).
export const MAXIMO_INTEIRO = 2147483647;

// Efeito de uma movimentação no estoque físico (a mesma regra da tela do admin):
// ENTRADA soma; SAIDA e PERDA subtraem; AJUSTE soma o valor gravado, que pode ser negativo (delta aditivo).
// `quantidade` é sempre o valor GRAVADO na movimentação: positivo para ENTRADA/SAIDA/PERDA, com sinal para AJUSTE.
export function efeitoNoSaldo(tipo: TipoMovimentacaoEstoque, quantidade: number): number {
  return tipo === "SAIDA" || tipo === "PERDA" ? -quantidade : quantidade;
}

// Garante que o produto tem linha em `estoque` (cria zerada se faltar), TRAVA essa linha até o fim da transação
// (SELECT ... FOR UPDATE) e devolve o estoque físico atual. Deve ser chamada DENTRO de `prisma.$transaction`.
// Sem o lock, duas operações simultâneas leriam o mesmo saldo, cada uma gravaria o seu resultado e uma sobrescreveria
// a outra (ou o saldo ficaria negativo). Com ele, quem chega depois espera a transação terminar e lê o valor já novo.
// `skipDuplicates` (INSERT ... ON CONFLICT DO NOTHING) faz duas requisições não brigarem pela criação da linha.
export async function travarEstoque(tx: Prisma.TransactionClient, produtoId: number): Promise<number> {
  await tx.estoque.createMany({ data: [{ produtoId }], skipDuplicates: true });
  const linhas = await tx.$queryRaw<{ quantidadeFisica: number }[]>`
    SELECT "quantidadeFisica" FROM "estoque" WHERE "produtoId" = ${produtoId} FOR UPDATE`;
  return linhas[0]!.quantidadeFisica;
}
