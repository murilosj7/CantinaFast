// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id da movimentação vindo na URL.
import { parseId } from "../../utils/parseId";
// Regras do saldo: limite da coluna, efeito de cada tipo e o lock da linha de estoque.
import { MAXIMO_INTEIRO, efeitoNoSaldo, travarEstoque } from "./saldoEstoque";

// Início do motivo das movimentações que o criarPedido grava a cada venda ("Venda - pedido #123").
const PREFIXO_MOTIVO_VENDA = "Venda - pedido";

// DELETE /movimentacoes/:id — rota protegida (qualquer perfil logado). Responde 204 sem corpo.
// Desfaz o efeito da movimentação no estoque físico (soma de volta o que era SAIDA/PERDA/AJUSTE negativo; subtrai o que
// era ENTRADA/AJUSTE positivo) e apaga o registro. Serve para corrigir lançamentos manuais feitos por engano.
// Movimentações de venda (motivo começando com "Venda - pedido") NÃO podem ser removidas: respondem 400.
// O físico nunca fica negativo por causa da reversão: se ficaria (ex.: a entrada já foi vendida), responde 409 e nada muda.
// Tudo numa transação com a linha de estoque TRAVADA (SELECT ... FOR UPDATE), a mesma que criarMovimentacao usa.
export async function removerMovimentacao(req: Request, res: Response) {
  // Lê o :id da URL e valida.
  const id = parseId(req.params.id);

  await prisma.$transaction(async (tx) => {
    // Lê a movimentação só para saber de qual produto ela é (produtoId, tipo e quantidade nunca mudam depois de criados).
    const movimentacao = await tx.movimentacaoEstoque.findUnique({ where: { id } });
    if (!movimentacao) {
      throw new AppError("Movimentação não encontrada.", 404);
    }

    // Movimentação criada automaticamente por uma venda (motivo "Venda - pedido #N", gravado pelo criarPedido): o pedido
    // depende dela, então só se desfaz pelo pedido. Recusa antes de travar o estoque, sem alterar nada. Só as manuais
    // (POST /movimentacoes) e a ENTRADA "Estoque inicial" do produto podem ser removidas por aqui.
    if (movimentacao.motivo?.startsWith(PREFIXO_MOTIVO_VENDA)) {
      throw new AppError(
        "Esta movimentação está vinculada a uma venda e não pode ser removida diretamente. Cancele o pedido, se aplicável.",
        400,
      );
    }

    // Trava a linha de estoque do produto; devolve o estoque físico atual. Como todas as operações do produto passam
    // por este lock, daqui até o fim da transação ninguém mexe no saldo.
    const atual = await travarEstoque(tx, movimentacao.produtoId);

    // Apaga a movimentação JÁ COM O LOCK e confere que fomos nós que apagamos. Se duas requisições removerem a mesma
    // movimentação ao mesmo tempo, a segunda só chega aqui depois da primeira terminar e não encontra mais o registro:
    // sem esta conferência o efeito seria desfeito duas vezes.
    const apagadas = await tx.movimentacaoEstoque.deleteMany({ where: { id } });
    if (apagadas.count !== 1) {
      throw new AppError("Movimentação não encontrada.", 404);
    }

    // Desfazer = aplicar o efeito contrário ao que a movimentação teve.
    const efeito = efeitoNoSaldo(movimentacao.tipo, movimentacao.quantidade);
    const novo = atual - efeito;
    // Reversão que deixaria o físico negativo: recusa (o erro desfaz o delete acima) explicando o motivo.
    if (novo < 0) {
      throw new AppError(
        `Não é possível remover esta movimentação: o estoque físico atual é ${atual} e desfazê-la o deixaria em ${novo}. ` +
          "Parte das unidades dela já foi usada; registre uma movimentação de correção em vez de removê-la.",
        409,
      );
    }
    // A reversão de uma saída/perda soma de volta; não pode estourar a coluna inteira do banco.
    if (novo > MAXIMO_INTEIRO) {
      throw new AppError(`Não é possível remover esta movimentação: o estoque total passaria de ${MAXIMO_INTEIRO} unidades (atual: ${atual}).`, 409);
    }

    // Grava o saldo revertido (a linha está travada por nós).
    await tx.estoque.update({ where: { produtoId: movimentacao.produtoId }, data: { quantidadeFisica: novo } });
  });

  // 204: removido, sem corpo.
  res.status(204).send();
}
