// Importa o AppError para poder recusar um id inválido com status 400.
import { AppError } from "../middlewares/errorHandler";

// Maior valor que cabe numa coluna inteira (Int) do PostgreSQL; acima disso o banco daria erro.
const MAX_INT32 = 2147483647;

// Converte um id vindo da URL/corpo em inteiro positivo; caso contrário responde 400.
// `campo` é o nome que aparece na mensagem de erro (padrão "id").
export function parseId(valor: unknown, campo = "id"): number {
  // Se for texto, tira espaços das pontas; se for outro tipo, mantém como está.
  const texto = typeof valor === "string" ? valor.trim() : valor;
  // Se o texto tem só dígitos, converte para número; senão deixa como veio (e falha na checagem abaixo).
  const numero = typeof texto === "string" && /^\d+$/.test(texto) ? Number(texto) : texto;

  // Recusa se não for número, não for inteiro, for menor que 1 ou maior que o limite do banco.
  if (typeof numero !== "number" || !Number.isInteger(numero) || numero < 1 || numero > MAX_INT32) {
    // Lança o erro 400 já indicando qual campo estava errado.
    throw new AppError(`O campo '${campo}' deve ser um número inteiro positivo.`, 400, campo);
  }
  // Passou em tudo: devolve o id como número.
  return numero;
}
