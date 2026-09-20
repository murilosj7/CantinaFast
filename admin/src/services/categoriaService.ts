import { api, semVazios } from '../lib/api';
import type { Categoria } from '../types';

export interface FiltroCategorias {
  busca?: string;
  // Sem status a API devolve só as ativas; o painel pede "todas".
  status?: 'ativa' | 'inativa' | 'todas';
}

export const categoriaService = {
  async listar(filtro: FiltroCategorias = {}) {
    const { data } = await api.get<Categoria[]>('/categorias', { params: semVazios({ ...filtro }) });
    return data;
  },

  async criar(nome: string) {
    const { data } = await api.post<Categoria>('/categorias', { nome });
    return data;
  },

  // `ativa` inativa (false) ou reativa (true).
  async atualizar(id: number, dados: { nome?: string; ativa?: boolean }) {
    const { data } = await api.patch<Categoria>(`/categorias/${id}`, dados);
    return data;
  },
};
