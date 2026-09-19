CantinaFast — Contexto do Projeto

TCC em equipe de 3 pessoas. Sistema de gestão para cantina escolar, com PDV presencial (atendimento + caixa), site de pedidos online e painel administrativo.

🚨 PRAZO URGENTE — pré-banca segunda 21/09

Code freeze domingo à noite — depois disso ninguém mexe em mais nada. Segunda de manhã é só ensaio, zero código.

Escopo da demo de segunda (não é o projeto completo, é o que precisa estar de pé):

Login interno funcionando
CRUD de Produtos/Categorias
Criar um pedido presencial com pagamento simulado (sem gateway real)
Site do Cliente (login + catálogo) só se sobrar tempo — é bônus, não é cobrado

Cortado da demo de segunda (fica pra depois, não implementar agora): pagamento real (Pix/cartão), fiscal (NFC-e/NF-e), financeiro, auditoria, sincronização, backup, cancelamento/estorno, reserva de estoque com concorrência, notificações WhatsApp, BI, Cliente, Favorito.

Plano dos 3 dias:

Sexta (hoje): CRUD de Usuários, Categorias, Produtos, Pedido+ItemPedido, Pagamento. Sem autenticação ainda — CRUDs ficam sem proteção por enquanto.
Sábado: Autenticação (login interno) + middleware JWT. Tarde/noite: testar integração real com o frontend do Andrei (Login + Catálogo).
Domingo: Fluxo de pedido presencial de ponta a ponta (criar pedido, item, baixar estoque, marcar pagamento como confirmado manualmente). Tarde: sessão de integração os três juntos. Noite: code freeze.
Meu papel (Victor)

Sou o Integrante 2 — Backend e Regras de Negócio. Trabalho com um PostgreSQL local próprio, independente dos outros dois integrantes, para não ficar bloqueado.

Time e responsabilidades
Murilo (Integrante 3 — Banco/Infra/QA): já modelou e migrou um schema Prisma próprio (ver "Schema atual" abaixo), com o módulo de Estoque pronto e testado. Vai converter esse módulo de JS para TS.
Andrei (Integrante 1 — Frontend): já construiu Site Cliente e Administrador em React+TS esperando um contrato de API específico (ver "Contrato do frontend" abaixo).
⚠️ Schema atual — provisório, do Murilo (não o de 21 entidades original)

Por causa do prazo, ficou decidido usar o schema reduzido que o Murilo já modelou e migrou, com os nomes que ELE definiu (não os que estavam na documentação original) — não vale a pena renomear agora, mesmo que divirja do relatório:

usuarios            (id, nome, login, senhaHash, perfil, ativo, criadoEm)
categorias          (id, nome, ativa)
produtos            (id, categoriaId, nome, descricao, precoVenda, codigoBarras, imagemUrl,
                       disponivelPresencial, disponivelOnline, ativo, criadoEm)
estoque              (id, produtoId, quantidadeFisica, quantidadeReservada, estoqueMinimo)
movimentacoes_estoque (id, produtoId, usuarioId, tipo, quantidade, motivo, criadoEm)
pedidos              (id, usuarioId, clienteId, canal, status, valorTotal, criadoEm)
itens_pedido         (id, pedidoId, produtoId, quantidade, precoUnitario, subtotal)
pagamentos           (id, pedidoId, formaPagamento, statusPagamento, valor,
                       identificadorExterno, criadoEm)

Enums do Murilo: PerfilUsuario (ATENDENTE/CAIXA/ADMINISTRADOR), TipoMovimentacaoEstoque, CanalPedido, StatusPedido, FormaPagamento, StatusPagamento.

Note: pedidos.clienteId existe no schema mas Cliente não está modelado ainda (fora do escopo desta entrega) — tratar como campo solto por enquanto, sem @relation obrigatória.

Diferenças em relação à documentação original do projeto (não corrigir agora): canal (aqui) = origem (documentação); identificadorExterno (aqui) = referenciaTransacao (documentação); tabelas no plural aqui vs. singular na documentação/DER. Isso será reconciliado depois da pré-banca.

Estoque é uma tabela própria ligada a Produto (decisão: manter assim, é a versão já testada — a documentação/DER será ajustada depois para refletir isso, não o contrário).

Assim que o Murilo mandar o schema.prisma real (arquivo, não só esta descrição), substituir esta seção e importar o arquivo de verdade no projeto.

Contrato de API esperado pelo frontend (Andrei)

Documento completo em contrato-api-cantinafast.md no repo do frontend. Pontos que afetam os módulos de hoje:

Toda resposta de erro: { mensagem: string, campo?: string } — implementar como middleware de erro genérico, não repetir isso manualmente em cada rota.
Nomes de campo do frontend podem divergir dos nomes do banco (ex: preco vs precoVenda, numero vs algum id de pedido) — resolver com tradução no controller, nunca renomeando o schema por causa disso.
Enums do banco ficam em português maiúsculo (ex: APROVADO); o frontend espera valores como "pago" — traduzir na resposta da API, não mudar o enum do Prisma.
Regra: não pode inativar o último usuário com perfil ADMINISTRADOR ativo — validar no controller antes do update, não é constraint de banco.
Cliente/Favorito/checkout online: fora do escopo de agora (ver seção do prazo).
Stack definida
Backend: Node.js + Express + TypeScript (decisão do time — Murilo está convertendo o módulo dele de JS para TS também)
ORM: Prisma
Execução em dev: tsx watch (NÃO usar ts-node/nodemon — incompatíveis com Node.js v25, causam erro Cannot read properties of undefined (reading 'fileExists'))
Banco local (dev): PostgreSQL rodando na máquina, banco cantinafast_dev
Banco em nuvem (produção, site cliente, pós-pré-banca): Supabase — usado só como PostgreSQL gerenciado, nunca a API REST/GraphQL automática (PostgREST) para dados de negócio. Todo acesso a dado passa pela API Express via Prisma.
Frontend: React + TypeScript + Tailwind + Vite, deploy na Vercel
Testes de API: Postman
Versionamento: Git/GitHub, branch principal protegida, PRs para merge
Estrutura de pastas — uma pasta por entidade, um arquivo por ação

Decisão explícita do Victor: quer conseguir apontar exatamente onde está cada funcionalidade na apresentação, então preferiu granularidade máxima em vez de controllers com múltiplas funções:

src/
  modules/
    usuario/
      criarUsuario.ts
      listarUsuarios.ts
      buscarUsuarioPorId.ts
      atualizarUsuario.ts
      inativarUsuario.ts
      usuario.routes.ts
    categoria/
      (mesmo padrão: criar/listar/atualizar/inativar + categoria.routes.ts)
    produto/
      (mesmo padrão + buscarProdutoPorCodigoBarras.ts)
    pedido/
      criarPedido.ts
      listarPedidos.ts
      buscarPedidoPorId.ts
      pedido.routes.ts
    pagamento/
      registrarPagamento.ts
      listarPagamentosPorPedido.ts
      pagamento.routes.ts
  middlewares/
    errorHandler.ts       ← padroniza toda resposta de erro como { mensagem, campo? }
    auth.middleware.ts    ← JWT, entra no sábado
  config/
    prisma.ts             ← instância única do PrismaClient
  server.ts                ← só monta o Express e pluga as rotas de cada módulo
Ambiente de dev — problemas já resolvidos (não repetir)
Node.js v25 + ts-node/nodemon = quebra. Usar tsx watch no lugar.
Senha do Postgres com caracteres especiais (@, :, etc.) quebra a DATABASE_URL do Prisma — usar senha só com letras/números em dev.
Se npx prisma generate der erro de módulo .wasm faltando, o @prisma/client provavelmente está corrompido — reinstalar com versão travada (verificar a versão em uso no package.json antes de reinstalar, ex: prisma@6.19.3 @prisma/client@6.19.3).
Depois da pré-banca — plano original completo (retomar quando o prazo aliviar)

O projeto tem 21 entidades no DER oficial (Usuario, Cliente, Categoria, Produto, JanelaRetirada, Pedido, ItemPedido, Pagamento, ReservaEstoque, MovimentacaoEstoque, Fornecedor, Despesa, PerdaDesperdicio, DestinatarioFiscal, DocumentoFiscal, FechamentoCaixa, Sincronizacao, Auditoria, CartaoToken, BackupLog, Notificacao) e regras de negócio mais completas (idempotência, concorrência de estoque, notificação por estágio do pedido, etc.) — isso volta à mesa depois de segunda, reconciliando com o schema reduzido que efetivamente foi pra produção nesta entrega.