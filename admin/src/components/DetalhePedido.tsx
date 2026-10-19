import { useState } from 'react';
import { Alerta, Badge, Button, Segmentado, tabela } from './ui';
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
import { lerErro } from '../lib/api';
import { useCarregar } from '../lib/useCarregar';
import { pagamentoService, STATUS_PAGAVEIS } from '../services/pagamentoService';
import { usePode } from '../auth/AuthContext';
import { pedidoService } from '../services/pedidoService';
import type { FormaPagamento, Pedido } from '../types';

// Detalhe de um pedido (itens, pagamentos) com o botão de registrar pagamento.
// Usado na tela de Pedidos e na tela de Pagamentos.
// `pagarDireto`: já abre o formulário de pagamento (a tela de Pagamentos usa, para o Caixa economizar um toque).
export function DetalhePedido({ id, aoAlterar, pagarDireto = false }: { id: number; aoAlterar: () => void; pagarDireto?: boolean }) {
  const { dados: pedido, erro, recarregar } = useCarregar(() => pedidoService.buscar(id), [id]);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const pode = usePode();
  const podeVerPagamentos = pode('pagamento.ver');
  const podeRegistrarPagamento = pode('pagamento.registrar');

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
  if (!pedido) return <p className="py-6 text-center text-carvao/65">Carregando…</p>;

  const pagamentos = pedido.pagamentos ?? [];

  return (
    <div className="space-y-6">
      {mensagem && <Alerta tipo="sucesso">{mensagem}</Alerta>}

      {podeRegistrarPagamento && STATUS_PAGAVEIS.includes(pedido.status) && (
        <RegistrarPagamento
          pedido={pedido}
          abertoAoIniciar={pagarDireto}
          aoRegistrar={() => {
            setMensagem(`Pagamento de ${moeda(pedido.total)} registrado. O pedido está pago.`);
            recarregar(); // atualiza o detalhe (status e lista de pagamentos)
            aoAlterar(); // atualiza a listagem atrás do modal
          }}
        />
      )}

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

      {podeVerPagamentos && (
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
      )}
    </div>
  );
}

// O backend aceita um único pagamento, do valor exato do pedido, e já o marca como aprovado.
function RegistrarPagamento({ pedido, aoRegistrar, abertoAoIniciar }: { pedido: Pedido; aoRegistrar: () => void; abertoAoIniciar: boolean }) {
  const [aberto, setAberto] = useState(abertoAoIniciar);
  const [forma, setForma] = useState<FormaPagamento>('PIX');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setSalvando(true);
    setErro(null);
    try {
      await pagamentoService.registrar({ pedidoId: pedido.id, formaPagamento: forma, valor: pedido.total });
      aoRegistrar();
    } catch (e) {
      // Ex.: 400 "Este pedido já está pago." se outra pessoa pagou antes.
      setErro(lerErro(e).mensagem);
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-brasa-200 bg-brasa-50 px-4 py-3">
        <p className="text-sm">
          Este pedido ainda não foi pago. Total a receber: <strong>{moeda(pedido.total)}</strong>.
        </p>
        <Button onClick={() => setAberto(true)}>Registrar pagamento</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-card border border-brasa-200 bg-brasa-50 p-4">
      <h3 className="text-lg font-semibold">Registrar pagamento</h3>
      {erro && <Alerta>{erro}</Alerta>}
      <div>
        <p className="mb-2 text-sm font-medium">Forma de pagamento</p>
        <Segmentado
          rotulo="Forma de pagamento"
          className="grid-cols-3"
          opcoes={(Object.keys(FORMA_PAGAMENTO_ROTULO) as FormaPagamento[]).map((f) => ({ valor: f, rotulo: FORMA_PAGAMENTO_ROTULO[f] }))}
          valor={forma}
          aoMudar={setForma}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3 rounded-md border border-carvao/15 bg-white px-4 py-3">
        <span className="text-sm">
          Valor <span className="text-carvao/65">(igual ao total; não há pagamento parcial)</span>
        </span>
        <span className="text-2xl font-semibold tabular-nums">{moeda(pedido.total)}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <Button variante="secundario" onClick={() => setAberto(false)} disabled={salvando} className="min-h-12">
          Cancelar
        </Button>
        <Button onClick={confirmar} carregando={salvando} className="min-h-12 text-base">
          Confirmar {moeda(pedido.total)} no {FORMA_PAGAMENTO_ROTULO[forma].toLowerCase()}
        </Button>
      </div>
    </div>
  );
}
