# CantinaFast — Administrador

Início do painel interno do CantinaFast. Por enquanto implementa:

- **US-01 — Login no Sistema Interno**: acesso para Atendente, Caixa e
  Administrador, com mensagem genérica de erro (não revela se foi
  login ou senha) e bloqueio de usuário inativo.
- **US-02 — Cadastro de Usuário Interno**: criação com nome, login,
  senha e perfil; login duplicado é tratado como erro de campo.
- **US-03 — Edição de Usuário Interno**: altera nome, senha e perfil
  (login não pode ser alterado).
- **US-04 — Inativação de Usuário Interno**: inativa/reativa em vez de
  excluir, preservando histórico.

O menu lateral já lista as demais áreas do Administrador previstas na
documentação (Produtos, Estoque, Despesas, Fornecedores, BI,
Financeiro, Fiscal, Sincronização, Backup, Configurações) como itens
desabilitados, prontos para ganhar uma página quando forem construídas.

## Como rodar

```bash
npm install
cp .env.example .env   # ajuste VITE_API_URL para a API do backend
npm run dev
```

Roda por padrão em `http://localhost:5174` (porta diferente do Site
Cliente, para os dois poderem rodar ao mesmo tempo).

## Regras de negócio já refletidas na interface

- Não é possível remover a última conta de Administrador ativa — a
  tela repassa o erro do backend, mas a validação de fato acontece lá
  (RN de US-03/US-04).
- Usuário inativo perde acesso mesmo com sessão válida (checado na
  rota protegida).
- Criar usuário exige senha; editar usuário permite deixá-la em branco
  para manter a atual.

## Onde plugar o backend

Serviços em `src/services/authService.ts` e `src/services/usuarioService.ts`
descrevem as rotas esperadas (`/interno/login`, `/interno/usuarios` etc.).
Ajuste-as quando o contrato real da API estiver definido.
