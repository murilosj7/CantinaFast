import express from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

app.get("/health", async (req, res) => {
  const totalUsuarios = await prisma.usuario.count();
  res.json({ status: "ok", totalUsuarios });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});