// Tipo Usuario gerado pelo Prisma (só para descrever o formato; não vira código no arquivo final).
import type { Usuario } from "@prisma/client";
// Enum PerfilUsuario do Prisma (ATENDENTE, CAIXA, ADMINISTRADOR), usado como valor.
import { PerfilUsuario } from "@prisma/client";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";

// Tradução banco <-> frontend (contrato-api-cantinafast.md, seção 3): o enum do Prisma fica em
// maiúsculo (ADMINISTRADOR), o frontend usa minúsculo ("administrador").

// Usuário do banco SEM o campo senhaHash (é o que devolvemos nas consultas).
export type UsuarioSemSenha = Omit<Usuario, "senhaHash">;

// Formato do usuário que o frontend espera receber (UsuarioInterno no contrato).
export type UsuarioInterno = {
  id: number;
  nome: string;
  login: string;
  // Só estes três valores em minúsculo.
  perfil: "atendente" | "caixa" | "administrador";
  ativo: boolean;
  // Data como texto ISO 8601.
  criadoEm: string;
};

// Converte o usuário do banco para o formato do contrato.
export function paraUsuarioInterno(usuario: UsuarioSemSenha): UsuarioInterno {
  return {
    id: usuario.id,
    nome: usuario.nome,
    login: usuario.login,
    // ADMINISTRADOR -> "administrador".
    perfil: usuario.perfil.toLowerCase() as UsuarioInterno["perfil"],
    ativo: usuario.ativo,
    // Date -> texto ISO (ex.: 2026-09-18T12:00:00.000Z).
    criadoEm: usuario.criadoEm.toISOString(),
  };
}

// Aceita "administrador" (formato do frontend) ou "ADMINISTRADOR" e devolve o enum do Prisma.
export function lerPerfil(valor: unknown): PerfilUsuario {
  // Se for texto: tira espaços e põe em maiúsculo; se não for texto, vira "" (que será recusado abaixo).
  const enumPerfil = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  // Confere se o texto é um dos valores válidos do enum.
  if (!Object.values(PerfilUsuario).includes(enumPerfil as PerfilUsuario)) {
    // Se não for, responde 400 apontando o campo "perfil".
    throw new AppError("Perfil inválido. Use: atendente, caixa ou administrador.", 400, "perfil");
  }
  // Valor válido: devolve já como enum.
  return enumPerfil as PerfilUsuario;
}
