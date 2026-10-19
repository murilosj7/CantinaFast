// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Mensagem de sessão inválida, a mesma do middleware.
import { MENSAGEM_SESSAO_INVALIDA } from "../../middlewares/auth.middleware";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Seleção segura de campos e montagem da resposta no formato do site.
import { clienteSelect, paraClienteSite } from "./cliente.mapper";

// GET /clientes/me — devolve o cliente logado (o id vem do token, já validado por autenticarCliente).
export async function meuPerfil(req: Request, res: Response) {
  // Sem req.cliente o middleware não rodou: trata como não autenticado.
  if (!req.cliente) {
    throw new AppError("Não autenticado.", 401);
  }

  // Busca o cliente com os campos públicos (nunca senhaHash nem loginGoogle).
  const cliente = await prisma.cliente.findUnique({ where: { id: req.cliente.id }, select: clienteSelect });

  // A situação "ativo" já foi conferida por autenticarCliente (é ele que derruba o token do cliente inativado; não
  // repetimos a checagem aqui para uma falha dele não ficar escondida). Aqui só tratamos o caso raro de a conta ter
  // sumido entre o middleware e esta consulta.
  if (!cliente) {
    throw new AppError(MENSAGEM_SESSAO_INVALIDA, 401);
  }

  // Devolve o cliente no formato do site.
  res.json(paraClienteSite(cliente));
}
