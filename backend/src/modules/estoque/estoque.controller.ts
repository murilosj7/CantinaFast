import { Request, Response } from 'express';
import prisma from '../../config/prisma';

const TIPOS_VALIDOS = ['ENTRADA', 'SAIDA', 'PERDA', 'AJUSTE'] as const;
type TipoMovimentacao = (typeof TIPOS_VALIDOS)[number];

// GET /estoque - lista o estoque atual de todos os produtos
export async function listarEstoque(req: Request, res: Response) {
  try {
    const estoques = await prisma.estoque.findMany({
      include: { produto: { select: { id: true, nome: true, codigoBarras: true } } },
      orderBy: { produtoId: 'asc' },
    });
    res.json(estoques);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar estoque' });
  }
}

// GET /estoque/:produtoId - estoque de um produto específico
export async function obterEstoquePorProduto(req: Request, res: Response) {
  const produtoId = Number(req.params.produtoId);
  try {
    const estoque = await prisma.estoque.findUnique({
      where: { produtoId },
      include: { produto: { select: { id: true, nome: true } } },
    });
    if (!estoque) {
      return res.status(404).json({ erro: 'Estoque não encontrado para esse produto' });
    }
    res.json(estoque);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar estoque' });
  }
}

// PUT /estoque/:produtoId - atualiza o estoque mínimo configurado (não a quantidade física direto)
export async function atualizarEstoqueMinimo(req: Request, res: Response) {
  const produtoId = Number(req.params.produtoId);
  const estoqueMinimo = Number(req.body.estoqueMinimo);

  if (Number.isNaN(estoqueMinimo) || estoqueMinimo < 0) {
    return res.status(400).json({ erro: 'estoqueMinimo é obrigatório e não pode ser negativo' });
  }

  try {
    const estoque = await prisma.estoque.update({
      where: { produtoId },
      data: { estoqueMinimo },
    });
    res.json(estoque);
  } catch (err) {
    res.status(404).json({ erro: 'Estoque não encontrado para esse produto' });
  }
}

// POST /movimentacoes - registra entrada/saída/perda/ajuste e atualiza o saldo do estoque
// numa única transação, pra histórico e saldo nunca ficarem dessincronizados.
export async function registrarMovimentacao(req: Request, res: Response) {
  const produtoId = Number(req.body.produtoId);
  const usuarioId = Number(req.body.usuarioId);
  const quantidade = Number(req.body.quantidade);
  const { tipo, motivo } = req.body as { tipo: string; motivo?: string };

  if (!produtoId || !usuarioId || !tipo || Number.isNaN(quantidade)) {
    return res.status(400).json({ erro: 'produtoId, usuarioId, tipo e quantidade são obrigatórios' });
  }
  if (!TIPOS_VALIDOS.includes(tipo as TipoMovimentacao)) {
    return res.status(400).json({ erro: `tipo inválido, use um de: ${TIPOS_VALIDOS.join(', ')}` });
  }
  if (tipo === 'AJUSTE') {
    if (quantidade === 0) {
      return res.status(400).json({ erro: 'quantidade do ajuste não pode ser zero' });
    }
  } else if (quantidade <= 0) {
    return res.status(400).json({ erro: 'quantidade deve ser maior que zero' });
  }

  try {
    const movimentacao = await prisma.$transaction(async (tx) => {
      let estoque = await tx.estoque.findUnique({ where: { produtoId } });
      if (!estoque) {
        estoque = await tx.estoque.create({ data: { produtoId, quantidadeFisica: 0 } });
      }

      // ENTRADA soma, SAIDA/PERDA subtraem, AJUSTE usa a quantidade informada como delta (pode ser negativa)
      let delta: number;
      if (tipo === 'ENTRADA') delta = quantidade;
      else if (tipo === 'SAIDA' || tipo === 'PERDA') delta = -quantidade;
      else delta = quantidade;

      const novaQuantidade = estoque.quantidadeFisica + delta;
      if (novaQuantidade < 0) {
        throw new Error('ESTOQUE_INSUFICIENTE');
      }

      const novaMovimentacao = await tx.movimentacaoEstoque.create({
        data: {
          produtoId,
          usuarioId,
          tipo: tipo as TipoMovimentacao,
          quantidade,
          motivo: motivo || null,
        },
      });

      await tx.estoque.update({
        where: { produtoId },
        data: { quantidadeFisica: novaQuantidade },
      });

      return novaMovimentacao;
    });

    res.status(201).json(movimentacao);
  } catch (err) {
    if (err instanceof Error && err.message === 'ESTOQUE_INSUFICIENTE') {
      return res.status(400).json({ erro: 'Estoque insuficiente para essa saída/perda' });
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registrar movimentação' });
  }
}

// GET /movimentacoes - histórico de movimentações, com filtro opcional ?produtoId=
export async function listarMovimentacoes(req: Request, res: Response) {
  const { produtoId } = req.query;
  const where = produtoId ? { produtoId: Number(produtoId) } : {};

  try {
    const movimentacoes = await prisma.movimentacaoEstoque.findMany({
      where,
      include: {
        produto: { select: { id: true, nome: true } },
        usuario: { select: { id: true, nome: true } },
      },
      orderBy: { criadoEm: 'desc' },
    });
    res.json(movimentacoes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar movimentações' });
  }
}

// DELETE /movimentacoes/:id - remove um lançamento feito por engano e desfaz o efeito no saldo
export async function removerMovimentacao(req: Request, res: Response) {
  const id = Number(req.params.id);

  try {
    await prisma.$transaction(async (tx) => {
      const mov = await tx.movimentacaoEstoque.findUnique({ where: { id } });
      if (!mov) throw new Error('NAO_ENCONTRADA');

      let delta: number;
      if (mov.tipo === 'ENTRADA') delta = -mov.quantidade;
      else if (mov.tipo === 'SAIDA' || mov.tipo === 'PERDA') delta = mov.quantidade;
      else delta = -mov.quantidade;

      const estoque = await tx.estoque.findUnique({ where: { produtoId: mov.produtoId } });
      const novaQuantidade = Math.max(0, (estoque?.quantidadeFisica ?? 0) + delta);

      await tx.estoque.update({
        where: { produtoId: mov.produtoId },
        data: { quantidadeFisica: novaQuantidade },
      });

      await tx.movimentacaoEstoque.delete({ where: { id } });
    });

    res.status(204).send();
  } catch (err) {
    if (err instanceof Error && err.message === 'NAO_ENCONTRADA') {
      return res.status(404).json({ erro: 'Movimentação não encontrada' });
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro ao remover movimentação' });
  }
}
