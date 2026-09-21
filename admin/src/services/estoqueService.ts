import { api, semVazios } from '../lib/api';
import type { Estoque, Movimentacao, TipoMovimentacao } from '../types';

export interface NovaMovimentacao {
  produtoId: number;
  // O backend recebe quem fez a movimentação no corpo (não do token).
  usuarioId: number;
  tipo: TipoMovimentacao;
  // ENTRADA, SAIDA e PERDA: maior que zero. AJUSTE: diferente de zero (negativo diminui).
  quantidade: number;
  motivo?: string;
}

export const estoqueService = {
  // GET /estoque: saldo de todos os produtos
  async listar() {
    const { data } = await api.get<Estoque[]>('/estoque');
    return data;
  },

  // PUT /estoque/:produtoId: só o estoque mínimo (a quantidade só muda por movimentação)
  async atualizarMinimo(produtoId: number, estoqueMinimo: number) {
    const { data } = await api.put(`/estoque/${produtoId}`, { estoqueMinimo });
    return data;
  },

  // GET /movimentacoes?produtoId=: mais recentes primeiro (sem paginação)
  async listarMovimentacoes(produtoId?: number) {
    const { data } = await api.get<Movimentacao[]>('/movimentacoes', { params: semVazios({ produtoId }) });
    return data;
  },

  // POST /movimentacoes: grava a movimentação e atualiza o saldo na mesma transação
  async registrarMovimentacao(dados: NovaMovimentacao) {
    const { data } = await api.post('/movimentacoes', dados);
    return data;
  },

  // DELETE /movimentacoes/:id: remove o lançamento e desfaz o efeito no saldo
  async removerMovimentacao(id: number) {
    await api.delete(`/movimentacoes/${id}`);
  },
};
