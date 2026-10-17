-- CreateEnum
CREATE TYPE "PerfilUsuario" AS ENUM ('ADMINISTRADOR', 'ATENDENTE', 'CAIXA');

-- CreateEnum
CREATE TYPE "OrigemPedido" AS ENUM ('PRESENCIAL', 'ONLINE');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('PIX', 'DEBITO', 'CREDITO', 'DINHEIRO');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO', 'CANCELADO', 'EXPIRADO', 'ESTORNADO');

-- CreateEnum
CREATE TYPE "StatusReserva" AS ENUM ('ATIVA', 'CONVERTIDA', 'LIBERADA');

-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'VENDA', 'PERDA', 'RETORNO');

-- CreateEnum
CREATE TYPE "StatusSincronizacao" AS ENUM ('PENDING', 'PROCESSING', 'SYNCED', 'ERROR');

-- CreateEnum
CREATE TYPE "TipoDocumentoFiscal" AS ENUM ('NFCE', 'NFE');

-- CreateEnum
CREATE TYPE "StatusFiscal" AS ENUM ('PENDENTE', 'AUTORIZADO', 'REJEITADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusBackup" AS ENUM ('SUCESSO', 'ERRO');

-- CreateEnum
CREATE TYPE "TipoEventoNotificacao" AS ENUM ('PEDIDO_CONFIRMADO', 'PEDIDO_RECEBIDO', 'PRONTO_PARA_RETIRADA', 'PEDIDO_CANCELADO');

-- CreateEnum
CREATE TYPE "StatusEnvioNotificacao" AS ENUM ('PENDENTE', 'ENVIADA', 'FALHA');

-- CreateTable
CREATE TABLE "usuario" (
    "id_usuario" BIGSERIAL NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "login" VARCHAR(120) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "perfil" "PerfilUsuario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id_cliente" BIGSERIAL NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "telefone" VARCHAR(20),
    "email" VARCHAR(160),
    "senha_hash" VARCHAR(255),
    "login_google" VARCHAR(255),
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id_cliente")
);

-- CreateTable
CREATE TABLE "categoria" (
    "id_categoria" BIGSERIAL NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categoria_pkey" PRIMARY KEY ("id_categoria")
);

-- CreateTable
CREATE TABLE "produto" (
    "id_produto" BIGSERIAL NOT NULL,
    "id_categoria" BIGINT NOT NULL,
    "nome" VARCHAR(140) NOT NULL,
    "descricao" TEXT,
    "preco_venda" DECIMAL(12,2) NOT NULL,
    "custo" DECIMAL(12,2),
    "codigo_barras" VARCHAR(80),
    "estoque_fisico" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "estoque_minimo" DECIMAL(12,3),
    "disponivel_presencial" BOOLEAN NOT NULL DEFAULT true,
    "disponivel_online" BOOLEAN NOT NULL DEFAULT true,
    "ncm" VARCHAR(20),
    "cfop_padrao" VARCHAR(10),
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id_produto")
);

-- CreateTable
CREATE TABLE "janela_retirada" (
    "id_janela" BIGSERIAL NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "capacidade_maxima" INTEGER NOT NULL,
    "bloqueada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "janela_retirada_pkey" PRIMARY KEY ("id_janela")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id_pedido" BIGSERIAL NOT NULL,
    "id_cliente" BIGINT,
    "id_usuario" BIGINT,
    "id_janela" BIGINT,
    "origem" "OrigemPedido" NOT NULL,
    "nome_contato" VARCHAR(120),
    "telefone_contato" VARCHAR(20),
    "status_pedido" VARCHAR(30) NOT NULL,
    "numero_retirada" VARCHAR(30),
    "total" DECIMAL(12,2) NOT NULL,
    "identificador_unico" UUID NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id_pedido")
);

-- CreateTable
CREATE TABLE "item_pedido" (
    "id_item_pedido" BIGSERIAL NOT NULL,
    "id_pedido" BIGINT NOT NULL,
    "id_produto" BIGINT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "preco_unitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "item_pedido_pkey" PRIMARY KEY ("id_item_pedido")
);

-- CreateTable
CREATE TABLE "pagamento" (
    "id_pagamento" BIGSERIAL NOT NULL,
    "id_pedido" BIGINT NOT NULL,
    "forma_pagamento" "FormaPagamento" NOT NULL,
    "status_pagamento" "StatusPagamento" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "referencia_transacao" VARCHAR(150),
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamento_pkey" PRIMARY KEY ("id_pagamento")
);

-- CreateTable
CREATE TABLE "reserva_estoque" (
    "id_reserva" BIGSERIAL NOT NULL,
    "id_pedido" BIGINT NOT NULL,
    "id_produto" BIGINT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "status_reserva" "StatusReserva" NOT NULL,

    CONSTRAINT "reserva_estoque_pkey" PRIMARY KEY ("id_reserva")
);

-- CreateTable
CREATE TABLE "movimentacao_estoque" (
    "id_movimentacao" BIGSERIAL NOT NULL,
    "id_produto" BIGINT NOT NULL,
    "id_pedido" BIGINT,
    "id_usuario" BIGINT,
    "tipo" "TipoMovimentacao" NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "motivo" VARCHAR(255),
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacao_estoque_pkey" PRIMARY KEY ("id_movimentacao")
);

-- CreateTable
CREATE TABLE "fornecedor" (
    "id_fornecedor" BIGSERIAL NOT NULL,
    "nome_razao" VARCHAR(160) NOT NULL,
    "documento" VARCHAR(30),
    "telefone" VARCHAR(20),
    "email" VARCHAR(160),
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fornecedor_pkey" PRIMARY KEY ("id_fornecedor")
);

-- CreateTable
CREATE TABLE "despesa" (
    "id_despesa" BIGSERIAL NOT NULL,
    "id_usuario" BIGINT NOT NULL,
    "id_fornecedor" BIGINT,
    "categoria" VARCHAR(60) NOT NULL,
    "descricao" VARCHAR(255),
    "quantidade" DECIMAL(12,3),
    "valor_total" DECIMAL(12,2) NOT NULL,
    "data_lancamento" DATE NOT NULL,

    CONSTRAINT "despesa_pkey" PRIMARY KEY ("id_despesa")
);

-- CreateTable
CREATE TABLE "perda_desperdicio" (
    "id_perda" BIGSERIAL NOT NULL,
    "id_produto" BIGINT NOT NULL,
    "id_usuario" BIGINT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "motivo" VARCHAR(80) NOT NULL,
    "observacao" TEXT,
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perda_desperdicio_pkey" PRIMARY KEY ("id_perda")
);

-- CreateTable
CREATE TABLE "destinatario_fiscal" (
    "id_destinatario" BIGSERIAL NOT NULL,
    "nome_razao" VARCHAR(160) NOT NULL,
    "cpf_cnpj" VARCHAR(20) NOT NULL,
    "email" VARCHAR(160),
    "telefone" VARCHAR(20),
    "cep" VARCHAR(10),
    "logradouro" VARCHAR(180),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(120),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "uf" CHAR(2),
    "inscricao_estadual" VARCHAR(30),

    CONSTRAINT "destinatario_fiscal_pkey" PRIMARY KEY ("id_destinatario")
);

-- CreateTable
CREATE TABLE "documento_fiscal" (
    "id_documento" BIGSERIAL NOT NULL,
    "id_pedido" BIGINT NOT NULL,
    "id_destinatario" BIGINT,
    "tipo_documento" "TipoDocumentoFiscal" NOT NULL,
    "numero" VARCHAR(30),
    "chave_acesso" VARCHAR(60),
    "status_fiscal" "StatusFiscal" NOT NULL,
    "motivo_rejeicao" TEXT,
    "data_emissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documento_fiscal_pkey" PRIMARY KEY ("id_documento")
);

-- CreateTable
CREATE TABLE "fechamento_caixa" (
    "id_fechamento" BIGSERIAL NOT NULL,
    "id_usuario" BIGINT NOT NULL,
    "data_abertura" TIMESTAMP(3) NOT NULL,
    "data_fechamento" TIMESTAMP(3),
    "total_dinheiro" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_pix" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_debito" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_credito" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "diferenca" DECIMAL(12,2),

    CONSTRAINT "fechamento_caixa_pkey" PRIMARY KEY ("id_fechamento")
);

-- CreateTable
CREATE TABLE "sincronizacao" (
    "id_sincronizacao" BIGSERIAL NOT NULL,
    "id_pedido" BIGINT,
    "identificador_operacao" UUID NOT NULL,
    "tipo_operacao" VARCHAR(60) NOT NULL,
    "status_sincronizacao" "StatusSincronizacao" NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultima_tentativa" TIMESTAMP(3),
    "mensagem_erro" TEXT,

    CONSTRAINT "sincronizacao_pkey" PRIMARY KEY ("id_sincronizacao")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id_auditoria" BIGSERIAL NOT NULL,
    "id_usuario" BIGINT,
    "modulo" VARCHAR(60) NOT NULL,
    "acao" VARCHAR(100) NOT NULL,
    "entidade" VARCHAR(80) NOT NULL,
    "id_registro" VARCHAR(80),
    "dados_anteriores" JSONB,
    "dados_novos" JSONB,
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id_auditoria")
);

-- CreateTable
CREATE TABLE "cartao_token" (
    "id_cartao_token" BIGSERIAL NOT NULL,
    "id_cliente" BIGINT NOT NULL,
    "token_gateway" VARCHAR(255) NOT NULL,
    "bandeira" VARCHAR(30),
    "ultimos_quatro" CHAR(4),
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cartao_token_pkey" PRIMARY KEY ("id_cartao_token")
);

-- CreateTable
CREATE TABLE "backup_log" (
    "id_backup" BIGSERIAL NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "status" "StatusBackup",
    "destino" VARCHAR(120),
    "arquivo" VARCHAR(255),
    "mensagem_erro" TEXT,

    CONSTRAINT "backup_log_pkey" PRIMARY KEY ("id_backup")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id_notificacao" BIGSERIAL NOT NULL,
    "id_pedido" BIGINT NOT NULL,
    "tipo_evento" "TipoEventoNotificacao" NOT NULL,
    "canal" VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP',
    "status_envio" "StatusEnvioNotificacao" NOT NULL,
    "mensagem_erro" TEXT,
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id_notificacao")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_login_key" ON "usuario"("login");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_email_key" ON "cliente"("email");

-- CreateIndex
CREATE UNIQUE INDEX "produto_codigo_barras_key" ON "produto"("codigo_barras");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_numero_retirada_key" ON "pedido"("numero_retirada");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_identificador_unico_key" ON "pedido"("identificador_unico");

-- CreateIndex
CREATE UNIQUE INDEX "sincronizacao_identificador_operacao_key" ON "sincronizacao"("identificador_operacao");

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_id_categoria_fkey" FOREIGN KEY ("id_categoria") REFERENCES "categoria"("id_categoria") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "cliente"("id_cliente") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_janela_fkey" FOREIGN KEY ("id_janela") REFERENCES "janela_retirada"("id_janela") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamento" ADD CONSTRAINT "pagamento_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_estoque" ADD CONSTRAINT "reserva_estoque_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_estoque" ADD CONSTRAINT "reserva_estoque_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesa" ADD CONSTRAINT "despesa_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesa" ADD CONSTRAINT "despesa_id_fornecedor_fkey" FOREIGN KEY ("id_fornecedor") REFERENCES "fornecedor"("id_fornecedor") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perda_desperdicio" ADD CONSTRAINT "perda_desperdicio_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perda_desperdicio" ADD CONSTRAINT "perda_desperdicio_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_fiscal" ADD CONSTRAINT "documento_fiscal_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_fiscal" ADD CONSTRAINT "documento_fiscal_id_destinatario_fkey" FOREIGN KEY ("id_destinatario") REFERENCES "destinatario_fiscal"("id_destinatario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamento_caixa" ADD CONSTRAINT "fechamento_caixa_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sincronizacao" ADD CONSTRAINT "sincronizacao_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartao_token" ADD CONSTRAINT "cartao_token_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "cliente"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE RESTRICT ON UPDATE CASCADE;
