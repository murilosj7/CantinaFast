import { useState, type FormEvent } from 'react';
import {
  Alerta,
  AreaTexto,
  Badge,
  Button,
  Campo,
  Confirmacao,
  Entrada,
  Interruptor,
  LinhaMensagem,
  Modal,
  PaginaCabecalho,
  Selecao,
  tabela,
} from '../components/ui';
import { lerErro } from '../lib/api';
import { lerPreco, moeda } from '../lib/format';
import { useCarregar } from '../lib/useCarregar';
import { useDebounce } from '../lib/useDebounce';
import { categoriaService } from '../services/categoriaService';
import { produtoService } from '../services/produtoService';
import type { Categoria, Produto } from '../types';

type Situacao = 'todos' | 'ativo' | 'inativo';

const CAMPOS_DO_FORM = ['nome', 'preco', 'categoriaId', 'descricao', 'codigoBarras', 'imagemUrl', 'quantidadeInicial'];

function Miniatura({ url }: { url: string }) {
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) {
    return <div className="h-10 w-10 shrink-0 rounded bg-carvao/10" aria-hidden="true" />;
  }
  return <img src={url} alt="" onError={() => setFalhou(true)} className="h-10 w-10 shrink-0 rounded object-cover" />;
}

export function ProdutosPage() {
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [status, setStatus] = useState<Situacao>('todos');
  const buscaAtrasada = useDebounce(busca);

  const { dados, carregando, erro, recarregar } = useCarregar(
    () =>
      produtoService.listar({
        busca: buscaAtrasada,
        categoriaId: categoriaId === '' ? undefined : Number(categoriaId),
        status,
      }),
    [buscaAtrasada, categoriaId, status],
  );
  const produtos = dados ?? [];

  // Todas as categorias (inclusive inativas) para o filtro e para o formulário.
  const { dados: categoriasDados } = useCarregar(() => categoriaService.listar({ status: 'todas' }), []);
  const categorias = categoriasDados ?? [];

  const [editando, setEditando] = useState<Produto | 'novo' | null>(null);
  const [alvoInativar, setAlvoInativar] = useState<Produto | null>(null);
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function alterarAtivo(alvo: Produto, ativo: boolean) {
    setProcessando(true);
    setMensagem(null);
    setErroAcao(null);
    try {
      await produtoService.atualizar(alvo.id, { ativo });
      setMensagem(ativo ? `"${alvo.nome}" foi reativado.` : `"${alvo.nome}" foi inativado.`);
      recarregar();
    } catch (e) {
      setErroAcao(lerErro(e).mensagem);
    } finally {
      setProcessando(false);
      setAlvoInativar(null);
    }
  }

  function aoSalvar(texto: string) {
    setEditando(null);
    setErroAcao(null);
    setMensagem(texto);
    recarregar();
  }

  return (
    <>
      <PaginaCabecalho
        titulo="Produtos"
        descricao="O cardápio da cantina. Produtos não são excluídos, porque os pedidos antigos continuam apontando para eles."
        acao={<Button onClick={() => setEditando('novo')}>Novo produto</Button>}
      />

      <div className="space-y-4">
        {mensagem && <Alerta tipo="sucesso">{mensagem}</Alerta>}
        {erroAcao && <Alerta>{erroAcao}</Alerta>}
        {erro && (
          <Alerta
            acao={
              <Button variante="secundario" tamanho="sm" onClick={recarregar}>
                Tentar de novo
              </Button>
            }
          >
            {erro}
          </Alerta>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_11rem]">
          <Entrada
            aria-label="Buscar por nome ou código de barras"
            placeholder="Buscar por nome ou código de barras"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Selecao aria-label="Filtrar por categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.ativa ? '' : ' (inativa)'}
              </option>
            ))}
          </Selecao>
          <Selecao aria-label="Filtrar por situação" value={status} onChange={(e) => setStatus(e.target.value as Situacao)}>
            <option value="todos">Todas as situações</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </Selecao>
        </div>

        <div className={tabela.caixa}>
          <table className={tabela.base}>
            <thead className={tabela.cabecalho}>
              <tr>
                <th className={tabela.th}>Produto</th>
                <th className={tabela.th}>Categoria</th>
                <th className={`${tabela.th} text-right`}>Preço</th>
                <th className={`${tabela.th} text-right`}>Disponível</th>
                <th className={tabela.th}>Vendido em</th>
                <th className={tabela.th}>Situação</th>
                <th className={`${tabela.th} text-right`}>Ações</th>
              </tr>
            </thead>
            <tbody className={carregando && dados ? 'opacity-60' : ''}>
              {!dados && carregando ? (
                <LinhaMensagem colunas={7}>Carregando…</LinhaMensagem>
              ) : produtos.length === 0 ? (
                <LinhaMensagem colunas={7}>Nenhum produto encontrado com esses filtros.</LinhaMensagem>
              ) : (
                produtos.map((p) => (
                  <tr key={p.id} className={tabela.linha}>
                    <td className={tabela.td}>
                      <div className="flex items-center gap-3">
                        <Miniatura url={p.imagemUrl} />
                        <div className="min-w-0">
                          <p className="font-medium">{p.nome}</p>
                          {p.codigoBarras && <p className="text-xs text-carvao/60">Código {p.codigoBarras}</p>}
                        </div>
                      </div>
                    </td>
                    <td className={tabela.td}>{p.categoriaNome}</td>
                    <td className={`${tabela.td} text-right tabular-nums`}>{moeda(p.preco)}</td>
                    <td className={`${tabela.td} text-right tabular-nums`}>
                      {p.quantidadeDisponivel === 0 ? <Badge tom="vermelho">Sem estoque</Badge> : p.quantidadeDisponivel}
                    </td>
                    <td className={tabela.td}>
                      <div className="flex flex-wrap gap-1">
                        {p.disponivelPresencial && <Badge tom="azul">Presencial</Badge>}
                        {p.disponivelOnline && <Badge tom="laranja">Online</Badge>}
                        {!p.disponivelPresencial && !p.disponivelOnline && <span className="text-carvao/50">Nenhum canal</span>}
                      </div>
                    </td>
                    <td className={tabela.td}>
                      <Badge tom={p.ativo ? 'verde' : 'neutro'}>{p.ativo ? 'Ativo' : 'Inativo'}</Badge>
                    </td>
                    <td className={`${tabela.td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <Button variante="fantasma" tamanho="sm" onClick={() => setEditando(p)}>
                          Editar
                        </Button>
                        {p.ativo ? (
                          <Button variante="fantasma" tamanho="sm" onClick={() => setAlvoInativar(p)}>
                            Inativar
                          </Button>
                        ) : (
                          <Button variante="fantasma" tamanho="sm" disabled={processando} onClick={() => alterarAtivo(p, true)}>
                            Reativar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal aberto={editando !== null} titulo={editando === 'novo' ? 'Novo produto' : 'Editar produto'} aoFechar={() => setEditando(null)} largura="max-w-2xl">
        {editando !== null && (
          <FormProduto
            key={editando === 'novo' ? 'novo' : editando.id}
            produto={editando === 'novo' ? null : editando}
            categorias={categorias}
            aoSalvar={aoSalvar}
            aoCancelar={() => setEditando(null)}
          />
        )}
      </Modal>

      <Confirmacao
        aberto={alvoInativar !== null}
        titulo="Inativar produto"
        mensagem={
          alvoInativar
            ? `"${alvoInativar.nome}" deixa de aparecer no catálogo e não pode mais ser vendido. Os pedidos antigos são mantidos e você pode reativar depois.`
            : ''
        }
        rotulo="Inativar"
        processando={processando}
        aoConfirmar={() => alvoInativar && alterarAtivo(alvoInativar, false)}
        aoCancelar={() => setAlvoInativar(null)}
      />
    </>
  );
}

function FormProduto({
  produto,
  categorias,
  aoSalvar,
  aoCancelar,
}: {
  produto: Produto | null;
  categorias: Categoria[];
  aoSalvar: (mensagem: string) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(produto?.nome ?? '');
  const [preco, setPreco] = useState(produto ? produto.preco.toFixed(2).replace('.', ',') : '');
  const [categoriaId, setCategoriaId] = useState(produto ? String(produto.categoriaId) : '');
  const [descricao, setDescricao] = useState(produto?.descricao ?? '');
  const [codigoBarras, setCodigoBarras] = useState(produto?.codigoBarras ?? '');
  const [imagemUrl, setImagemUrl] = useState(produto?.imagemUrl ?? '');
  const [disponivelPresencial, setDisponivelPresencial] = useState(produto?.disponivelPresencial ?? true);
  const [disponivelOnline, setDisponivelOnline] = useState(produto?.disponivelOnline ?? true);
  const [quantidadeInicial, setQuantidadeInicial] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Só categorias ativas recebem produtos; a categoria atual do produto continua listada mesmo se foi inativada.
  const opcoes = categorias.filter((c) => c.ativa || c.id === produto?.categoriaId);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErroGeral(null);

    const novos: Record<string, string> = {};
    if (nome.trim() === '' || nome.trim().length > 140) novos.nome = 'Informe o nome do produto (até 140 caracteres).';
    const valorPreco = lerPreco(preco);
    if (valorPreco === null) novos.preco = 'Informe um preço maior que zero, com até 2 casas decimais (ex.: 12,50).';
    if (categoriaId === '') novos.categoriaId = 'Selecione a categoria.';
    if (descricao.trim().length > 5000) novos.descricao = 'A descrição aceita no máximo 5000 caracteres.';
    if (codigoBarras.trim().length > 80) novos.codigoBarras = 'O código de barras aceita no máximo 80 caracteres.';
    if (imagemUrl.trim().length > 500) novos.imagemUrl = 'A URL da imagem aceita no máximo 500 caracteres.';

    let quantidade: number | undefined;
    if (!produto && quantidadeInicial.trim() !== '') {
      if (!/^\d+$/.test(quantidadeInicial.trim()) || Number(quantidadeInicial) > 2147483647) {
        novos.quantidadeInicial = 'Informe um número inteiro de 0 em diante.';
      } else {
        quantidade = Number(quantidadeInicial);
      }
    }

    setErros(novos);
    if (Object.keys(novos).length > 0 || valorPreco === null) return;

    const dados = {
      nome: nome.trim(),
      preco: valorPreco,
      categoriaId: Number(categoriaId),
      descricao: descricao.trim(),
      codigoBarras: codigoBarras.trim(),
      imagemUrl: imagemUrl.trim(),
      disponivelPresencial,
      disponivelOnline,
    };

    setSalvando(true);
    try {
      if (produto) {
        await produtoService.atualizar(produto.id, dados);
        aoSalvar('Produto atualizado.');
      } else {
        await produtoService.criar({ ...dados, ...(quantidade !== undefined ? { quantidadeInicial: quantidade } : {}) });
        aoSalvar('Produto cadastrado.');
      }
    } catch (err) {
      const erro = lerErro(err);
      // Ex.: 409 com campo "codigoBarras" (código já usado por outro produto).
      if (erro.campo && CAMPOS_DO_FORM.includes(erro.campo)) setErros({ [erro.campo]: erro.mensagem });
      else setErroGeral(erro.mensagem);
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      {erroGeral && <Alerta>{erroGeral}</Alerta>}

      <Campo rotulo="Nome" id="produto-nome" erro={erros.nome} obrigatorio>
        <Entrada id="produto-nome" value={nome} onChange={(e) => setNome(e.target.value)} erro={erros.nome} maxLength={140} autoFocus />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Preço (R$)" id="produto-preco" erro={erros.preco} obrigatorio>
          <Entrada
            id="produto-preco"
            inputMode="decimal"
            placeholder="12,50"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            erro={erros.preco}
          />
        </Campo>

        <Campo
          rotulo="Categoria"
          id="produto-categoria"
          erro={erros.categoriaId}
          obrigatorio
          dica={opcoes.length === 0 ? 'Cadastre uma categoria antes de criar produtos.' : undefined}
        >
          <Selecao id="produto-categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} erro={erros.categoriaId}>
            <option value="">Selecione…</option>
            {opcoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.ativa ? '' : ' (inativa)'}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>

      <Campo rotulo="Descrição" id="produto-descricao" erro={erros.descricao}>
        <AreaTexto id="produto-descricao" rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} erro={erros.descricao} />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Código de barras" id="produto-codigo" erro={erros.codigoBarras} dica="Opcional. Não pode repetir em outro produto.">
          <Entrada
            id="produto-codigo"
            value={codigoBarras}
            onChange={(e) => setCodigoBarras(e.target.value)}
            erro={erros.codigoBarras}
            maxLength={80}
            inputMode="numeric"
          />
        </Campo>

        <Campo rotulo="URL da imagem" id="produto-imagem" erro={erros.imagemUrl} dica="Opcional.">
          <Entrada
            id="produto-imagem"
            type="url"
            placeholder="https://…"
            value={imagemUrl}
            onChange={(e) => setImagemUrl(e.target.value)}
            erro={erros.imagemUrl}
            maxLength={500}
          />
        </Campo>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Onde este produto é vendido</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Interruptor rotulo="Presencial (caixa)" marcado={disponivelPresencial} aoMudar={setDisponivelPresencial} />
          <Interruptor rotulo="Online (site)" marcado={disponivelOnline} aoMudar={setDisponivelOnline} />
        </div>
      </fieldset>

      {produto ? (
        <p className="rounded-md bg-carvao/5 px-3 py-2 text-sm text-carvao/75">
          Em estoque agora: <strong>{produto.quantidadeDisponivel}</strong>. O estoque muda por vendas e movimentações, não por esta tela.
        </p>
      ) : (
        <Campo
          rotulo="Quantidade inicial em estoque"
          id="produto-quantidade"
          erro={erros.quantidadeInicial}
          dica="Opcional. Se for maior que zero, registra uma entrada de estoque em seu nome."
        >
          <Entrada
            id="produto-quantidade"
            inputMode="numeric"
            placeholder="0"
            value={quantidadeInicial}
            onChange={(e) => setQuantidadeInicial(e.target.value)}
            erro={erros.quantidadeInicial}
            className="sm:max-w-40"
          />
        </Campo>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variante="secundario" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" carregando={salvando}>
          {produto ? 'Salvar alterações' : 'Cadastrar produto'}
        </Button>
      </div>
    </form>
  );
}
