// Tipo Prisma usado para descrever o formato do produto com o estoque carregado.
import type { Prisma } from "@prisma/client";

// O que uma consulta precisa trazer do produto (e da linha de estoque dele) para montar um saldo.
export const saldoSelect = {
  id: true,
  nome: true,
  codigoBarras: true,
  // A relação vem null quando o produto (antigo) não tem linha em `estoque`.
  estoque: { select: { quantidadeFisica: true, quantidadeReservada: true, estoqueMinimo: true } },
  // `satisfies` só confere o formato com o tipo do Prisma, sem alargar o tipo.
} satisfies Prisma.ProdutoSelect;

// Tipo do produto do banco já com os campos de `saldoSelect`.
export type ProdutoComSaldo = Prisma.ProdutoGetPayload<{ select: typeof saldoSelect }>;

// Como o saldo aparece na tela: "zerado" (nada disponível), "baixo" (no mínimo ou abaixo dele) ou "ok".
export type Situacao = "ok" | "baixo" | "zerado";

// Decide a situação do produto. "zerado" vem primeiro: com disponível 0 e mínimo 0 (o padrão do banco), 0 <= 0 também
// seria "baixo", mas o mais informativo para a tela é "zerado".
export function calcularSituacao(quantidadeDisponivel: number, estoqueMinimo: number): Situacao {
  if (quantidadeDisponivel === 0) return "zerado";
  if (quantidadeDisponivel <= estoqueMinimo) return "baixo";
  return "ok";
}

// Formato de uma linha de saldo (GET /estoque e resposta do PATCH /estoque/:produtoId).
// `id` é o próprio produtoId (a tela identifica o saldo pelo produto). Produto sem linha de estoque conta tudo como 0.
export function paraSaldoEstoque(produto: ProdutoComSaldo) {
  const quantidadeFisica = produto.estoque?.quantidadeFisica ?? 0;
  const quantidadeReservada = produto.estoque?.quantidadeReservada ?? 0;
  const estoqueMinimo = produto.estoque?.estoqueMinimo ?? 0;
  // Nunca negativo: se reservaram mais do que existe, mostra 0 (mesma regra do quantidadeDisponivel do GET /produtos).
  const quantidadeDisponivel = Math.max(0, quantidadeFisica - quantidadeReservada);

  return {
    id: produto.id,
    produtoId: produto.id,
    // Dados do produto aninhados (a tela mostra nome e código de barras junto do saldo).
    produto: { id: produto.id, nome: produto.nome, codigoBarras: produto.codigoBarras },
    quantidadeFisica,
    quantidadeReservada,
    quantidadeDisponivel,
    estoqueMinimo,
    situacao: calcularSituacao(quantidadeDisponivel, estoqueMinimo),
  };
}
