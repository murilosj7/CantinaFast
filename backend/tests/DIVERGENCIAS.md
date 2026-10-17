# Divergências entre a API atual e o PDF de modelagem

Fonte: `docs/CantinaFast_Modelagem_Banco_de_Dados.pdf` (versão consolidada 2026) × código em `backend/src` e `prisma/schema.prisma`.

As suítes em `backend/tests/` são **regressão do comportamento atual**. Toda asserção que afirma um comportamento que
**conflita com o PDF** vem marcada `[DIVERGE-PDF]` no nome do caso e, no código, com um comentário `// [DIVERGE-PDF] Dn`
apontando para o item abaixo. O runner (`npm test`) mostra a contagem dessas asserções em uma coluna própria do quadro final.
Quando um módulo for reconciliado com o PDF, as asserções do item correspondente são as primeiras a mudar.

Itens **prioritários** (D1 e D2) ficam para ser corrigidos junto com `ReservaEstoque`.

| Id | Entidade | PDF | Código atual | Prioridade |
|---|---|---|---|---|
| D1 | Pedido / estoque | "A baixa definitiva do estoque ocorre apenas após pagamento validamente aprovado ou confirmação em dinheiro." | `criarPedido` baixa o físico e grava a movimentação `Venda - pedido #N` **na criação**, com o pedido ainda `ABERTO` e sem pagamento. | **Alta** |
| D2 | Pedido / estoque | Falha, expiração ou cancelamento libera a reserva; cancelamento e retorno geram movimentos. | Não existe cancelamento de pedido nem devolução de estoque: um pedido nunca pago consome estoque para sempre. | **Alta** |
| D3 | Pedido × Pagamento | `status_pedido`, `status_pagamento` e demais estados são independentes e "não devem ser reutilizados como um único campo". | `StatusPedido` mistura estado de pagamento (`PAGO`, `ESTORNADO`, `CANCELADO`); `registrarPagamento` põe o pedido em `PAGO`. | Média |
| D4 | Pedido | `identificador_unico` UUID UNIQUE: idempotência para impedir duplicidade de pedido, pagamento, estoque. | Não existe. O mesmo `POST /pedidos` enviado duas vezes cria dois pedidos e baixa o estoque duas vezes. | Média |
| D5 | Pedido | Campos `id_janela`, `nome_contato`, `telefone_contato`, `numero_retirada` (UNIQUE) e `identificador_unico`. | Nenhum existe. O pedido tem só `usuarioId`, `clienteId`, `canal`, `status`, `valorTotal`, `criadoEm`. | Média |
| D6 | Pedido / Movimentação | `id_usuario` é FK NULL (o pedido online e movimentos automáticos não têm usuário interno). | `usuarioId` é obrigatório em `Pedido` e em `MovimentacaoEstoque`; pedido `ONLINE` hoje exige usuário interno. | Média |
| D7 | Cliente / Pedido | Entidade `CLIENTE` e `PEDIDO.id_cliente` FK NULL; o pedido de visitante guarda `nome_contato` e `telefone_contato`. | **Parcial.** A tabela `clientes` e a FK `pedidos.clienteId → clientes.id` (nullable, `ON DELETE RESTRICT`) existem, com cadastro e login do cliente. Pendente: o vínculo no pedido (`criarPedido` ignora `clienteId` do corpo e o pedido ainda é sempre `null`), pedidos de visitante (`nome_contato`/`telefone_contato`) e rotas de pedido do cliente. | Média (pedido do cliente) |
| D8 | Vários | Nomes: `origem`, `data_hora`, `referencia_transacao`, `ativo` (categoria). | `canal`, `criadoEm`, `identificadorExterno`, `ativa`. A API expõe os nomes do código. Tradução fica nos mappers (decisão registrada no `CLAUDE.md`). | Baixa |
| D9 | Pagamento | Formas: **Pix, débito, crédito ou dinheiro**. | `FormaPagamento` só tem `PIX`, `CARTAO` e `DINHEIRO`; `DEBITO` e `CREDITO` são rejeitados (400). | Média |
| D10 | Pagamento | Uma linha por **tentativa/transação**, com `pendente → aprovado/recusado/cancelado/expirado`; a tentativa recusada não fecha o pedido. | `registrarPagamento` cria sempre `APROVADO` na hora; não há `PENDENTE`, nem gateway, nem estorno/cancelamento de pagamento (`ESTORNADO` existe no enum, sem rota), nem pagamento parcial (valor tem de ser igual ao total). `referencia_transacao` nunca é preenchida. | Média |
| D11 | Estoque / Reserva | Entidade `RESERVA_ESTOQUE` (ATIVA/CONVERTIDA/LIBERADA); disponível = físico − soma das reservas ativas, sem armazenar o disponível. | Não existe a entidade. `Estoque.quantidadeReservada` é um contador armazenado que nada altera (fica sempre 0); só entra na conta do disponível. | Alta (junto com D1/D2) |
| D12 | Movimentação | Tipos: entrada, saída, ajuste, **venda**, perda, **retorno**; `id_pedido` FK NULL. | Só `ENTRADA`, `SAIDA`, `PERDA`, `AJUSTE`. A venda é `SAIDA` com o texto `Venda - pedido #N` no motivo; não há `pedidoId` (decisão registrada: o bloqueio de remoção usa o texto). O ajuste de estoque do produto grava `ENTRADA`/`SAIDA`, nunca `AJUSTE`. | Média |
| D13 | Quantidades | `NUMERIC(12,3)` em item de pedido, movimentação, estoque e mínimo (aceita fração, ex.: venda por peso). | Tudo `Int`; frações são rejeitadas (400) em pedido, movimentação, ajuste e estoque mínimo. | Média |
| D14 | Produto | Campos `custo`, `ncm`, `cfop_padrao`; estoque físico/mínimo dentro de PRODUTO; preço `NUMERIC(12,2)`. | Sem custo/ncm/cfop; estoque em tabela própria (decisão do `CLAUDE.md`); preço `Decimal(10,2)` (teto R$ 99.999.999,99). | Baixa |
| D15 | Auditoria | Alterações críticas de preço, estoque, usuários, cancelamentos e fiscal devem manter usuário, data/hora e informação suficiente. | Entidade `AUDITORIA` não existe. `DELETE /movimentacoes/:id` apaga fisicamente o histórico de estoque sem rastro; mudanças de preço e de usuário também não deixam registro. | Média |
| D16 | Cliente | `id_cliente` BIGSERIAL (todos os ids do PDF são BIGSERIAL/BIGINT). | `clientes.id` é `Int` (SERIAL), igual a `pedidos.clienteId` e a todos os demais ids do schema. Migrar **todos** os ids para `BigInt` é uma tarefa única de reconciliação, não módulo a módulo. | Baixa |
| D17 | Cliente | `telefone` VARCHAR(20): "WhatsApp/telefone". | A API usa `telefone`; o contrato do frontend (`contrato-api-cantinafast.md`) fala em `whatsapp` no cadastro e no usuário do site. O frontend ou o mapper precisa de acordo antes de ligar o site. | Baixa |
| D18 | Cliente | `login_google` VARCHAR(255), sem UNIQUE no PDF. | Sem `@unique` também na API (fiel ao PDF), então dois clientes podem ter o mesmo `loginGoogle`. Avaliar um índice único parcial (`WHERE login_google IS NOT NULL`) na reconciliação, antes de implementar o login Google. | Baixa (antes do login Google) |

## Observações

- **Permissões por perfil**: o PDF só diz que o perfil é Administrador, Atendente ou Caixa. Hoje só `POST/PATCH/inativar` de
  `/interno/usuarios` são exclusivos do administrador; todas as demais rotas aceitam qualquer perfil autenticado. As suítes fixam
  isso como "comportamento atual (lacuna conhecida)" — não é uma divergência com o PDF, mas é uma decisão a tomar.
- O que **bate** com o PDF e é testado normalmente: `Usuario` (perfis e `ativo`), código de barras `UNIQUE`, exclusão lógica por
  `ativo`, preço congelado no item do pedido, transação contra estoque negativo e venda concorrente da última unidade.
- Tradução dos enums nos mappers (perfil em minúsculo, dinheiro como `number`, datas ISO) é decisão do projeto e é testada como regra.
