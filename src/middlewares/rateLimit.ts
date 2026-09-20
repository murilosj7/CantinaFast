// Limitador de requisições por IP (proteção contra força bruta no login e contra excesso de chamadas).
// Carrega o arquivo .env (idempotente): é de lá que pode vir a LOGIN_RATE_LIMIT_MAX.
import "dotenv/config";
import { rateLimit } from "express-rate-limit";

// Máximo de tentativas de login erradas por IP quando LOGIN_RATE_LIMIT_MAX não existe ou é inválida (valor de segurança/produção).
const LIMITE_LOGIN_PADRAO = 5;

// Lê o texto da variável LOGIN_RATE_LIMIT_MAX e devolve o limite: um número inteiro de 1 em diante; senão, o padrão (5).
export function lerLimiteLogin(valor: string | undefined): number {
  // Tira os espaços das pontas (variável ausente vira texto vazio).
  const texto = (valor ?? "").trim();
  // Só aceita dígitos puros: recusa "abc", "0x10", "-2", "2.5", "1e3" e "10 tentativas".
  if (/^\d+$/.test(texto)) {
    // Converte para número e confere que é inteiro seguro e pelo menos 1 (limite 0 barraria todo mundo).
    const numero = Number(texto);
    if (Number.isSafeInteger(numero) && numero >= 1) return numero;
  }
  // Variável preenchida mas inválida (ex.: erro de digitação): avisa no terminal para não passar despercebido.
  if (texto !== "") {
    console.warn(`LOGIN_RATE_LIMIT_MAX inválida ('${texto}'): usando o padrão ${LIMITE_LOGIN_PADRAO}.`);
  }
  // Ausente, vazia ou inválida: cai no padrão.
  return LIMITE_LOGIN_PADRAO;
}

// Limite de tentativas de login lido uma vez, na subida do servidor.
const limiteLogin = lerLimiteLogin(process.env.LOGIN_RATE_LIMIT_MAX);

// Nos testes automatizados (NODE_ENV=test) os limites ficam desligados: as suítes fazem centenas de chamadas seguidas.
// Em qualquer outro ambiente (dev, produção) os limites estão SEMPRE ligados.
const desligado = process.env.NODE_ENV === "test";

// Login: no máximo LOGIN_RATE_LIMIT_MAX (padrão 5) tentativas FALHAS por IP a cada 15 minutos. Aplicado só em POST /interno/login (server.ts).
export const limitadorLogin = rateLimit({
  // Janela de 15 minutos (em milissegundos).
  windowMs: 15 * 60 * 1000,
  // Até `limiteLogin` tentativas na janela; a seguinte recebe 429.
  limit: limiteLogin,
  // Login que deu certo (2xx) NÃO conta: só as tentativas erradas gastam o limite, então quem digita certo nunca é barrado.
  skipSuccessfulRequests: true,
  // Informa o limite e o que resta nos cabeçalhos padrão RateLimit-* (e Retry-After ao estourar).
  standardHeaders: "draft-7",
  // Desliga os cabeçalhos antigos X-RateLimit-*.
  legacyHeaders: false,
  // Nos testes automatizados não limita.
  skip: () => desligado,
  // Resposta ao estourar: 429 no mesmo formato de erro do resto da API ({ mensagem }).
  handler: (_req, res) => {
    res.status(429).json({ mensagem: "Muitas tentativas de login. Tente novamente em alguns minutos." });
  },
});

// Geral: 100 requisições por minuto por IP em todas as demais rotas.
export const limitadorGeral = rateLimit({
  // Janela de 1 minuto.
  windowMs: 60 * 1000,
  // Até 100 requisições na janela; a 101ª recebe 429.
  limit: 100,
  // Cabeçalhos padrão RateLimit-* (e Retry-After ao estourar).
  standardHeaders: "draft-7",
  // Desliga os cabeçalhos antigos X-RateLimit-*.
  legacyHeaders: false,
  // Não limita nos testes automatizados; e o login fica de fora porque tem o limitador próprio (mais rígido) acima.
  skip: (req) => desligado || (req.method === "POST" && req.path === "/interno/login"),
  // Resposta ao estourar: 429 no mesmo formato de erro do resto da API ({ mensagem }).
  handler: (_req, res) => {
    res.status(429).json({ mensagem: "Muitas requisições. Tente novamente em instantes." });
  },
});
