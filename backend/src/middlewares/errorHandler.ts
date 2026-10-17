// Importa só os TIPOS do Express usados abaixo (não entram no código final, servem para o TypeScript).
import type { ErrorRequestHandler, RequestHandler } from "express";
// Importa o Prisma para reconhecer os erros que o banco pode devolver (ex.: valor duplicado).
import { Prisma } from "@prisma/client";

// Erro esperado (validação, regra de negócio, não encontrado). Lance com `throw` em qualquer
// controller: o errorHandler converte em { mensagem, campo? } com o status correto.
export class AppError extends Error {
  // Código HTTP que será devolvido (400, 404, 409...).
  readonly status: number;
  // Nome do campo com problema (opcional); o frontend usa para marcar o input certo.
  readonly campo: string | undefined;

  // Construtor: recebe a mensagem, o status (padrão 400) e, se quiser, o campo.
  constructor(mensagem: string, status = 400, campo?: string) {
    // Passa a mensagem para a classe Error do JavaScript.
    super(mensagem);
    // Guarda o status HTTP no objeto.
    this.status = status;
    // Guarda o campo (ou undefined) no objeto.
    this.campo = campo;
  }
}

// Rota inexistente — mesmo formato de erro do resto da API.
export const rotaNaoEncontrada: RequestHandler = (req, res) => {
  // Responde 404 com a mensagem dizendo qual método e caminho não existem.
  res.status(404).json({ mensagem: `Rota não encontrada: ${req.method} ${req.path}` });
};

// Padroniza TODA resposta de erro como { mensagem, campo? }. Deve ser o último middleware.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Se a resposta já começou a ser enviada, não dá para mudar: repassa o erro para o Express.
  if (res.headersSent) {
    next(err);
    return;
  }

  // Caso 1: erro que nós mesmos lançamos com AppError (validação, regra de negócio, 404...).
  if (err instanceof AppError) {
    // Devolve o status escolhido e o corpo { mensagem, campo }.
    res.status(err.status).json({ mensagem: err.message, campo: err.campo });
    return;
  }

  // JSON malformado no corpo da requisição (lançado pelo express.json()).
  if (err?.type === "entity.parse.failed") {
    // Responde 400 explicando que o JSON enviado é inválido.
    res.status(400).json({ mensagem: "Corpo da requisição não é um JSON válido." });
    return;
  }

  // Rede de segurança para erros do banco que escaparam das validações do controller.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 = violação de campo único (ex.: login ou código de barras repetido).
    if (err.code === "P2002") {
      // O Prisma informa em meta.target quais campos causaram o conflito.
      const alvo = err.meta?.target;
      // Se vier uma lista, usa o primeiro campo como "campo" da resposta.
      const campo = Array.isArray(alvo) ? String(alvo[0]) : undefined;
      // 409 = conflito com algo que já existe.
      res.status(409).json({ mensagem: "Já existe um registro com esse valor.", campo });
      return;
    }
    // P2025 = o registro que se tentou alterar/apagar não existe.
    if (err.code === "P2025") {
      res.status(404).json({ mensagem: "Registro não encontrado." });
      return;
    }
    // P2003 = chave estrangeira inválida (aponta para um registro que não existe).
    if (err.code === "P2003") {
      res.status(400).json({ mensagem: "O registro referenciado não existe." });
      return;
    }
    // P2034 = a transação falhou por conflito de escrita ou deadlock com outra requisição simultânea.
    if (err.code === "P2034") {
      // 409 = conflito; o cliente pode simplesmente repetir a operação.
      res.status(409).json({ mensagem: "Conflito com outra operação simultânea. Tente novamente." });
      return;
    }
    // P2028 = a transação não conseguiu conexão a tempo ou estourou o tempo limite (servidor ocupado).
    if (err.code === "P2028") {
      // 503 = indisponível no momento; tentar de novo em instantes costuma resolver.
      res.status(503).json({ mensagem: "Servidor ocupado. Tente novamente em instantes." });
      return;
    }
  }

  // Qualquer outro erro é inesperado: registra no terminal para o desenvolvedor investigar.
  console.error(err);
  // E responde 500 com mensagem genérica, sem expor detalhes internos ao cliente.
  res.status(500).json({ mensagem: "Erro interno do servidor." });
};
