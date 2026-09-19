import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";

// Erro esperado (validação, regra de negócio, não encontrado). Lance com `throw` em qualquer
// controller: o errorHandler converte em { mensagem, campo? } com o status correto.
export class AppError extends Error {
  readonly status: number;
  readonly campo: string | undefined;

  constructor(mensagem: string, status = 400, campo?: string) {
    super(mensagem);
    this.status = status;
    this.campo = campo;
  }
}

// Rota inexistente — mesmo formato de erro do resto da API.
export const rotaNaoEncontrada: RequestHandler = (req, res) => {
  res.status(404).json({ mensagem: `Rota não encontrada: ${req.method} ${req.path}` });
};

// Padroniza TODA resposta de erro como { mensagem, campo? }. Deve ser o último middleware.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({ mensagem: err.message, campo: err.campo });
    return;
  }

  // JSON malformado no corpo da requisição (lançado pelo express.json()).
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ mensagem: "Corpo da requisição não é um JSON válido." });
    return;
  }

  // Rede de segurança para erros do banco que escaparam das validações do controller.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const alvo = err.meta?.target;
      const campo = Array.isArray(alvo) ? String(alvo[0]) : undefined;
      res.status(409).json({ mensagem: "Já existe um registro com esse valor.", campo });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ mensagem: "Registro não encontrado." });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({ mensagem: "O registro referenciado não existe." });
      return;
    }
  }

  console.error(err);
  res.status(500).json({ mensagem: "Erro interno do servidor." });
};
