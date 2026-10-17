// Tipos do Express: Request (o que chega) e Response (o que devolvemos).
import type { Request, Response } from "express";
// Enums do Prisma usados nos valores gravados, e o Prisma (para o tipo Decimal, que soma dinheiro sem erro de ponto flutuante).
import { CanalPedido, Prisma, StatusPedido, TipoMovimentacaoEstoque } from "@prisma/client";
// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";
// Valida ids (aqui, o produtoId de cada item).
import { parseId } from "../../utils/parseId";
// pedidoCompletoInclude carrega itens e pagamentos; paraPedido monta a resposta.
import { paraPedido, pedidoCompletoInclude } from "./pedido.mapper";

// Máximo de linhas (produtos diferentes) por pedido, para não aceitar pedidos absurdos.
const MAX_ITENS = 100;
// Maior quantidade que cabe numa coluna inteira do PostgreSQL.
const MAX_QUANTIDADE = 2147483647;
// Maior valor que cabe nas colunas Decimal(10,2) de dinheiro (subtotal e valorTotal).
const LIMITE_VALOR = new Prisma.Decimal("99999999.99");

// Valida o canal ("PRESENCIAL" ou "ONLINE", aceitando minúsculas) e devolve o enum do Prisma.
function lerCanal(valor: unknown): CanalPedido {
  // Se for texto: tira espaços e põe em maiúsculo; senão vira "" (que será recusado abaixo).
  const canal = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  // Confere se é um dos valores do enum.
  if (!Object.values(CanalPedido).includes(canal as CanalPedido)) {
    throw new AppError(`Canal inválido. Use: ${Object.values(CanalPedido).join(" ou ")}.`, 400, "canal");
  }
  return canal as CanalPedido;
}

// Valida a lista de itens { produtoId, quantidade } e devolve uma lista limpa.
function lerItens(valor: unknown): { produtoId: number; quantidade: number }[] {
  // Precisa ser uma lista com pelo menos 1 e no máximo MAX_ITENS itens.
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAX_ITENS) {
    throw new AppError(`Informe a lista 'itens' com 1 a ${MAX_ITENS} itens.`, 400, "itens");
  }

  // Guarda os produtoId já vistos, para recusar o mesmo produto em duas linhas.
  const vistos = new Set<number>();
  // Valida cada item da lista.
  return valor.map((item: unknown, i: number) => {
    // Cada item precisa ser um objeto (não nulo, não lista).
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new AppError(`O item ${i + 1} deve ser um objeto { produtoId, quantidade }.`, 400, `itens[${i}]`);
    }
    // Lê os dois campos do item.
    const { produtoId: produtoIdBruto, quantidade } = item as Record<string, unknown>;
    // produtoId precisa ser um inteiro positivo.
    const produtoId = parseId(produtoIdBruto, `itens[${i}].produtoId`);
    // quantidade precisa ser um número inteiro de 1 em diante (sem fração, sem texto).
    if (typeof quantidade !== "number" || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_QUANTIDADE) {
      throw new AppError(`A quantidade do item ${i + 1} deve ser um número inteiro maior que zero.`, 400, `itens[${i}].quantidade`);
    }
    // O mesmo produto em duas linhas é recusado: o cliente deve somar as quantidades num item só.
    if (vistos.has(produtoId)) {
      throw new AppError(`O produto ${produtoId} aparece mais de uma vez em 'itens'. Some as quantidades num único item.`, 400, "itens");
    }
    vistos.add(produtoId);
    return { produtoId, quantidade };
  });
}

// POST /pedidos — body: { canal: "PRESENCIAL" | "ONLINE", itens: [{ produtoId, quantidade }] }
// Rota protegida: o usuário do pedido é o do token (req.usuario.id); qualquer usuarioId no corpo é ignorado.
//
// CONCORRÊNCIA (pesquisado e testado no Postgres local): o isolamento padrão (READ COMMITTED) NÃO impede que
// duas requisições leiam "1 em estoque" ao mesmo tempo e as duas vendam a última unidade (teste "ingênuo"
// deu estoque final -1). A proteção usada aqui é o UPDATE CONDICIONAL: a conferência do saldo vai dentro do
// WHERE do próprio UPDATE do estoque, que é uma instrução única e atômica. Quem chega depois espera o lock da
// linha, reavalia o WHERE com o saldo já baixado e não atualiza nada (count = 0) -> o pedido inteiro é
// desfeito. SELECT ... FOR UPDATE também resolveria, mas exigiria SQL cru e um lock explícito. Para evitar
// deadlock entre pedidos com os mesmos produtos em ordens diferentes, as baixas são feitas em ordem
// crescente de produtoId. Limite conhecido: quantidadeReservada não é alterada aqui (reserva de estoque
// está fora do escopo); se algo mudá-la entre a leitura e a baixa, o pedido é recusado e pode ser repetido.
export async function criarPedido(req: Request, res: Response) {
  // Segurança extra: a rota exige autenticação; sem usuário no token não há como registrar quem vendeu.
  if (!req.usuario) {
    throw new AppError("Não autenticado.", 401);
  }
  // Id de quem está criando o pedido, vindo do token (nunca do corpo da requisição).
  const usuarioId = req.usuario.id;

  // Lê e valida o corpo antes de abrir a transação (erros de formato não precisam do banco).
  const { canal, itens: itensBrutos } = req.body ?? {};
  const canalPedido = lerCanal(canal);
  const itens = lerItens(itensBrutos);

  // Tudo abaixo roda numa transação: se qualquer passo falhar, NADA é gravado.
  const pedido = await prisma.$transaction(
    async (tx) => {
      // Busca de uma vez todos os produtos pedidos, já com o estoque de cada um.
      const produtos = await tx.produto.findMany({
        where: { id: { in: itens.map((item) => item.produtoId) } },
        include: { estoque: true },
      });
      // Indexa os produtos por id para achar cada um rápido.
      const produtoPorId = new Map(produtos.map((produto) => [produto.id, produto]));

      // Linhas do pedido (ItemPedido) que serão gravadas.
      const linhas: Prisma.ItemPedidoCreateManyPedidoInput[] = [];
      // Baixas de estoque que serão feitas depois que o pedido existir.
      const baixas: { produtoId: number; nome: string; quantidade: number; reservada: number }[] = [];
      // Soma dos subtotais (começa em zero).
      let valorTotal = new Prisma.Decimal(0);

      // Confere cada item, na ordem em que foi enviado.
      for (const item of itens) {
        // Produto do item (undefined se o id não existe).
        const produto = produtoPorId.get(item.produtoId);
        // Não existe: erro 400.
        if (!produto) {
          throw new AppError(`O produto ${item.produtoId} não existe.`, 400, "itens");
        }
        // Existe mas está inativo: não pode ser vendido.
        if (!produto.ativo) {
          throw new AppError(`O produto "${produto.nome}" está inativo.`, 400, "itens");
        }

        // Estoque do produto; sem linha em `estoque` conta como 0.
        const fisica = produto.estoque?.quantidadeFisica ?? 0;
        const reservada = produto.estoque?.quantidadeReservada ?? 0;
        // Saldo disponível = quantidade física menos a reservada.
        const disponivel = fisica - reservada;
        // Saldo menor que o pedido: erro 400 com o nome do produto.
        if (disponivel < item.quantidade) {
          throw new AppError(
            `Estoque insuficiente para "${produto.nome}": disponível ${Math.max(0, disponivel)}, solicitado ${item.quantidade}.`,
            400,
            "itens",
          );
        }

        // Preço da venda: sempre o precoVenda ATUAL do produto (o frontend não envia preço).
        const precoUnitario = produto.precoVenda;
        // Subtotal = preço x quantidade, em Decimal (sem erro de ponto flutuante).
        const subtotal = precoUnitario.mul(item.quantidade);
        // Subtotal que não cabe na coluna Decimal(10,2) daria erro no banco; recusa antes.
        if (subtotal.gt(LIMITE_VALOR)) {
          throw new AppError(`O valor do item "${produto.nome}" excede o limite permitido.`, 400, "itens");
        }

        // Guarda a linha do pedido e a baixa de estoque que ela exige.
        linhas.push({ produtoId: produto.id, quantidade: item.quantidade, precoUnitario, subtotal });
        baixas.push({ produtoId: produto.id, nome: produto.nome, quantidade: item.quantidade, reservada });
        // Acumula no total do pedido.
        valorTotal = valorTotal.plus(subtotal);
      }

      // O total também precisa caber na coluna Decimal(10,2).
      if (valorTotal.gt(LIMITE_VALOR)) {
        throw new AppError("O valor total do pedido excede o limite permitido.", 400, "itens");
      }

      // Cria o pedido (já com as linhas). Status inicial: ABERTO. Usuário: o do token.
      const novo = await tx.pedido.create({
        data: {
          usuarioId,
          canal: canalPedido,
          status: StatusPedido.ABERTO,
          valorTotal,
          // Cria os ItemPedido vinculados a este pedido na mesma operação.
          itens: { createMany: { data: linhas } },
        },
      });

      // Dá baixa no estoque em ordem crescente de produtoId (mesma ordem em todos os pedidos: evita deadlock).
      for (const baixa of [...baixas].sort((a, b) => a.produtoId - b.produtoId)) {
        // UPDATE condicional: só baixa se o saldo AINDA cobre a quantidade (e a reserva não mudou desde a leitura).
        const baixou = await tx.estoque.updateMany({
          where: {
            produtoId: baixa.produtoId,
            // Reserva igual à que foi lida...
            quantidadeReservada: baixa.reservada,
            // ...e quantidade física suficiente: física >= reservada + pedido  <=>  física - reservada >= pedido.
            quantidadeFisica: { gte: baixa.reservada + baixa.quantidade },
          },
          // Baixa atômica: física = física - quantidade.
          data: { quantidadeFisica: { decrement: baixa.quantidade } },
        });
        // Nenhuma linha atualizada: outra venda levou o saldo depois da nossa leitura. Desfaz o pedido inteiro.
        if (baixou.count === 0) {
          throw new AppError(
            `Estoque insuficiente para "${baixa.nome}": outra venda levou as últimas unidades. Tente novamente.`,
            400,
            "itens",
          );
        }
        // Registra a saída no histórico de movimentações de estoque.
        await tx.movimentacaoEstoque.create({
          data: {
            produtoId: baixa.produtoId,
            // Quem vendeu (usuário do token).
            usuarioId,
            tipo: TipoMovimentacaoEstoque.SAIDA,
            quantidade: baixa.quantidade,
            motivo: `Venda - pedido #${novo.id}`,
          },
        });
      }

      // Devolve o pedido completo (itens e pagamentos) para montar a resposta.
      return tx.pedido.findUniqueOrThrow({ where: { id: novo.id }, include: pedidoCompletoInclude });
    },
    // Espera até 5s por uma conexão livre e dá até 10s para a transação terminar (pedidos simultâneos).
    { maxWait: 5000, timeout: 10000 },
  );

  // Responde 201 (criado) com o pedido no formato da API.
  res.status(201).json(paraPedido(pedido));
}
