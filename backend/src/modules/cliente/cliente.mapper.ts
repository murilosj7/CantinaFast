// Tipos do Prisma: o select permitido e o formato do resultado.
import type { Prisma } from "@prisma/client";

// Campos que PODEM sair da API. O senhaHash e o loginGoogle ficam de fora de propósito: nunca são lidos do banco
// nas respostas (select explícito), então não há como vazarem por engano.
export const clienteSelect = {
  id: true,
  nome: true,
  email: true,
  telefone: true,
  ativo: true,
} satisfies Prisma.ClienteSelect;

// Cliente lido com o select acima.
export type ClienteLido = Prisma.ClienteGetPayload<{ select: typeof clienteSelect }>;

// Formato do "usuario" do site (contrato do frontend): telefone vem como texto vazio quando não foi informado.
export type ClienteSite = {
  id: number;
  nome: string;
  email: string;
  telefone: string;
};

// Visão interna (painel do administrador): o mesmo formato do site mais a situação da conta.
export type ClienteInterno = ClienteSite & { ativo: boolean };

// Monta o cliente no formato do site, escolhendo campo a campo.
export function paraClienteSite(cliente: ClienteLido): ClienteSite {
  return {
    id: cliente.id,
    nome: cliente.nome,
    // Conta criada só com login Google pode não ter e-mail: devolve texto vazio em vez de null.
    email: cliente.email ?? "",
    telefone: cliente.telefone ?? "",
  };
}

// Monta o cliente na visão interna: formato do site + ativo.
export function paraClienteInterno(cliente: ClienteLido): ClienteInterno {
  return { ...paraClienteSite(cliente), ativo: cliente.ativo };
}
