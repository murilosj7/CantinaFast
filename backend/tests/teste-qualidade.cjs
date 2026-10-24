'use strict';
// Trabalho de Qualidade de Software: Particionamento de Equivalência (PE) + Análise de Valor Limite (AVL).
// Cinco funcionalidades da API, testadas como caixa-preta (só requisição HTTP e resposta).
// Cada caso imprime: id, classe coberta, técnica, entrada, resultado esperado, resultado obtido e veredito.
// Uso: npm test -- qualidade
const L = require('./_lib.cjs');
const t = L.suite('qualidade');

const resumo = []; // { func, total, passou, falhou }
let atual = null;

function funcionalidade(codigo, titulo, rota) {
  atual = { func: `${codigo} - ${titulo}`, total: 0, passou: 0, falhou: 0 };
  resumo.push(atual);
  console.log('\n' + '='.repeat(110));
  console.log(`${codigo} - ${titulo}   [${rota}]`);
  console.log('='.repeat(110));
}

// Executa um caso e imprime a linha de evidência.
// esperado: status HTTP esperado pela ESPECIFICAÇÃO (não pelo código).
async function ct(id, classe, tecnica, entrada, esperado, fazer) {
  atual.total++;
  let r;
  try {
    r = await fazer();
  } catch (e) {
    r = { status: 'ERRO', body: { mensagem: e.message } };
  }
  const passou = r.status === esperado;
  if (passou) atual.passou++;
  else atual.falhou++;
  const msg = r.body && r.body.mensagem ? ` -> "${r.body.mensagem}"` : '';
  console.log(
    `${id.padEnd(6)} ${classe.padEnd(9)} ${tecnica.padEnd(4)} ${entrada.padEnd(44)} esperado ${String(esperado).padEnd(4)} obtido ${String(r.status).padEnd(4)} ${passou ? 'PASSOU' : 'FALHOU'}${msg}`,
  );
  // Conta no placar do runner (uma falha aqui é um defeito encontrado, não erro do script).
  if (passou) t.placar.ok++;
  else t.placar.falhas++;
  return r;
}

const rep = (c, n) => c.repeat(n);

L.executar(t, async () => {
  const adm = await t.usuario('ADMINISTRADOR');
  const produtosForaDoPrefixo = []; // produtos com nome curto (sem o prefixo de limpeza)

  // ======================================================================= F1
  funcionalidade('F1', 'Cadastro de produto', 'POST /produtos');
  const cat = await t.categoria();
  const catInativa = await t.categoria({ ativa: false });
  const produto = async (over) => {
    const r = await t.http('POST', '/produtos', { token: adm.token, body: { nome: t.unico('p'), preco: 10, categoriaId: cat.id, ...over } });
    if (r.status === 201 && !String(r.body.nome).startsWith(t.prefixo)) produtosForaDoPrefixo.push(r.body.id);
    return r;
  };
  const nomeTam = (n) => t.prefixo + rep('x', n - t.prefixo.length);

  await ct('CT01', 'V1', 'PE', 'nome "Coxinha" (texto comum)', 201, () => produto({ nome: 'Coxinha' }));
  await ct('CT02', 'V1', 'AVL', 'nome com 1 caractere (mínimo)', 201, () => produto({ nome: 'A' }));
  await ct('CT03', 'V1', 'AVL', 'nome com 140 caracteres (máximo)', 201, () => produto({ nome: nomeTam(140) }));
  await ct('CT04', 'I1', 'AVL', 'nome com 141 caracteres (máximo+1)', 400, () => produto({ nome: nomeTam(141) }));
  await ct('CT05', 'I2', 'PE', 'nome vazio / só espaços "   "', 400, () => produto({ nome: '   ' }));
  await ct('CT06', 'V2', 'PE', 'preco 12.50', 201, () => produto({ preco: 12.5 }));
  await ct('CT07', 'V2', 'AVL', 'preco 0.01 (mínimo)', 201, () => produto({ preco: 0.01 }));
  await ct('CT08', 'I3', 'AVL', 'preco 0.00 (mínimo-1 centavo)', 400, () => produto({ preco: 0 }));
  await ct('CT09', 'I3', 'PE', 'preco -5.00 (negativo)', 400, () => produto({ preco: -5 }));
  await ct('CT10', 'V2', 'AVL', 'preco 99999999.99 (máximo)', 201, () => produto({ preco: 99999999.99 }));
  await ct('CT11', 'I4', 'AVL', 'preco 100000000.00 (máximo+1 centavo)', 400, () => produto({ preco: 100000000 }));
  await ct('CT12', 'I5', 'PE', 'preco 10.999 (3 casas decimais)', 400, () => produto({ preco: 10.999 }));
  await ct('CT13', 'I6', 'PE', 'preco "12.50" (texto)', 400, () => produto({ preco: '12.50' }));
  await ct('CT14', 'V3', 'AVL', 'quantidadeInicial 0 (mínimo)', 201, () => produto({ quantidadeInicial: 0 }));
  await ct('CT15', 'I7', 'AVL', 'quantidadeInicial -1 (mínimo-1)', 400, () => produto({ quantidadeInicial: -1 }));
  await ct('CT16', 'I8', 'PE', 'quantidadeInicial 2.5 (fracionária)', 400, () => produto({ quantidadeInicial: 2.5 }));
  await ct('CT17', 'V4', 'PE', 'categoria existente e ativa', 201, () => produto({ categoriaId: cat.id }));
  await ct('CT18', 'I9', 'PE', 'categoria inexistente (id 999999)', 400, () => produto({ categoriaId: 999999 }));
  await ct('CT19', 'I10', 'PE', 'categoria inativa', 400, () => produto({ categoriaId: catInativa.id }));

  // ======================================================================= F2
  funcionalidade('F2', 'Cadastro de cliente (site)', 'POST /clientes/cadastro');
  const email = (tam) => {
    const dominio = '@teste.local';
    const base = t.unico('e');
    if (!tam) return base + dominio;
    return base + rep('a', tam - base.length - dominio.length) + dominio;
  };
  const cliente = (over) =>
    t.http('POST', '/clientes/cadastro', { body: { nome: 'Maria Silva', email: email(), senha: 'segredo1', telefone: '44999990000', ...over } });

  await ct('CT20', 'V1', 'PE', 'todos os campos válidos', 201, () => cliente({}));
  await ct('CT21', 'V1', 'AVL', 'nome com 120 caracteres (máximo)', 201, () => cliente({ nome: rep('M', 120) }));
  await ct('CT22', 'I1', 'AVL', 'nome com 121 caracteres (máximo+1)', 400, () => cliente({ nome: rep('M', 121) }));
  await ct('CT23', 'I2', 'PE', 'nome vazio', 400, () => cliente({ nome: '' }));
  await ct('CT24', 'V2', 'AVL', 'e-mail com 160 caracteres (máximo)', 201, () => cliente({ email: email(160) }));
  await ct('CT25', 'I3', 'AVL', 'e-mail com 161 caracteres (máximo+1)', 400, () => cliente({ email: email(161) }));
  await ct('CT26', 'I4', 'PE', 'e-mail sem @ ("maria.teste.local")', 400, () => cliente({ email: 'maria.teste.local' }));
  const repetido = email();
  await cliente({ email: repetido });
  await ct('CT27', 'I5', 'PE', 'e-mail já cadastrado', 409, () => cliente({ email: repetido }));
  await ct('CT28', 'V3', 'AVL', 'senha com 6 caracteres (mínimo)', 201, () => cliente({ senha: '123456' }));
  await ct('CT29', 'I6', 'AVL', 'senha com 5 caracteres (mínimo-1)', 400, () => cliente({ senha: '12345' }));
  await ct('CT30', 'V3', 'AVL', 'senha com 72 bytes (máximo)', 201, () => cliente({ senha: rep('s', 72) }));
  await ct('CT31', 'I7', 'AVL', 'senha com 73 bytes (máximo+1)', 400, () => cliente({ senha: rep('s', 73) }));
  await ct('CT32', 'V4', 'AVL', 'telefone com 20 caracteres (máximo)', 201, () => cliente({ telefone: rep('9', 20) }));
  await ct('CT33', 'I8', 'AVL', 'telefone com 21 caracteres (máximo+1)', 400, () => cliente({ telefone: rep('9', 21) }));
  // Regra do cliente (decisão de escopo): telefone é OBRIGATÓRIO no cadastro.
  await ct('CT34', 'I9', 'PE', 'telefone ausente (campo obrigatório)', 400, () => cliente({ telefone: undefined }));
  await ct('CT35', 'I10', 'PE', 'telefone com letras ("abcdefgh")', 400, () => cliente({ telefone: 'abcdefgh' }));

  // ======================================================================= F3
  funcionalidade('F3', 'Movimentação de estoque', 'POST /movimentacoes (saldo inicial = 10)');
  const mov = async (over) => {
    const p = await t.produto({ qtd: 10 });
    return t.http('POST', '/movimentacoes', { token: adm.token, body: { produtoId: p.id, tipo: 'SAIDA', quantidade: 1, ...over } });
  };
  await ct('CT36', 'V1', 'PE', 'tipo ENTRADA, quantidade 5', 201, () => mov({ tipo: 'ENTRADA', quantidade: 5 }));
  await ct('CT37', 'V1', 'PE', 'tipo PERDA, quantidade 2', 201, () => mov({ tipo: 'PERDA', quantidade: 2 }));
  await ct('CT38', 'I1', 'PE', 'tipo "VENDA" (fora da lista)', 400, () => mov({ tipo: 'VENDA' }));
  await ct('CT39', 'V2', 'AVL', 'SAIDA quantidade 1 (mínimo)', 201, () => mov({ quantidade: 1 }));
  await ct('CT40', 'I2', 'AVL', 'SAIDA quantidade 0 (mínimo-1)', 400, () => mov({ quantidade: 0 }));
  await ct('CT41', 'I3', 'PE', 'SAIDA quantidade -3 (negativa)', 400, () => mov({ quantidade: -3 }));
  await ct('CT42', 'I4', 'PE', 'SAIDA quantidade 1.5 (fracionária)', 400, () => mov({ quantidade: 1.5 }));
  await ct('CT43', 'V3', 'AVL', 'SAIDA quantidade 10 (= saldo, zera)', 201, () => mov({ quantidade: 10 }));
  await ct('CT44', 'I5', 'AVL', 'SAIDA quantidade 11 (saldo+1)', 400, () => mov({ quantidade: 11 }));
  await ct('CT45', 'V4', 'AVL', 'AJUSTE -10 (= saldo, zera)', 201, () => mov({ tipo: 'AJUSTE', quantidade: -10 }));
  await ct('CT46', 'I6', 'AVL', 'AJUSTE -11 (saldo+1)', 400, () => mov({ tipo: 'AJUSTE', quantidade: -11 }));
  await ct('CT47', 'I7', 'PE', 'AJUSTE 0 (não altera nada)', 400, () => mov({ tipo: 'AJUSTE', quantidade: 0 }));
  await ct('CT48', 'I8', 'PE', 'produto inexistente (id 999999)', 404, () => mov({ produtoId: 999999 }));

  // ======================================================================= F4
  funcionalidade('F4', 'Criação de pedido (venda)', 'POST /pedidos (estoque disponível = 5)');
  const pedido = async (over, qtd = 5) => {
    const p = await t.produto({ qtd, preco: '8.00' });
    return t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: p.id, quantidade: 1 }], ...over(p) } });
  };
  await ct('CT49', 'V1', 'PE', 'canal PRESENCIAL, 1 item, quantidade 1', 201, () => pedido(() => ({})));
  await ct('CT50', 'V1', 'PE', 'canal ONLINE', 201, () => pedido(() => ({ canal: 'ONLINE' })));
  await ct('CT51', 'I1', 'PE', 'canal "BALCAO" (fora da lista)', 400, () => pedido(() => ({ canal: 'BALCAO' })));
  await ct('CT52', 'I2', 'AVL', 'lista de itens vazia (0 itens)', 400, () => pedido(() => ({ itens: [] })));
  await ct('CT53', 'I3', 'AVL', '101 itens (máximo+1)', 400, () =>
    pedido(() => ({ itens: Array.from({ length: 101 }, (_, i) => ({ produtoId: i + 1, quantidade: 1 })) })));
  await ct('CT54', 'V2', 'AVL', 'quantidade 5 (= estoque disponível)', 201, () => pedido((p) => ({ itens: [{ produtoId: p.id, quantidade: 5 }] })));
  await ct('CT55', 'I4', 'AVL', 'quantidade 6 (estoque+1)', 400, () => pedido((p) => ({ itens: [{ produtoId: p.id, quantidade: 6 }] })));
  await ct('CT56', 'I5', 'AVL', 'quantidade 0 (mínimo-1)', 400, () => pedido((p) => ({ itens: [{ produtoId: p.id, quantidade: 0 }] })));
  await ct('CT57', 'I6', 'PE', 'mesmo produto repetido em 2 itens', 400, () =>
    pedido((p) => ({ itens: [{ produtoId: p.id, quantidade: 1 }, { produtoId: p.id, quantidade: 1 }] })));
  await ct('CT58', 'I7', 'PE', 'produto inativo', 400, async () => {
    const p = await t.produto({ qtd: 5, ativo: false });
    return t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: p.id, quantidade: 1 }] } });
  });

  // ======================================================================= F5
  funcionalidade('F5', 'Registro de pagamento', 'POST /pagamentos (total do pedido = 20.00)');
  const novoPedido = async () => {
    const p = await t.produto({ qtd: 50, preco: '10.00' });
    const r = await t.http('POST', '/pedidos', { token: adm.token, body: { canal: 'PRESENCIAL', itens: [{ produtoId: p.id, quantidade: 2 }] } });
    return t.sucesso(r, 201).id;
  };
  const pagar = async (over, pedidoId) => {
    const id = pedidoId || (await novoPedido());
    return t.http('POST', '/pagamentos', { token: adm.token, body: { pedidoId: id, formaPagamento: 'PIX', valor: 20, ...over } });
  };
  await ct('CT59', 'V1', 'PE', 'forma PIX, valor 20.00', 201, () => pagar({}));
  await ct('CT60', 'V1', 'PE', 'forma DINHEIRO', 201, () => pagar({ formaPagamento: 'DINHEIRO' }));
  await ct('CT61', 'V1', 'PE', 'forma "cartao" (minúsculas)', 201, () => pagar({ formaPagamento: 'cartao' }));
  // Especificação (documento do TCC): formas aceitas são Pix, débito, crédito ou dinheiro.
  await ct('CT62', 'V1', 'PE', 'forma DEBITO (prevista na especificação)', 201, () => pagar({ formaPagamento: 'DEBITO' }));
  await ct('CT63', 'I1', 'PE', 'forma "CHEQUE" (fora da lista)', 400, () => pagar({ formaPagamento: 'CHEQUE' }));
  await ct('CT64', 'I2', 'AVL', 'valor 19.99 (total-1 centavo)', 400, () => pagar({ valor: 19.99 }));
  await ct('CT65', 'I3', 'AVL', 'valor 20.01 (total+1 centavo)', 400, () => pagar({ valor: 20.01 }));
  await ct('CT66', 'I4', 'AVL', 'valor 0.00', 400, () => pagar({ valor: 0 }));
  await ct('CT67', 'I5', 'PE', 'valor 20.001 (3 casas decimais)', 400, () => pagar({ valor: 20.001 }));
  await ct('CT68', 'I6', 'PE', 'valor "20" (texto)', 400, () => pagar({ valor: '20' }));
  const pago = await novoPedido();
  await pagar({}, pago);
  await ct('CT69', 'I7', 'PE', 'pedido já pago (pagar 2 vezes)', 400, () => pagar({}, pago));
  await ct('CT70', 'I8', 'PE', 'pedido inexistente (id 999999)', 400, () => pagar({}, 999999));

  // ======================================================================= resumo
  console.log('\n' + '='.repeat(110));
  console.log('RESUMO POR FUNCIONALIDADE');
  console.log('='.repeat(110));
  console.log('funcionalidade'.padEnd(44) + 'casos'.padStart(7) + 'passou'.padStart(8) + 'falhou'.padStart(8));
  for (const f of resumo) console.log(f.func.padEnd(44) + String(f.total).padStart(7) + String(f.passou).padStart(8) + String(f.falhou).padStart(8));
  const tot = resumo.reduce((a, f) => ({ total: a.total + f.total, passou: a.passou + f.passou, falhou: a.falhou + f.falhou }), { total: 0, passou: 0, falhou: 0 });
  console.log('TOTAL'.padEnd(44) + String(tot.total).padStart(7) + String(tot.passou).padStart(8) + String(tot.falhou).padStart(8));
  console.log('');

  // Limpeza dos produtos de nome curto (não carregam o prefixo da suíte).
  await t.prisma.movimentacaoEstoque.deleteMany({ where: { produtoId: { in: produtosForaDoPrefixo } } });
  await t.prisma.estoque.deleteMany({ where: { produtoId: { in: produtosForaDoPrefixo } } });
  await t.prisma.produto.deleteMany({ where: { id: { in: produtosForaDoPrefixo } } });
});
