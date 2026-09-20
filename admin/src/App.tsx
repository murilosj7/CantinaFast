import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Layout } from './components/Layout';
import { CategoriasPage } from './pages/CategoriasPage';
import { LoginPage } from './pages/LoginPage';
import { PedidosPage } from './pages/PedidosPage';
import { ProdutosPage } from './pages/ProdutosPage';
import { UsuariosPage } from './pages/UsuariosPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/pedidos" replace />} />
        <Route path="pedidos" element={<PedidosPage />} />
        <Route path="produtos" element={<ProdutosPage />} />
        <Route path="categorias" element={<CategoriasPage />} />
        <Route
          path="usuarios"
          element={
            <ProtectedRoute perfis={['administrador']}>
              <UsuariosPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
