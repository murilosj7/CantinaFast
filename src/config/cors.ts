// CORS (Cross-Origin Resource Sharing): decide QUAIS sites (origens) podem chamar esta API a partir do navegador.
// Carrega o arquivo .env (idempotente: o dotenv não relê o que já foi carregado).
import "dotenv/config";
// Tipo das opções do pacote cors.
import type { CorsOptions } from "cors";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../middlewares/errorHandler";

// Origem usada quando CORS_ALLOWED_ORIGINS não existe (ou está em branco): o Vite do frontend em desenvolvimento.
const ORIGEM_PADRAO = "http://localhost:5174";

// Transforma o texto da variável ("http://a.com, http://b.com") na lista de origens permitidas.
export function lerOrigensPermitidas(valor: string | undefined): string[] {
  // Separa por vírgula, tira espaços das pontas, descarta itens vazios e remove "/" final (origem nunca termina em barra).
  const origens = (valor ?? "")
    .split(",")
    .map((origem) => origem.trim().replace(/\/+$/, ""))
    .filter((origem) => origem !== "");
  // Variável ausente ou em branco: cai no padrão de desenvolvimento em vez de bloquear tudo ou liberar tudo.
  return origens.length > 0 ? origens : [ORIGEM_PADRAO];
}

// Lista final de origens permitidas, lida uma vez na subida do servidor.
export const origensPermitidas = lerOrigensPermitidas(process.env.CORS_ALLOWED_ORIGINS);

// Opções passadas ao middleware cors() no server.ts.
export const opcoesCors: CorsOptions = {
  // Função em vez de lista pura: além de só liberar as origens da allowlist, RECUSA (403) as demais no servidor.
  origin(origem, callback) {
    // Sem cabeçalho Origin = não veio de um navegador em outro site (Postman, curl, chamadas do próprio servidor): segue.
    // Origem na allowlist: libera (o cors devolve Access-Control-Allow-Origin com essa origem).
    if (origem === undefined || origensPermitidas.includes(origem)) {
      callback(null, true);
      return;
    }
    // Origem fora da lista: devolve 403 no formato { mensagem } e a rota nem chega a executar.
    callback(new AppError("Origem não permitida.", 403));
  },
  // Permite que o navegador envie credenciais (cookies/cabeçalho Authorization) nas chamadas entre origens.
  credentials: true,
};
