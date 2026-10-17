import { useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alerta, Badge, Button, Campo, Confirmacao, Entrada, Interruptor, LinhaMensagem, Modal, PaginaCabecalho, Selecao, tabela } from '../components/ui';
import { lerErro } from '../lib/api';
import { dataHora, deltaMovimentacao, TIPO_MOV_ROTULO, TIPO_MOV_TOM, type Tom } from '../lib/format';
import { useCarregar } from '../lib/useCarregar';
import { estoqueService } from '../services/estoqueService';
import type { Estoque, Movimentacao, TipoMovimentacao } from '../types';

type Aba = 'saldos' | 'movimentacoes';

const TIPOS = Object.keys(TIPO_MOV_ROTULO) as TipoMovimentacao[];
const POR_VEZ = 50;

const DICA_TIPO: Record<TipoMovimentacao, string> = {
  ENTRADA: 'Soma ao estoque (compra, reposição).',
  SAIDA: 'Tira do estoque (uso interno, doação).',
  PERDA: 'Tira do estoque (vencido, quebrado).',
  AJUSTE: 'Soma o valor informado. Use número negativo para diminuir (ex.: -3).',
};

// O que o cliente pode comprar agora: físico menos o reservado (nunca negativo).
const disponivelDe = (e: Estoque) => Math.max(0, e.quantidadeFisica - e.quantidadeReservada);

function situacaoDe(e: Estoque): { texto: string; tom: Tom } {
  const disponivel = disponivelDe(e);
  if (disponivel === 0) return { texto: 'Sem estoque', tom: 'vermelho' };
  if (e.estoqueMinimo > 0 && disponivel <= e.estoqueMinimo) return { texto: 'Estoque baixo', tom: 'amarelo' };
  return { texto: 'Em dia', tom: 'verde' };
}

const sinal = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

export function EstoquePage() {
  const { usuario } = useAuth();

  const [aba, setAba] = useState<Aba>('saldos');
  const [busca, setBusca] = useState('');
  const [soBaixo, setSoBaixo] = useState(false);
  const [produtoFiltro, setProdutoFiltro] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState<TipoMovimentacao | ''>('');
  const [limite, setLimite] = useState(POR_VEZ);

  const saldos = useCarregar(() => estoqueService.listar(), []);
  const movs = useCarregar(
    () => estoqueService.listarMovimentacoes(produtoFiltro === '' ? undefined : Number(produtoFiltro)),
    [produtoFiltro],
  );

  const [movimentando, setMovimentando] = useState<{ produtoId: number | null } | null>(null);
  const [editandoMinimo, setEditandoMinimo] = useState<Estoque | null>(null);
  const [removendo, setRemovendo] = useState<Movimentacao | null>(null);
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const listaSaldos = saldos.dados ?? [];

  const saldosVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (saldos.dados ?? []).filter((e) => {
      if (termo && !e.produto.nome.toLowerCase().includes(termo) && !(e.produto.codigoBarras ?? '').toLowerCase().includes(termo)) return false;
      if (soBaixo && situacaoDe(e).tom === 'verde') return false;
      return true;
    });
  }, [saldos.dados, busca, soBaixo]);

  const semEstoque = listaSaldos.filter((e) => disponivelDe(e) === 0).length;
  const estoqueBaixo = listaSaldos.filter((e) => situacaoDe(e).texto === 'Estoque baixo').length;

  const movsFiltradas = (movs.dados ?? []).filter((m) => tipoFiltro === '' || m.tipo === tipoFiltro);
  const movsVisiveis = movsFiltradas.slice(0, limite);

  function aoSalvar(texto: string) {
    setMovimentando(null);
    setEditandoMinimo(null);
    setErroAcao(null);
    setMensagem(texto);
    saldos.recarregar();
    movs.recarregar();
  }

  function verHistorico(produtoId: number) {
    setProdutoFiltro(String(produtoId));
    setTipoFiltro('');
    setLimite(POR_VEZ);
    setAba('movimentacoes');
  }

  async function remover() {
    if (!removendo) return;
    setProcessando(true);
    setMensagem(null);
    setErroAcao(null);
    try {
      await estoqueService.removerMovimentacao(removendo.id);
      setMensagem('Movimentação removida e saldo corrigido.');
      saldos.recarregar();
      movs.recarregar();
    } catch (e) {
      setErroAcao(lerErro(e).mensagem);
    } finally {
      setProcessando(false);
      setRemovendo(null);
    }
  }

  const botaoAba = (id: Aba, rotulo: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={aba === id}
      onClick={() => setAba(id)}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600 ${
        aba === id ? 'border-brasa-600 text-brasa-700' : 'border-transparent text-carvao/70 hover:text-carvao'
      }`}
    >
      {rotulo}
    </button>
  );

  return (
    <>
      <PaginaCabecalho
        titulo="Estoque"
        descricao="Saldo de cada produto e o histórico de entradas, saídas, perdas e ajustes. O saldo só muda por movimentação (ou por venda)."
        acao={<Button onClick={() => setMovimentando({ produtoId: null })}>Registrar movimentação</Button>}
      />

      <div className="space-y-4">
        {mensagem && <Alerta tipo="sucesso">{mensagem}</Alerta>}
        {erroAcao && <Alerta>{erroAcao}</Alerta>}

        <div role="tablist" aria-label="Estoque" className="flex gap-1 border-b border-carvao/15">
          {botaoAba('saldos', 'Saldos')}
          {botaoAba('movimentacoes', 'Movimentações')}
        </div>

        {aba === 'saldos' ? (
          <div className="space-y-4">
            {saldos.erro && (
              <Alerta
                acao={
                  <Button variante="secundario" tamanho="sm" onClick={saldos.recarregar}>
                    Tentar de novo
                  </Button>
                }
              >
                {saldos.erro}
              </Alerta>
            )}

            {saldos.dados && (
              <p className="text-sm text-carvao/75">
                {listaSaldos.length} {listaSaldos.length === 1 ? 'produto' : 'produtos'} · {semEstoque} sem estoque · {estoqueBaixo} com estoque baixo
              </p>
            )}

            <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto]">
              <Entrada
                aria-label="Buscar por nome ou código de barras"
                placeholder="Buscar por nome ou código de barras"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              <Interruptor rotulo="Só estoque baixo ou zerado" marcado={soBaixo} aoMudar={setSoBaixo} />
            </div>

            <div className={tabela.caixa}>
              <table className={tabela.base}>
                <thead className={tabela.cabecalho}>
                  <tr>
                    <th className={tabela.th}>Produto</th>
                    <th className={`${tabela.th} text-right`}>Físico</th>
                    <th className={`${tabela.th} text-right`}>Reservado</th>
                    <th className={`${tabela.th} text-right`}>Disponível</th>
                    <th className={`${tabela.th} text-right`}>Mínimo</th>
                    <th className={tabela.th}>Situação</th>
                    <th className={`${tabela.th} text-right`}>Ações</th>
                  </tr>
                </thead>
                <tbody className={saldos.carregando && saldos.dados ? 'opacity-60' : ''}>
                  {!saldos.dados && saldos.carregando ? (
                    <LinhaMensagem colunas={7}>Carregando…</LinhaMensagem>
                  ) : saldosVisiveis.length === 0 ? (
                    <LinhaMensagem colunas={7}>Nenhum produto encontrado com esses filtros.</LinhaMensagem>
                  ) : (
                    saldosVisiveis.map((e) => {
                      const situacao = situacaoDe(e);
                      return (
                        <tr key={e.id} className={tabela.linha}>
                          <td className={tabela.td}>
                            <p className="font-medium">{e.produto.nome}</p>
                            {e.produto.codigoBarras && <p className="text-xs text-carvao/60">Código {e.produto.codigoBarras}</p>}
                          </td>
                          <td className={`${tabela.td} text-right tabular-nums`}>{e.quantidadeFisica}</td>
                          <td className={`${tabela.td} text-right tabular-nums`}>{e.quantidadeReservada}</td>
                          <td className={`${tabela.td} text-right font-medium tabular-nums`}>{disponivelDe(e)}</td>
                          <td className={`${tabela.td} text-right tabular-nums`}>{e.estoqueMinimo}</td>
                          <td className={tabela.td}>
                            <Badge tom={situacao.tom}>{situacao.texto}</Badge>
                          </td>
                          <td className={`${tabela.td} text-right`}>
                            <div className="flex justify-end gap-1">
                              <Button variante="fantasma" tamanho="sm" onClick={() => setMovimentando({ produtoId: e.produtoId })}>
                                Movimentar
                              </Button>
                              <Button variante="fantasma" tamanho="sm" onClick={() => setEditandoMinimo(e)}>
                                Mínimo
                              </Button>
                              <Button variante="fantasma" tamanho="sm" onClick={() => verHistorico(e.produtoId)}>
                                Histórico
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {movs.erro && (
              <Alerta
                acao={
                  <Button variante="secundario" tamanho="sm" onClick={movs.recarregar}>
                    Tentar de novo
                  </Button>
                }
              >
                {movs.erro}
              </Alerta>
            )}

            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <Selecao
                aria-label="Filtrar por produto"
                value={produtoFiltro}
                onChange={(e) => {
                  setProdutoFiltro(e.target.value);
                  setLimite(POR_VEZ);
                }}
              >
                <option value="">Todos os produtos</option>
                {listaSaldos.map((e) => (
                  <option key={e.produtoId} value={e.produtoId}>
                    {e.produto.nome}
                  </option>
                ))}
              </Selecao>
              <Selecao
                aria-label="Filtrar por tipo"
                value={tipoFiltro}
                onChange={(e) => {
                  setTipoFiltro(e.target.value as TipoMovimentacao | '');
                  setLimite(POR_VEZ);
                }}
              >
                <option value="">Todos os tipos</option>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_MOV_ROTULO[t]}
                  </option>
                ))}
              </Selecao>
            </div>

            <div className={tabela.caixa}>
              <table className={tabela.base}>
                <thead className={tabela.cabecalho}>
                  <tr>
                    <th className={tabela.th}>Data</th>
                    <th className={tabela.th}>Produto</th>
                    <th className={tabela.th}>Tipo</th>
                    <th className={`${tabela.th} text-right`}>Quantidade</th>
                    <th className={tabela.th}>Motivo</th>
                    <th className={tabela.th}>Registrado por</th>
                    <th className={`${tabela.th} text-right`}>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={movs.carregando && movs.dados ? 'opacity-60' : ''}>
                  {!movs.dados && movs.carregando ? (
                    <LinhaMensagem colunas={7}>Carregando…</LinhaMensagem>
                  ) : movsVisiveis.length === 0 ? (
                    <LinhaMensagem colunas={7}>Nenhuma movimentação encontrada com esses filtros.</LinhaMensagem>
                  ) : (
                    movsVisiveis.map((m) => {
                      const delta = deltaMovimentacao(m.tipo, m.quantidade);
                      return (
                        <tr key={m.id} className={tabela.linha}>
                          <td className={`${tabela.td} whitespace-nowrap`}>{dataHora(m.criadoEm)}</td>
                          <td className={`${tabela.td} font-medium`}>{m.produto.nome}</td>
                          <td className={tabela.td}>
                            <Badge tom={TIPO_MOV_TOM[m.tipo]}>{TIPO_MOV_ROTULO[m.tipo]}</Badge>
                          </td>
                          <td className={`${tabela.td} text-right font-medium tabular-nums ${delta > 0 ? 'text-oliva-700' : 'text-red-700'}`}>{sinal(delta)}</td>
                          <td className={tabela.td}>{m.motivo ?? <span className="text-carvao/50">—</span>}</td>
                          <td className={tabela.td}>{m.usuario.nome}</td>
                          <td className={`${tabela.td} text-right`}>
                            <Button variante="fantasma" tamanho="sm" onClick={() => setRemovendo(m)}>
                              Remover
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {movsFiltradas.length > movsVisiveis.length && (
              <div className="flex justify-center">
                <Button variante="secundario" onClick={() => setLimite((n) => n + POR_VEZ)}>
                  Mostrar mais ({movsFiltradas.length - movsVisiveis.length} restantes)
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal aberto={movimentando !== null} titulo="Registrar movimentação" aoFechar={() => setMovimentando(null)}>
        {movimentando !== null && usuario && (
          <FormMovimentacao
            estoques={listaSaldos}
            produtoInicial={movimentando.produtoId}
            usuarioId={usuario.id}
            aoSalvar={aoSalvar}
            aoCancelar={() => setMovimentando(null)}
          />
        )}
      </Modal>

      <Modal aberto={editandoMinimo !== null} titulo="Estoque mínimo" aoFechar={() => setEditandoMinimo(null)} largura="max-w-md">
        {editandoMinimo !== null && <FormMinimo estoque={editandoMinimo} aoSalvar={aoSalvar} aoCancelar={() => setEditandoMinimo(null)} />}
      </Modal>

      <Confirmacao
        aberto={removendo !== null}
        titulo="Remover movimentação"
        mensagem={
          removendo
            ? `Remover ${TIPO_MOV_ROTULO[removendo.tipo].toLowerCase()} de ${removendo.quantidade} em "${removendo.produto.nome}"? O saldo volta ao que era antes dela. Use só para lançamentos feitos por engano.${
                removendo.motivo?.startsWith('Venda') ? ' Esta movimentação veio de uma venda: o pedido continua registrado, mas as unidades voltam ao estoque.' : ''
              }`
            : ''
        }
        rotulo="Remover"
        processando={processando}
        aoConfirmar={remover}
        aoCancelar={() => setRemovendo(null)}
      />
    </>
  );
}

function FormMovimentacao({
  estoques,
  produtoInicial,
  usuarioId,
  aoSalvar,
  aoCancelar,
}: {
  estoques: Estoque[];
  produtoInicial: number | null;
  usuarioId: number;
  aoSalvar: (mensagem: string) => void;
  aoCancelar: () => void;
}) {
  const [produtoId, setProdutoId] = useState(produtoInicial === null ? '' : String(produtoInicial));
  const [tipo, setTipo] = useState<TipoMovimentacao>('ENTRADA');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const estoque = estoques.find((e) => String(e.produtoId) === produtoId);
  const valor = /^-?\d+$/.test(quantidade.trim()) ? Number(quantidade.trim()) : null;
  const valorValido = valor !== null && (tipo === 'AJUSTE' ? valor !== 0 : valor > 0);
  const novoSaldo = estoque && valor !== null && valorValido ? estoque.quantidadeFisica + deltaMovimentacao(tipo, valor) : null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErroGeral(null);

    const novos: Record<string, string> = {};
    if (!estoque) novos.produto = 'Selecione o produto.';
    if (valor === null) novos.quantidade = 'Informe um número inteiro.';
    else if (tipo === 'AJUSTE' && valor === 0) novos.quantidade = 'A quantidade do ajuste não pode ser zero.';
    else if (tipo !== 'AJUSTE' && valor <= 0) novos.quantidade = 'A quantidade deve ser maior que zero.';
    else if (estoque && novoSaldo !== null && novoSaldo < 0) {
      novos.quantidade = `O estoque não pode ficar negativo (saldo físico atual: ${estoque.quantidadeFisica}).`;
    }
    setErros(novos);
    if (Object.keys(novos).length > 0 || !estoque || valor === null) return;

    setSalvando(true);
    try {
      await estoqueService.registrarMovimentacao({
        produtoId: estoque.produtoId,
        usuarioId,
        tipo,
        quantidade: valor,
        ...(motivo.trim() !== '' ? { motivo: motivo.trim() } : {}),
      });
      aoSalvar('Movimentação registrada.');
    } catch (err) {
      setErroGeral(lerErro(err).mensagem);
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      {erroGeral && <Alerta>{erroGeral}</Alerta>}

      <Campo rotulo="Produto" id="mov-produto" erro={erros.produto} obrigatorio>
        <Selecao id="mov-produto" value={produtoId} onChange={(e) => setProdutoId(e.target.value)} erro={erros.produto} autoFocus={produtoInicial === null}>
          <option value="">Selecione…</option>
          {estoques.map((e) => (
            <option key={e.produtoId} value={e.produtoId}>
              {e.produto.nome}
            </option>
          ))}
        </Selecao>
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo" id="mov-tipo" dica={DICA_TIPO[tipo]} obrigatorio>
          <Selecao id="mov-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimentacao)}>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {TIPO_MOV_ROTULO[t]}
              </option>
            ))}
          </Selecao>
        </Campo>

        <Campo rotulo="Quantidade" id="mov-quantidade" erro={erros.quantidade} obrigatorio>
          <Entrada
            id="mov-quantidade"
            inputMode="numeric"
            placeholder={tipo === 'AJUSTE' ? 'Ex.: 5 ou -3' : 'Ex.: 10'}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            erro={erros.quantidade}
            autoFocus={produtoInicial !== null}
          />
        </Campo>
      </div>

      {estoque && (
        <p className="rounded-md bg-carvao/5 px-3 py-2 text-sm">
          Saldo físico: <strong>{estoque.quantidadeFisica}</strong>
          {novoSaldo !== null && (
            <>
              {' '}
              → <strong className={novoSaldo < 0 ? 'text-red-700' : ''}>{novoSaldo}</strong>
            </>
          )}
        </p>
      )}

      <Campo rotulo="Motivo" id="mov-motivo" dica="Opcional. Ajuda a entender o lançamento depois.">
        <Entrada id="mov-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
      </Campo>

      <div className="flex justify-end gap-2 pt-2">
        <Button variante="secundario" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" carregando={salvando}>
          Registrar
        </Button>
      </div>
    </form>
  );
}

function FormMinimo({ estoque, aoSalvar, aoCancelar }: { estoque: Estoque; aoSalvar: (mensagem: string) => void; aoCancelar: () => void }) {
  const [valor, setValor] = useState(String(estoque.estoqueMinimo));
  const [erro, setErro] = useState<string | undefined>();
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    if (!/^\d+$/.test(valor.trim())) {
      setErro('Informe um número inteiro de 0 em diante.');
      return;
    }
    setErro(undefined);
    setSalvando(true);
    try {
      await estoqueService.atualizarMinimo(estoque.produtoId, Number(valor.trim()));
      aoSalvar('Estoque mínimo atualizado.');
    } catch (err) {
      setErroGeral(lerErro(err).mensagem);
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <p className="text-sm">
        <strong>{estoque.produto.nome}</strong>
      </p>
      {erroGeral && <Alerta>{erroGeral}</Alerta>}
      <Campo
        rotulo="Estoque mínimo"
        id="minimo-valor"
        erro={erro}
        dica="Quando o disponível chegar a esse número, o produto aparece como estoque baixo. Use 0 para não alertar."
        obrigatorio
      >
        <Entrada id="minimo-valor" inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)} erro={erro} autoFocus />
      </Campo>
      <div className="flex justify-end gap-2 pt-2">
        <Button variante="secundario" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" carregando={salvando}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
