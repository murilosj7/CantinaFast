// Seed do primeiro administrador. Rode com: npm run seed
// Lê SEED_ADMIN_LOGIN e SEED_ADMIN_SENHA (obrigatórios) e SEED_ADMIN_NOME (opcional) do ambiente ou do .env.
// Não existe senha escrita no código; e se o login já existir, nada é alterado (pode rodar quantas vezes quiser).

// Carrega o arquivo .env para dentro de process.env (é de lá que saem as variáveis SEED_*).
import "dotenv/config";
// bcrypt gera o hash da senha, para nunca guardar a senha em texto puro no banco.
import bcrypt from "bcrypt";
// Enum de perfis do Prisma (usaremos ADMINISTRADOR).
import { PerfilUsuario } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../config/prisma";

// Faz o trabalho do seed; qualquer erro lançado aqui é tratado no final do arquivo.
async function seedAdmin() {
  // Nome de exibição do administrador; se não vier, usa "Administrador".
  const nome = (process.env.SEED_ADMIN_NOME ?? "").trim() || "Administrador";
  // Login do administrador (sem espaços nas pontas, como o cadastro normal grava).
  const login = (process.env.SEED_ADMIN_LOGIN ?? "").trim();
  // Senha em texto: só existe na memória durante este script e nunca é impressa.
  const senha = process.env.SEED_ADMIN_SENHA ?? "";

  // Login é obrigatório e cabe até 120 caracteres (limite da API).
  if (login === "" || login.length > 120) {
    throw new Error("Defina SEED_ADMIN_LOGIN (até 120 caracteres) no .env ou no ambiente.");
  }
  // Senha é obrigatória e segue a mesma regra do cadastro pela API: pelo menos 6 caracteres.
  if (senha.length < 6) {
    throw new Error("Defina SEED_ADMIN_SENHA (pelo menos 6 caracteres) no .env ou no ambiente.");
  }
  // Nome cabe até 120 caracteres (limite da API).
  if (nome.length > 120) {
    throw new Error("SEED_ADMIN_NOME aceita no máximo 120 caracteres.");
  }

  // Procura se já existe alguém com esse login (login é único no banco).
  const existente = await prisma.usuario.findUnique({ where: { login } });
  // Se já existe, não mexe em nada (nem na senha): só avisa o estado atual.
  if (existente) {
    console.log(
      `Já existe um usuário com o login '${login}' (perfil ${existente.perfil}, ${existente.ativo ? "ativo" : "inativo"}). Nada foi alterado.`,
    );
    return;
  }

  // Não existe: cria o administrador com a senha em hash.
  const admin = await prisma.usuario.create({
    data: {
      nome,
      login,
      // Transforma a senha em hash (o 10 é o mesmo "custo" usado no cadastro pela API).
      senhaHash: await bcrypt.hash(senha, 10),
      perfil: PerfilUsuario.ADMINISTRADOR,
    },
  });
  // Confirma no terminal (só id e login; a senha nunca aparece).
  console.log(`Administrador '${admin.login}' criado (id ${admin.id}).`);
}

// Executa o seed.
seedAdmin()
  // Se algo deu errado, mostra a mensagem e marca o processo com código de saída 1 (falha).
  .catch((erro) => {
    console.error("Falha ao executar o seed:", erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  // Em qualquer caso, fecha a conexão com o banco para o processo poder terminar.
  .finally(() => prisma.$disconnect());
