// Importa só o tipo Prisma (para descrever o tipo Decimal); não vira código no arquivo final.
import type { Prisma } from "@prisma/client";

// O Prisma devolve colunas Decimal como Prisma.Decimal, que o JSON serializa como STRING ("12.5").
// O contrato do frontend exige valor monetário como número (12.5): converta aqui, na resposta.
// O banco continua Decimal(12,2) — a conversão vale só para a saída da API.
export function decimalParaNumero(valor: Prisma.Decimal): number {
  // toNumber() transforma o Decimal do Prisma em um número comum do JavaScript.
  return valor.toNumber();
}
