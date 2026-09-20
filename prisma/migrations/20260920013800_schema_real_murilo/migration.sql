-- AlterEnum
BEGIN;
CREATE TYPE "FormaPagamento_new" AS ENUM ('PIX', 'CARTAO', 'DINHEIRO');
ALTER TABLE "pagamentos" ALTER COLUMN "formaPagamento" TYPE "FormaPagamento_new" USING ("formaPagamento"::text::"FormaPagamento_new");
ALTER TYPE "FormaPagamento" RENAME TO "FormaPagamento_old";
ALTER TYPE "FormaPagamento_new" RENAME TO "FormaPagamento";
DROP TYPE "public"."FormaPagamento_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "StatusPedido_new" AS ENUM ('ABERTO', 'ENVIADO_AO_CAIXA', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'RECEBIDO_PELA_CANTINA', 'EM_SEPARACAO', 'PRONTO_PARA_RETIRADA', 'ENTREGUE', 'RETIRADO', 'CANCELADO', 'ESTORNADO');
ALTER TABLE "public"."pedidos" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "pedidos" ALTER COLUMN "status" TYPE "StatusPedido_new" USING ("status"::text::"StatusPedido_new");
ALTER TYPE "StatusPedido" RENAME TO "StatusPedido_old";
ALTER TYPE "StatusPedido_new" RENAME TO "StatusPedido";
DROP TYPE "public"."StatusPedido_old";
ALTER TABLE "pedidos" ALTER COLUMN "status" SET DEFAULT 'ABERTO';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TipoMovimentacaoEstoque_new" AS ENUM ('ENTRADA', 'SAIDA', 'PERDA', 'AJUSTE');
ALTER TABLE "movimentacoes_estoque" ALTER COLUMN "tipo" TYPE "TipoMovimentacaoEstoque_new" USING ("tipo"::text::"TipoMovimentacaoEstoque_new");
ALTER TYPE "TipoMovimentacaoEstoque" RENAME TO "TipoMovimentacaoEstoque_old";
ALTER TYPE "TipoMovimentacaoEstoque_new" RENAME TO "TipoMovimentacaoEstoque";
DROP TYPE "public"."TipoMovimentacaoEstoque_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "movimentacoes_estoque" DROP CONSTRAINT "movimentacoes_estoque_usuarioId_fkey";

-- DropForeignKey
ALTER TABLE "pedidos" DROP CONSTRAINT "pedidos_usuarioId_fkey";

-- AlterTable
ALTER TABLE "categorias" ALTER COLUMN "nome" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "itens_pedido" ALTER COLUMN "precoUnitario" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "movimentacoes_estoque" ALTER COLUMN "usuarioId" SET NOT NULL,
ALTER COLUMN "motivo" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "pagamentos" ALTER COLUMN "valor" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "identificadorExterno" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "pedidos" ALTER COLUMN "usuarioId" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ABERTO',
ALTER COLUMN "valorTotal" SET DEFAULT 0,
ALTER COLUMN "valorTotal" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "produtos" ALTER COLUMN "nome" SET DATA TYPE TEXT,
ALTER COLUMN "precoVenda" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "codigoBarras" SET DATA TYPE TEXT,
ALTER COLUMN "imagemUrl" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "nome" SET DATA TYPE TEXT,
ALTER COLUMN "login" SET DATA TYPE TEXT,
ALTER COLUMN "senhaHash" SET DATA TYPE TEXT;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

