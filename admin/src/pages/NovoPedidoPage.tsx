import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePode } from '../auth/AuthContext';
import { IconeBusca } from '../components/icones';
import { Alerta, Badge, Button, Entrada, MensagemVazia, PaginaCabecalho, Segmentado } from '../components/ui';
import { lerErro } from '../lib/api';
import { CANAL_ROTULO, moeda, STATUS_PEDIDO_ROTULO } from '../lib/format';
import { useCarregar } from '../lib/useCarregar';
import { categoriaService } from '../services/categoriaService';
import { pedidoService } from '../services/pedidoService';
import { produtoService } from '../services/produtoService';
import type { CanalPedido, Pedido, Produto } from '../types';

const CANAIS = Object.keys(CANAL_ROTULO) as CanalPedido[];

// O backend não confere o canal do produto, mas o painel só oferece o que é vendido no canal escolhido.
const vendidoNoCanal = (p: Produto, canal: CanalPedido) => (canal === 'PRESENCIAL' ? p.disponivelPresencial : p.disponivelOnline);

// Soma em centavos para não acumular erro de ponto flutuante.
const centavos = (valor: number) => Math.round(valor * 100);

export function NovoPedidoPage() {
  const navegar = useNavigate();
  const pode = usePode();

  const { dados, carregando, erro, recarregar } = useCarregar(() => produtoService.listar({ status: 'ativo' }), []);
  const { dados: categorias } = useCarregar(() => categoriaService.listar({ status: 'ativa' }), []);

  const [canal, setCanal] = useState<CanalPedido>('PRESENCIAL');
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  // produtoId -> quantidade no pedido
  const [carrinho, setCarrinho] = useState<Record<number, number>>({});
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [criado, setCriado] = useState<Pedido | null>(null);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (dados ?? []).filter(
      (p) =>
        vendidoNoCanal(p, canal) &&
        (categoriaId === '' || p.categoriaId === Number(categoriaId)) &&
        (termo === '' || p.nome.toLowerCase().includes(termo) || (p.codigoBarras ?? '').toLowerCase().includes(termo)),
    );
  }, [dados, canal, busca, categoriaId]);

  // As linhas do pedido saem da lista completa (não da filtrada), para não sumirem ao buscar outro produto.
  const linhas = (dados ?? [])
    .filter((p) => (carrinho[p.id] ?? 0) > 0)
    .map((p) => ({ produto: p, quantidade: carrinho[p.id] ?? 0 }));

  const totalCentavos = linhas.reduce((soma, l) => soma + centavos(l.produto.preco) * l.quantidade, 0);
  const temExcesso = linhas.some((l) => l.quantidade > l.produto.quantidadeDisponivel);

  function alterar(produto: Produto, delta: number) {
    setCriado(null);
    setErroEnvio(null);
    setAviso(null);
    setCarrinho((atual) => {
      const nova = Math.min(produto.quantidadeDisponivel, Math.max(0, (atual[produto.id] ?? 0) + delta));
      const copia = { ...atual };
      if (nova > 0) copia[produto.id] = nova;
      else delete copia[produto.id];
      return copia;
    });
  }

  function mudarCanal(novo: CanalPedido) {
    setCanal(novo);
    setCriado(null);
    setErroEnvio(null);
    const removidas = linhas.filter((l) => !vendidoNoCanal(l.produto, novo));
    if (removidas.length === 0) {
      setAviso(null);
      return;
    }
    setCarrinho((atual) => {
      const copia = { ...atual };
      removidas.forEach((l) => delete copia[l.produto.id]);
      return copia;
    });
    setAviso(`Saíram do pedido os itens que não são vendidos no canal ${CANAL_ROTULO[novo].toLowerCase()}: ${removidas.map((l) => l.produto.nome).join(', ')}.`);
  }

  async function registrar() {
    setEnviando(true);
    setErroEnvio(null);
    setAviso(null);
    try {
      const pedido = await pedidoService.criar({
        canal,
        itens: linhas.map((l) => ({ produtoId: l.produto.id, quantidade: l.quantidade })),
      });
      setCriado(pedido);
      setCarrinho({});
      recarregar(); // o estoque mudou
    } catch (e) {
      // Ex.: 400 "Estoque insuficiente..." quando outra venda levou as últimas unidades.
      setErroEnvio(lerErro(e).mensagem);
      recarregar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <PaginaCabecalho titulo="Novo pedido" descricao="Toque nos produtos para adicionar. O estoque é baixado ao registrar." />

      <div className="space-y-4">
        {criado && (
          <Alerta
            tipo="sucesso"
            acao={
              pode('pagamento.registrar') ? (
                <Button variante="secundario" tamanho="sm" onClick={() => navegar('/pedidos', { state: { abrirPedido: criado.id } })}>
                  Pagar pedido
                </Button>
              ) : undefined
            }
          >
            Pedido #{criado.id} registrado: {moeda(criado.total)}. Status: {STATUS_PEDIDO_ROTULO[criado.status]}.
          </Alerta>
        )}
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

        <div className="grid items-start gap-6 md:grid-cols-[1fr_19rem] xl:grid-cols-[1fr_22rem]">
          {/* Produtos */}
          <section aria-label="Produtos" className="min-w-0 space-y-3">
            <div className="relative">
              <IconeBusca className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-carvao/45" />
              <Entrada
                type="search"
                aria-label="Buscar por nome ou código de barras"
                placeholder="Buscar por nome ou código de barras"
                className="pl-10"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  // Leitor de código de barras: ao dar Enter com um único resultado, adiciona o produto.
                  if (e.key === 'Enter' && visiveis.length === 1 && visiveis[0]) {
                    e.preventDefault();
                    alterar(visiveis[0], 1);
                    setBusca('');
                  }
                }}
              />
            </div>

            {/* Categorias em botões: um toque filtra (rola para o lado se não couber) */}
            <div role="radiogroup" aria-label="Categoria" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {[{ id: '', nome: 'Todas' }, ...(categorias ?? []).map((c) => ({ id: String(c.id), nome: c.nome }))].map((c) => {
                const ativa = categoriaId === c.id;
                return (
                  <button
                    key={c.id || 'todas'}
                    type="button"
                    role="radio"
                    aria-checked={ativa}
                    onClick={() => setCategoriaId(c.id)}
                    className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600 ${
                      ativa ? 'border-carvao bg-carvao text-creme' : 'border-carvao/20 bg-white text-carvao hover:bg-carvao/5'
                    }`}
                  >
                    {c.nome}
                  </button>
                );
              })}
            </div>

            {!dados && carregando ? (
              <MensagemVazia>Carregando…</MensagemVazia>
            ) : visiveis.length === 0 ? (
              <MensagemVazia>Nenhum produto disponível com esses filtros neste canal.</MensagemVazia>
            ) : (
              <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
                {visiveis.map((p) => {
                  const noPedido = carrinho[p.id] ?? 0;
                  const restante = p.quantidadeDisponivel - noPedido;
                  const esgotado = p.quantidadeDisponivel === 0;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={restante <= 0}
                        onClick={() => alterar(p, 1)}
                        aria-label={`Adicionar ${p.nome}, ${moeda(p.preco)}${noPedido ? `, ${noPedido} no pedido` : ''}`}
                        className={`relative flex h-full min-h-[7.5rem] w-full flex-col justify-between rounded-card border bg-white p-3 text-left transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa-600 disabled:cursor-not-allowed disabled:active:scale-100 ${
                          noPedido ? 'border-brasa-500 ring-2 ring-brasa-500/40' : 'border-carvao/10 hover:border-carvao/25'
                        } ${esgotado ? 'opacity-55' : ''}`}
                      >
                        {noPedido > 0 && (
                          <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-brasa-600 px-2 text-sm font-semibold text-white tabular-nums">
                            {noPedido}
                          </span>
                        )}
                        <span className={`line-clamp-2 font-medium leading-snug ${noPedido ? 'pr-9' : ''}`}>{p.nome}</span>
                        <span className="mt-2 flex items-end justify-between gap-2">
                          <span className="text-lg font-semibold tabular-nums">{moeda(p.preco)}</span>
                          {esgotado ? (
                            <Badge tom="vermelho">Sem estoque</Badge>
                          ) : (
                            <span className={`text-xs tabular-nums ${restante <= 0 ? 'font-semibold text-brasa-700' : 'text-carvao/60'}`}>
                              {restante <= 0 ? 'Tudo no pedido' : `${restante} disp.`}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Pedido atual: fica ao lado dos produtos (e acompanha a rolagem) a partir do tablet */}
          <aside
            aria-label="Pedido atual"
            className="space-y-4 rounded-card border border-carvao/10 bg-white p-4 md:sticky md:top-4 md:max-h-[calc(100dvh-8rem)] md:overflow-y-auto"
          >
            <h2 className="text-xl font-semibold">Pedido atual</h2>

            <Segmentado
              rotulo="Canal"
              opcoes={CANAIS.map((c) => ({ valor: c, rotulo: CANAL_ROTULO[c] }))}
              valor={canal}
              aoMudar={mudarCanal}
            />

            {aviso && <Alerta tipo="aviso">{aviso}</Alerta>}

            {linhas.length === 0 ? (
              <p className="py-4 text-center text-sm text-carvao/65">Nenhum item ainda. Toque em um produto para adicionar.</p>
            ) : (
              <ul className="divide-y divide-carvao/10">
                {linhas.map(({ produto, quantidade }) => {
                  const excede = quantidade > produto.quantidadeDisponivel;
                  return (
                    <li key={produto.id} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{produto.nome}</p>
                        <p className="shrink-0 text-sm font-semibold tabular-nums">{moeda((centavos(produto.preco) * quantidade) / 100)}</p>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Button
                            variante="secundario"
                            onClick={() => alterar(produto, -1)}
                            aria-label={`Diminuir ${produto.nome}`}
                            className="h-11 w-11 !px-0 text-xl"
                          >
                            −
                          </Button>
                          <span className="w-10 text-center text-lg font-semibold tabular-nums" aria-label={`Quantidade de ${produto.nome}`}>
                            {quantidade}
                          </span>
                          <Button
                            variante="secundario"
                            disabled={quantidade >= produto.quantidadeDisponivel}
                            onClick={() => alterar(produto, 1)}
                            aria-label={`Aumentar ${produto.nome}`}
                            className="h-11 w-11 !px-0 text-xl"
                          >
                            +
                          </Button>
                        </div>
                        <Button variante="fantasma" tamanho="sm" onClick={() => alterar(produto, -quantidade)} aria-label={`Remover ${produto.nome}`}>
                          Remover
                        </Button>
                      </div>
                      {excede && (
                        <p role="alert" className="mt-1 text-sm text-red-700">
                          Só há {produto.quantidadeDisponivel} em estoque. Diminua a quantidade.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-carvao/10 pt-3">
              <span className="font-semibold">Total</span>
              <span className="text-2xl font-semibold tabular-nums">{moeda(totalCentavos / 100)}</span>
            </div>

            {erroEnvio && <Alerta>{erroEnvio}</Alerta>}

            <Button className="min-h-14 w-full text-base" onClick={registrar} carregando={enviando} disabled={linhas.length === 0 || temExcesso}>
              Registrar pedido
            </Button>
          </aside>
        </div>
      </div>
    </>
  );
}
