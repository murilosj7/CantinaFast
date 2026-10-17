// Importa o Express, a biblioteca que cria o servidor web e trata as rotas HTTP.
import express from "express";
// Helmet: acrescenta cabeçalhos HTTP de segurança em todas as respostas.
import helmet from "helmet";
// CORS: controla quais sites (origens) podem chamar a API pelo navegador.
import cors from "cors";
// Importa a instância única do Prisma (conexão com o banco), criada em config/prisma.ts.
import { prisma } from "./config/prisma";
// Importa o middleware de erro genérico e o tratador de rota inexistente (404).
import { errorHandler, rotaNaoEncontrada } from "./middlewares/errorHandler";
// Limitadores de requisições por IP: o do login (LOGIN_RATE_LIMIT_MAX falhas/15 min, padrão 5; uma instância para o login interno e outra
// para o do cliente), o do cadastro de cliente (20/hora) e um geral (100/min).
import { limitadorCadastro, limitadorGeral, limitadoresLoginCliente, limitadoresLoginInterno } from "./middlewares/rateLimit";
// Opções do CORS (allowlist de origens vinda de CORS_ALLOWED_ORIGINS no .env).
import { opcoesCors } from "./config/cors";
// Importa o conjunto de rotas de cada módulo (cada um mora na sua pasta em src/modules).
import { authRoutes } from "./modules/auth/auth.routes";
import { usuarioRoutes } from "./modules/usuario/usuario.routes";
import { categoriaRoutes } from "./modules/categoria/categoria.routes";
import { produtoRoutes } from "./modules/produto/produto.routes";
import { estoqueRoutes } from "./modules/produto/estoque.routes";
import { movimentacaoRoutes } from "./modules/movimentacao/movimentacao.routes";
import { pedidoRoutes } from "./modules/pedido/pedido.routes";
import { pagamentoRoutes } from "./modules/pagamento/pagamento.routes";
import { clienteRoutes } from "./modules/cliente/cliente.routes";
import { clienteInternoRoutes } from "./modules/cliente/clienteInterno.routes";

// Cria a aplicação Express: é ela que recebe todas as requisições.
const app = express();

// Segurança 1: cabeçalhos de proteção (nosniff, HSTS, X-Frame-Options, CSP etc.) e remove o X-Powered-By. Vem antes de tudo.
app.use(helmet());

// Segurança 2: CORS com allowlist explícita. Antes das rotas (e do limitador) para que até as respostas 429 e de
// erro levem os cabeçalhos CORS e o navegador do frontend consiga ler a mensagem. Também responde às consultas
// "preflight" (OPTIONS) do navegador.
app.use(cors(opcoesCors));

// Segurança 3a: limite geral de 3000 requisições por minuto por IP, só contra cliente descontrolado (os logins e o cadastro têm
// limitadores próprios e ficam de fora). É o único limite só por IP, por isso o teto é altíssimo: a escola compartilha o IP.
app.use(limitadorGeral);

// Ensina o Express a ler o corpo (body) das requisições em JSON e colocá-lo em req.body.
app.use(express.json());

// Rota de teste: serve para ver se o servidor e o banco estão de pé.
app.get("/health", async (req, res) => {
  // Conta quantos usuários existem; se o banco estiver fora do ar, essa linha dá erro.
  const totalUsuarios = await prisma.usuario.count();
  // Responde em JSON com o status e a contagem.
  res.json({ status: "ok", totalUsuarios });
});

// Segurança 3b: limites do login interno, em série e ANTES das rotas de auth: teto de 100 falhas por login (todos os IPs) e, por último,
// LOGIN_RATE_LIMIT_MAX falhas (padrão 5) por IP + login a cada 15 min. Chave sempre IP + alvo, nunca só o IP. Leem req.body (express.json acima).
app.post("/interno/login", ...limitadoresLoginInterno);
// /interno/login e /interno/me são resolvidos pelas rotas do módulo de autenticação.
app.use("/interno", authRoutes);
// Tudo que começar com /interno/usuarios é resolvido pelas rotas do módulo de usuário.
app.use("/interno/usuarios", usuarioRoutes);
// Tudo que começar com /interno/clientes (gestão de clientes pelo administrador) é resolvido pelas rotas internas do módulo de cliente.
app.use("/interno/clientes", clienteInternoRoutes);
// Segurança 3c: limites do cliente do site, ANTES das rotas de /clientes: login (instâncias próprias, mesmas regras do login interno:
// teto de 100 falhas por e-mail e, por último, o par IP + e-mail) e cadastro (100 cadastros bem-sucedidos por hora por IP;
// falhas de validação e e-mail repetido não contam).
app.post("/clientes/login", ...limitadoresLoginCliente);
app.post("/clientes/cadastro", limitadorCadastro);
// Tudo que começar com /clientes (cadastro, login e /me do cliente) é resolvido pelas rotas do módulo de cliente.
app.use("/clientes", clienteRoutes);
// Tudo que começar com /categorias é resolvido pelas rotas do módulo de categoria.
app.use("/categorias", categoriaRoutes);
// Tudo que começar com /produtos é resolvido pelas rotas do módulo de produto.
app.use("/produtos", produtoRoutes);
// Tudo que começar com /estoque é resolvido pelas rotas de saldos (também no módulo de produto; protegidas).
app.use("/estoque", estoqueRoutes);
// Tudo que começar com /movimentacoes é resolvido pelas rotas do módulo de movimentação (todas protegidas).
app.use("/movimentacoes", movimentacaoRoutes);
// Tudo que começar com /pedidos é resolvido pelas rotas do módulo de pedido (todas protegidas).
app.use("/pedidos", pedidoRoutes);
// Tudo que começar com /pagamentos é resolvido pelas rotas do módulo de pagamento (todas protegidas).
app.use("/pagamentos", pagamentoRoutes);

// Sempre por último: 404 padronizado e tratamento de erro genérico.
// Se nenhuma rota acima respondeu, cai aqui e devolve "Rota não encontrada".
app.use(rotaNaoEncontrada);
// Se qualquer rota lançou um erro, ele vem parar aqui e vira { mensagem, campo? }.
app.use(errorHandler);

// Porta em que o servidor vai escutar as requisições.
const PORT = 3000;
// Liga o servidor na porta definida.
app.listen(PORT, () => {
  // Avisa no terminal que o servidor subiu e em qual endereço.
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
