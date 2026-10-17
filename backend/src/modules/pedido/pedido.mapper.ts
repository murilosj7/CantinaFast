// Tipos do Prisma usados para descrever o pedido carregado e o pagamento.
import type { Pagamento, Prisma } from "@prisma/client";
// Converte valores Decimal (dinheiro) em número comum para a resposta.
import { decimalParaNumero } from "../../utils/decimalParaNumero";

// Consulta de LISTAGEM: o pedido com seus itens (e, de cada item, só o nome e a imagem do produto).
export const pedidoComItensInclude = {
  itens: {
    // Da relação com produto, só o que a resposta mostra.
    include: { produto: { select: { nome: true, imagemUrl: true } } },
    // Itens na ordem em que foram criados.
    orderBy: { id: "asc" },
  },
  // `satisfies` só confere o formato com o tipo do Prisma, sem alargar o tipo.
} satisfies Prisma.PedidoInclude;

// Consulta de DETALHE (e da criação): os itens acima MAIS os pagamentos do pedido.
export const pedidoCompletoInclude = {
  ...pedidoComItensInclude,
  // Pagamentos na ordem em que foram registrados.
  pagamentos: { orderBy: { id: "asc" } },
} satisfies Prisma.PedidoInclude;

// Tipos do pedido do banco já com as relações carregadas.
export type PedidoComItens = Prisma.PedidoGetPayload<{ include: typeof pedidoComItensInclude }>;
export type PedidoCompleto = Prisma.PedidoGetPayload<{ include: typeof pedidoCompletoInclude }>;

// Converte um pagamento do banco para a resposta (dinheiro como número). Exportada: o módulo pagamento reaproveita.
export function paraPagamento(pagamento: Pagamento) {
  return {
    id: pagamento.id,
    formaPagamento: pagamento.formaPagamento,
    statusPagamento: pagamento.statusPagamento,
    // Decimal -> número (contrato: valor monetário é número).
    valor: decimalParaNumero(pagamento.valor),
    identificadorExterno: pagamento.identificadorExterno,
    // Data como texto ISO 8601.
    criadoEm: pagamento.criadoEm.toISOString(),
  };
}

// Tradução banco -> frontend (contrato-api-cantinafast.md): o total do pedido sai como `total` (número),
// e cada item traz o nome e a imagem do produto. Os enums (canal, status) seguem como no banco.
// Só inclui `pagamentos` quando o pedido foi carregado com eles (detalhe/criação, não na listagem).
export function paraPedido(pedido: PedidoComItens | PedidoCompleto) {
  // Parte comum a todas as respostas de pedido.
  const base = {
    id: pedido.id,
    canal: pedido.canal,
    status: pedido.status,
    // O banco chama de valorTotal (Decimal); o frontend recebe `total` como número.
    total: decimalParaNumero(pedido.valorTotal),
    usuarioId: pedido.usuarioId,
    // Cliente ainda não está modelado: campo solto, pode ser null.
    clienteId: pedido.clienteId,
    // Data como texto ISO 8601.
    criadoEm: pedido.criadoEm.toISOString(),
    itens: pedido.itens.map((item) => ({
      id: item.id,
      produtoId: item.produtoId,
      nome: item.produto.nome,
      // Sem imagem (null) vira texto vazio, como no módulo de produto.
      imagemUrl: item.produto.imagemUrl ?? "",
      quantidade: item.quantidade,
      // Preço no momento da venda (não muda se o produto for reajustado depois).
      precoUnitario: decimalParaNumero(item.precoUnitario),
      subtotal: decimalParaNumero(item.subtotal),
    })),
  };

  // Pedido carregado com pagamentos: acrescenta a lista.
  if ("pagamentos" in pedido) {
    return { ...base, pagamentos: pedido.pagamentos.map(paraPagamento) };
  }
  // Pedido de listagem: sem pagamentos.
  return base;
}
