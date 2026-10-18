// Permissões por perfil das rotas internas: um único lugar com os conjuntos de perfis, usados nas rotas via exigirPerfil.
// A matriz perfil x rota completa está em tests/teste-permissoes.cjs (que também confere que nenhuma rota interna fica sem regra).
import { PerfilUsuario } from "@prisma/client";

// Só o Administrador/Proprietário: usuários, produtos, categorias e a remoção de movimentações (apaga histórico).
export const SO_ADMIN: PerfilUsuario[] = [PerfilUsuario.ADMINISTRADOR];

// Caixa e Administrador: pagamentos (o PDV Atendimento não recebe pagamento).
export const ADMIN_E_CAIXA: PerfilUsuario[] = [PerfilUsuario.ADMINISTRADOR, PerfilUsuario.CAIXA];

// Os três perfis internos: pedidos e controle de estoque (saldos, mínimo, ajuste e movimentações, exceto remover).
export const TODOS_INTERNOS: PerfilUsuario[] = [PerfilUsuario.ADMINISTRADOR, PerfilUsuario.CAIXA, PerfilUsuario.ATENDENTE];
