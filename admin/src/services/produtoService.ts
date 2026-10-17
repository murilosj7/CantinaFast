import { api, semVazios } from '../lib/api';
import type { Produto } from '../types';

export interface FiltroProdutos {
  busca?: string;
  categoriaId?: number;
  // Sem status a API devolve só os ativos; o painel pede "todos".
  status?: 'ativo' | 'inativo' | 'todos';
}

export interface DadosProduto {
  nome: string;
  preco: number;
  categoriaId: number;
  // Texto vazio limpa o campo no backend.
  descricao: string;
  codigoBarras: string;
  imagemUrl: string;
  disponivelPresencial: boolean;
  disponivelOnline: boolean;
}

export const produtoService = {
  async listar(filtro: FiltroProdutos = {}) {
    const { data } = await api.get<Produto[]>('/produtos', { params: semVazios({ ...filtro }) });
    return data;
  },

  // quantidadeInicial só existe na criação: cria o estoque e a movimentação de ENTRADA.
  async criar(dados: DadosProduto & { quantidadeInicial?: number }) {
    const { data } = await api.post<Produto>('/produtos', dados);
    return data;
  },

  // `ativo` inativa (false) ou reativa (true).
  async atualizar(id: number, dados: Partial<DadosProduto> & { ativo?: boolean }) {
    const { data } = await api.patch<Produto>(`/produtos/${id}`, dados);
    return data;
  },
};
