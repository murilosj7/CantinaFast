import { api } from '../lib/api';
import type { UsuarioInterno } from '../types';

export const authService = {
  // POST /interno/login -> { usuario, token }
  async login(login: string, senha: string) {
    const { data } = await api.post<{ usuario: UsuarioInterno; token: string }>('/interno/login', { login, senha });
    return data;
  },

  // GET /interno/me -> o usuário dono do token (o backend já barra usuário inativo com 401)
  async me() {
    const { data } = await api.get<UsuarioInterno>('/interno/me');
    return data;
  },
};
