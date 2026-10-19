// Matriz de permissões do painel: o ÚNICO lugar que diz o que cada perfil pode fazer.
// Se a matriz mudar, troque só este arquivo. As telas, o menu e as rotas perguntam aqui.
//
// O front só ESCONDE o que o perfil não pode usar. Quem BLOQUEIA é o backend (403);
// nunca confie só nesta tabela.
import type { Perfil } from '../types';

export type Acao =
  // Categorias e produtos
  | 'categoria.gerenciar' // criar, editar, inativar e reativar
  | 'produto.gerenciar'
  // Usuários internos
  | 'usuario.gerenciar' // listar, criar, editar e inativar
  // Estoque
  | 'estoque.consultar'
  | 'estoque.ajustar' // estoque mínimo
  // Movimentações de estoque
  | 'movimentacao.listar'
  | 'movimentacao.registrar' // inclusive perdas
  | 'movimentacao.excluir'
  // Pagamentos
  | 'pagamento.ver' // ver os pagamentos de um pedido e a tela de Pagamentos
  | 'pagamento.registrar'
  // Pedidos
  | 'pedido.ver'
  | 'pedido.criar';

const TODOS: Perfil[] = ['administrador', 'caixa', 'atendente'];
const SO_ADMIN: Perfil[] = ['administrador'];
const ADMIN_E_CAIXA: Perfil[] = ['administrador', 'caixa'];

const MATRIZ: Record<Acao, Perfil[]> = {
  'categoria.gerenciar': SO_ADMIN,
  'produto.gerenciar': SO_ADMIN,
  'usuario.gerenciar': SO_ADMIN,
  'estoque.consultar': TODOS,
  'estoque.ajustar': TODOS,
  'movimentacao.listar': TODOS,
  'movimentacao.registrar': TODOS,
  'movimentacao.excluir': SO_ADMIN,
  'pagamento.ver': ADMIN_E_CAIXA,
  'pagamento.registrar': ADMIN_E_CAIXA,
  'pedido.ver': TODOS,
  'pedido.criar': TODOS,
};

// Sem perfil (ninguém logado) nunca pode nada.
export function podeFazer(perfil: Perfil | null | undefined, acao: Acao): boolean {
  if (!perfil) return false;
  return MATRIZ[acao].includes(perfil);
}

// ---- Interface por perfil (não é permissão: só onde e como cada perfil trabalha) ----

// Atendente e Caixa usam o painel no tablet, no balcão: abas grandes embaixo e só as telas do dia a dia.
// O Administrador usa no PC, com o menu lateral completo.
export function usaLayoutBalcao(perfil: Perfil | null | undefined): boolean {
  return perfil === 'atendente' || perfil === 'caixa';
}

// Tela que abre logo depois do login.
export function telaInicial(perfil: Perfil | null | undefined): string {
  if (perfil === 'atendente') return '/pedidos/novo';
  if (perfil === 'caixa') return '/pagamentos';
  return '/pedidos';
}
