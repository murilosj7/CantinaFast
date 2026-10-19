import { useState } from 'react';
import { DetalhePedido } from '../components/DetalhePedido';
import { Abas, Alerta, Badge, Button, CartaoLista, LinhaMensagem, MensagemVazia, Modal, PaginaCabecalho, Segmentado, tabela } from '../components/ui';
import {
  CANAL_ROTULO,
  dataHora,
  FORMA_PAGAMENTO_ROTULO,
  moeda,
  STATUS_PAGAMENTO_ROTULO,
  STATUS_PAGAMENTO_TOM,
  STATUS_PEDIDO_ROTULO,
  STATUS_PEDIDO_TOM,
} from '../lib/format';
import { useCarregar } from '../lib/useCarregar';
import { pagamentoService, STATUS_PAGAVEIS } from '../services/pagamentoService';
import { pedidoService } from '../services/pedidoService';
import type { FormaPagamento, Pedido, StatusPedido } from '../types';

type Aba = 'receber' | 'recebidos';

// Estados de pedido que já passaram pelo pagamento (o backend só registra pagamento nos pagáveis).
const STATUS_COM_PAGAMENTO: StatusPedido[] = [
  'PAGO',
  'RECEBIDO_PELA_CANTINA',
  'EM_SEPARACAO',
  'PRONTO_PARA_RETIRADA',
  'ENTREGUE',
  'RETIRADO',
  'ESTORNADO',
];

const FORMAS = Object.keys(FORMA_PAGAMENTO_ROTULO) as FormaPagamento[];
const POR_PAGINA = 20;

// O backend não tem "listar todos os pagamentos" nem filtro por vários status,
// então buscamos os pedidos de cada status (até 100 por status) e juntamos.
async function pedidosComStatus(statuses: StatusPedido[]) {
  const paginas = await Promise.all(statuses.map((status) => pedidoService.listar({ status, limite: 100 })));
  return paginas.flatMap((pagina) => pagina.dados).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.id - a.id);
}

const quantidadeItens = (pedido: Pedido) => pedido.itens.reduce((soma, item) => soma + item.quantidade, 0);
const somarCentavos = (valores: number[]) => valores.reduce((soma, v) => soma + Math.round(v * 100), 0) / 100;

export function PagamentosPage() {
  const [aba, setAba] = useState<Aba>('receber');
  const [aberto, setAberto] = useState<number | null>(null);
  // Muda quando um pagamento é registrado no modal: as listas são remontadas e recarregam.
  const [versao, setVersao] = useState(0);

  return (
    <>
      <PaginaCabecalho
        titulo="Pagamentos"
        descricao="Toque em um pedido para receber. O pagamento é registrado como aprovado, no valor exato do pedido."
      />

      <div className="space-y-4">
        <Abas
          rotulo="Pagamentos"
          abas={[
            { valor: 'receber', rotulo: 'A receber' },
            { valor: 'recebidos', rotulo: 'Recebidos' },
          ]}
          valor={aba}
          aoMudar={setAba}
        />

        {aba === 'receber' ? (
          <AReceber key={`receber-${versao}`} aoAbrir={setAberto} />
        ) : (
          <Recebidos key={`recebidos-${versao}`} aoAbrir={setAberto} />
        )}
      </div>

      <Modal aberto={aberto !== null} titulo={aberto ? `Pedido #${aberto}` : 'Pedido'} aoFechar={() => setAberto(null)} largura="max-w-3xl">
        {aberto !== null && <DetalhePedido id={aberto} aoAlterar={() => setVersao((v) => v + 1)} pagarDireto={aba === 'receber'} />}
      </Modal>
    </>
  );
}

function AReceber({ aoAbrir }: { aoAbrir: (id: number) => void }) {
  const { dados, carregando, erro, recarregar } = useCarregar(() => pedidosComStatus(STATUS_PAGAVEIS), []);
  const pedidos = dados ?? [];

  return (
    <div className="space-y-4">
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

      {dados && (
        <p className="text-sm text-carvao/75">
          {pedidos.length} {pedidos.length === 1 ? 'pedido aguardando' : 'pedidos aguardando'} pagamento · {moeda(somarCentavos(pedidos.map((p) => p.total)))} a receber
        </p>
      )}

      <div className={`lg:hidden ${carregando && dados ? 'opacity-60' : ''}`}>
        {!dados && carregando ? (
          <MensagemVazia>Carregando…</MensagemVazia>
        ) : pedidos.length === 0 ? (
          <MensagemVazia>Nenhum pedido aguardando pagamento.</MensagemVazia>
        ) : (
          <CartaoLista>
            {pedidos.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => aoAbrir(p.id)} aria-label={`Receber pedido ${p.id}`} className="flex w-full flex-col gap-2 rounded-card border border-carvao/10 bg-white p-4 text-left transition-colors hover:border-carvao/25 active:bg-carvao/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold">#{p.id}</span>
                    <Badge tom={STATUS_PEDIDO_TOM[p.status]}>{STATUS_PEDIDO_ROTULO[p.status]}</Badge>
                  </span>
                  <span className="text-sm text-carvao/70">
                    {dataHora(p.criadoEm)} · {CANAL_ROTULO[p.canal]} · {quantidadeItens(p)} {quantidadeItens(p) === 1 ? 'item' : 'itens'}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-2xl font-semibold tabular-nums">{moeda(p.total)}</span>
                    <span className="inline-flex min-h-11 items-center rounded-md bg-brasa-600 px-4 text-sm font-semibold text-white">Receber</span>
                  </span>
                </button>
              </li>
            ))}
          </CartaoLista>
        )}
      </div>

      <div className={`hidden lg:block ${tabela.caixa}`}>
        <table className={tabela.base}>
          <thead className={tabela.cabecalho}>
            <tr>
              <th className={tabela.th}>Pedido</th>
              <th className={tabela.th}>Data</th>
              <th className={tabela.th}>Canal</th>
              <th className={tabela.th}>Status</th>
              <th className={`${tabela.th} text-right`}>Itens</th>
              <th className={`${tabela.th} text-right`}>Total</th>
              <th className={`${tabela.th} text-right`}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className={carregando && dados ? 'opacity-60' : ''}>
            {!dados && carregando ? (
              <LinhaMensagem colunas={7}>Carregando…</LinhaMensagem>
            ) : pedidos.length === 0 ? (
              <LinhaMensagem colunas={7}>Nenhum pedido aguardando pagamento.</LinhaMensagem>
            ) : (
              pedidos.map((p) => (
                <tr key={p.id} className={tabela.linha}>
                  <td className={`${tabela.td} font-medium`}>#{p.id}</td>
                  <td className={`${tabela.td} whitespace-nowrap`}>{dataHora(p.criadoEm)}</td>
                  <td className={tabela.td}>{CANAL_ROTULO[p.canal]}</td>
                  <td className={tabela.td}>
                    <Badge tom={STATUS_PEDIDO_TOM[p.status]}>{STATUS_PEDIDO_ROTULO[p.status]}</Badge>
                  </td>
                  <td className={`${tabela.td} text-right tabular-nums`}>{quantidadeItens(p)}</td>
                  <td className={`${tabela.td} text-right font-medium tabular-nums`}>{moeda(p.total)}</td>
                  <td className={`${tabela.td} text-right`}>
                    <Button tamanho="sm" onClick={() => aoAbrir(p.id)} aria-label={`Receber pedido ${p.id}`}>
                      Receber
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-carvao/60">Mostra até 100 pedidos por situação (aberto, enviado ao caixa e aguardando pagamento).</p>
    </div>
  );
}

function Recebidos({ aoAbrir }: { aoAbrir: (id: number) => void }) {
  const [pagina, setPagina] = useState(1);
  const [forma, setForma] = useState<FormaPagamento | ''>('');

  const pedidosQ = useCarregar(() => pedidosComStatus(STATUS_COM_PAGAMENTO), []);
  const pedidos = pedidosQ.dados ?? [];
  const totalPaginas = Math.max(1, Math.ceil(pedidos.length / POR_PAGINA));
  const daPagina = pedidos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const porId = new Map(pedidos.map((p) => [p.id, p]));

  // Um GET /pagamentos/pedido/:id por pedido da página (o backend não lista todos de uma vez).
  const chave = daPagina.map((p) => p.id).join(',');
  const pagamentosQ = useCarregar(
    async () => (daPagina.length === 0 ? [] : (await Promise.all(daPagina.map((p) => pagamentoService.listarDoPedido(p.id)))).flat()),
    [chave],
  );

  const linhas = (pagamentosQ.dados ?? [])
    .filter((pg) => forma === '' || pg.formaPagamento === forma)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.id - a.id);
  const aprovados = linhas.filter((pg) => pg.statusPagamento === 'APROVADO');
  const carregando = pedidosQ.carregando || pagamentosQ.carregando;
  const erro = pedidosQ.erro ?? pagamentosQ.erro;

  return (
    <div className="space-y-4">
      {erro && (
        <Alerta
          acao={
            <Button
              variante="secundario"
              tamanho="sm"
              onClick={() => {
                pedidosQ.recarregar();
                pagamentosQ.recarregar();
              }}
            >
              Tentar de novo
            </Button>
          }
        >
          {erro}
        </Alerta>
      )}

      <div className="grid items-center gap-3 md:grid-cols-[26rem_1fr]">
        <Segmentado
          rotulo="Filtrar por forma de pagamento"
          className="grid-cols-4"
          opcoes={[{ valor: '' as FormaPagamento | '', rotulo: 'Todas' }, ...FORMAS.map((f) => ({ valor: f as FormaPagamento | '', rotulo: FORMA_PAGAMENTO_ROTULO[f] }))]}
          valor={forma}
          aoMudar={setForma}
        />
        {!carregando && (
          <p className="text-sm text-carvao/75">
            {aprovados.length} {aprovados.length === 1 ? 'pagamento aprovado' : 'pagamentos aprovados'} nesta página · {moeda(somarCentavos(aprovados.map((pg) => pg.valor)))}
          </p>
        )}
      </div>

      <div className={`lg:hidden ${carregando && pagamentosQ.dados ? 'opacity-60' : ''}`}>
        {carregando && !pagamentosQ.dados ? (
          <MensagemVazia>Carregando…</MensagemVazia>
        ) : linhas.length === 0 ? (
          <MensagemVazia>Nenhum pagamento registrado com esses filtros.</MensagemVazia>
        ) : (
          <CartaoLista>
            {linhas.map((pg) => {
              const pedido = porId.get(pg.pedidoId);
              return (
                <li key={pg.id}>
                  <button type="button" onClick={() => aoAbrir(pg.pedidoId)} aria-label={`Ver pedido ${pg.pedidoId}`} className="flex w-full flex-col gap-2 rounded-card border border-carvao/10 bg-white p-4 text-left transition-colors hover:border-carvao/25 active:bg-carvao/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-lg font-semibold">Pedido #{pg.pedidoId}</span>
                      <Badge tom={STATUS_PAGAMENTO_TOM[pg.statusPagamento]}>{STATUS_PAGAMENTO_ROTULO[pg.statusPagamento]}</Badge>
                    </span>
                    <span className="flex items-end justify-between gap-2">
                      <span className="text-sm text-carvao/70">
                        {FORMA_PAGAMENTO_ROTULO[pg.formaPagamento]} · {dataHora(pg.criadoEm)}
                        {pedido && <> · {STATUS_PEDIDO_ROTULO[pedido.status]}</>}
                      </span>
                      <span className="text-lg font-semibold tabular-nums">{moeda(pg.valor)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </CartaoLista>
        )}
      </div>

      <div className={`hidden lg:block ${tabela.caixa}`}>
        <table className={tabela.base}>
          <thead className={tabela.cabecalho}>
            <tr>
              <th className={tabela.th}>Registrado em</th>
              <th className={tabela.th}>Pedido</th>
              <th className={tabela.th}>Forma</th>
              <th className={tabela.th}>Pagamento</th>
              <th className={`${tabela.th} text-right`}>Valor</th>
              <th className={tabela.th}>Status do pedido</th>
              <th className={`${tabela.th} text-right`}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className={carregando && pagamentosQ.dados ? 'opacity-60' : ''}>
            {carregando && !pagamentosQ.dados ? (
              <LinhaMensagem colunas={7}>Carregando…</LinhaMensagem>
            ) : linhas.length === 0 ? (
              <LinhaMensagem colunas={7}>Nenhum pagamento registrado com esses filtros.</LinhaMensagem>
            ) : (
              linhas.map((pg) => {
                const pedido = porId.get(pg.pedidoId);
                return (
                  <tr key={pg.id} className={tabela.linha}>
                    <td className={`${tabela.td} whitespace-nowrap`}>{dataHora(pg.criadoEm)}</td>
                    <td className={`${tabela.td} font-medium`}>#{pg.pedidoId}</td>
                    <td className={tabela.td}>{FORMA_PAGAMENTO_ROTULO[pg.formaPagamento]}</td>
                    <td className={tabela.td}>
                      <Badge tom={STATUS_PAGAMENTO_TOM[pg.statusPagamento]}>{STATUS_PAGAMENTO_ROTULO[pg.statusPagamento]}</Badge>
                    </td>
                    <td className={`${tabela.td} text-right font-medium tabular-nums`}>{moeda(pg.valor)}</td>
                    <td className={tabela.td}>
                      {pedido && <Badge tom={STATUS_PEDIDO_TOM[pedido.status]}>{STATUS_PEDIDO_ROTULO[pedido.status]}</Badge>}
                    </td>
                    <td className={`${tabela.td} text-right`}>
                      <Button variante="fantasma" tamanho="sm" onClick={() => aoAbrir(pg.pedidoId)} aria-label={`Ver pedido ${pg.pedidoId}`}>
                        Ver pedido
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pedidos.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-carvao/70">
            Página {pagina} de {totalPaginas} ({pedidos.length} {pedidos.length === 1 ? 'pedido pago' : 'pedidos pagos'})
          </p>
          <div className="flex gap-2">
            <Button variante="secundario" tamanho="sm" disabled={pagina <= 1 || carregando} onClick={() => setPagina((n) => n - 1)}>
              Anterior
            </Button>
            <Button variante="secundario" tamanho="sm" disabled={pagina >= totalPaginas || carregando} onClick={() => setPagina((n) => n + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-carvao/60">
        A página vai por pedido: cada pedido pago traz seus pagamentos. Mostra até 100 pedidos por situação.
      </p>
    </div>
  );
}
