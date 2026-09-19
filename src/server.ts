import express from "express";
import { prisma } from "./config/prisma";
import { errorHandler, rotaNaoEncontrada } from "./middlewares/errorHandler";
import { usuarioRoutes } from "./modules/usuario/usuario.routes";
import { categoriaRoutes } from "./modules/categoria/categoria.routes";

const app = express();

app.use(express.json());

app.get("/health", async (req, res) => {
  const totalUsuarios = await prisma.usuario.count();
  res.json({ status: "ok", totalUsuarios });
});

app.use("/interno/usuarios", usuarioRoutes);
app.use("/categorias", categoriaRoutes);

// Sempre por último: 404 padronizado e tratamento de erro genérico.
app.use(rotaNaoEncontrada);
app.use(errorHandler);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
