import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { TelaCarregando } from '../components/ui';
import type { Perfil } from '../types';
import { useAuth } from './AuthContext';

// Só entra quem está logado. Com `perfis`, só entram esses perfis (o backend confere de novo: 403).
export function ProtectedRoute({ perfis, children }: { perfis?: Perfil[]; children?: ReactNode }) {
  const { usuario, carregando } = useAuth();
  const local = useLocation();

  if (carregando) return <TelaCarregando />;
  if (!usuario) return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  if (perfis && !perfis.includes(usuario.perfil)) return <Navigate to="/" replace />;

  return <>{children ?? <Outlet />}</>;
}
