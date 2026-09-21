// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id do produto vindo na URL.
import { parseId } from "../../utils/parseId";
// saldoSelect carrega o que o saldo precisa; paraSaldoEstoque monta a mesma linha do GET /estoque.
import { paraSaldoEstoque, saldoSelect } from "./estoque.mapper";

// Maior valor que cabe na coluna inteira do banco (estoqueMinimo é Int de 32 bits).
const MAXIMO_INTEIRO = 2147483647;

// Valida o estoque mínimo: número inteiro de 0 em diante que caiba na coluna.
function lerEstoqueMinimo(valor: unknown): number {
  // Recusa texto, null, ausente, decimal, NaN, infinito, negativo e valor maior que a coluna aguenta.
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0 || valor > MAXIMO_INTEIRO) {
    throw new AppError("O estoque mínimo deve ser um número inteiro de 0 em diante.", 400, "estoqueMinimo");
  }
  return valor;
}

// PATCH (ou PUT) /estoque/:produtoId — body: { estoqueMinimo }. Rota protegida (qualquer perfil logado).
// Muda SÓ o estoque mínimo (a quantidade física só muda por movimentação). Produto antigo sem linha em `estoque`
// ganha a linha zerada. Devolve o saldo atualizado, no mesmo formato de uma linha do GET /estoque.
export async function atualizarEstoqueMinimo(req: Request, res: Response) {
  // Lê o :produtoId da URL e valida.
  const produtoId = parseId(req.params.produtoId, "produtoId");
  // Valida o corpo (se não veio corpo, usa um objeto vazio e cai no erro do campo).
  const estoqueMinimo = lerEstoqueMinimo(req.body?.estoqueMinimo);

  // Numa transação: a linha criada (se faltava) e a alteração do mínimo valem juntas ou não valem.
  const produto = await prisma.$transaction(async (tx) => {
    // Confere que o produto existe (produto inativo também pode ter o mínimo ajustado).
    const existente = await tx.produto.findUnique({ where: { id: produtoId }, select: { id: true } });
    if (!existente) {
      throw new AppError("Produto não encontrado.", 404);
    }
    // Cria a linha zerada se não existir. `skipDuplicates` (ON CONFLICT DO NOTHING) evita briga entre requisições simultâneas.
    await tx.estoque.createMany({ data: [{ produtoId }], skipDuplicates: true });
    // Só o mínimo é gravado: o UPDATE toca uma única coluna, então não desfaz movimentações que estejam acontecendo.
    await tx.estoque.update({ where: { produtoId }, data: { estoqueMinimo } });
    // Relê o produto já atualizado para montar a resposta.
    return tx.produto.findUniqueOrThrow({ where: { id: produtoId }, select: saldoSelect });
  });

  // 200 com o saldo no formato do GET /estoque.
  res.json(paraSaldoEstoque(produto));
}
