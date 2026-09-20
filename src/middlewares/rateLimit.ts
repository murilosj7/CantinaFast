// Limitador de requisições por IP (proteção contra força bruta no login e contra excesso de chamadas).
import { rateLimit } from "express-rate-limit";

// Nos testes automatizados (NODE_ENV=test) os limites ficam desligados: as suítes fazem centenas de chamadas seguidas.
// Em qualquer outro ambiente (dev, produção) os limites estão SEMPRE ligados.
const desligado = process.env.NODE_ENV === "test";

// Login: no máximo 5 tentativas FALHAS por IP a cada 15 minutos. Aplicado só em POST /interno/login (server.ts).
export const limitadorLogin = rateLimit({
  // Janela de 15 minutos (em milissegundos).
  windowMs: 15 * 60 * 1000,
  // Até 5 tentativas na janela; a 6ª recebe 429.
  limit: 5,
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
