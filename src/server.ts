// Importa o Express, a biblioteca que cria o servidor web e trata as rotas HTTP.
import express from "express";
// Importa a instância única do Prisma (conexão com o banco), criada em config/prisma.ts.
import { prisma } from "./config/prisma";
// Importa o middleware de erro genérico e o tratador de rota inexistente (404).
import { errorHandler, rotaNaoEncontrada } from "./middlewares/errorHandler";
// Importa o conjunto de rotas de cada módulo (cada um mora na sua pasta em src/modules).
import { authRoutes } from "./modules/auth/auth.routes";
import { usuarioRoutes } from "./modules/usuario/usuario.routes";
import { categoriaRoutes } from "./modules/categoria/categoria.routes";
import { produtoRoutes } from "./modules/produto/produto.routes";

// Cria a aplicação Express: é ela que recebe todas as requisições.
const app = express();

// Ensina o Express a ler o corpo (body) das requisições em JSON e colocá-lo em req.body.
app.use(express.json());

// Rota de teste: serve para ver se o servidor e o banco estão de pé.
app.get("/health", async (req, res) => {
  // Conta quantos usuários existem; se o banco estiver fora do ar, essa linha dá erro.
  const totalUsuarios = await prisma.usuario.count();
  // Responde em JSON com o status e a contagem.
  res.json({ status: "ok", totalUsuarios });
});

// /interno/login e /interno/me são resolvidos pelas rotas do módulo de autenticação.
app.use("/interno", authRoutes);
// Tudo que começar com /interno/usuarios é resolvido pelas rotas do módulo de usuário.
app.use("/interno/usuarios", usuarioRoutes);
// Tudo que começar com /categorias é resolvido pelas rotas do módulo de categoria.
app.use("/categorias", categoriaRoutes);
// Tudo que começar com /produtos é resolvido pelas rotas do módulo de produto.
app.use("/produtos", produtoRoutes);

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
