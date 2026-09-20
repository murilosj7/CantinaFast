// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Enums gravados no banco e o Prisma (tipo Decimal, que compara dinheiro sem erro de ponto flutuante).
import { FormaPagamento, Prisma, StatusPagamento, StatusPedido } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida o id do pedido enviado no corpo.
import { parseId } from "../../utils/parseId";
// Converte Decimal (dinheiro) em número comum para a resposta.
import { decimalParaNumero } from "../../utils/decimalParaNumero";
// Monta a resposta do pagamento no formato da API.
import { paraPagamento } from "./pagamento.mapper";

// Estados em que o pedido AINDA NÃO foi pago e por isso pode receber pagamento.
// Os demais estados ou são finais sem pagamento (CANCELADO, ESTORNADO) ou vêm DEPOIS do pagamento
// (PAGO, RECEBIDO_PELA_CANTINA, EM_SEPARACAO...): mudar esses para PAGO faria o pedido voltar no fluxo.
const STATUS_PAGAVEIS: StatusPedido[] = [
  StatusPedido.ABERTO,
  StatusPedido.ENVIADO_AO_CAIXA,
  StatusPedido.AGUARDANDO_PAGAMENTO,
];

// Valida a forma de pagamento ("PIX", "CARTAO" ou "DINHEIRO", aceitando minúsculas) e devolve o enum do Prisma.
function lerFormaPagamento(valor: unknown): FormaPagamento {
  // Se for texto: tira espaços e põe em maiúsculo; senão vira "" (que será recusado abaixo).
  const forma = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  // Confere se é um dos valores do enum.
  if (!Object.values(FormaPagamento).includes(forma as FormaPagamento)) {
    throw new AppError(`Forma de pagamento inválida. Use: ${Object.values(FormaPagamento).join(", ")}.`, 400, "formaPagamento");
  }
  return forma as FormaPagamento;
}

// Valida o valor enviado (número maior que zero, no máximo 2 casas) e devolve como Decimal.
function lerValor(valor: unknown): Prisma.Decimal {
  // Contrato: valor monetário é número (recusa texto, null, NaN e infinito).
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    throw new AppError("O valor deve ser um número maior que zero (ex.: 12.5).", 400, "valor");
  }
  // No máximo 2 casas decimais (multiplica por 100 e vê se sobra fração; 1e-6 é a tolerância).
  if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6) {
    throw new AppError("O valor deve ter no máximo 2 casas decimais.", 400, "valor");
  }
  // Passa por texto com 2 casas para virar Decimal exato (ex.: 7.5 -> "7.50").
  return new Prisma.Decimal(valor.toFixed(2));
}

// Confere se o pedido, no estado em que está, pode receber pagamento; se não, lança o erro 400 certo.
function garantirPedidoPagavel(status: StatusPedido) {
  // Já pago: não aceita um segundo pagamento (evita cobrar duas vezes).
  if (status === StatusPedido.PAGO) {
    throw new AppError("Este pedido já está pago.", 400, "pedidoId");
  }
  // Cancelado ou estornado: não há o que cobrar.
  if (status === StatusPedido.CANCELADO || status === StatusPedido.ESTORNADO) {
    throw new AppError(`Pedido ${status.toLowerCase()} não pode receber pagamento.`, 400, "pedidoId");
  }
  // Qualquer outro estado fora da lista já passou do pagamento (está em separação, retirada etc.).
  if (!STATUS_PAGAVEIS.includes(status)) {
    throw new AppError(`Este pedido já foi pago e está em andamento (status ${status}).`, 400, "pedidoId");
  }
}

// POST /pagamentos — body: { pedidoId, formaPagamento: "PIX" | "CARTAO" | "DINHEIRO", valor }
// Rota protegida (qualquer perfil logado). Versão simplificada da demo: NÃO há gateway, então o pagamento já nasce
// APROVADO e o pedido vai para PAGO. O valor precisa ser IGUAL ao total do pedido (sem pagamento parcial).
//
// Atomicidade: a mudança do pedido para PAGO e a criação do pagamento acontecem na MESMA transação; se qualquer
// parte falhar, nada é gravado.
//
// Concorrência: dois pagamentos simultâneos do mesmo pedido poderiam ambos ler "ainda não pago". Por isso a virada
// para PAGO é um UPDATE condicional ("só se o status ainda é pagável"): o banco trava a linha, o segundo pedido
// espera, reavalia a condição, não encontra mais nada para atualizar (count 0) e recebe o 400 "já está pago".
export async function registrarPagamento(req: Request, res: Response) {
  // Lê e valida o corpo antes de abrir a transação (erros de formato não precisam do banco).
  const { pedidoId: pedidoIdBruto, formaPagamento, valor } = req.body ?? {};
  // Id do pedido: inteiro positivo (senão 400 apontando pedidoId).
  const pedidoId = parseId(pedidoIdBruto, "pedidoId");
  // Forma de pagamento: um dos valores do enum.
  const forma = lerFormaPagamento(formaPagamento);
  // Valor: número positivo com até 2 casas, já como Decimal.
  const valorPago = lerValor(valor);

  // Tudo abaixo roda numa transação: ou grava o pedido PAGO + o pagamento, ou não grava nada.
  const pagamento = await prisma.$transaction(async (tx) => {
    // Busca o pedido para conferir estado e total.
    const pedido = await tx.pedido.findUnique({ where: { id: pedidoId } });
    // Não existe: o id veio no corpo (não na URL), então segue o padrão das outras referências do corpo: 400 no campo.
    if (!pedido) {
      throw new AppError("Pedido não encontrado.", 400, "pedidoId");
    }
    // Recusa pedido já pago, cancelado, estornado ou além do pagamento.
    garantirPedidoPagavel(pedido.status);
    // Sem pagamento parcial (nem a maior) nesta versão: o valor tem que bater com o total do pedido.
    if (!valorPago.equals(pedido.valorTotal)) {
      throw new AppError(
        `O valor (${decimalParaNumero(valorPago)}) deve ser igual ao total do pedido (${decimalParaNumero(pedido.valorTotal)}).`,
        400,
        "valor",
      );
    }

    // Virada atômica para PAGO: só acontece se o pedido AINDA estiver em um estado pagável neste instante.
    const virou = await tx.pedido.updateMany({
      where: { id: pedidoId, status: { in: STATUS_PAGAVEIS } },
      data: { status: StatusPedido.PAGO },
    });
    // Ninguém foi atualizado: outra requisição pagou (ou cancelou) o pedido entre a leitura e agora.
    if (virou.count === 0) {
      // Relê o estado atual para dar a mensagem verdadeira (na prática: "já está pago").
      const atual = await tx.pedido.findUnique({ where: { id: pedidoId }, select: { status: true } });
      // Sem pedido (foi apagado) ou ainda pagável (não deveria ocorrer): cai no 409 genérico abaixo.
      if (atual) garantirPedidoPagavel(atual.status);
      throw new AppError("O pedido foi alterado por outra operação. Tente novamente.", 409, "pedidoId");
    }

    // Cria o pagamento já APROVADO (simulação: sem gateway, sem identificador externo).
    return tx.pagamento.create({
      data: { pedidoId, formaPagamento: forma, statusPagamento: StatusPagamento.APROVADO, valor: valorPago },
    });
  });

  // 201 (criado) com o pagamento e o novo estado do pedido, para o frontend não precisar buscar de novo.
  res.status(201).json({
    ...paraPagamento(pagamento),
    pedido: { id: pedidoId, status: StatusPedido.PAGO, total: decimalParaNumero(pagamento.valor) },
  });
}
