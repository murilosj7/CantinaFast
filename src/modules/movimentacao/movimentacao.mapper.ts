// Tipo Prisma usado para descrever o formato da movimentação com as relações carregadas.
import type { Prisma } from "@prisma/client";

// Relações que toda consulta de movimentação carrega: só id e nome do produto e de quem lançou.
export const movimentacaoInclude = {
  produto: { select: { id: true, nome: true } },
  usuario: { select: { id: true, nome: true } },
  // `satisfies` só confere o formato com o tipo do Prisma, sem alargar o tipo.
} satisfies Prisma.MovimentacaoEstoqueInclude;

// Tipo da movimentação do banco JÁ com produto e usuário carregados.
export type MovimentacaoComRelacoes = Prisma.MovimentacaoEstoqueGetPayload<{ include: typeof movimentacaoInclude }>;

// Formato de resposta (GET /movimentacoes e POST /movimentacoes). `quantidade` sai como foi gravada:
// positiva em ENTRADA/SAIDA/PERDA (a direção está no tipo) e com sinal em AJUSTE.
export function paraMovimentacao(m: MovimentacaoComRelacoes) {
  return {
    id: m.id,
    produtoId: m.produtoId,
    usuarioId: m.usuarioId,
    produto: { id: m.produto.id, nome: m.produto.nome },
    tipo: m.tipo,
    quantidade: m.quantidade,
    // Sem motivo o banco guarda null e a tela aceita null.
    motivo: m.motivo,
    // Data como texto ISO 8601.
    criadoEm: m.criadoEm.toISOString(),
    usuario: { id: m.usuario.id, nome: m.usuario.nome },
  };
}
