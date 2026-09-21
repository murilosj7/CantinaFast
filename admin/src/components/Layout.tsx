import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PERFIL_ROTULO } from '../lib/format';
import type { Perfil } from '../types';
import { Button } from './ui';

interface ItemMenu {
  para: string;
  rotulo: string;
  perfis?: Perfil[];
}

const ITENS: ItemMenu[] = [
  { para: '/pedidos/novo', rotulo: 'Novo pedido' },
  { para: '/pedidos', rotulo: 'Pedidos' },
  { para: '/produtos', rotulo: 'Produtos' },
  { para: '/estoque', rotulo: 'Estoque' },
  { para: '/categorias', rotulo: 'Categorias' },
  { para: '/usuarios', rotulo: 'Usuários', perfis: ['administrador'] },
];

// Áreas previstas na documentação que ainda não têm página.
const EM_BREVE = ['Despesas', 'Fornecedores', 'BI', 'Financeiro', 'Fiscal', 'Sincronização', 'Backup', 'Configurações'];

export function Layout() {
  const { usuario, sair } = useAuth();
  const local = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    setMenuAberto(false);
  }, [local.pathname]);

  const visiveis = ITENS.filter((item) => !item.perfis || (usuario && item.perfis.includes(usuario.perfil)));

  return (
    <div className="flex min-h-screen">
      {menuAberto && <div className="fixed inset-0 z-20 bg-carvao/50 md:hidden" onClick={() => setMenuAberto(false)} aria-hidden="true" />}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-carvao text-creme transition-transform md:static md:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 pb-4 pt-6">
          <p className="font-display text-2xl font-semibold tracking-tight">
            Cantina<span className="text-brasa-400">Fast</span>
          </p>
          <p className="text-sm text-creme/60">Administrador</p>
        </div>

        <nav aria-label="Principal" className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="space-y-1">
            {visiveis.map((item) => (
              <li key={item.para}>
                <NavLink
                  to={item.para}
                  end
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-400 ${
                      isActive ? 'bg-brasa-600 text-white' : 'text-creme/85 hover:bg-white/10'
                    }`
                  }
                >
                  {item.rotulo}
                </NavLink>
              </li>
            ))}
          </ul>

          <p className="mb-1 mt-6 px-3 text-xs text-creme/50">Em breve</p>
          <ul className="space-y-1">
            {EM_BREVE.map((rotulo) => (
              <li key={rotulo}>
                <span aria-disabled="true" className="block cursor-not-allowed rounded-md px-3 py-2 text-sm text-creme/45">
                  {rotulo}
                </span>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-sm font-medium">{usuario?.nome}</p>
          <p className="mb-3 text-xs text-creme/60">{usuario && PERFIL_ROTULO[usuario.perfil]}</p>
          <Button variante="secundario" tamanho="sm" onClick={sair} className="w-full">
            Sair
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-3 border-b border-carvao/10 bg-white px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMenuAberto(true)}
            aria-label="Abrir menu"
            className="rounded-md border border-carvao/25 px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600"
          >
            Menu
          </button>
          <span className="font-display text-lg font-semibold">
            Cantina<span className="text-brasa-600">Fast</span>
          </span>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
