import { useState } from 'react';
import { Alerta, Badge, Button, LinhaMensagem, Modal, PaginaCabecalho, Selecao, tabela } from '../components/ui';
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
import { pedidoService } from '../services/pedidoService';
import type { CanalPedido, StatusPedido } from '../types';

const STATUS = Object.keys(STATUS_PEDIDO_ROTULO) as StatusPedido[];
const CANAIS = Object.keys(CANAL_ROTULO) as CanalPedido[];
const POR_PAGINA = 20;

export function PedidosPage() {
  const [pagina, setPagina] = useState(1);
  const [status, setStatus] = useState<StatusPedido | ''>('');
  const [canal, setCanal] = useState<CanalPedido | ''>('');
  const [aberto, setAberto] = useState<number | null>(null);

  const { dados, carregando, erro, recarregar } = useCarregar(
    () => pedidoService.listar({ pagina, limite: POR_PAGINA, status, canal }),
    [pagina, status, canal],
  );
  const pedidos = dados?.dados ?? [];

  // Ao mudar um filtro, volta para a primeira página.
  function mudarStatus(valor: StatusPedido | '') {
    setStatus(valor);
    setPagina(1);
  }
  function mudarCanal(valor: CanalPedido | '') {
    setCanal(valor);
    setPagina(1);
  }

  return (
    <>
      <PaginaCabecalho titulo="Pedidos" descricao="Do mais recente para o mais antigo. Clique em um pedido para ver itens e pagamentos." />

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

        <div className="grid gap-3 sm:grid-cols-[14rem_11rem]">
          <Selecao aria-label="Filtrar por status" value={status} onChange={(e) => mudarStatus(e.target.value as StatusPedido | '')}>
            <option value="">Todos os status</option>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {STATUS_PEDIDO_ROTULO[s]}
              </option>
            ))}
          </Selecao>
          <Selecao aria-label="Filtrar por canal" value={canal} onChange={(e) => mudarCanal(e.target.value as CanalPedido | '')}>
            <option value="">Todos os canais</option>
            {CANAIS.map((c) => (
              <option key={c} value={c}>
                {CANAL_ROTULO[c]}
              </option>
            ))}
          </Selecao>
        </div>

        <div className={tabela.caixa}>
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
                <LinhaMensagem colunas={7}>Nenhum pedido encontrado com esses filtros.</LinhaMensagem>
              ) : (
                pedidos.map((p) => (
                  <tr key={p.id} className={tabela.linha}>
                    <td className={`${tabela.td} font-medium`}>#{p.id}</td>
                    <td className={tabela.td}>{dataHora(p.criadoEm)}</td>
                    <td className={tabela.td}>{CANAL_ROTULO[p.canal]}</td>
                    <td className={tabela.td}>
                      <Badge tom={STATUS_PEDIDO_TOM[p.status]}>{STATUS_PEDIDO_ROTULO[p.status]}</Badge>
                    </td>
                    <td className={`${tabela.td} text-right tabular-nums`}>{p.itens.reduce((soma, i) => soma + i.quantidade, 0)}</td>
                    <td className={`${tabela.td} text-right font-medium tabular-nums`}>{moeda(p.total)}</td>
                    <td className={`${tabela.td} text-right`}>
                      <Button variante="fantasma" tamanho="sm" onClick={() => setAberto(p.id)} aria-label={`Ver pedido ${p.id}`}>
                        Ver
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {dados && dados.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-carvao/70">
              Página {dados.pagina} de {dados.totalPaginas} ({dados.total} {dados.total === 1 ? 'pedido' : 'pedidos'})
            </p>
            <div className="flex gap-2">
              <Button variante="secundario" tamanho="sm" disabled={pagina <= 1 || carregando} onClick={() => setPagina((n) => n - 1)}>
                Anterior
              </Button>
              <Button
                variante="secundario"
                tamanho="sm"
                disabled={pagina >= dados.totalPaginas || carregando}
                onClick={() => setPagina((n) => n + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal aberto={aberto !== null} titulo={aberto ? `Pedido #${aberto}` : 'Pedido'} aoFechar={() => setAberto(null)} largura="max-w-3xl">
        {aberto !== null && <DetalhePedido id={aberto} />}
      </Modal>
    </>
  );
}

function DetalhePedido({ id }: { id: number }) {
  const { dados: pedido, carregando, erro, recarregar } = useCarregar(() => pedidoService.buscar(id), [id]);

  if (erro) {
    return (
      <Alerta
        acao={
          <Button variante="secundario" tamanho="sm" onClick={recarregar}>
            Tentar de novo
          </Button>
        }
      >
        {erro}
      </Alerta>
    );
  }
  if (carregando || !pedido) return <p className="py-6 text-center text-carvao/65">Carregando…</p>;

  const pagamentos = pedido.pagamentos ?? [];

  return (
    <div className="space-y-6">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-carvao/65">Status</dt>
          <dd className="mt-0.5">
            <Badge tom={STATUS_PEDIDO_TOM[pedido.status]}>{STATUS_PEDIDO_ROTULO[pedido.status]}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-carvao/65">Canal</dt>
          <dd className="mt-0.5 font-medium">{CANAL_ROTULO[pedido.canal]}</dd>
        </div>
        <div>
          <dt className="text-carvao/65">Criado em</dt>
          <dd className="mt-0.5 font-medium">{dataHora(pedido.criadoEm)}</dd>
        </div>
        <div>
          <dt className="text-carvao/65">Registrado por</dt>
          <dd className="mt-0.5 font-medium">Usuário #{pedido.usuarioId}</dd>
        </div>
        {pedido.clienteId !== null && (
          <div>
            <dt className="text-carvao/65">Cliente</dt>
            <dd className="mt-0.5 font-medium">#{pedido.clienteId}</dd>
          </div>
        )}
      </dl>

      <section>
        <h3 className="mb-2 text-lg font-semibold">Itens</h3>
        <div className={tabela.caixa}>
          <table className={tabela.base}>
            <thead className={tabela.cabecalho}>
              <tr>
                <th className={tabela.th}>Produto</th>
                <th className={`${tabela.th} text-right`}>Qtd.</th>
                <th className={`${tabela.th} text-right`}>Preço</th>
                <th className={`${tabela.th} text-right`}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {pedido.itens.map((item) => (
                <tr key={item.id} className={tabela.linha}>
                  <td className={`${tabela.td} font-medium`}>{item.nome}</td>
                  <td className={`${tabela.td} text-right tabular-nums`}>{item.quantidade}</td>
                  <td className={`${tabela.td} text-right tabular-nums`}>{moeda(item.precoUnitario)}</td>
                  <td className={`${tabela.td} text-right tabular-nums`}>{moeda(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-carvao/10">
                <td colSpan={3} className={`${tabela.td} text-right font-semibold`}>
                  Total
                </td>
                <td className={`${tabela.td} text-right font-semibold tabular-nums`}>{moeda(pedido.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-lg font-semibold">Pagamentos</h3>
        {pagamentos.length === 0 ? (
          <p className="text-sm text-carvao/65">Nenhum pagamento registrado para este pedido.</p>
        ) : (
          <div className={tabela.caixa}>
            <table className={tabela.base}>
              <thead className={tabela.cabecalho}>
                <tr>
                  <th className={tabela.th}>Forma</th>
                  <th className={tabela.th}>Status</th>
                  <th className={`${tabela.th} text-right`}>Valor</th>
                  <th className={tabela.th}>Data</th>
                </tr>
              </thead>
              <tbody>
                {pagamentos.map((pg) => (
                  <tr key={pg.id} className={tabela.linha}>
                    <td className={tabela.td}>{FORMA_PAGAMENTO_ROTULO[pg.formaPagamento]}</td>
                    <td className={tabela.td}>
                      <Badge tom={STATUS_PAGAMENTO_TOM[pg.statusPagamento]}>{STATUS_PAGAMENTO_ROTULO[pg.statusPagamento]}</Badge>
                    </td>
                    <td className={`${tabela.td} text-right tabular-nums`}>{moeda(pg.valor)}</td>
                    <td className={tabela.td}>{dataHora(pg.criadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
