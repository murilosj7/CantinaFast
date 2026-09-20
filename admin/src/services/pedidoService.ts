import { api, semVazios } from '../lib/api';
import type { CanalPedido, PaginaDePedidos, Pedido, StatusPedido } from '../types';

export interface FiltroPedidos {
  pagina?: number;
  limite?: number;
  status?: StatusPedido | '';
  canal?: CanalPedido | '';
}

export const pedidoService = {
  async listar(filtro: FiltroPedidos = {}) {
    const { data } = await api.get<PaginaDePedidos>('/pedidos', { params: semVazios({ ...filtro }) });
    return data;
  },

  // Detalhe com itens e pagamentos.
  async buscar(id: number) {
    const { data } = await api.get<Pedido>(`/pedidos/${id}`);
    return data;
  },
};
