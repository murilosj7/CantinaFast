import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { TelaCarregando } from '../components/ui';
import { useAuth } from './AuthContext';
import { podeFazer, type Acao } from './permissoes';

// Só entra quem está logado. Com `acao`, só entra quem pode fazê-la (podeFazer); o backend confere de novo (403).
export function ProtectedRoute({ acao, children }: { acao?: Acao; children?: ReactNode }) {
  const { usuario, carregando } = useAuth();
  const local = useLocation();

  if (carregando) return <TelaCarregando />;
  if (!usuario) return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  if (acao && !podeFazer(usuario.perfil, acao)) return <Navigate to="/" replace />;

  return <>{children ?? <Outlet />}</>;
}
