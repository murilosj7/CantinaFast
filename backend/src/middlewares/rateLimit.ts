// Limitadores de requisições (proteção contra força bruta no login, contra criação em massa de contas e contra excesso de chamadas).
//
// PRINCÍPIO: nenhum limite que BLOQUEIA usa só o IP como chave. A escola/cantina compartilha um único IP; se o bloqueio fosse
// por IP, uma pessoa sozinha esgotaria o limite e travaria todos. Nos logins a chave é IP + alvo (e-mail ou login): quem erra
// a senha bloqueia apenas a si mesmo. O único limite só por IP é o geral, com teto altíssimo (veja abaixo).
//
// ATENÇÃO: os contadores ficam em MEMÓRIA (store padrão do express-rate-limit). Isso vale para UMA instância do servidor:
// com mais de uma instância (ou reinício do processo) cada uma conta separado e os contadores zeram. Para escalar, trocar
// o store por um compartilhado (ex.: Redis).
//
// Carrega o arquivo .env (idempotente): é de lá que pode vir a LOGIN_RATE_LIMIT_MAX.
import "dotenv/config";
// Tipos do Express: a requisição (para ler o alvo e-mail/login do corpo) e a resposta (do handler do 429).
import type { Request, Response } from "express";
// ipKeyGenerator normaliza o IP (IPv6 agrupado em /56, IPv4 mapeado vira IPv4) para o usuário não escapar mudando de endereço.
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

// Máximo de tentativas de login erradas por IP+alvo quando LOGIN_RATE_LIMIT_MAX não existe ou é inválida (valor de segurança/produção).
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

// Limite de tentativas de login (por IP + alvo) lido uma vez, na subida do servidor.
const limiteLogin = lerLimiteLogin(process.env.LOGIN_RATE_LIMIT_MAX);

// Teto de falhas de login por ALVO (e-mail ou login) somando TODOS os IPs, a cada 15 minutos. Só dispara quando o mesmo alvo
// é atacado de muitos IPs distintos (cada IP só pode errar `limiteLogin` vezes por alvo, então são necessários 20 IPs ou mais
// com o limite padrão): é a defesa contra ataque distribuído. Um aluno digitando errado, ou uma sala inteira errando a senha
// de colegas diferentes, nunca chega perto. Contrapartida aceita: um atacante com muitos IPs consegue travar o login de UM
// alvo específico por até 15 minutos.
const LIMITE_TETO_POR_ALVO = 100;

// Nos testes automatizados (NODE_ENV=test) os limites ficam desligados: as suítes fazem centenas de chamadas seguidas.
// Em qualquer outro ambiente (dev, produção) os limites estão SEMPRE ligados.
const desligado = process.env.NODE_ENV === "test";

// Alvo usado quando o corpo não traz e-mail/login em texto (ausente, número, objeto, vazio). Esse balde só afeta outras
// requisições malformadas (que já seriam 400); logins legítimos sempre têm um alvo em texto e nunca caem aqui.
const ALVO_AUSENTE = "sem-alvo";

// Alvo do login do CLIENTE: o e-mail normalizado como o login faz (aparado e em minúsculas), cortado em 160 caracteres
// (o tamanho máximo do e-mail) para um corpo gigante não virar chave gigante. E-mail inexistente conta igual ao existente:
// o limitador não revela se a conta existe.
function alvoEmail(req: Request): string {
  const email: unknown = req.body?.email;
  if (typeof email !== "string") return ALVO_AUSENTE;
  const normalizado = email.trim().toLowerCase().slice(0, 160);
  return normalizado === "" ? ALVO_AUSENTE : normalizado;
}

// Alvo do login INTERNO: o login aparado, SEM minúsculas (o login interno diferencia maiúsculas), cortado em 120 caracteres.
function alvoLogin(req: Request): string {
  const login: unknown = req.body?.login;
  if (typeof login !== "string") return ALVO_AUSENTE;
  const normalizado = login.trim().slice(0, 120);
  return normalizado === "" ? ALVO_AUSENTE : normalizado;
}

// Cria os DOIS limitadores de um login, para usar em SÉRIE (o teto por alvo primeiro, o do par por último):
//  1) teto por alvo em todos os IPs: LIMITE_TETO_POR_ALVO falhas por alvo (defesa contra ataque distribuído);
//  2) par IP + alvo: `limiteLogin` falhas (padrão 5) do mesmo IP contra o mesmo alvo. É o que protege a senha de uma conta
//     sem punir ninguém além de quem está errando.
// Em ambos só as tentativas FALHAS contam (2xx não gasta) e a janela é de 15 minutos. O do par fica por último de propósito:
// o último limitador a rodar é quem escreve os cabeçalhos RateLimit-* (a política "5;w=900" que o cliente vê).
// Cada chamada cria instâncias com contadores PRÓPRIOS: estourar o login interno não bloqueia o do cliente, e vice-versa.
function criarLimitadoresLogin(prefixoPar: string, prefixoTeto: string, alvo: (req: Request) => string) {
  // Configuração comum aos dois limitadores.
  const comum = {
    // Janela de 15 minutos (em milissegundos).
    windowMs: 15 * 60 * 1000,
    // Login que deu certo (2xx) NÃO conta: só as tentativas erradas gastam o limite, então quem digita certo nunca é barrado.
    skipSuccessfulRequests: true,
    // Informa o limite e o que resta nos cabeçalhos padrão RateLimit-* (e Retry-After ao estourar).
    standardHeaders: "draft-7" as const,
    // Desliga os cabeçalhos antigos X-RateLimit-*.
    legacyHeaders: false,
    // Nos testes automatizados não limita.
    skip: () => desligado,
    // Resposta ao estourar: 429 no mesmo formato de erro do resto da API ({ mensagem }).
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ mensagem: "Muitas tentativas de login. Tente novamente em alguns minutos." });
    },
  };
  // Teto por alvo, somando todos os IPs.
  const tetoPorAlvo = rateLimit({
    ...comum,
    limit: LIMITE_TETO_POR_ALVO,
    keyGenerator: (req) => `${prefixoTeto}${alvo(req)}`,
  });
  // Par IP + alvo. O IP passa pelo ipKeyGenerator (IPv6 agrupado) para não dar para escapar trocando de endereço.
  const porPar = rateLimit({
    ...comum,
    limit: limiteLogin,
    keyGenerator: (req) => `${prefixoPar}${ipKeyGenerator(req.ip ?? "sem-ip")}:${alvo(req)}`,
  });
  return [tetoPorAlvo, porPar];
}

// Login interno: aplicado só em POST /interno/login (server.ts). Chaves "int-login:" (teto) e "int-par:" (par).
export const limitadoresLoginInterno = criarLimitadoresLogin("int-par:", "int-login:", alvoLogin);

// Login do cliente: instâncias próprias, mesmas regras e mesmo limite do login interno, aplicado só em POST /clientes/login
// (server.ts). Chaves "cli-email:" (teto) e "cli-par:" (par).
export const limitadoresLoginCliente = criarLimitadoresLogin("cli-par:", "cli-email:", alvoEmail);

// Cadastro de cliente: no máximo 100 cadastros BEM-SUCEDIDOS por hora por IP. Só os sucessos contam (skipFailedRequests):
// erro de validação e e-mail repetido não gastam o limite, então um aluno que erra o formulário nunca é barrado. O teto é
// alto de propósito: a escola compartilha o IP (rede única) e o limite é só por IP. Ele existe para frear a criação de
// contas em massa; o efeito colateral aceito é que quem consiga 100 cadastros válidos por hora trava novos cadastros
// daquele IP até a janela virar. Aplicado só em POST /clientes/cadastro (server.ts); NODE_ENV=test desliga.
const LIMITE_CADASTRO_POR_HORA = 100;
export const limitadorCadastro = rateLimit({
  // Janela de 1 hora.
  windowMs: 60 * 60 * 1000,
  // Até 100 cadastros bem-sucedidos na janela; o seguinte recebe 429.
  limit: LIMITE_CADASTRO_POR_HORA,
  // Requisição que falhou (4xx/5xx: validação, e-mail repetido...) NÃO conta.
  skipFailedRequests: true,
  // Cabeçalhos padrão RateLimit-* (e Retry-After ao estourar).
  standardHeaders: "draft-7",
  // Desliga os cabeçalhos antigos X-RateLimit-*.
  legacyHeaders: false,
  // Nos testes automatizados não limita.
  skip: () => desligado,
  // Resposta ao estourar: 429 no mesmo formato de erro do resto da API ({ mensagem }).
  handler: (_req, res) => {
    res.status(429).json({ mensagem: "Muitos cadastros a partir deste endereço. Tente novamente mais tarde." });
  },
});

// Geral: até 3000 requisições por minuto por IP, em todas as rotas comuns. É a ÚNICA chave só por IP e, por isso, o teto é
// altíssimo: serve apenas de proteção contra um cliente descontrolado (laço infinito, polling quebrado), NÃO contra abuso
// direcionado. Um laço ainda o esgota; a proteção de flood de verdade é do proxy/WAF da hospedagem. Com a escola inteira
// atrás de um IP, um limite baixo (era 100) deixava uma pessoa travar todos.
const LIMITE_GERAL_POR_MINUTO = 3000;
export const limitadorGeral = rateLimit({
  // Janela de 1 minuto.
  windowMs: 60 * 1000,
  // Até 3000 requisições na janela; a seguinte recebe 429.
  limit: LIMITE_GERAL_POR_MINUTO,
  // Cabeçalhos padrão RateLimit-* (e Retry-After ao estourar).
  standardHeaders: "draft-7",
  // Desliga os cabeçalhos antigos X-RateLimit-*.
  legacyHeaders: false,
  // Não limita nos testes automatizados; e os logins (interno e do cliente) e o cadastro ficam de fora porque têm limitador próprio.
  skip: (req) =>
    desligado ||
    (req.method === "POST" && (req.path === "/interno/login" || req.path === "/clientes/login" || req.path === "/clientes/cadastro")),
  // Resposta ao estourar: 429 no mesmo formato de erro do resto da API ({ mensagem }).
  handler: (_req, res) => {
    res.status(429).json({ mensagem: "Muitas requisições. Tente novamente em instantes." });
  },
});
