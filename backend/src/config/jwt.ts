// Carrega o arquivo .env para dentro de process.env (é de lá que sai o JWT_SECRET).
import "dotenv/config";
// jsonwebtoken assina o token do cliente (helper no fim deste arquivo).
import jwt from "jsonwebtoken";

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

// O token do usuário interno é assinado em auth/login.ts, com { id, perfil, tipo: TIPO_USUARIO, aud: AUD_INTERNO }.
// Dois "lados" de autenticação, com tokens que não se misturam: o usuário interno (painel/PDV) e o cliente (site).
// `tipo` diz quem é o dono do token e `aud` diz para qual lado ele foi emitido; os dois precisam ser coerentes.
export const TIPO_USUARIO = "usuario";
export const TIPO_CLIENTE = "cliente";
export const AUD_INTERNO = "interno";
export const AUD_CLIENTE = "cliente";

// Assina o token do cliente do site: { id, tipo: "cliente", aud: "cliente" }. Sem perfil: cliente não tem perfil.
export function assinarTokenCliente(id: number): string {
  return jwt.sign({ id, tipo: TIPO_CLIENTE, aud: AUD_CLIENTE }, JWT_SECRET, {
    algorithm: JWT_ALGORITMO,
    expiresIn: JWT_EXPIRA_EM,
  });
}
