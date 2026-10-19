import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import type { Tom } from '../lib/format';

/* ---------- Botão ---------- */

// Só vale em tela de toque (pointer: coarse): no PC com mouse o tamanho não muda.
export const TOQUE = '[@media(pointer:coarse)]:min-h-11';

type Variante = 'primario' | 'secundario' | 'perigo' | 'fantasma';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-brasa-600 text-white hover:bg-brasa-700 focus-visible:ring-brasa-600',
  secundario: 'border border-carvao/25 bg-white text-carvao hover:bg-carvao/5 focus-visible:ring-carvao/50',
  perigo: 'bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-700',
  fantasma: 'text-brasa-700 hover:bg-brasa-50 focus-visible:ring-brasa-600',
};

export function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
      aria-hidden="true"
    />
  );
}

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: 'md' | 'sm';
  carregando?: boolean;
}

export function Button({
  variante = 'primario',
  tamanho = 'md',
  carregando = false,
  type = 'button',
  className = '',
  disabled,
  children,
  ...resto
}: BotaoProps) {
  const medidas = tamanho === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-4 py-2 text-sm';
  // Em tela de toque (tablet) todo botão tem pelo menos 44px de altura, o mínimo confortável para o dedo.
  return (
    <button
      type={type}
      disabled={disabled || carregando}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${TOQUE} ${medidas} ${VARIANTES[variante]} ${className}`}
      {...resto}
    >
      {carregando && <Spinner />}
      {children}
    </button>
  );
}

// Link com cara de botão (navega sem recarregar a página).
export function BotaoLink({ para, variante = 'primario', children }: { para: string; variante?: Variante; children: ReactNode }) {
  return (
    <Link
      to={para}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${TOQUE} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${VARIANTES[variante]}`}
    >
      {children}
    </Link>
  );
}

/* ---------- Campos de formulário ---------- */

// No toque: 44px de altura e fonte de 16px (abaixo disso o navegador do tablet dá zoom ao focar o campo).
const CAMPO =
  'block w-full rounded-md border bg-white px-3 py-2 text-sm placeholder:text-carvao/45 focus:outline-none focus:ring-2 disabled:bg-carvao/5 disabled:text-carvao/60 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-base';
const CAMPO_OK = 'border-carvao/25 focus:border-brasa-600 focus:ring-brasa-600/30';
const CAMPO_ERRO = 'border-red-600 focus:border-red-600 focus:ring-red-600/30';

function acessibilidade(id: string | undefined, erro: string | undefined) {
  return {
    'aria-invalid': erro ? (true as const) : undefined,
    'aria-describedby': erro && id ? `${id}-erro` : undefined,
  };
}

interface ComErro {
  erro?: string;
}

export function Entrada({ erro, className = '', id, ...resto }: InputHTMLAttributes<HTMLInputElement> & ComErro) {
  return <input id={id} className={`${CAMPO} ${erro ? CAMPO_ERRO : CAMPO_OK} ${className}`} {...acessibilidade(id, erro)} {...resto} />;
}

export function Selecao({ erro, className = '', id, children, ...resto }: SelectHTMLAttributes<HTMLSelectElement> & ComErro) {
  return (
    <select id={id} className={`${CAMPO} ${erro ? CAMPO_ERRO : CAMPO_OK} ${className}`} {...acessibilidade(id, erro)} {...resto}>
      {children}
    </select>
  );
}

export function AreaTexto({ erro, className = '', id, ...resto }: TextareaHTMLAttributes<HTMLTextAreaElement> & ComErro) {
  return <textarea id={id} className={`${CAMPO} ${erro ? CAMPO_ERRO : CAMPO_OK} ${className}`} {...acessibilidade(id, erro)} {...resto} />;
}

export function Campo({
  rotulo,
  id,
  erro,
  dica,
  obrigatorio,
  children,
}: {
  rotulo: string;
  id: string;
  erro?: string;
  dica?: string;
  obrigatorio?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {rotulo}
        {obrigatorio && <span className="text-brasa-700"> *</span>}
      </label>
      {children}
      {erro ? (
        <p id={`${id}-erro`} role="alert" className="mt-1 text-sm text-red-700">
          {erro}
        </p>
      ) : (
        dica && <p className="mt-1 text-xs text-carvao/65">{dica}</p>
      )}
    </div>
  );
}

export function Interruptor({
  rotulo,
  marcado,
  aoMudar,
  disabled,
}: {
  rotulo: string;
  marcado: boolean;
  aoMudar: (valor: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm [@media(pointer:coarse)]:min-h-11">
      <input
        type="checkbox"
        className="h-4 w-4 accent-brasa-600 [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-5"
        checked={marcado}
        disabled={disabled}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      {rotulo}
    </label>
  );
}

/* ---------- Escolha entre poucas opções (no lugar de lista suspensa) ---------- */

// Botões lado a lado, um selecionado. Mais rápido no toque do que abrir um <select>.
export function Segmentado<T extends string>({
  rotulo,
  opcoes,
  valor,
  aoMudar,
  className = 'grid-cols-2',
}: {
  rotulo: string;
  opcoes: { valor: T; rotulo: string }[];
  valor: T;
  aoMudar: (valor: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={`grid gap-2 ${className}`}>
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => aoMudar(o.valor)}
            className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600 focus-visible:ring-offset-1 ${
              ativo ? 'border-brasa-600 bg-brasa-600 text-white' : 'border-carvao/20 bg-white text-carvao hover:bg-carvao/5'
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

// Abas de página (Saldos/Movimentações, A receber/Recebidos).
export function Abas<T extends string>({
  rotulo,
  abas,
  valor,
  aoMudar,
}: {
  rotulo: string;
  abas: { valor: T; rotulo: string }[];
  valor: T;
  aoMudar: (valor: T) => void;
}) {
  return (
    <div role="tablist" aria-label={rotulo} className="flex gap-1 border-b border-carvao/15">
      {abas.map((a) => (
        <button
          key={a.valor}
          type="button"
          role="tab"
          aria-selected={valor === a.valor}
          onClick={() => aoMudar(a.valor)}
          className={`-mb-px min-h-11 border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600 [@media(pointer:coarse)]:px-5 [@media(pointer:coarse)]:text-base ${
            valor === a.valor ? 'border-brasa-600 text-brasa-700' : 'border-transparent text-carvao/70 hover:text-carvao'
          }`}
        >
          {a.rotulo}
        </button>
      ))}
    </div>
  );
}

// Cartão tocável usado no lugar da linha de tabela em telas estreitas (tablet em pé).
export function CartaoLista({ children }: { children: ReactNode }) {
  return <ul className="grid gap-3 sm:grid-cols-2">{children}</ul>;
}

export function MensagemVazia({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-carvao/10 bg-white px-4 py-10 text-center text-carvao/65">{children}</p>;
}

/* ---------- Feedback ---------- */

const ALERTAS = {
  erro: 'border-red-300 bg-red-50 text-red-900',
  sucesso: 'border-oliva-300 bg-oliva-50 text-oliva-900',
  aviso: 'border-amber-300 bg-amber-50 text-amber-900',
} as const;

export function Alerta({
  tipo = 'erro',
  acao,
  children,
}: {
  tipo?: keyof typeof ALERTAS;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tipo === 'erro' ? 'alert' : 'status'}
      className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm ${ALERTAS[tipo]}`}
    >
      <p>{children}</p>
      {acao}
    </div>
  );
}

const TONS: Record<Tom, string> = {
  neutro: 'bg-carvao/10 text-carvao',
  verde: 'bg-oliva-100 text-oliva-800',
  laranja: 'bg-brasa-100 text-brasa-800',
  vermelho: 'bg-red-100 text-red-800',
  azul: 'bg-sky-100 text-sky-900',
  amarelo: 'bg-amber-100 text-amber-900',
};

export function Badge({ tom = 'neutro', children }: { tom?: Tom; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONS[tom]}`}>
      {children}
    </span>
  );
}

export function TelaCarregando() {
  return (
    <div role="status" className="flex min-h-screen items-center justify-center gap-3 text-carvao/70">
      <Spinner />
      Carregando…
    </div>
  );
}

/* ---------- Estrutura de página ---------- */

export function PaginaCabecalho({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-semibold">{titulo}</h1>
        {descricao && <p className="mt-1 max-w-prose text-sm text-carvao/70">{descricao}</p>}
      </div>
      {acao}
    </div>
  );
}

// Classes compartilhadas pelas tabelas das páginas.
export const tabela = {
  caixa: 'overflow-x-auto rounded-card border border-carvao/10 bg-white',
  base: 'min-w-full text-left text-sm',
  cabecalho: 'border-b border-carvao/10 bg-carvao/[0.03]',
  th: 'whitespace-nowrap px-4 py-3 font-semibold',
  td: 'px-4 py-3 align-middle',
  linha: 'border-b border-carvao/5 last:border-0',
};

export function LinhaMensagem({ colunas, children }: { colunas: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colunas} className="px-4 py-10 text-center text-carvao/65">
        {children}
      </td>
    </tr>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  aberto,
  titulo,
  aoFechar,
  largura = 'max-w-lg',
  children,
}: {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  largura?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-carvao/60 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={titulo} className={`w-full ${largura} rounded-card bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-carvao/10 px-5 py-4">
          <h2 className="text-xl font-semibold">{titulo}</h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="min-h-11 min-w-11 rounded-md px-2 py-1 text-carvao/60 hover:bg-carvao/10 hover:text-carvao focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Confirmacao({
  aberto,
  titulo,
  mensagem,
  rotulo,
  processando,
  aoConfirmar,
  aoCancelar,
}: {
  aberto: boolean;
  titulo: string;
  mensagem: string;
  rotulo: string;
  processando: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  return (
    <Modal aberto={aberto} titulo={titulo} aoFechar={aoCancelar} largura="max-w-md">
      <p className="text-sm">{mensagem}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variante="secundario" onClick={aoCancelar} disabled={processando}>
          Cancelar
        </Button>
        <Button variante="perigo" onClick={aoConfirmar} carregando={processando}>
          {rotulo}
        </Button>
      </div>
    </Modal>
  );
}
