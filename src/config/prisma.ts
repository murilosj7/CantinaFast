import { PrismaClient } from "@prisma/client";

// Instância única do PrismaClient — todos os módulos importam daqui.
export const prisma = new PrismaClient();
