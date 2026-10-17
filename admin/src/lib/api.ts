import axios from 'axios';
import type { ErroApi } from '../types';

const CHAVE_TOKEN = 'cantinafast.admin.token';

export const tokenStorage = {
  ler: () => localStorage.getItem(CHAVE_TOKEN),
  salvar: (token: string) => localStorage.setItem(CHAVE_TOKEN, token),
  limpar: () => localStorage.removeItem(CHAVE_TOKEN),
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

// Anexa o token em toda requisição.
api.interceptors.request.use((config) => {
  const token = tokenStorage.ler();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// O AuthContext registra aqui o que fazer quando a sessão cai.
let aoExpirarSessao: (() => void) | null = null;
export function aoExpirar(funcao: (() => void) | null) {
  aoExpirarSessao = funcao;
}

// 401 fora do login = token vencido, usuário inativado ou removido: encerra a sessão.
// No próprio /interno/login o 401 só quer dizer "login ou senha inválidos".
api.interceptors.response.use(
  (resposta) => resposta,
  (erro) => {
    const ehLogin = erro?.config?.url === '/interno/login';
    if (erro?.response?.status === 401 && !ehLogin) {
      tokenStorage.limpar();
      aoExpirarSessao?.();
    }
    return Promise.reject(erro);
  },
);

export interface ErroLido {
  mensagem: string;
  campo?: string;
  status?: number;
}

// Converte qualquer erro do axios em { mensagem, campo?, status? } para a tela mostrar.
export function lerErro(erro: unknown): ErroLido {
  if (axios.isAxiosError(erro)) {
    if (!erro.response) {
      return { mensagem: 'Não foi possível conectar ao servidor. Verifique se a API está no ar.' };
    }
    // A maior parte da API responde { mensagem, campo? }; o módulo de estoque responde { erro }.
    const dados: Partial<ErroApi> & { erro?: string } =
      typeof erro.response.data === 'object' && erro.response.data !== null ? erro.response.data : {};
    const status = erro.response.status;
    const texto = dados.mensagem ?? dados.erro;
    if (texto) return { mensagem: texto, campo: dados.campo, status };
    if (status >= 500) return { mensagem: 'O servidor não respondeu como esperado. Verifique se a API está no ar.', status };
    return { mensagem: 'Erro inesperado. Tente novamente.', status };
  }
  return { mensagem: 'Erro inesperado. Tente novamente.' };
}

// Tira do objeto os parâmetros vazios, para não mandar "?busca=" na URL.
export function semVazios(params: Record<string, string | number | undefined>) {
  return Object.fromEntries(Object.entries(params).filter(([, valor]) => valor !== undefined && valor !== ''));
}
