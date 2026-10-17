// Tipo Prisma usado para descrever o formato do produto com as relações carregadas.
import type { Prisma } from "@prisma/client";
// Converte o preço (Decimal) em número comum para a resposta.
import { decimalParaNumero } from "../../utils/decimalParaNumero";

// Relações que toda consulta de produto carrega, para montar categoriaNome e quantidadeDisponivel.
export const produtoInclude = {
  // Traz da categoria só o nome.
  categoria: { select: { nome: true } },
  // Traz do estoque só as duas quantidades necessárias para o cálculo de disponível.
  estoque: { select: { quantidadeFisica: true, quantidadeReservada: true } },
  // `satisfies` só confere o formato com o tipo do Prisma, sem alargar o tipo.
} satisfies Prisma.ProdutoInclude;

// Tipo do produto do banco JÁ com categoria e estoque carregados.
export type ProdutoComRelacoes = Prisma.ProdutoGetPayload<{ include: typeof produtoInclude }>;

// Tradução banco -> frontend (contrato-api-cantinafast.md, seção 2.2):
// precoVenda vira `preco` (número, não string), e `quantidadeDisponivel` sai da tabela estoque.
// Campos além do contrato (codigoBarras, disponivelPresencial, ativo, criadoEm) servem ao admin/PDV.
// `maisVendido` é opcional no contrato e ainda não é calculado.
export function paraProduto(produto: ProdutoComRelacoes) {
  // Linha de estoque do produto (pode não existir).
  const estoque = produto.estoque;
  // Produto sem linha em `estoque` (ainda não movimentado) conta como 0 disponível.
  // Com estoque: disponível = quantidade física menos a reservada.
  const disponivel = estoque ? estoque.quantidadeFisica - estoque.quantidadeReservada : 0;

  return {
    id: produto.id,
    nome: produto.nome,
    // Sem descrição no banco (null) vira texto vazio, como o contrato espera (string).
    descricao: produto.descricao ?? "",
    // O banco guarda precoVenda (Decimal); o frontend recebe `preco` como número.
    preco: decimalParaNumero(produto.precoVenda),
    // Sem imagem (null) vira texto vazio.
    imagemUrl: produto.imagemUrl ?? "",
    categoriaId: produto.categoriaId,
    // Nome da categoria, vindo da relação carregada.
    categoriaNome: produto.categoria.nome,
    disponivelOnline: produto.disponivelOnline,
    // Nunca negativo: se reservaram mais do que existe, mostra 0.
    quantidadeDisponivel: Math.max(0, disponivel),
    // Campos extras para o admin e o PDV:
    codigoBarras: produto.codigoBarras,
    disponivelPresencial: produto.disponivelPresencial,
    ativo: produto.ativo,
    // Data como texto ISO 8601.
    criadoEm: produto.criadoEm.toISOString(),
  };
}
