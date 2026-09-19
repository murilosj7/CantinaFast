import { AppError } from "../middlewares/errorHandler";

const MAX_INT32 = 2147483647;

// Converte um id vindo da URL/corpo em inteiro positivo; caso contrário responde 400.
export function parseId(valor: unknown, campo = "id"): number {
  const texto = typeof valor === "string" ? valor.trim() : valor;
  const numero = typeof texto === "string" && /^\d+$/.test(texto) ? Number(texto) : texto;

  if (typeof numero !== "number" || !Number.isInteger(numero) || numero < 1 || numero > MAX_INT32) {
    throw new AppError(`O campo '${campo}' deve ser um número inteiro positivo.`, 400, campo);
  }
  return numero;
}
