'use strict';
// Saldos de estoque: GET /estoque e PATCH|PUT /estoque/:produtoId (estoque mínimo).
const L = require('./_lib.cjs');
const t = L.suite('saldos');

const CHAVES = ['id', 'produto', 'produtoId', 'quantidadeDisponivel', 'quantidadeFisica', 'quantidadeReservada', 'estoqueMinimo', 'situacao'].sort();

L.executar(t, async () => {
  // Usuários de teste, um por perfil: criados pelo próprio teste (senha aleatória, nada do .env) e apagados no fim pelo prefixo da suíte.
  const adm = await t.usuario('ADMINISTRADOR');
  const cx = await t.usuario('CAIXA');
  const at = await t.usuario('ATENDENTE');
  const cat = await t.categoria();
  // Lista de saldos restrita aos produtos desta suíte (busca pelo prefixo).
  const lista = async (qs = '', token = adm.token) => t.sucesso(await t.http('GET', `/estoque?busca=${encodeURIComponent(t.prefixo)}${qs}`, { token }));
  const minimo = (id, body, metodo = 'PATCH', token = adm.token) => t.http(metodo, `/estoque/${id}`, { token, body });
  const semEstoque = (extra = {}) => t.prisma.produto.create({ data: { nome: t.unico('sem'), precoVenda: '5.00', categoriaId: cat.id, ...extra } });

  // Massa: ok (acima do mínimo), baixo (igual ao mínimo), zerado e inativo.
  const ok = await t.produto({ nome: t.unico('a-ok'), qtd: 20, minimo: 5, categoriaId: cat.id, codigoBarras: t.unico('scb') });
  const baixo = await t.produto({ nome: t.unico('b-baixo'), qtd: 5, minimo: 5, categoriaId: cat.id });
  const zerado = await t.produto({ nome: t.unico('c-zerado'), qtd: 0, minimo: 5, categoriaId: cat.id });
  const inativo = await t.produto({ nome: t.unico('d-inativo'), qtd: 3, ativo: false, categoriaId: cat.id });

  // ---------------------------------------------------------------- formato
  await t.caso('GET /estoque devolve o formato do contrato de saldos', async () => {
    const r = await lista();
    const s = r.find((x) => x.produtoId === ok.id);
    t.eq(Object.keys(s).sort(), CHAVES);
    t.eq(s.id, s.produtoId);
    t.eq(s.produto, { id: ok.id, nome: ok.nome, codigoBarras: ok.codigoBarras });
    t.eq([s.quantidadeFisica, s.quantidadeReservada, s.quantidadeDisponivel, s.estoqueMinimo, s.situacao], [20, 0, 20, 5, 'ok']);
  });
  await t.caso('lista ordenada por nome do produto', async () => {
    t.eq((await lista()).map((s) => s.produtoId), [ok.id, baixo.id, zerado.id]);
  });
  await t.caso('por padrão traz só produtos ATIVOS', async () => {
    t.verdade(!(await lista()).some((s) => s.produtoId === inativo.id));
  });
  await t.caso('?status=inativo traz só inativos; ?status=todos traz todos', async () => {
    t.eq((await lista('&status=inativo')).map((s) => s.produtoId), [inativo.id]);
    const base = [ok.id, baixo.id, zerado.id, inativo.id];
    const so = async (qs) => (await lista(qs)).filter((x) => base.includes(x.produtoId)).length;
    t.eq(await so('&status=todos'), 4);
    t.eq(await so('&status=ativo'), 3);
    t.eq(await so('&status='), 3);
  });
  await t.caso('?status inválido → 400 campo=status', async () => {
    L.erro(await t.http('GET', '/estoque?status=xx', { token: adm.token }), 400, { campo: 'status' });
  });

  // ---------------------------------------------------------------- situação
  // Cria um produto com a combinação físico/reservado/mínimo e devolve o saldo calculado pela API.
  const situacao = async (qtd, reservada, min) => {
    const p = await t.produto({ qtd, reservada, minimo: min });
    return (await lista('&status=todos')).find((s) => s.produtoId === p.id);
  };
  // Tabela da regra de situação: disponível = max(0, físico − reservado); 0 → zerado; <= mínimo → baixo; senão ok.
  for (const [qtd, res, min, disp, esperado] of [
    [10, 0, 0, 10, 'ok'], [1, 0, 0, 1, 'ok'], [0, 0, 0, 0, 'zerado'], [0, 0, 9, 0, 'zerado'],
    [5, 0, 5, 5, 'baixo'], [4, 0, 5, 4, 'baixo'], [6, 0, 5, 6, 'ok'], [1, 0, 5, 1, 'baixo'],
    [10, 5, 5, 5, 'baixo'], [10, 4, 5, 6, 'ok'], [10, 10, 5, 0, 'zerado'], [3, 8, 0, 0, 'zerado'],
  ]) {
    await t.caso(`físico=${qtd} reservado=${res} mínimo=${min} → disponível ${disp}, situação "${esperado}"`, async () => {
      const s = await situacao(qtd, res, min);
      t.eq([s.quantidadeDisponivel, s.situacao], [disp, esperado]);
    });
  }
  await t.caso('reservado maior que o físico: disponível fica 0 (nunca negativo)', async () => {
    t.eq((await situacao(2, 9, 0)).quantidadeDisponivel, 0);
  });
  await t.caso('produto sem linha de estoque aparece com tudo zerado e situação "zerado"', async () => {
    const p = await semEstoque();
    const s = (await lista()).find((x) => x.produtoId === p.id);
    t.eq([s.quantidadeFisica, s.quantidadeReservada, s.quantidadeDisponivel, s.estoqueMinimo, s.situacao], [0, 0, 0, 0, 'zerado']);
  });
  await t.caso('?somenteBaixoOuZerado=true traz só baixo e zerado', async () => {
    const r = await lista('&somenteBaixoOuZerado=true');
    t.verdade(r.length >= 2 && r.every((s) => s.situacao !== 'ok'));
    t.verdade(r.some((s) => s.produtoId === baixo.id) && r.some((s) => s.produtoId === zerado.id));
  });
  // O filtro somenteBaixoOuZerado aceita true/false (qualquer caixa, aparado) ou vazio.
  for (const v of ['false', 'FALSE', '', ' true ']) {
    await t.caso(`?somenteBaixoOuZerado='${v}' é aceito`, async () => {
      t.verdade(Array.isArray(await lista(`&somenteBaixoOuZerado=${encodeURIComponent(v)}`)));
    });
  }
  // Valores que não são true/false literais são rejeitados com 400 campo=somenteBaixoOuZerado.
  for (const v of ['1', 'sim', 'yes', 'talvez']) {
    await t.caso(`?somenteBaixoOuZerado='${v}' → 400 campo=somenteBaixoOuZerado`, async () => {
      L.erro(await t.http('GET', `/estoque?somenteBaixoOuZerado=${v}`, { token: adm.token }), 400, { campo: 'somenteBaixoOuZerado' });
    });
  }
  await t.caso('?busca por nome (insensível a maiúsculas) e por código de barras', async () => {
    const base = [ok.id, baixo.id, zerado.id];
    t.eq((await lista()).filter((x) => base.includes(x.produtoId)).length, 3);
    const porNome = t.sucesso(await t.http('GET', `/estoque?busca=${encodeURIComponent((t.prefixo + 'B-BAIXO').toUpperCase())}`, { token: adm.token }));
    t.eq(porNome.map((s) => s.produtoId), [baixo.id]);
    const porCodigo = t.sucesso(await t.http('GET', `/estoque?busca=${encodeURIComponent(ok.codigoBarras)}`, { token: adm.token }));
    t.eq(porCodigo.map((s) => s.produtoId), [ok.id]);
  });
  await t.caso('?busca sem resultado → []', async () => {
    t.eq(t.sucesso(await t.http('GET', `/estoque?busca=${t.prefixo}nada_zzz`, { token: adm.token })), []);
  });
  await t.caso('o saldo acompanha as movimentações feitas pela API', async () => {
    const p = await t.produto({ nome: t.unico('mov'), qtd: 10, minimo: 4 });
    t.sucesso(await t.http('POST', '/movimentacoes', { token: adm.token, body: { produtoId: p.id, tipo: 'SAIDA', quantidade: 7 } }), 201);
    const s = (await lista()).find((x) => x.produtoId === p.id);
    t.eq([s.quantidadeFisica, s.situacao], [3, 'baixo']);
  });
  await t.caso('GET /estoque sem token → 401 (não é público)', async () => {
    L.erro(await t.http('GET', '/estoque'), 401);
  });
  // Regra decidida: os três perfis consultam os saldos (leitura); alterar o mínimo é só do administrador (ver abaixo).
  await t.caso('caixa e atendente também consultam saldos (200)', async () => {
    await lista('', cx.token);
    await lista('', at.token);
  });

  // ---------------------------------------------------------------- estoque mínimo
  // PATCH e PUT /estoque/:produtoId são equivalentes (alias para o frontend).
  for (const metodo of ['PATCH', 'PUT']) {
    await t.caso(`${metodo} /estoque/:produtoId atualiza o mínimo e devolve o saldo`, async () => {
      const p = await t.produto({ qtd: 8 });
      const s = t.sucesso(await minimo(p.id, { estoqueMinimo: 12 }, metodo));
      t.eq(Object.keys(s).sort(), CHAVES);
      t.eq([s.estoqueMinimo, s.quantidadeFisica, s.situacao], [12, 8, 'baixo']);
      t.eq((await t.saldo(p.id)).estoqueMinimo, 12);
    });
  }
  await t.caso('mínimo 0 é aceito; mínimo 2147483647 é aceito', async () => {
    const p = await t.produto({ qtd: 1, minimo: 3 });
    t.eq(t.sucesso(await minimo(p.id, { estoqueMinimo: 0 })).situacao, 'ok');
    t.eq(t.sucesso(await minimo(p.id, { estoqueMinimo: 2147483647 })).estoqueMinimo, 2147483647);
  });
  await t.caso('mudar o mínimo não altera físico nem reservado nem gera movimentação', async () => {
    const p = await t.produto({ qtd: 6, reservada: 2 });
    t.sucesso(await minimo(p.id, { estoqueMinimo: 9 }));
    const e = await t.saldo(p.id);
    t.eq([e.quantidadeFisica, e.quantidadeReservada], [6, 2]);
    t.eq(await t.contarMov(p.id), 0);
  });
  await t.caso('produto sem linha de estoque: cria a linha com o mínimo', async () => {
    const p = await semEstoque();
    const s = t.sucesso(await minimo(p.id, { estoqueMinimo: 4 }));
    t.eq([s.estoqueMinimo, s.quantidadeFisica, s.situacao], [4, 0, 'zerado']);
  });
  await t.caso('produto inativo também aceita novo mínimo (comportamento atual)', async () => {
    t.sucesso(await minimo(inativo.id, { estoqueMinimo: 2 }));
  });
  // Matriz de estoqueMinimo inválido: precisa ser inteiro de 0 até 2147483647.
  for (const [rotulo, body] of [
    ['ausente', {}], ['negativo', { estoqueMinimo: -1 }], ['fracionário', { estoqueMinimo: 1.5 }], ['texto', { estoqueMinimo: '5' }],
    ['nulo', { estoqueMinimo: null }], ['booleano', { estoqueMinimo: true }], ['acima de int32', { estoqueMinimo: 2147483648 }],
  ]) {
    await t.caso(`estoqueMinimo ${rotulo} → 400 campo=estoqueMinimo`, async () => {
      L.erro(await minimo(ok.id, body), 400, { campo: 'estoqueMinimo' });
    });
  }
  await t.caso('sem corpo → 400', async () => {
    L.erro(await t.http('PATCH', `/estoque/${ok.id}`, { token: adm.token }), 400, { campo: 'estoqueMinimo' });
  });
  await t.caso('produto inexistente → 404', async () => {
    L.erro(await minimo(2000000000, { estoqueMinimo: 1 }), 404, { mensagem: 'Produto não encontrado.' });
  });
  for (const id of ['abc', '0', '-1', '1.5']) {
    await t.caso(`produtoId inválido '${id}' → 400 campo=produtoId`, async () => {
      L.erro(await minimo(id, { estoqueMinimo: 1 }), 400, { campo: 'produtoId' });
    });
  }
  await t.caso('PATCH/PUT sem token → 401', async () => {
    L.erro(await t.http('PATCH', `/estoque/${ok.id}`, { body: { estoqueMinimo: 1 } }), 401);
    L.erro(await t.http('PUT', `/estoque/${ok.id}`, { body: { estoqueMinimo: 1 } }), 401);
  });
  await t.caso('DELETE /estoque/:id não existe (404 de rota)', async () => {
    L.erro(await t.http('DELETE', `/estoque/${ok.id}`, { token: adm.token }), 404, { contem: 'Rota não encontrada' });
  });
  // Permissões: o mínimo é só do administrador (PATCH e PUT), sem alterar o valor.
  for (const [nome, u] of [['caixa', cx], ['atendente', at]]) {
    for (const metodo of ['PATCH', 'PUT']) {
      await t.caso(`${nome} não altera o estoque mínimo (${metodo}) → 403`, async () => {
        const antes = (await t.prisma.estoque.findUnique({ where: { produtoId: ok.id } })).estoqueMinimo;
        L.erro(await minimo(ok.id, { estoqueMinimo: 77 }, metodo, u.token), 403, { campo: null, contem: 'permissão' });
        t.eq((await t.prisma.estoque.findUnique({ where: { produtoId: ok.id } })).estoqueMinimo, antes);
      });
    }
  }
  await t.caso('administrador altera o estoque mínimo (PATCH e PUT)', async () => {
    t.sucesso(await minimo(ok.id, { estoqueMinimo: 5 }, 'PATCH'));
    t.sucesso(await minimo(ok.id, { estoqueMinimo: 6 }, 'PUT'));
  });
  await t.caso('atualizações simultâneas do mínimo: o valor final é um dos enviados e a linha é única', async () => {
    const p = await semEstoque();
    const valores = [1, 2, 3, 4, 5, 6, 7, 8];
    const rs = await t.paralelo(valores.length, (i) => minimo(p.id, { estoqueMinimo: valores[i] }));
    t.verdade(rs.every((r) => r.status === 200), rs.map((r) => r.status).join());
    t.eq(await t.prisma.estoque.count({ where: { produtoId: p.id } }), 1);
    t.verdade(valores.includes((await t.saldo(p.id)).estoqueMinimo));
  });
  // Rollback: a linha de estoque é criada dentro da transação; se o UPDATE falha, a criação também é desfeita.
  await t.caso('rollback: falha no UPDATE do mínimo desfaz também a linha de estoque criada na transação', async () => {
    const p = await semEstoque();
    await t.comConstraint('estoque', 'chk_tc_sld', `"estoqueMinimo" <> 777`, async () => {
      t.eq((await minimo(p.id, { estoqueMinimo: 777 })).status, 500);
    });
    t.eq(await t.prisma.estoque.count({ where: { produtoId: p.id } }), 0);
  });
  await t.caso('rollback: com linha existente o mínimo antigo é preservado', async () => {
    const p = await t.produto({ minimo: 3 });
    await t.comConstraint('estoque', 'chk_tc_sld2', `"estoqueMinimo" <> 778`, async () => {
      t.eq((await minimo(p.id, { estoqueMinimo: 778 })).status, 500);
    });
    t.eq((await t.saldo(p.id)).estoqueMinimo, 3);
  });

  // ---------------------------------------------------------------- divergências
  // [DIVERGE-PDF] D11 — PDF: disponível = físico − soma das reservas ativas (RESERVA_ESTOQUE). Aqui é um contador armazenado e a entidade não existe.
  await t.diverge('quantidadeReservada é um contador armazenado na tabela estoque (PDF: disponível = físico − soma das RESERVA_ESTOQUE ativas; a entidade não existe)', async () => {
    const cols = await t.prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name='estoque' AND column_name='quantidadeReservada'`;
    t.eq(cols.length, 1);
    const reservas = await t.prisma.$queryRaw`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%reserva%'`;
    t.eq(reservas.length, 0);
  });
  // [DIVERGE-PDF] D13/D14 — PDF: estoque_minimo NUMERIC(12,3) dentro de PRODUTO.
  await t.diverge('estoque mínimo é inteiro e vive em tabela própria (PDF: NUMERIC(12,3) em PRODUTO)', async () => {
    L.erro(await minimo(ok.id, { estoqueMinimo: 1.5 }), 400, { campo: 'estoqueMinimo' });
  });
});
