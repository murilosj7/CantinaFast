// Carrega o arquivo .env para dentro de process.env (é de lá que sai o JWT_SECRET).
import "dotenv/config";

// Lê o segredo do ambiente; ele NUNCA fica escrito no código.
const segredo = process.env.JWT_SECRET;

// Sem segredo (ou com segredo curto demais) o servidor nem sobe: melhor falhar no início do que assinar tokens fracos.
if (!segredo || segredo.length < 32) {
  throw new Error(
    "JWT_SECRET não definido (ou com menos de 32 caracteres) no .env. " +
      "Gere um com: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
  );
}

// Segredo usado para assinar (login) e conferir (middleware) os tokens.
export const JWT_SECRET: string = segredo;
// Algoritmo de assinatura; fixá-lo também na conferência impede que aceitem tokens "sem assinatura" (alg none).
export const JWT_ALGORITMO = "HS256" as const;
// Validade do token: depois de 8 horas é preciso fazer login de novo.
export const JWT_EXPIRA_EM = "8h";
