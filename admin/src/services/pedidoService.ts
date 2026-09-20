import { api, semVazios } from '../lib/api';
import type { CanalPedido, PaginaDePedidos, Pedido, StatusPedido } from '../types';

export interface FiltroPedidos {
  pagina?: number;
  limite?: number;
  status?: StatusPedido | '';
  canal?: CanalPedido | '';
}

export interface NovoPedido {
  canal: CanalPedido;
  itens: { produtoId: number; quantidade: number }[];
}

export const pedidoService = {
  async listar(filtro: FiltroPedidos = {}) {
    const { data } = await api.get<PaginaDePedidos>('/pedidos', { params: semVazios({ ...filtro }) });
    return data;
  },

  // POST /pedidos: valida estoque, grava o pedido (status ABERTO) e dá baixa no estoque.
  // O usuário do pedido é o do token; o preço vem do produto (o front não envia preço).
  async criar(dados: NovoPedido) {
    const { data } = await api.post<Pedido>('/pedidos', dados);
    return data;
  },

  // Detalhe com itens e pagamentos.
  async buscar(id: number) {
    const { data } = await api.get<Pedido>(`/pedidos/${id}`);
    return data;
  },
};
