// Tipo do pagamento vindo do banco.
import type { Pagamento } from "@prisma/client";
// Conversão de um pagamento (com dinheiro como número) já usada nas respostas de pedido.
import { paraPagamento as paraPagamentoBase } from "../pedido/pedido.mapper";

// Resposta de um pagamento nas rotas deste módulo: os mesmos campos que aparecem dentro do pedido,
// mais o `pedidoId` (aqui o pagamento vem fora do pedido, então precisa dizer a qual ele pertence).
export function paraPagamento(pagamento: Pagamento) {
  return {
    // Campos comuns: id, formaPagamento, statusPagamento, valor (número), identificadorExterno e criadoEm.
    ...paraPagamentoBase(pagamento),
    // Pedido ao qual o pagamento pertence.
    pedidoId: pagamento.pedidoId,
  };
}
