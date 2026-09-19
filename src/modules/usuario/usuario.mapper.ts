import type { Usuario } from "@prisma/client";
import { PerfilUsuario } from "@prisma/client";
import { AppError } from "../../middlewares/errorHandler";

// Tradução banco <-> frontend (contrato-api-cantinafast.md, seção 3): o enum do Prisma fica em
// maiúsculo (ADMINISTRADOR), o frontend usa minúsculo ("administrador").

export type UsuarioSemSenha = Omit<Usuario, "senhaHash">;

export type UsuarioInterno = {
  id: number;
  nome: string;
  login: string;
  perfil: "atendente" | "caixa" | "administrador";
  ativo: boolean;
  criadoEm: string;
};

export function paraUsuarioInterno(usuario: UsuarioSemSenha): UsuarioInterno {
  return {
    id: usuario.id,
    nome: usuario.nome,
    login: usuario.login,
    perfil: usuario.perfil.toLowerCase() as UsuarioInterno["perfil"],
    ativo: usuario.ativo,
    criadoEm: usuario.criadoEm.toISOString(),
  };
}

// Aceita "administrador" (formato do frontend) ou "ADMINISTRADOR" e devolve o enum do Prisma.
export function lerPerfil(valor: unknown): PerfilUsuario {
  const enumPerfil = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  if (!Object.values(PerfilUsuario).includes(enumPerfil as PerfilUsuario)) {
    throw new AppError("Perfil inválido. Use: atendente, caixa ou administrador.", 400, "perfil");
  }
  return enumPerfil as PerfilUsuario;
}
