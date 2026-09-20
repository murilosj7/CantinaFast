import { useState, type FormEvent } from 'react';
import { Alerta, Badge, Button, Campo, Confirmacao, Entrada, LinhaMensagem, Modal, PaginaCabecalho, Selecao, tabela } from '../components/ui';
import { lerErro } from '../lib/api';
import { useCarregar } from '../lib/useCarregar';
import { useDebounce } from '../lib/useDebounce';
import { categoriaService } from '../services/categoriaService';
import type { Categoria } from '../types';

type Situacao = 'todas' | 'ativa' | 'inativa';

export function CategoriasPage() {
  const [busca, setBusca] = useState('');
  // A API só devolve as ativas quando não recebe status; o painel começa mostrando todas.
  const [status, setStatus] = useState<Situacao>('todas');
  const buscaAtrasada = useDebounce(busca);

  const { dados, carregando, erro, recarregar } = useCarregar(
    () => categoriaService.listar({ busca: buscaAtrasada, status }),
    [buscaAtrasada, status],
  );
  const categorias = dados ?? [];

  const [editando, setEditando] = useState<Categoria | 'nova' | null>(null);
  const [alvoInativar, setAlvoInativar] = useState<Categoria | null>(null);
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function alterarAtiva(alvo: Categoria, ativa: boolean) {
    setProcessando(true);
    setMensagem(null);
    setErroAcao(null);
    try {
      await categoriaService.atualizar(alvo.id, { ativa });
      setMensagem(ativa ? `A categoria "${alvo.nome}" foi reativada.` : `A categoria "${alvo.nome}" foi inativada.`);
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
        titulo="Categorias"
        descricao="Agrupam os produtos do cardápio. Uma categoria inativa deixa de aparecer no catálogo e não recebe novos produtos."
        acao={<Button onClick={() => setEditando('nova')}>Nova categoria</Button>}
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

        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Entrada aria-label="Buscar por nome" placeholder="Buscar por nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Selecao aria-label="Filtrar por situação" value={status} onChange={(e) => setStatus(e.target.value as Situacao)}>
            <option value="todas">Todas as situações</option>
            <option value="ativa">Ativas</option>
            <option value="inativa">Inativas</option>
          </Selecao>
        </div>

        <div className={tabela.caixa}>
          <table className={tabela.base}>
            <thead className={tabela.cabecalho}>
              <tr>
                <th className={tabela.th}>Nome</th>
                <th className={tabela.th}>Situação</th>
                <th className={`${tabela.th} text-right`}>Ações</th>
              </tr>
            </thead>
            <tbody className={carregando && dados ? 'opacity-60' : ''}>
              {!dados && carregando ? (
                <LinhaMensagem colunas={3}>Carregando…</LinhaMensagem>
              ) : categorias.length === 0 ? (
                <LinhaMensagem colunas={3}>Nenhuma categoria encontrada. Cadastre a primeira para começar a organizar os produtos.</LinhaMensagem>
              ) : (
                categorias.map((c) => (
                  <tr key={c.id} className={tabela.linha}>
                    <td className={`${tabela.td} font-medium`}>{c.nome}</td>
                    <td className={tabela.td}>
                      <Badge tom={c.ativa ? 'verde' : 'neutro'}>{c.ativa ? 'Ativa' : 'Inativa'}</Badge>
                    </td>
                    <td className={`${tabela.td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <Button variante="fantasma" tamanho="sm" onClick={() => setEditando(c)}>
                          Editar
                        </Button>
                        {c.ativa ? (
                          <Button variante="fantasma" tamanho="sm" onClick={() => setAlvoInativar(c)}>
                            Inativar
                          </Button>
                        ) : (
                          <Button variante="fantasma" tamanho="sm" disabled={processando} onClick={() => alterarAtiva(c, true)}>
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

      <Modal aberto={editando !== null} titulo={editando === 'nova' ? 'Nova categoria' : 'Editar categoria'} aoFechar={() => setEditando(null)} largura="max-w-md">
        {editando !== null && (
          <FormCategoria
            key={editando === 'nova' ? 'nova' : editando.id}
            categoria={editando === 'nova' ? null : editando}
            aoSalvar={aoSalvar}
            aoCancelar={() => setEditando(null)}
          />
        )}
      </Modal>

      <Confirmacao
        aberto={alvoInativar !== null}
        titulo="Inativar categoria"
        mensagem={
          alvoInativar
            ? `A categoria "${alvoInativar.nome}" deixa de aparecer no catálogo. Os produtos dela não são alterados e você pode reativá-la depois.`
            : ''
        }
        rotulo="Inativar"
        processando={processando}
        aoConfirmar={() => alvoInativar && alterarAtiva(alvoInativar, false)}
        aoCancelar={() => setAlvoInativar(null)}
      />
    </>
  );
}

function FormCategoria({
  categoria,
  aoSalvar,
  aoCancelar,
}: {
  categoria: Categoria | null;
  aoSalvar: (mensagem: string) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [erroNome, setErroNome] = useState<string | undefined>();
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    if (nome.trim() === '' || nome.trim().length > 80) {
      setErroNome('Informe o nome da categoria (até 80 caracteres).');
      return;
    }
    setErroNome(undefined);

    setSalvando(true);
    try {
      if (categoria) {
        await categoriaService.atualizar(categoria.id, { nome: nome.trim() });
        aoSalvar('Categoria atualizada.');
      } else {
        await categoriaService.criar(nome.trim());
        aoSalvar('Categoria cadastrada.');
      }
    } catch (err) {
      const erro = lerErro(err);
      if (erro.campo === 'nome') setErroNome(erro.mensagem);
      else setErroGeral(erro.mensagem);
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      {erroGeral && <Alerta>{erroGeral}</Alerta>}
      <Campo rotulo="Nome" id="categoria-nome" erro={erroNome} obrigatorio>
        <Entrada id="categoria-nome" value={nome} onChange={(e) => setNome(e.target.value)} erro={erroNome} maxLength={80} autoFocus />
      </Campo>
      <div className="flex justify-end gap-2 pt-2">
        <Button variante="secundario" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" carregando={salvando}>
          {categoria ? 'Salvar alterações' : 'Cadastrar categoria'}
        </Button>
      </div>
    </form>
  );
}
