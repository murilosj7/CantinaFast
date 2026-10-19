// Ícones de traço simples (24x24), desenhados aqui para não depender de biblioteca.
// Sempre decorativos: o texto ao lado é que diz o que o botão faz.
import type { ReactNode } from 'react';

function Icone({ children, className = 'h-6 w-6' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

type Props = { className?: string };

export const IconeNovoPedido = (p: Props) => (
  <Icone {...p}>
    <path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2" />
    <circle cx="9" cy="19" r="1.4" />
    <circle cx="17" cy="19" r="1.4" />
    <path d="M13 9.5v4M11 11.5h4" />
  </Icone>
);

export const IconePedidos = (p: Props) => (
  <Icone {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Icone>
);

export const IconePagamentos = (p: Props) => (
  <Icone {...p}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
    <path d="M7 15h3" />
  </Icone>
);

export const IconeEstoque = (p: Props) => (
  <Icone {...p}>
    <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" />
    <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
  </Icone>
);

export const IconeSair = (p: Props) => (
  <Icone {...p}>
    <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Icone>
);

export const IconeBusca = (p: Props) => (
  <Icone {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icone>
);
