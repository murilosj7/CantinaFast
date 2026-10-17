/*
  Warnings:

  - You are about to drop the `auditoria` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `backup_log` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cartao_token` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `categoria` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cliente` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `despesa` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `destinatario_fiscal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `documento_fiscal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `fechamento_caixa` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `fornecedor` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `item_pedido` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `janela_retirada` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `movimentacao_estoque` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `notificacao` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `pagamento` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `pedido` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `perda_desperdicio` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `produto` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `reserva_estoque` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sincronizacao` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `usuario` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "TipoMovimentacaoEstoque" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'VENDA', 'PERDA', 'RETORNO');

-- CreateEnum
CREATE TYPE "CanalPedido" AS ENUM ('PRESENCIAL', 'ONLINE');

-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('PENDENTE', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO');

-- DropForeignKey
ALTER TABLE "auditoria" DROP CONSTRAINT "auditoria_id_usuario_fkey";

-- DropForeignKey
ALTER TABLE "cartao_token" DROP CONSTRAINT "cartao_token_id_cliente_fkey";

-- DropForeignKey
ALTER TABLE "despesa" DROP CONSTRAINT "despesa_id_fornecedor_fkey";

-- DropForeignKey
ALTER TABLE "despesa" DROP CONSTRAINT "despesa_id_usuario_fkey";

-- DropForeignKey
ALTER TABLE "documento_fiscal" DROP CONSTRAINT "documento_fiscal_id_destinatario_fkey";

-- DropForeignKey
ALTER TABLE "documento_fiscal" DROP CONSTRAINT "documento_fiscal_id_pedido_fkey";

-- DropForeignKey
ALTER TABLE "fechamento_caixa" DROP CONSTRAINT "fechamento_caixa_id_usuario_fkey";

-- DropForeignKey
ALTER TABLE "item_pedido" DROP CONSTRAINT "item_pedido_id_pedido_fkey";

-- DropForeignKey
ALTER TABLE "item_pedido" DROP CONSTRAINT "item_pedido_id_produto_fkey";

-- DropForeignKey
ALTER TABLE "movimentacao_estoque" DROP CONSTRAINT "movimentacao_estoque_id_pedido_fkey";

-- DropForeignKey
ALTER TABLE "movimentacao_estoque" DROP CONSTRAINT "movimentacao_estoque_id_produto_fkey";

-- DropForeignKey
ALTER TABLE "movimentacao_estoque" DROP CONSTRAINT "movimentacao_estoque_id_usuario_fkey";

-- DropForeignKey
ALTER TABLE "notificacao" DROP CONSTRAINT "notificacao_id_pedido_fkey";

-- DropForeignKey
ALTER TABLE "pagamento" DROP CONSTRAINT "pagamento_id_pedido_fkey";

-- DropForeignKey
ALTER TABLE "pedido" DROP CONSTRAINT "pedido_id_cliente_fkey";

-- DropForeignKey
ALTER TABLE "pedido" DROP CONSTRAINT "pedido_id_janela_fkey";

-- DropForeignKey
ALTER TABLE "pedido" DROP CONSTRAINT "pedido_id_usuario_fkey";

-- DropForeignKey
ALTER TABLE "perda_desperdicio" DROP CONSTRAINT "perda_desperdicio_id_produto_fkey";

-- DropForeignKey
ALTER TABLE "perda_desperdicio" DROP CONSTRAINT "perda_desperdicio_id_usuario_fkey";

-- DropForeignKey
ALTER TABLE "produto" DROP CONSTRAINT "produto_id_categoria_fkey";

-- DropForeignKey
ALTER TABLE "reserva_estoque" DROP CONSTRAINT "reserva_estoque_id_pedido_fkey";

-- DropForeignKey
ALTER TABLE "reserva_estoque" DROP CONSTRAINT "reserva_estoque_id_produto_fkey";

-- DropForeignKey
ALTER TABLE "sincronizacao" DROP CONSTRAINT "sincronizacao_id_pedido_fkey";

-- DropTable
DROP TABLE "auditoria";

-- DropTable
DROP TABLE "backup_log";

-- DropTable
DROP TABLE "cartao_token";

-- DropTable
DROP TABLE "categoria";

-- DropTable
DROP TABLE "cliente";

-- DropTable
DROP TABLE "despesa";

-- DropTable
DROP TABLE "destinatario_fiscal";

-- DropTable
DROP TABLE "documento_fiscal";

-- DropTable
DROP TABLE "fechamento_caixa";

-- DropTable
DROP TABLE "fornecedor";

-- DropTable
DROP TABLE "item_pedido";

-- DropTable
DROP TABLE "janela_retirada";

-- DropTable
DROP TABLE "movimentacao_estoque";

-- DropTable
DROP TABLE "notificacao";

-- DropTable
DROP TABLE "pagamento";

-- DropTable
DROP TABLE "pedido";

-- DropTable
DROP TABLE "perda_desperdicio";

-- DropTable
DROP TABLE "produto";

-- DropTable
DROP TABLE "reserva_estoque";

-- DropTable
DROP TABLE "sincronizacao";

-- DropTable
DROP TABLE "usuario";

-- DropEnum
DROP TYPE "OrigemPedido";

-- DropEnum
DROP TYPE "StatusBackup";

-- DropEnum
DROP TYPE "StatusEnvioNotificacao";

-- DropEnum
DROP TYPE "StatusFiscal";

-- DropEnum
DROP TYPE "StatusReserva";

-- DropEnum
DROP TYPE "StatusSincronizacao";

-- DropEnum
DROP TYPE "TipoDocumentoFiscal";

-- DropEnum
DROP TYPE "TipoEventoNotificacao";

-- DropEnum
DROP TYPE "TipoMovimentacao";

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "login" VARCHAR(120) NOT NULL,
    "senhaHash" VARCHAR(255) NOT NULL,
    "perfil" "PerfilUsuario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" SERIAL NOT NULL,
    "categoriaId" INTEGER NOT NULL,
    "nome" VARCHAR(140) NOT NULL,
    "descricao" TEXT,
    "precoVenda" DECIMAL(12,2) NOT NULL,
    "codigoBarras" VARCHAR(80),
    "imagemUrl" VARCHAR(500),
    "disponivelPresencial" BOOLEAN NOT NULL DEFAULT true,
    "disponivelOnline" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estoque" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "quantidadeFisica" INTEGER NOT NULL DEFAULT 0,
    "quantidadeReservada" INTEGER NOT NULL DEFAULT 0,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_estoque" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "tipo" "TipoMovimentacaoEstoque" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "motivo" VARCHAR(255),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER,
    "clienteId" INTEGER,
    "canal" "CanalPedido" NOT NULL,
    "status" "StatusPedido" NOT NULL DEFAULT 'PENDENTE',
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_pedido" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoUnitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "itens_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "formaPagamento" "FormaPagamento" NOT NULL,
    "statusPagamento" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "valor" DECIMAL(12,2) NOT NULL,
    "identificadorExterno" VARCHAR(150),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_login_key" ON "usuarios"("login");

-- CreateIndex
CREATE UNIQUE INDEX "produtos_codigoBarras_key" ON "produtos"("codigoBarras");

-- CreateIndex
CREATE UNIQUE INDEX "estoque_produtoId_key" ON "estoque"("produtoId");

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque" ADD CONSTRAINT "estoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_pedido" ADD CONSTRAINT "itens_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_pedido" ADD CONSTRAINT "itens_pedido_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
