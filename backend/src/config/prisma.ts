import { PrismaClient } from '@prisma/client';

// Instância única do Prisma Client, compartilhada por todo o backend.
// Evita abrir uma conexão nova com o banco a cada requisição.
const prisma = new PrismaClient();

export default prisma;
