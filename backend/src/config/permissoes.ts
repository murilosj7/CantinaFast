// Permissões por perfil das rotas internas: um único lugar com os conjuntos de perfis, usados nas rotas via exigirPerfil.
// A matriz perfil x rota completa está em tests/teste-permissoes.cjs (que também confere que nenhuma rota interna fica sem regra).
import { PerfilUsuario } from "@prisma/client";

// Só o Administrador/Proprietário: usuários, produtos, categorias, ajuste de estoque, mínimo, histórico de movimentações.
export const SO_ADMIN: PerfilUsuario[] = [PerfilUsuario.ADMINISTRADOR];

// Caixa e Administrador: pagamentos (o PDV Atendimento não recebe pagamento) e registro de perdas (decisão do dono, D19).
export const ADMIN_E_CAIXA: PerfilUsuario[] = [PerfilUsuario.ADMINISTRADOR, PerfilUsuario.CAIXA];

// Os três perfis internos: basta estar autenticado como usuário interno (pedidos, leitura de saldos).
export const TODOS_INTERNOS: PerfilUsuario[] = [PerfilUsuario.ADMINISTRADOR, PerfilUsuario.CAIXA, PerfilUsuario.ATENDENTE];
