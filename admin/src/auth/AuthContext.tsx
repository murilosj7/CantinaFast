import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { aoExpirar, tokenStorage } from '../lib/api';
import { authService } from '../services/authService';
import type { UsuarioInterno } from '../types';

interface AuthContextValor {
  usuario: UsuarioInterno | null;
  // true enquanto confirma o token guardado com GET /interno/me.
  carregando: boolean;
  // Mensagem mostrada no login quando a sessão caiu (token vencido, usuário inativado...).
  aviso: string | null;
  entrar: (login: string, senha: string) => Promise<void>;
  sair: () => void;
  limparAviso: () => void;
}

const AuthContext = createContext<AuthContextValor | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioInterno | null>(null);
  const [carregando, setCarregando] = useState(() => tokenStorage.ler() !== null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Qualquer 401 fora do login derruba a sessão (ver interceptor em lib/api.ts).
  useEffect(() => {
    aoExpirar(() => {
      setUsuario(null);
      setAviso('Sua sessão expirou ou foi encerrada. Entre novamente.');
    });
    return () => aoExpirar(null);
  }, []);

  // Ao abrir o painel com um token guardado, confirma no backend quem é o usuário.
  useEffect(() => {
    if (!tokenStorage.ler()) return;
    let cancelado = false;
    authService
      .me()
      .then((u) => {
        if (!cancelado) setUsuario(u);
      })
      .catch(() => {
        // 401 já foi tratado pelo interceptor; outros erros (API fora do ar) deixam o usuário no login.
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const entrar = useCallback(async (login: string, senha: string) => {
    const resposta = await authService.login(login, senha);
    tokenStorage.salvar(resposta.token);
    setAviso(null);
    setUsuario(resposta.usuario);
  }, []);

  const sair = useCallback(() => {
    tokenStorage.limpar();
    setUsuario(null);
  }, []);

  const limparAviso = useCallback(() => setAviso(null), []);

  const valor = useMemo(
    () => ({ usuario, carregando, aviso, entrar, sair, limparAviso }),
    [usuario, carregando, aviso, entrar, sair, limparAviso],
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (!contexto) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return contexto;
}
