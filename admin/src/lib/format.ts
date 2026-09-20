import type { CanalPedido, FormaPagamento, Perfil, StatusPagamento, StatusPedido } from '../types';

export type Tom = 'neutro' | 'verde' | 'laranja' | 'vermelho' | 'azul' | 'amarelo';

const moedaBR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (valor: number) => moedaBR.format(valor);

export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

// Converte "12,50", "12.5" ou "1.234,50" em número. Devolve null se for inválido,
// zero/negativo ou tiver mais de 2 casas decimais (mesma regra do backend).
export function lerPreco(texto: string): number | null {
  const t = texto.trim();
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const numero = Number(normal);
  return numero > 0 && numero <= 99999999.99 ? numero : null;
}

export const PERFIL_ROTULO: Record<Perfil, string> = {
  atendente: 'Atendente',
  caixa: 'Caixa',
  administrador: 'Administrador',
};

export const CANAL_ROTULO: Record<CanalPedido, string> = {
  PRESENCIAL: 'Presencial',
  ONLINE: 'Online',
};

export const STATUS_PEDIDO_ROTULO: Record<StatusPedido, string> = {
  ABERTO: 'Aberto',
  ENVIADO_AO_CAIXA: 'Enviado ao caixa',
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  PAGO: 'Pago',
  RECEBIDO_PELA_CANTINA: 'Recebido pela cantina',
  EM_SEPARACAO: 'Em separação',
  PRONTO_PARA_RETIRADA: 'Pronto para retirada',
  ENTREGUE: 'Entregue',
  RETIRADO: 'Retirado',
  CANCELADO: 'Cancelado',
  ESTORNADO: 'Estornado',
};

export const STATUS_PEDIDO_TOM: Record<StatusPedido, Tom> = {
  ABERTO: 'neutro',
  ENVIADO_AO_CAIXA: 'azul',
  AGUARDANDO_PAGAMENTO: 'amarelo',
  PAGO: 'verde',
  RECEBIDO_PELA_CANTINA: 'azul',
  EM_SEPARACAO: 'amarelo',
  PRONTO_PARA_RETIRADA: 'laranja',
  ENTREGUE: 'verde',
  RETIRADO: 'verde',
  CANCELADO: 'vermelho',
  ESTORNADO: 'vermelho',
};

export const FORMA_PAGAMENTO_ROTULO: Record<FormaPagamento, string> = {
  PIX: 'Pix',
  CARTAO: 'Cartão',
  DINHEIRO: 'Dinheiro',
};

export const STATUS_PAGAMENTO_ROTULO: Record<StatusPagamento, string> = {
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  RECUSADO: 'Recusado',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
  ESTORNADO: 'Estornado',
};

export const STATUS_PAGAMENTO_TOM: Record<StatusPagamento, Tom> = {
  PENDENTE: 'amarelo',
  APROVADO: 'verde',
  RECUSADO: 'vermelho',
  CANCELADO: 'neutro',
  EXPIRADO: 'neutro',
  ESTORNADO: 'vermelho',
};
