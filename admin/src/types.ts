// Tipos que espelham o que a API do backend devolve.

export type Perfil = 'atendente' | 'caixa' | 'administrador';

export interface UsuarioInterno {
  id: number;
  nome: string;
  login: string;
  perfil: Perfil;
  ativo: boolean;
  criadoEm: string;
}

export interface Categoria {
  id: number;
  nome: string;
  ativa: boolean;
}

export interface Produto {
  id: number;
  nome: string;
  descricao: string;
  preco: number;
  imagemUrl: string;
  categoriaId: number;
  categoriaNome: string;
  disponivelOnline: boolean;
  disponivelPresencial: boolean;
  quantidadeDisponivel: number;
  codigoBarras: string | null;
  ativo: boolean;
  criadoEm: string;
}

export type CanalPedido = 'PRESENCIAL' | 'ONLINE';

export type StatusPedido =
  | 'ABERTO'
  | 'ENVIADO_AO_CAIXA'
  | 'AGUARDANDO_PAGAMENTO'
  | 'PAGO'
  | 'RECEBIDO_PELA_CANTINA'
  | 'EM_SEPARACAO'
  | 'PRONTO_PARA_RETIRADA'
  | 'ENTREGUE'
  | 'RETIRADO'
  | 'CANCELADO'
  | 'ESTORNADO';

export type FormaPagamento = 'PIX' | 'CARTAO' | 'DINHEIRO';

export type StatusPagamento = 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'CANCELADO' | 'EXPIRADO' | 'ESTORNADO';

export interface ItemPedido {
  id: number;
  produtoId: number;
  nome: string;
  imagemUrl: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}

export interface Pagamento {
  id: number;
  formaPagamento: FormaPagamento;
  statusPagamento: StatusPagamento;
  valor: number;
  identificadorExterno: string | null;
  criadoEm: string;
}

export interface Pedido {
  id: number;
  canal: CanalPedido;
  status: StatusPedido;
  total: number;
  usuarioId: number;
  clienteId: number | null;
  criadoEm: string;
  itens: ItemPedido[];
  // Só vem no detalhe (GET /pedidos/:id), não na listagem.
  pagamentos?: Pagamento[];
}

export interface PaginaDePedidos {
  dados: Pedido[];
  pagina: number;
  limite: number;
  total: number;
  totalPaginas: number;
}

// Formato de erro de toda a API: { mensagem, campo? }.
export interface ErroApi {
  mensagem: string;
  campo?: string;
}
