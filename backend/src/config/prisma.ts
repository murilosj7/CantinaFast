// Importa a classe PrismaClient, que é quem conversa com o banco PostgreSQL.
import { PrismaClient } from "@prisma/client";

// Instância única do PrismaClient — todos os módulos importam daqui.
// Criar um único cliente evita abrir várias conexões com o banco sem necessidade.
export const prisma = new PrismaClient();
