import { api, semVazios } from '../lib/api';
import type { Perfil, UsuarioInterno } from '../types';

const BASE = '/interno/usuarios';

export interface FiltroUsuarios {
  busca?: string;
  perfil?: Perfil | '';
  status?: 'ativo' | 'inativo' | '';
}

export interface NovoUsuario {
  nome: string;
  login: string;
  senha: string;
  perfil: Perfil;
}

// O login não é editável; `ativo` inativa (false) ou reativa (true).
export interface EdicaoUsuario {
  nome?: string;
  senha?: string;
  perfil?: Perfil;
  ativo?: boolean;
}

export const usuarioService = {
  async listar(filtro: FiltroUsuarios = {}) {
    const { data } = await api.get<UsuarioInterno[]>(BASE, { params: semVazios({ ...filtro }) });
    return data;
  },

  async criar(dados: NovoUsuario) {
    const { data } = await api.post<UsuarioInterno>(BASE, dados);
    return data;
  },

  async atualizar(id: number, dados: EdicaoUsuario) {
    const { data } = await api.patch<UsuarioInterno>(`${BASE}/${id}`, dados);
    return data;
  },
};
