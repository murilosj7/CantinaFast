import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alerta, Badge, Button, Entrada, PaginaCabecalho, Selecao } from '../components/ui';
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
      <PaginaCabecalho titulo="Novo pedido" descricao="Escolha os produtos, ajuste as quantidades e registre. O estoque é baixado ao registrar." />

      <div className="space-y-4">
        {criado && (
          <Alerta
            tipo="sucesso"
            acao={
              <Button variante="secundario" tamanho="sm" onClick={() => navegar('/pedidos', { state: { abrirPedido: criado.id } })}>
                Pagar pedido
              </Button>
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

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          {/* Produtos */}
          <section aria-label="Produtos" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <Entrada
                aria-label="Buscar por nome ou código de barras"
                placeholder="Buscar por nome ou código de barras"
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
              <Selecao aria-label="Filtrar por categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Todas as categorias</option>
                {(categorias ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Selecao>
            </div>

            <ul className="max-h-[65vh] divide-y divide-carvao/10 overflow-y-auto rounded-card border border-carvao/10 bg-white">
              {!dados && carregando ? (
                <li className="px-4 py-10 text-center text-carvao/65">Carregando…</li>
              ) : visiveis.length === 0 ? (
                <li className="px-4 py-10 text-center text-carvao/65">Nenhum produto disponível com esses filtros neste canal.</li>
              ) : (
                visiveis.map((p) => {
                  const noPedido = carrinho[p.id] ?? 0;
                  const restante = p.quantidadeDisponivel - noPedido;
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{p.nome}</p>
                        <p className="text-sm text-carvao/70">
                          {moeda(p.preco)} · {p.categoriaNome}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {p.quantidadeDisponivel === 0 ? (
                          <Badge tom="vermelho">Sem estoque</Badge>
                        ) : (
                          <span className="text-sm text-carvao/70">{restante} disp.</span>
                        )}
                        <Button tamanho="sm" disabled={restante <= 0} onClick={() => alterar(p, 1)} aria-label={`Adicionar ${p.nome}`}>
                          Adicionar
                        </Button>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          {/* Pedido atual */}
          <aside aria-label="Pedido atual" className="h-fit space-y-4 rounded-card border border-carvao/10 bg-white p-4 lg:sticky lg:top-6">
            <h2 className="text-xl font-semibold">Pedido atual</h2>

            <div>
              <label htmlFor="canal" className="mb-1 block text-sm font-medium">
                Canal
              </label>
              <Selecao id="canal" value={canal} onChange={(e) => mudarCanal(e.target.value as CanalPedido)}>
                {CANAIS.map((c) => (
                  <option key={c} value={c}>
                    {CANAL_ROTULO[c]}
                  </option>
                ))}
              </Selecao>
            </div>

            {aviso && <Alerta tipo="aviso">{aviso}</Alerta>}

            {linhas.length === 0 ? (
              <p className="py-4 text-center text-sm text-carvao/65">Nenhum item ainda. Adicione produtos da lista.</p>
            ) : (
              <ul className="divide-y divide-carvao/10">
                {linhas.map(({ produto, quantidade }) => {
                  const excede = quantidade > produto.quantidadeDisponivel;
                  return (
                    <li key={produto.id} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{produto.nome}</p>
                        <p className="shrink-0 text-sm tabular-nums">{moeda((centavos(produto.preco) * quantidade) / 100)}</p>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button variante="secundario" tamanho="sm" onClick={() => alterar(produto, -1)} aria-label={`Diminuir ${produto.nome}`}>
                            −
                          </Button>
                          <span className="w-8 text-center text-sm tabular-nums" aria-label={`Quantidade de ${produto.nome}`}>
                            {quantidade}
                          </span>
                          <Button
                            variante="secundario"
                            tamanho="sm"
                            disabled={quantidade >= produto.quantidadeDisponivel}
                            onClick={() => alterar(produto, 1)}
                            aria-label={`Aumentar ${produto.nome}`}
                          >
                            +
                          </Button>
                        </div>
                        <Button variante="fantasma" tamanho="sm" onClick={() => alterar(produto, -quantidade)}>
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
              <span className="text-xl font-semibold tabular-nums">{moeda(totalCentavos / 100)}</span>
            </div>

            {erroEnvio && <Alerta>{erroEnvio}</Alerta>}

            <Button className="w-full" onClick={registrar} carregando={enviando} disabled={linhas.length === 0 || temExcesso}>
              Registrar pedido
            </Button>
          </aside>
        </div>
      </div>
    </>
  );
}
