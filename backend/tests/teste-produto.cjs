'use strict';
// Produtos: criação (com estoque inicial), validação, listagem/filtros, busca por id e código de barras,
// edição parcial, exclusão lógica, mapper, concorrência e rollback.
const L = require('./_lib.cjs');
const t = L.suite('produto');

const CHAVES = ['ativo', 'categoriaId', 'categoriaNome', 'codigoBarras', 'criadoEm', 'descricao', 'disponivelOnline', 'disponivelPresencial', 'id', 'imagemUrl', 'nome', 'preco', 'quantidadeDisponivel'];

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  // Categoria ativa e categoria inativa usadas para validar a regra de categoria na criação e edição.
  const cat = await t.categoria();
  const catInativa = await t.categoria({ ativa: false });
  // Corpo válido de produto; `over` troca só o campo que o caso quer testar.
  const post = (over = {}, token = adm.token) => t.http('POST', '/produtos', { token, body: { nome: t.unico('p'), preco: 10, categoriaId: cat.id, ...over } });
  const patch = (id, body, token = adm.token) => t.http('PATCH', `/produtos/${id}`, { token, body });
  // Variante que REMOVE um campo obrigatório do corpo.
  const sem = (campo, over = {}) => {
    const b = { nome: t.unico('p'), preco: 10, categoriaId: cat.id, ...over };
    delete b[campo];
    return t.http('POST', '/produtos', { token: adm.token, body: b });
  };

  // ---------------------------------------------------------------- criar: feliz
  // Produto base com todos os campos preenchidos, criado pela API.
  let prod;
  await t.caso('POST cria produto (201) com o formato do mapper', async () => {
    prod = t.sucesso(await post({ preco: 12.5, descricao: 'Gostoso', codigoBarras: t.unico('cb'), imagemUrl: 'http://img/x.png', quantidadeInicial: 7 }), 201);
    t.eq(Object.keys(prod).sort(), CHAVES);
    t.eq(prod.preco, 12.5);
    t.eq(typeof prod.preco, 'number');
    t.eq(prod.categoriaNome, cat.nome);
    t.eq(prod.quantidadeDisponivel, 7);
    t.eq(prod.ativo, true);
    t.eq(prod.disponivelOnline, true);
    t.eq(prod.disponivelPresencial, true);
    t.eq(new Date(prod.criadoEm).toISOString(), prod.criadoEm);
  });
  await t.caso('quantidadeInicial>0 grava estoque físico e UMA movimentação ENTRADA "Estoque inicial" do usuário do token', async () => {
    const s = await t.saldo(prod.id);
    t.eq([s.quantidadeFisica, s.quantidadeReservada, s.estoqueMinimo], [7, 0, 0]);
    const ms = await t.prisma.movimentacaoEstoque.findMany({ where: { produtoId: prod.id } });
    t.eq(ms.length, 1);
    t.eq([ms[0].tipo, ms[0].quantidade, ms[0].motivo, ms[0].usuarioId], ['ENTRADA', 7, 'Estoque inicial', adm.id]);
  });
  await t.caso('sem quantidadeInicial: estoque criado zerado e SEM movimentação', async () => {
    const p = t.sucesso(await post(), 201);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 0);
    t.eq(await t.contarMov(p.id), 0);
    t.eq(p.quantidadeDisponivel, 0);
  });
  await t.caso('quantidadeInicial 0 explícita ou null: zero, sem movimentação', async () => {
    for (const q of [0, null]) {
      const p = t.sucesso(await post({ quantidadeInicial: q }), 201);
      t.eq(await t.contarMov(p.id), 0);
    }
  });
  await t.caso('campos opcionais ausentes viram "" (descricao/imagemUrl) e null (codigoBarras)', async () => {
    const p = t.sucesso(await post(), 201);
    t.eq([p.descricao, p.imagemUrl, p.codigoBarras], ['', '', null]);
  });
  await t.caso('o usuário do movimento é o do token, não o do corpo (usuarioId no body é ignorado)', async () => {
    const p = t.sucesso(await post({ quantidadeInicial: 2, usuarioId: cx.id }), 201);
    t.eq((await t.prisma.movimentacaoEstoque.findFirst({ where: { produtoId: p.id } })).usuarioId, adm.id);
  });
  await t.caso('nome é aparado; texto opcional vazio vira null', async () => {
    const p = t.sucesso(await post({ nome: `  ${t.unico('esp')}  `, descricao: '   ', codigoBarras: '  ' }), 201);
    t.eq(p.nome, p.nome.trim());
    t.eq([p.descricao, p.codigoBarras], ['', null]);
  });
  await t.caso('nome com exatamente 140 caracteres é aceito', async () => {
    t.sucesso(await post({ nome: (t.prefixo + 'n'.repeat(140)).slice(0, 140) }), 201);
  });
  await t.caso('disponivelOnline/Presencial false são respeitados', async () => {
    const p = t.sucesso(await post({ disponivelOnline: false, disponivelPresencial: false }), 201);
    t.eq([p.disponivelOnline, p.disponivelPresencial], [false, false]);
  });
  await t.caso('quantidadeInicial gigante (2147483647) é aceita', async () => {
    const p = t.sucesso(await post({ quantidadeInicial: 2147483647 }), 201);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 2147483647);
  });

  // ---------------------------------------------------------------- criar: preço
  // Preços aceitos: até 2 casas, com tolerância de ponto flutuante (0.1+0.2 vira 0.30).
  for (const [v, esperado] of [[0.01, 0.01], [1, 1], [19.99, 19.99], [0.1 + 0.2, 0.3], [99999999.99, 99999999.99], [1234.5, 1234.5], [7, 7]]) {
    await t.caso(`preço ${v} é aceito e gravado como ${esperado}`, async () => {
      t.eq(t.sucesso(await post({ preco: v }), 201).preco, esperado);
    });
  }
  // Preços rejeitados: zero, negativo, acima do teto, 3 casas ou tipo que não é número.
  for (const [rotulo, v, contem] of [
    ['zero', 0, 'maior que zero'], ['negativo', -1, 'maior que zero'], ['acima do teto', 100000000, 'maior que zero'],
    ['3 casas decimais', 1.005, '2 casas'], ['0.001', 0.001, '2 casas'], ['texto numérico "12.5"', '12.5', 'número'],
    ['null', null, 'número'], ['booleano', true, 'número'], ['objeto', {}, 'número'], ['array', [1], 'número'], ['string vazia', '', 'número'],
  ]) {
    await t.caso(`preço ${rotulo} → 400 campo=preco`, async () => {
      L.erro(await post({ preco: v }), 400, { campo: 'preco', contem });
    });
  }
  await t.caso('preço ausente → 400 campo=preco', async () => {
    L.erro(await sem('preco'), 400, { campo: 'preco' });
  });

  // ---------------------------------------------------------------- criar: demais validações
  // Matriz de validação de criação: cada linha quebra um campo e o erro 400 aponta exatamente esse campo.
  for (const [rotulo, over, campo] of [
    ['nome vazio', { nome: '' }, 'nome'], ['nome só espaços', { nome: '   ' }, 'nome'], ['nome numérico', { nome: 9 }, 'nome'],
    ['nome nulo', { nome: null }, 'nome'], ['nome com 141 caracteres', { nome: 'n'.repeat(141) }, 'nome'],
    ['quantidadeInicial negativa', { quantidadeInicial: -1 }, 'quantidadeInicial'],
    ['quantidadeInicial fracionária', { quantidadeInicial: 1.5 }, 'quantidadeInicial'],
    ['quantidadeInicial texto', { quantidadeInicial: '5' }, 'quantidadeInicial'],
    ['quantidadeInicial acima de int32', { quantidadeInicial: 2147483648 }, 'quantidadeInicial'],
    ['categoriaId texto', { categoriaId: 'abc' }, 'categoriaId'], ['categoriaId zero', { categoriaId: 0 }, 'categoriaId'],
    ['categoriaId negativo', { categoriaId: -4 }, 'categoriaId'], ['categoriaId fracionário', { categoriaId: 1.5 }, 'categoriaId'],
    ['categoriaId nulo', { categoriaId: null }, 'categoriaId'],
    ['categoria inexistente', { categoriaId: 2000000000 }, 'categoriaId'],
    ['categoria inativa', { categoriaId: catInativa.id }, 'categoriaId'],
    ['descricao numérica', { descricao: 5 }, 'descricao'], ['descricao > 5000', { descricao: 'd'.repeat(5001) }, 'descricao'],
    ['imagemUrl numérica', { imagemUrl: 5 }, 'imagemUrl'], ['imagemUrl > 500', { imagemUrl: 'i'.repeat(501) }, 'imagemUrl'],
    ['codigoBarras numérico', { codigoBarras: 789 }, 'codigoBarras'], ['codigoBarras > 80', { codigoBarras: 'c'.repeat(81) }, 'codigoBarras'],
    ['disponivelOnline texto', { disponivelOnline: 'sim' }, 'disponivelOnline'],
    ['disponivelPresencial número', { disponivelPresencial: 1 }, 'disponivelPresencial'],
  ]) {
    await t.caso(`POST ${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await post(over), 400, { campo });
    });
  }
  await t.caso('POST sem categoriaId → 400 campo=categoriaId', async () => {
    L.erro(await sem('categoriaId'), 400, { campo: 'categoriaId' });
  });
  await t.caso('POST sem nome → 400 campo=nome', async () => {
    L.erro(await sem('nome'), 400, { campo: 'nome' });
  });
  await t.caso('POST com descricao de 5000 e imagemUrl de 500 caracteres é aceito', async () => {
    t.sucesso(await post({ descricao: 'd'.repeat(5000), imagemUrl: 'i'.repeat(500) }), 201);
  });
  await t.caso('POST erro de validação não cria produto nem movimentação (preço inválido com quantidadeInicial)', async () => {
    const nome = t.unico('semefeito');
    L.erro(await post({ nome, preco: -1, quantidadeInicial: 10 }), 400);
    t.eq(await t.prisma.produto.count({ where: { nome } }), 0);
  });
  await t.caso('POST sem token → 401', async () => {
    L.erro(await t.http('POST', '/produtos', { body: { nome: 'x', preco: 1, categoriaId: cat.id } }), 401);
  });
  await t.caso('POST com JSON malformado → 400', async () => {
    L.erro(await t.http('POST', '/produtos', { token: adm.token, rawBody: '{' }), 400, { contem: 'JSON' });
  });

  // ---------------------------------------------------------------- código de barras
  // Código de barras é único; a checagem aparada evita duplicata com espaços.
  const cb = t.unico('barras');
  await t.caso('código de barras duplicado → 409 campo=codigoBarras e nada é criado', async () => {
    t.sucesso(await post({ codigoBarras: cb }), 201);
    const nome = t.unico('dup');
    L.erro(await post({ nome, codigoBarras: cb, quantidadeInicial: 3 }), 409, { campo: 'codigoBarras' });
    t.eq(await t.prisma.produto.count({ where: { nome } }), 0);
  });
  await t.caso('código com espaços nas pontas conflita com o já cadastrado (aparado)', async () => {
    L.erro(await post({ codigoBarras: `  ${cb}  ` }), 409, { campo: 'codigoBarras' });
  });
  await t.caso('vários produtos sem código de barras convivem (null não conflita)', async () => {
    t.sucesso(await post(), 201);
    t.sucesso(await post(), 201);
  });
  // Concorrência: 10 criações com o mesmo código geram 1 produto; o P2002 do banco vira 409 campo=codigoBarras.
  await t.caso('criação simultânea com o mesmo código (10x): 1×201 e 9×409 campo=codigoBarras', async () => {
    const codigo = t.unico('corrida');
    const rs = await t.paralelo(10, (i) => post({ nome: t.unico('c' + i), codigoBarras: codigo, quantidadeInicial: 1 }));
    t.eq(rs.filter((r) => r.status === 201).length, 1);
    for (const r of rs.filter((x) => x.status !== 201)) L.erro(r, 409, { campo: 'codigoBarras' });
    t.eq(await t.prisma.produto.count({ where: { codigoBarras: codigo } }), 1);
    const p = await t.prisma.produto.findFirst({ where: { codigoBarras: codigo } });
    t.eq(await t.contarMov(p.id), 1);
  });
  await t.caso('criação simultânea de 15 produtos distintos: todos 201 com ids distintos', async () => {
    const rs = await t.paralelo(15, (i) => post({ nome: t.unico('par' + i), quantidadeInicial: i }));
    t.verdade(rs.every((r) => r.status === 201));
    t.eq(new Set(rs.map((r) => r.body.id)).size, 15);
  });

  // ---------------------------------------------------------------- rollback
  // Rollback: força falha DENTRO da transação do create aninhado (produto + estoque + movimentação) e prova que nada ficou.
  await t.caso('rollback: falha ao gravar a movimentação inicial desfaz produto e estoque (nada fica gravado)', async () => {
    const nome = t.unico('rollback');
    await t.comConstraint('movimentacoes_estoque', 'chk_tc_prod', `NOT (motivo = 'Estoque inicial' AND quantidade = 55)`, async () => {
      const r = await post({ nome, quantidadeInicial: 55 });
      t.eq(r.status, 500);
    });
    t.eq(await t.prisma.produto.count({ where: { nome } }), 0);
    t.eq(await t.prisma.estoque.count({ where: { produto: { nome } } }), 0);
    t.eq(await t.prisma.movimentacaoEstoque.count({ where: { quantidade: 55, usuarioId: adm.id } }), 0);
    t.sucesso(await post({ nome: t.unico('depois'), quantidadeInicial: 55 }), 201); // constraint removida: volta a funcionar
  });

  // ---------------------------------------------------------------- listar (pública)
  // Massa da listagem: A (ativo), B (ativo, indisponível online, reservado > físico) e C (inativo, sem canal presencial).
  const A = await t.produto({ nome: t.unico('lst-A'), preco: '5.00', qtd: 10, categoriaId: cat.id, codigoBarras: t.unico('lcb') });
  const B = await t.produto({ nome: t.unico('lst-B'), preco: '6.00', qtd: 2, reservada: 5, categoriaId: cat.id, online: false });
  const C = await t.produto({ nome: t.unico('lst-C'), preco: '7.00', qtd: 1, ativo: false, presencial: false });
  const lista = async (qs) => t.sucesso(await t.http('GET', `/produtos?busca=${encodeURIComponent(t.prefixo + 'lst-')}${qs}`));
  await t.caso('GET /produtos é público e por padrão traz só ativos, ordenados por nome', async () => {
    const r = await lista('');
    t.eq(r.map((p) => p.id), [A.id, B.id]);
  });
  await t.caso('quantidadeDisponivel = físico − reservado, nunca negativo', async () => {
    const r = await lista('');
    t.eq(r.find((p) => p.id === A.id).quantidadeDisponivel, 10);
    t.eq(r.find((p) => p.id === B.id).quantidadeDisponivel, 0);
  });
  await t.caso('?status=inativo traz só inativos', async () => {
    t.eq((await lista('&status=inativo')).map((p) => p.id), [C.id]);
  });
  await t.caso('?status=todos traz ativos e inativos', async () => {
    t.eq((await lista('&status=todos')).map((p) => p.id), [A.id, B.id, C.id]);
  });
  await t.caso('?status inválido → 400 campo=status', async () => {
    L.erro(await t.http('GET', '/produtos?status=zzz'), 400, { campo: 'status' });
  });
  await t.caso('?canal=online exclui produtos indisponíveis no site', async () => {
    t.eq((await lista('&canal=online')).map((p) => p.id), [A.id]);
  });
  await t.caso('?canal=presencial filtra por disponivelPresencial (ativos)', async () => {
    t.eq((await lista('&canal=presencial&status=todos')).map((p) => p.id), [A.id, B.id]);
  });
  await t.caso('?canal inválido → 400 campo=canal', async () => {
    L.erro(await t.http('GET', '/produtos?canal=balcao'), 400, { campo: 'canal' });
  });
  await t.caso('?canal= vazio é ignorado', async () => {
    t.eq((await lista('&canal=')).length, 2);
  });
  await t.caso('?categoriaId filtra por categoria', async () => {
    const outra = await t.produto({ nome: t.unico('lst-D') });
    t.eq((await lista(`&categoriaId=${outra.categoriaId}`)).map((p) => p.id), [outra.id]);
  });
  for (const v of ['abc', '0', '-1', '1.5']) {
    await t.caso(`?categoriaId inválido '${v}' → 400 campo=categoriaId`, async () => {
      L.erro(await t.http('GET', `/produtos?categoriaId=${v}`), 400, { campo: 'categoriaId' });
    });
  }
  await t.caso('?busca acha por parte do nome sem diferenciar maiúsculas', async () => {
    const r = t.sucesso(await t.http('GET', `/produtos?busca=${encodeURIComponent((t.prefixo + 'LST-A').toUpperCase())}`));
    t.eq(r.map((p) => p.id), [A.id]);
  });
  await t.caso('?busca acha por parte do código de barras', async () => {
    t.eq(t.sucesso(await t.http('GET', `/produtos?busca=${encodeURIComponent(A.codigoBarras)}`)).map((p) => p.id), [A.id]);
  });
  await t.caso('?busca sem resultados → []', async () => {
    t.eq(t.sucesso(await t.http('GET', `/produtos?busca=${t.prefixo}inexistente_zzz`)), []);
  });
  await t.caso('?busca com caractere especial (%) é tratada como texto', async () => {
    t.eq(t.sucesso(await t.http('GET', '/produtos?busca=%25zz%25_nao')), []);
  });
  await t.caso('preço aparece como número com o valor gravado', async () => {
    t.eq((await lista('')).find((p) => p.id === A.id).preco, 5);
  });

  // ---------------------------------------------------------------- buscar por id / código
  await t.caso('GET /produtos/:id devolve o produto (público)', async () => {
    const r = t.sucesso(await t.http('GET', `/produtos/${prod.id}`));
    t.eq(r.id, prod.id);
    t.eq(Object.keys(r).sort(), CHAVES);
  });
  await t.caso('GET /produtos/:id inexistente → 404', async () => {
    L.erro(await t.http('GET', '/produtos/2000000000'), 404, { mensagem: 'Produto não encontrado.' });
  });
  for (const v of ['abc', '0', '-2', '1.2', '99999999999']) {
    await t.caso(`GET /produtos/${v} → 400 campo=id`, async () => {
      L.erro(await t.http('GET', `/produtos/${v}`), 400, { campo: 'id' });
    });
  }
  await t.caso('GET /produtos/codigo-barras/:codigo acha o produto', async () => {
    t.eq(t.sucesso(await t.http('GET', `/produtos/codigo-barras/${A.codigoBarras}`)).id, A.id);
  });
  await t.caso('GET por código com espaços codificados é aparado', async () => {
    t.eq(t.sucesso(await t.http('GET', `/produtos/codigo-barras/%20${A.codigoBarras}%20`)).id, A.id);
  });
  await t.caso('GET por código inexistente → 404', async () => {
    L.erro(await t.http('GET', '/produtos/codigo-barras/nao-existe-xyz'), 404, { contem: 'Nenhum produto' });
  });
  await t.caso('GET por código com mais de 80 caracteres → 400 campo=codigo', async () => {
    L.erro(await t.http('GET', `/produtos/codigo-barras/${'9'.repeat(81)}`), 400, { campo: 'codigo' });
  });
  await t.caso('GET por código encontra também produto inativo', async () => {
    const p = await t.produto({ ativo: false, codigoBarras: t.unico('inat') });
    t.eq(t.sucesso(await t.http('GET', `/produtos/codigo-barras/${p.codigoBarras}`)).ativo, false);
  });
  await t.caso('GET /produtos/codigo-barras (sem código) cai na rota /:id → 400 campo=id', async () => {
    L.erro(await t.http('GET', '/produtos/codigo-barras'), 400, { campo: 'id' });
  });

  // ---------------------------------------------------------------- atualizar
  // Produto que sofre as edições (PATCH) abaixo.
  const alvo = t.sucesso(await post({ nome: t.unico('alvo'), preco: 3, descricao: 'x', codigoBarras: t.unico('acb'), quantidadeInicial: 4 }), 201);
  await t.caso('PATCH muda só o nome (outros campos intactos)', async () => {
    const novo = t.unico('renomeado');
    const r = t.sucesso(await patch(alvo.id, { nome: novo }));
    t.eq([r.nome, r.preco, r.descricao, r.codigoBarras], [novo, 3, 'x', alvo.codigoBarras]);
  });
  await t.caso('PATCH muda o preço (aceita 2 casas)', async () => {
    t.eq(t.sucesso(await patch(alvo.id, { preco: 4.75 })).preco, 4.75);
  });
  await t.caso('PATCH troca de categoria ativa', async () => {
    const c2 = await t.categoria();
    const r = t.sucesso(await patch(alvo.id, { categoriaId: c2.id }));
    t.eq([r.categoriaId, r.categoriaNome], [c2.id, c2.nome]);
  });
  await t.caso('PATCH para categoria inativa → 400; mas manter a categoria atual é permitido', async () => {
    L.erro(await patch(alvo.id, { categoriaId: catInativa.id }), 400, { campo: 'categoriaId' });
    const p = await t.produto({ categoriaId: catInativa.id });
    t.eq(t.sucesso(await patch(p.id, { categoriaId: catInativa.id, nome: t.unico('mesma') })).categoriaId, catInativa.id);
  });
  await t.caso('PATCH limpa texto opcional com "" ou null (viram vazio no mapper)', async () => {
    const r = t.sucesso(await patch(alvo.id, { descricao: '', imagemUrl: null, codigoBarras: null }));
    t.eq([r.descricao, r.imagemUrl, r.codigoBarras], ['', '', null]);
  });
  await t.caso('PATCH altera código de barras; repetir o PRÓPRIO código é permitido', async () => {
    const novo = t.unico('novocb');
    t.eq(t.sucesso(await patch(alvo.id, { codigoBarras: novo })).codigoBarras, novo);
    t.eq(t.sucesso(await patch(alvo.id, { codigoBarras: novo, nome: t.unico('n2') })).codigoBarras, novo);
  });
  await t.caso('PATCH com código de OUTRO produto → 409 campo=codigoBarras (e nada muda)', async () => {
    const antes = (await t.prisma.produto.findUnique({ where: { id: alvo.id } })).nome;
    L.erro(await patch(alvo.id, { codigoBarras: A.codigoBarras, nome: 'mudou?' }), 409, { campo: 'codigoBarras' });
    t.eq((await t.prisma.produto.findUnique({ where: { id: alvo.id } })).nome, antes);
  });
  await t.caso('PATCH disponivelOnline/Presencial/ativo', async () => {
    const r = t.sucesso(await patch(alvo.id, { disponivelOnline: false, disponivelPresencial: false, ativo: false }));
    t.eq([r.disponivelOnline, r.disponivelPresencial, r.ativo], [false, false, false]);
    t.eq(t.sucesso(await patch(alvo.id, { ativo: true })).ativo, true);
  });
  await t.caso('PATCH não mexe no estoque: quantidade no corpo é ignorada', async () => {
    t.sucesso(await patch(alvo.id, { quantidade: 999, quantidadeInicial: 999, nome: t.unico('semestoque') }));
    t.eq((await t.saldo(alvo.id)).quantidadeFisica, 4);
  });
  await t.caso('PATCH {} → 400 listando os campos permitidos', async () => {
    L.erro(await patch(alvo.id, {}), 400, { campo: null, contem: 'ao menos um campo' });
  });
  for (const [rotulo, body, campo] of [
    ['nome vazio', { nome: '' }, 'nome'], ['preço 0', { preco: 0 }, 'preco'], ['preço com 3 casas', { preco: 1.234 }, 'preco'],
    ['preço texto', { preco: '5' }, 'preco'], ['categoriaId inválido', { categoriaId: 'x' }, 'categoriaId'],
    ['categoria inexistente', { categoriaId: 2000000000 }, 'categoriaId'], ['descricao número', { descricao: 1 }, 'descricao'],
    ['imagemUrl longa', { imagemUrl: 'u'.repeat(501) }, 'imagemUrl'], ['codigoBarras longo', { codigoBarras: 'c'.repeat(81) }, 'codigoBarras'],
    ['ativo texto', { ativo: 'false' }, 'ativo'], ['disponivelOnline nulo', { disponivelOnline: null }, 'disponivelOnline'],
    ['disponivelPresencial texto', { disponivelPresencial: 'x' }, 'disponivelPresencial'],
  ]) {
    await t.caso(`PATCH ${rotulo} → 400 campo=${campo}`, async () => {
      L.erro(await patch(alvo.id, body), 400, { campo });
    });
  }
  await t.caso('PATCH inexistente → 404 / id inválido → 400', async () => {
    L.erro(await patch(2000000000, { nome: 'x' }), 404);
    L.erro(await patch('abc', { nome: 'x' }), 400, { campo: 'id' });
  });
  await t.caso('PATCH sem token → 401', async () => {
    L.erro(await t.http('PATCH', `/produtos/${alvo.id}`, { body: { nome: 'x' } }), 401);
  });
  await t.caso('PATCHs simultâneos em campos diferentes não se sobrescrevem', async () => {
    const novoNome = t.unico('pn');
    await t.paralelo(2, (i) => (i === 0 ? patch(alvo.id, { nome: novoNome }) : patch(alvo.id, { preco: 8.88 })));
    const p = await t.prisma.produto.findUnique({ where: { id: alvo.id } });
    t.eq([p.nome, p.precoVenda.toString()], [novoNome, '8.88']);
  });

  // ---------------------------------------------------------------- inativar
  await t.caso('PATCH /:id/inativar → ativo=false, registro e estoque preservados', async () => {
    const p = t.sucesso(await post({ quantidadeInicial: 3 }), 201);
    t.eq(t.sucesso(await t.http('PATCH', `/produtos/${p.id}/inativar`, { token: adm.token })).ativo, false);
    t.eq((await t.saldo(p.id)).quantidadeFisica, 3);
    t.eq(await t.contarMov(p.id), 1);
  });
  await t.caso('inativar é idempotente e o produto some da lista padrão, mas aparece em ?status=inativo', async () => {
    const p = t.sucesso(await post(), 201);
    await t.http('PATCH', `/produtos/${p.id}/inativar`, { token: adm.token });
    t.eq(t.sucesso(await t.http('PATCH', `/produtos/${p.id}/inativar`, { token: adm.token })).ativo, false);
    t.eq(t.sucesso(await t.http('GET', `/produtos?busca=${encodeURIComponent(p.nome)}`)), []);
    t.eq(t.sucesso(await t.http('GET', `/produtos?status=inativo&busca=${encodeURIComponent(p.nome)}`)).length, 1);
  });
  await t.caso('inativar inexistente → 404; id inválido → 400; sem token → 401', async () => {
    L.erro(await t.http('PATCH', '/produtos/2000000000/inativar', { token: adm.token }), 404);
    L.erro(await t.http('PATCH', '/produtos/x/inativar', { token: adm.token }), 400, { campo: 'id' });
    L.erro(await t.http('PATCH', `/produtos/${alvo.id}/inativar`), 401);
  });
  await t.caso('não existe DELETE de produto (404 de rota)', async () => {
    L.erro(await t.http('DELETE', `/produtos/${alvo.id}`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
  });
  await t.caso('produto inativo pode ser reativado por PATCH ativo=true', async () => {
    const p = t.sucesso(await post(), 201);
    await t.http('PATCH', `/produtos/${p.id}/inativar`, { token: adm.token });
    t.eq(t.sucesso(await patch(p.id, { ativo: true })).ativo, true);
  });

  // ---------------------------------------------------------------- permissões e divergências
  // Permissões: criar, editar (inclui preço) e inativar produto é só do administrador; a leitura (cardápio) segue pública.
  for (const [nome, u] of [['caixa', cx], ['atendente', at]]) {
    await t.caso(`${nome} não cria produto → 403`, async () => {
      const antes = await t.prisma.produto.count();
      L.erro(await post({}, u.token), 403, { campo: null, contem: 'permissão' });
      t.eq(await t.prisma.produto.count(), antes);
    });
    await t.caso(`${nome} não altera preço → 403 (o preço não muda)`, async () => {
      const antes = await t.prisma.produto.findUnique({ where: { id: alvo.id } });
      L.erro(await patch(alvo.id, { preco: 9 }, u.token), 403);
      t.eq(String((await t.prisma.produto.findUnique({ where: { id: alvo.id } })).precoVenda), String(antes.precoVenda));
    });
    await t.caso(`${nome} não inativa produto → 403 (ele segue ativo)`, async () => {
      const p = t.sucesso(await post(), 201);
      L.erro(await t.http('PATCH', `/produtos/${p.id}/inativar`, { token: u.token }), 403);
      t.eq((await t.prisma.produto.findUnique({ where: { id: p.id } })).ativo, true);
    });
  }
  // [DIVERGE-PDF] D14 — o PDF prevê custo, ncm e cfop_padrao em PRODUTO.
  await t.diverge('produto não tem custo, ncm nem cfop_padrao (PDF prevê esses campos)', async () => {
    const p = t.sucesso(await post(), 201);
    t.verdade(!('custo' in p) && !('ncm' in p) && !('cfopPadrao' in p));
  });
  // [DIVERGE-PDF] D13 — o PDF define quantidades como NUMERIC(12,3).
  await t.diverge('quantidade inicial fracionária é rejeitada (PDF: NUMERIC(12,3))', async () => {
    L.erro(await post({ quantidadeInicial: 1.5 }), 400, { campo: 'quantidadeInicial' });
  });
  // [DIVERGE-PDF] D14 — PDF: preco_venda NUMERIC(12,2); a API limita em Decimal(10,2).
  await t.diverge('preço é Decimal(10,2): teto de 99.999.999,99 (PDF: NUMERIC(12,2))', async () => {
    L.erro(await post({ preco: 100000000 }), 400, { campo: 'preco' });
  });
  // [DIVERGE-PDF] D14 — PDF: estoque_fisico e estoque_minimo em PRODUTO; aqui ficam na tabela estoque (decisão do CLAUDE.md).
  await t.diverge('estoque físico/mínimo vivem em tabela própria, não no produto (PDF os põe em PRODUTO; decisão registrada no CLAUDE.md)', async () => {
    const p = t.sucesso(await post(), 201);
    t.verdade(!('estoqueFisico' in p) && !('estoqueMinimo' in p));
  });
  // [DIVERGE-PDF] D15 — o PDF exige rastreio de alterações de preço (auditoria).
  await t.diverge('criar/alterar preço de produto não gera auditoria (PDF exige rastreio de alterações de preço)', async () => {
    const p = t.sucesso(await post(), 201);
    t.sucesso(await patch(p.id, { preco: 99 }));
    const tabelas = await t.prisma.$queryRaw`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%auditoria%'`;
    t.eq(tabelas.length, 0);
  });
});
