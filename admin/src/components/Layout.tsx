import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, usePode } from '../auth/AuthContext';
import { usaLayoutBalcao, type Acao } from '../auth/permissoes';
import { PERFIL_ROTULO } from '../lib/format';
import { IconeEstoque, IconeNovoPedido, IconePagamentos, IconePedidos, IconeSair } from './icones';
import { Button } from './ui';

interface ItemMenu {
  para: string;
  rotulo: string;
  // Sem `acao`, qualquer usuário logado vê o item.
  acao?: Acao;
}

// Escolhe o layout pelo perfil (regra em auth/permissoes.ts): balcão (tablet) ou administrador (PC).
export function Layout() {
  const { usuario } = useAuth();
  return usaLayoutBalcao(usuario?.perfil) ? <LayoutBalcao /> : <LayoutAdministrador />;
}

/* ---------- Balcão: Atendente e Caixa, no tablet ---------- */

// Só as telas do dia a dia, com ícone e texto grandes. As demais rotas continuam existindo.
const ITENS_BALCAO: (ItemMenu & { Icone: ComponentType<{ className?: string }> })[] = [
  { para: '/pedidos/novo', rotulo: 'Novo pedido', acao: 'pedido.criar', Icone: IconeNovoPedido },
  { para: '/pedidos', rotulo: 'Pedidos', acao: 'pedido.ver', Icone: IconePedidos },
  { para: '/pagamentos', rotulo: 'Pagamentos', acao: 'pagamento.ver', Icone: IconePagamentos },
  { para: '/estoque', rotulo: 'Estoque', acao: 'estoque.consultar', Icone: IconeEstoque },
];

function LayoutBalcao() {
  const { usuario, sair } = useAuth();
  const pode = usePode();
  const visiveis = ITENS_BALCAO.filter((item) => !item.acao || pode(item.acao));

  return (
    <div className="min-h-screen">
      <header className="bg-carvao text-creme">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <p className="font-display text-xl font-semibold tracking-tight">
            Cantina<span className="text-brasa-400">Fast</span>
          </p>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <p className="max-w-[12rem] truncate text-sm font-medium">{usuario?.nome}</p>
              <p className="text-xs text-creme/65">{usuario && PERFIL_ROTULO[usuario.perfil]}</p>
            </div>
            <button
              type="button"
              onClick={sair}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/25 px-3 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-400"
            >
              <IconeSair className="h-5 w-5" />
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* pb: espaço para a barra de abas fixa não cobrir o fim da página */}
      <main className="mx-auto max-w-6xl px-4 pb-32 pt-6 sm:px-6">
        <Outlet />
      </main>

      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-carvao/10 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(36,28,22,0.06)] backdrop-blur"
      >
        <ul className="mx-auto flex max-w-3xl">
          {visiveis.map(({ para, rotulo, Icone }) => (
            <li key={para} className="flex-1">
              <NavLink
                to={para}
                end
                className={({ isActive }) =>
                  `mx-1 my-1.5 flex min-h-16 flex-col items-center justify-center gap-1 rounded-card text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600 ${
                    isActive ? 'bg-brasa-50 text-brasa-700' : 'text-carvao/70 hover:bg-carvao/5'
                  }`
                }
              >
                <Icone className="h-7 w-7" />
                {rotulo}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/* ---------- Administrador: no PC ---------- */

const ITENS: ItemMenu[] = [
  { para: '/pedidos/novo', rotulo: 'Novo pedido', acao: 'pedido.criar' },
  { para: '/pedidos', rotulo: 'Pedidos', acao: 'pedido.ver' },
  { para: '/pagamentos', rotulo: 'Pagamentos', acao: 'pagamento.ver' },
  { para: '/produtos', rotulo: 'Produtos' },
  { para: '/estoque', rotulo: 'Estoque', acao: 'estoque.consultar' },
  { para: '/categorias', rotulo: 'Categorias' },
  { para: '/usuarios', rotulo: 'Usuários', acao: 'usuario.gerenciar' },
];

// Áreas previstas na documentação que ainda não têm página.
const EM_BREVE = ['Despesas', 'Fornecedores', 'BI', 'Financeiro', 'Fiscal', 'Sincronização', 'Backup', 'Configurações'];

function LayoutAdministrador() {
  const { usuario, sair } = useAuth();
  const local = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    setMenuAberto(false);
  }, [local.pathname]);

  const pode = usePode();
  const visiveis = ITENS.filter((item) => !item.acao || pode(item.acao));

  return (
    <div className="flex min-h-screen">
      {menuAberto && <div className="fixed inset-0 z-20 bg-carvao/50 lg:hidden" onClick={() => setMenuAberto(false)} aria-hidden="true" />}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-carvao text-creme transition-transform lg:static lg:translate-x-0 ${
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
        <header className="flex items-center gap-3 border-b border-carvao/10 bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuAberto(true)}
            aria-label="Abrir menu"
            className="min-h-11 rounded-md border border-carvao/25 px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600"
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
