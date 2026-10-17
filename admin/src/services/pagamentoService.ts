import { api } from '../lib/api';
import type { FormaPagamento, Pagamento, StatusPedido } from '../types';

// Estados em que o pedido ainda não foi pago e pode receber pagamento (mesma lista do backend).
// PAGO, CANCELADO, ESTORNADO e os estados posteriores ao pagamento são recusados com 400.
export const STATUS_PAGAVEIS: StatusPedido[] = ['ABERTO', 'ENVIADO_AO_CAIXA', 'AGUARDANDO_PAGAMENTO'];

export interface NovoPagamento {
  pedidoId: number;
  formaPagamento: FormaPagamento;
  // Nesta versão do backend o valor precisa ser IGUAL ao total do pedido (não há pagamento parcial).
  valor: number;
}

// Resposta do POST /pagamentos: o pagamento (já APROVADO) e o novo estado do pedido.
export interface PagamentoRegistrado extends Pagamento {
  pedidoId: number;
  pedido: { id: number; status: StatusPedido; total: number };
}

export const pagamentoService = {
  // POST /pagamentos: registra o pagamento como aprovado e marca o pedido como PAGO (numa transação).
  async registrar(dados: NovoPagamento) {
    const { data } = await api.post<PagamentoRegistrado>('/pagamentos', dados);
    return data;
  },

  // GET /pagamentos/pedido/:pedidoId
  async listarDoPedido(pedidoId: number) {
    const { data } = await api.get<(Pagamento & { pedidoId: number })[]>(`/pagamentos/pedido/${pedidoId}`);
    return data;
  },
};
