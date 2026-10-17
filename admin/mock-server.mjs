// Servidor de MENTIRA para testar o painel sem o backend real (sem banco, sem instalar nada).
// Imita as rotas, os status HTTP e o formato de erro { mensagem, campo? } do backend.
// Os dados ficam só na memória: ao reiniciar (Ctrl+C e rodar de novo), tudo volta ao começo.
//
// Rode com:  node mock-server.mjs
// Logins de teste:
//   admin / admin123   (administrador)
//   caixa / 123456     (caixa)
//   atendente / 123456 (atendente)
//   paula / 123456     (atendente INATIVA: o login deve ser recusado)

import http from 'node:http';

const PORT = 3000;
const ATRASO_MS = 150; // um respiro para dar para ver os estados de "Carregando…"

/* ---------- Dados iniciais ---------- */

const diasAtras = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

const usuarios = [
  { id: 1, nome: 'Administrador', login: 'admin', senha: 'admin123', perfil: 'administrador', ativo: true, criadoEm: diasAtras(60) },
  { id: 2, nome: 'Carla Souza', login: 'caixa', senha: '123456', perfil: 'caixa', ativo: true, criadoEm: diasAtras(40) },
  { id: 3, nome: 'André Lima', login: 'atendente', senha: '123456', perfil: 'atendente', ativo: true, criadoEm: diasAtras(30) },
  { id: 4, nome: 'Paula Mendes', login: 'paula', senha: '123456', perfil: 'atendente', ativo: false, criadoEm: diasAtras(20) },
];

const categorias = [
  { id: 1, nome: 'Salgados', ativa: true },
  { id: 2, nome: 'Bebidas', ativa: true },
  { id: 3, nome: 'Doces', ativa: true },
  { id: 4, nome: 'Almoço', ativa: true },
  { id: 5, nome: 'Sazonais', ativa: false },
];

const produtos = [
  { id: 1, nome: 'Coxinha de frango', descricao: 'Massa crocante, recheio cremoso.', preco: 7.5, categoriaId: 1, codigoBarras: '7890000000011', fisica: 40, reservada: 0, presencial: true, online: true, ativo: true },
  { id: 2, nome: 'Pastel de queijo', descricao: '', preco: 8, categoriaId: 1, codigoBarras: null, fisica: 25, reservada: 2, presencial: true, online: true, ativo: true },
  { id: 3, nome: 'Suco de laranja 300 ml', descricao: 'Feito na hora.', preco: 6.5, categoriaId: 2, codigoBarras: '7890000000035', fisica: 18, reservada: 0, presencial: true, online: false, ativo: true },
  { id: 4, nome: 'Refrigerante lata', descricao: '', preco: 5, categoriaId: 2, codigoBarras: '7890000000042', fisica: 0, reservada: 0, presencial: true, online: true, ativo: true },
  { id: 5, nome: 'Brigadeiro', descricao: 'Unidade.', preco: 3.5, categoriaId: 3, codigoBarras: null, fisica: 60, reservada: 0, presencial: true, online: true, ativo: true },
  { id: 6, nome: 'Prato feito do dia', descricao: 'Arroz, feijão, proteína e salada.', preco: 24.9, categoriaId: 4, codigoBarras: null, fisica: 12, reservada: 0, presencial: false, online: true, ativo: true },
  { id: 7, nome: 'Torta de limão (fatia)', descricao: '', preco: 9.9, categoriaId: 3, codigoBarras: null, fisica: 7, reservada: 0, presencial: true, online: true, ativo: false },
  { id: 8, nome: 'Panetone', descricao: 'Edição de fim de ano.', preco: 32, categoriaId: 5, codigoBarras: '7890000000080', fisica: 5, reservada: 0, presencial: true, online: true, ativo: true },
].map((p) => ({ ...p, imagemUrl: '', criadoEm: diasAtras(25), minimo: { 1: 10, 2: 30, 3: 5, 4: 5, 5: 20, 6: 12, 7: 0, 8: 2 }[p.id] ?? 0 }));

// Histórico de estoque de exemplo (o saldo dos produtos acima já considera estes lançamentos).
const movimentacoes = [];
const lancar = (produtoId, usuarioId, tipo, quantidade, motivo, dias) =>
  movimentacoes.push({ id: movimentacoes.length + 1, produtoId, usuarioId, tipo, quantidade, motivo, criadoEm: diasAtras(dias) });
produtos.forEach((p) => {
  if (p.id === 3) { lancar(3, 1, 'ENTRADA', 20, 'Estoque inicial', 25); lancar(3, 3, 'PERDA', 2, 'Copos quebrados', 10); }
  else if (p.id === 5) { lancar(5, 1, 'ENTRADA', 65, 'Estoque inicial', 25); lancar(5, 2, 'AJUSTE', -5, 'Contagem física', 7); }
  else lancar(p.id, 1, 'ENTRADA', p.fisica, 'Estoque inicial', 25);
});

const STATUS = [
  'ABERTO', 'ENVIADO_AO_CAIXA', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'RECEBIDO_PELA_CANTINA', 'EM_SEPARACAO',
  'PRONTO_PARA_RETIRADA', 'ENTREGUE', 'RETIRADO', 'CANCELADO', 'ESTORNADO',
];

const arred = (n) => Math.round(n * 100) / 100;

// 27 pedidos de exemplo (dá 2 páginas na listagem).
const pedidos = Array.from({ length: 27 }, (_, i) => {
  const id = i + 1;
  const itens = [0, 1, 2].slice(0, (i % 3) + 1).map((k, idx) => {
    const p = produtos[(i + k) % 6];
    const quantidade = ((i + idx) % 3) + 1;
    return { id: id * 10 + idx, produtoId: p.id, nome: p.nome, imagemUrl: '', quantidade, precoUnitario: p.preco, subtotal: arred(p.preco * quantidade) };
  });
  const total = arred(itens.reduce((s, it) => s + it.subtotal, 0));
  const status = STATUS[i % STATUS.length];
  const pagamentos = ['AGUARDANDO_PAGAMENTO', 'ABERTO', 'ENVIADO_AO_CAIXA'].includes(status)
    ? []
    : [{ id: id, formaPagamento: ['PIX', 'CARTAO', 'DINHEIRO'][i % 3], statusPagamento: status === 'ESTORNADO' ? 'ESTORNADO' : status === 'CANCELADO' ? 'CANCELADO' : 'APROVADO', valor: total, identificadorExterno: i % 3 === 0 ? `pix-${1000 + id}` : null, criadoEm: diasAtras(27 - i) }];
  return { id, canal: i % 2 === 0 ? 'PRESENCIAL' : 'ONLINE', status, total, usuarioId: 1 + (i % 3), clienteId: i % 2 === 0 ? null : 100 + id, criadoEm: diasAtras(27 - i), itens, pagamentos };
}).reverse();

/* ---------- Utilidades ---------- */

class ApiErro extends Error {
  constructor(status, mensagem, campo) {
    super(mensagem);
    this.status = status;
    this.campo = campo;
  }
}

// O módulo de estoque do backend responde { erro } em vez de { mensagem, campo }.
class ErroSimples extends ApiErro {}

const proximoId = (lista) => lista.reduce((m, x) => Math.max(m, x.id), 0) + 1;

const paraUsuario = ({ senha, ...resto }) => resto;

const paraProduto = (p) => ({
  id: p.id,
  nome: p.nome,
  descricao: p.descricao ?? '',
  preco: p.preco,
  imagemUrl: p.imagemUrl ?? '',
  categoriaId: p.categoriaId,
  categoriaNome: categorias.find((c) => c.id === p.categoriaId)?.nome ?? '',
  disponivelOnline: p.online,
  quantidadeDisponivel: Math.max(0, p.fisica - p.reservada),
  codigoBarras: p.codigoBarras,
  disponivelPresencial: p.presencial,
  ativo: p.ativo,
  criadoEm: p.criadoEm,
});

function parseId(valor, campo = 'id') {
  if (!/^\d+$/.test(String(valor))) throw new ApiErro(400, `O campo '${campo}' deve ser um número inteiro positivo.`, campo);
  return Number(valor);
}

function autenticar(req) {
  const cabecalho = req.headers.authorization;
  if (!cabecalho) throw new ApiErro(401, 'Token de autenticação não informado.');
  const [esquema, token] = cabecalho.split(' ');
  const m = /^mock-(\d+)$/.exec(token ?? '');
  if (esquema?.toLowerCase() !== 'bearer' || !m) throw new ApiErro(401, 'Token inválido.');
  const usuario = usuarios.find((u) => u.id === Number(m[1]));
  if (!usuario || !usuario.ativo) throw new ApiErro(401, 'Sessão inválida. Faça login novamente.');
  return usuario;
}

function exigirAdministrador(usuario) {
  if (usuario.perfil !== 'administrador') throw new ApiErro(403, 'Você não tem permissão para realizar esta ação.');
}

function lerPerfil(valor) {
  const p = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  if (!['atendente', 'caixa', 'administrador'].includes(p)) {
    throw new ApiErro(400, 'Perfil inválido. Use: atendente, caixa ou administrador.', 'perfil');
  }
  return p;
}

function garantirUltimoAdministrador(usuario, novo) {
  const era = usuario.perfil === 'administrador' && usuario.ativo;
  const sera = novo.perfil === 'administrador' && novo.ativo;
  if (!era || sera) return;
  const outros = usuarios.filter((u) => u.perfil === 'administrador' && u.ativo && u.id !== usuario.id).length;
  if (outros === 0) throw new ApiErro(409, 'Não é possível inativar nem alterar o perfil do último administrador ativo.');
}

function lerBooleano(valor, campo) {
  if (typeof valor !== 'boolean') throw new ApiErro(400, `O campo '${campo}' deve ser verdadeiro ou falso.`, campo);
  return valor;
}

function lerTextoOpcional(valor, campo, max) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ApiErro(400, `O campo '${campo}' deve ser um texto.`, campo);
  const t = valor.trim();
  if (t === '') return null;
  if (t.length > max) throw new ApiErro(400, `O campo '${campo}' aceita no máximo ${max} caracteres.`, campo);
  return t;
}

function lerNomeProduto(valor) {
  if (typeof valor !== 'string' || valor.trim() === '' || valor.trim().length > 140) {
    throw new ApiErro(400, 'Informe o nome do produto (até 140 caracteres).', 'nome');
  }
  return valor.trim();
}

function lerPreco(valor) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new ApiErro(400, 'O preço deve ser um número (ex.: 12.5).', 'preco');
  if (valor <= 0 || valor > 99999999.99) throw new ApiErro(400, 'O preço deve ser maior que zero.', 'preco');
  if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6) throw new ApiErro(400, 'O preço deve ter no máximo 2 casas decimais.', 'preco');
  return valor;
}

function garantirCategoriaAtiva(categoriaId) {
  const c = categorias.find((x) => x.id === categoriaId);
  if (!c) throw new ApiErro(400, 'Categoria não encontrada.', 'categoriaId');
  if (!c.ativa) throw new ApiErro(400, 'A categoria informada está inativa.', 'categoriaId');
}

function garantirCodigoLivre(codigo, ignorarId) {
  const emUso = produtos.find((p) => p.codigoBarras === codigo);
  if (emUso && emUso.id !== ignorarId) throw new ApiErro(409, 'Já existe um produto com esse código de barras.', 'codigoBarras');
}

/* ---------- Rotas ---------- */

// Cada rota: [método, expressão do caminho, função(req, corpo, params, consulta)] -> { status?, corpo }
const rotas = [];
const rota = (metodo, caminho, funcao) => rotas.push([metodo, new RegExp(`^${caminho}$`), funcao]);

rota('GET', '/health', () => ({ corpo: { status: 'ok (mock)', totalUsuarios: usuarios.length } }));

// --- auth ---
rota('POST', '/interno/login', (req, body) => {
  const { login, senha } = body ?? {};
  if (typeof login !== 'string' || typeof senha !== 'string' || login.trim() === '' || senha === '') {
    throw new ApiErro(400, 'Informe login e senha.');
  }
  const u = usuarios.find((x) => x.login === login.trim());
  if (!u || !u.ativo || u.senha !== senha) throw new ApiErro(401, 'Login ou senha inválidos.');
  return { corpo: { usuario: paraUsuario(u), token: `mock-${u.id}` } };
});

rota('GET', '/interno/me', (req) => ({ corpo: paraUsuario(autenticar(req)) }));

// --- usuários ---
rota('GET', '/interno/usuarios', (req, body, p, q) => {
  autenticar(req);
  let lista = usuarios;
  const busca = (q.get('busca') ?? '').trim().toLowerCase();
  if (busca) lista = lista.filter((u) => u.nome.toLowerCase().includes(busca) || u.login.toLowerCase().includes(busca));
  if (q.get('perfil')) {
    const perfil = lerPerfil(q.get('perfil'));
    lista = lista.filter((u) => u.perfil === perfil);
  }
  const status = q.get('status');
  if (status) {
    if (status !== 'ativo' && status !== 'inativo') throw new ApiErro(400, 'Status inválido. Use: ativo ou inativo.', 'status');
    lista = lista.filter((u) => u.ativo === (status === 'ativo'));
  }
  return { corpo: [...lista].sort((a, b) => a.nome.localeCompare(b.nome)).map(paraUsuario) };
});

rota('POST', '/interno/usuarios', (req, body) => {
  exigirAdministrador(autenticar(req));
  const { nome, login, senha, perfil } = body ?? {};
  if (typeof nome !== 'string' || nome.trim() === '' || nome.trim().length > 120) throw new ApiErro(400, 'Informe o nome (até 120 caracteres).', 'nome');
  if (typeof login !== 'string' || login.trim() === '' || login.trim().length > 120) throw new ApiErro(400, 'Informe o login (até 120 caracteres).', 'login');
  if (typeof senha !== 'string' || senha.length < 6) throw new ApiErro(400, 'A senha deve ter pelo menos 6 caracteres.', 'senha');
  const perfilLido = lerPerfil(perfil);
  if (usuarios.some((u) => u.login === login.trim())) throw new ApiErro(409, 'Já existe um usuário com esse login.', 'login');
  const novo = { id: proximoId(usuarios), nome: nome.trim(), login: login.trim(), senha, perfil: perfilLido, ativo: true, criadoEm: new Date().toISOString() };
  usuarios.push(novo);
  return { status: 201, corpo: paraUsuario(novo) };
});

rota('GET', '/interno/usuarios/(\\d+)', (req, body, p) => {
  autenticar(req);
  const u = usuarios.find((x) => x.id === parseId(p[1]));
  if (!u) throw new ApiErro(404, 'Usuário não encontrado.');
  return { corpo: paraUsuario(u) };
});

rota('PATCH', '/interno/usuarios/(\\d+)', (req, body, p) => {
  exigirAdministrador(autenticar(req));
  const u = usuarios.find((x) => x.id === parseId(p[1]));
  if (!u) throw new ApiErro(404, 'Usuário não encontrado.');
  const { nome, senha, perfil, ativo } = body ?? {};
  const mudancas = {};
  if (nome !== undefined) {
    if (typeof nome !== 'string' || nome.trim() === '' || nome.trim().length > 120) throw new ApiErro(400, 'Informe o nome (até 120 caracteres).', 'nome');
    mudancas.nome = nome.trim();
  }
  if (senha !== undefined) {
    if (typeof senha !== 'string' || senha.length < 6) throw new ApiErro(400, 'A senha deve ter pelo menos 6 caracteres.', 'senha');
    mudancas.senha = senha;
  }
  if (perfil !== undefined) mudancas.perfil = lerPerfil(perfil);
  if (ativo !== undefined) mudancas.ativo = lerBooleano(ativo, 'ativo');
  if (Object.keys(mudancas).length === 0) throw new ApiErro(400, 'Informe ao menos um campo para atualizar: nome, senha, perfil ou ativo.');
  garantirUltimoAdministrador(u, { perfil: mudancas.perfil ?? u.perfil, ativo: mudancas.ativo ?? u.ativo });
  Object.assign(u, mudancas);
  return { corpo: paraUsuario(u) };
});

rota('PATCH', '/interno/usuarios/(\\d+)/inativar', (req, body, p) => {
  exigirAdministrador(autenticar(req));
  const u = usuarios.find((x) => x.id === parseId(p[1]));
  if (!u) throw new ApiErro(404, 'Usuário não encontrado.');
  garantirUltimoAdministrador(u, { perfil: u.perfil, ativo: false });
  u.ativo = false;
  return { corpo: paraUsuario(u) };
});

// --- categorias (GET público, o resto exige token) ---
rota('GET', '/categorias', (req, body, p, q) => {
  let lista = categorias;
  const busca = (q.get('busca') ?? '').trim().toLowerCase();
  if (busca) lista = lista.filter((c) => c.nome.toLowerCase().includes(busca));
  const status = q.get('status');
  if (!status || status === 'ativa') lista = lista.filter((c) => c.ativa);
  else if (status === 'inativa') lista = lista.filter((c) => !c.ativa);
  else if (status !== 'todas') throw new ApiErro(400, 'Status inválido. Use: ativa, inativa ou todas.', 'status');
  return { corpo: [...lista].sort((a, b) => a.nome.localeCompare(b.nome)) };
});

rota('POST', '/categorias', (req, body) => {
  autenticar(req);
  const { nome } = body ?? {};
  if (typeof nome !== 'string' || nome.trim() === '' || nome.trim().length > 80) throw new ApiErro(400, 'Informe o nome da categoria (até 80 caracteres).', 'nome');
  const nova = { id: proximoId(categorias), nome: nome.trim(), ativa: true };
  categorias.push(nova);
  return { status: 201, corpo: nova };
});

rota('PATCH', '/categorias/(\\d+)', (req, body, p) => {
  autenticar(req);
  const c = categorias.find((x) => x.id === parseId(p[1]));
  if (!c) throw new ApiErro(404, 'Categoria não encontrada.');
  const { nome, ativa } = body ?? {};
  const mudancas = {};
  if (nome !== undefined) {
    if (typeof nome !== 'string' || nome.trim() === '' || nome.trim().length > 80) throw new ApiErro(400, 'Informe o nome da categoria (até 80 caracteres).', 'nome');
    mudancas.nome = nome.trim();
  }
  if (ativa !== undefined) mudancas.ativa = lerBooleano(ativa, 'ativa');
  if (Object.keys(mudancas).length === 0) throw new ApiErro(400, 'Informe ao menos um campo para atualizar: nome ou ativa.');
  Object.assign(c, mudancas);
  return { corpo: c };
});

// --- produtos (GET público, o resto exige token) ---
rota('GET', '/produtos', (req, body, p, q) => {
  let lista = produtos;
  if (q.get('categoriaId')) {
    const id = parseId(q.get('categoriaId'));
    lista = lista.filter((x) => x.categoriaId === id);
  }
  const busca = (q.get('busca') ?? '').trim().toLowerCase();
  if (busca) lista = lista.filter((x) => x.nome.toLowerCase().includes(busca) || (x.codigoBarras ?? '').toLowerCase().includes(busca));
  const canal = q.get('canal');
  if (canal === 'online') lista = lista.filter((x) => x.online);
  else if (canal === 'presencial') lista = lista.filter((x) => x.presencial);
  else if (canal) throw new ApiErro(400, 'Canal inválido. Use: online ou presencial.', 'canal');
  const status = q.get('status');
  if (!status || status === 'ativo') lista = lista.filter((x) => x.ativo);
  else if (status === 'inativo') lista = lista.filter((x) => !x.ativo);
  else if (status !== 'todos') throw new ApiErro(400, 'Status inválido. Use: ativo, inativo ou todos.', 'status');
  return { corpo: [...lista].sort((a, b) => a.nome.localeCompare(b.nome)).map(paraProduto) };
});

rota('GET', '/produtos/(\\d+)', (req, body, p) => {
  const produto = produtos.find((x) => x.id === parseId(p[1]));
  if (!produto) throw new ApiErro(404, 'Produto não encontrado.');
  return { corpo: paraProduto(produto) };
});

rota('POST', '/produtos', (req, body) => {
  autenticar(req);
  const b = body ?? {};
  const quantidade = b.quantidadeInicial ?? 0;
  if (typeof quantidade !== 'number' || !Number.isInteger(quantidade) || quantidade < 0) {
    throw new ApiErro(400, 'A quantidade inicial deve ser um número inteiro de 0 em diante.', 'quantidadeInicial');
  }
  const nome = lerNomeProduto(b.nome);
  const preco = lerPreco(b.preco);
  const categoriaId = parseId(b.categoriaId);
  garantirCategoriaAtiva(categoriaId);
  const descricao = lerTextoOpcional(b.descricao, 'descricao', 5000);
  const imagemUrl = lerTextoOpcional(b.imagemUrl, 'imagemUrl', 500);
  const codigoBarras = lerTextoOpcional(b.codigoBarras, 'codigoBarras', 80);
  if (codigoBarras !== null) garantirCodigoLivre(codigoBarras);
  const novo = {
    id: proximoId(produtos), nome, descricao, preco, categoriaId, codigoBarras, imagemUrl,
    fisica: quantidade, reservada: 0,
    presencial: b.disponivelPresencial === undefined ? true : lerBooleano(b.disponivelPresencial, 'disponivelPresencial'),
    online: b.disponivelOnline === undefined ? true : lerBooleano(b.disponivelOnline, 'disponivelOnline'),
    ativo: true, criadoEm: new Date().toISOString(),
  };
  produtos.push(novo);
  return { status: 201, corpo: paraProduto(novo) };
});

rota('PATCH', '/produtos/(\\d+)', (req, body, p) => {
  autenticar(req);
  const produto = produtos.find((x) => x.id === parseId(p[1]));
  if (!produto) throw new ApiErro(404, 'Produto não encontrado.');
  const b = body ?? {};
  const m = {};
  if (b.nome !== undefined) m.nome = lerNomeProduto(b.nome);
  if (b.preco !== undefined) m.preco = lerPreco(b.preco);
  if (b.categoriaId !== undefined) {
    const id = parseId(b.categoriaId);
    if (id !== produto.categoriaId) garantirCategoriaAtiva(id);
    m.categoriaId = id;
  }
  if (b.descricao !== undefined) m.descricao = lerTextoOpcional(b.descricao, 'descricao', 5000);
  if (b.imagemUrl !== undefined) m.imagemUrl = lerTextoOpcional(b.imagemUrl, 'imagemUrl', 500);
  if (b.codigoBarras !== undefined) {
    const codigo = lerTextoOpcional(b.codigoBarras, 'codigoBarras', 80);
    if (codigo !== null) garantirCodigoLivre(codigo, produto.id);
    m.codigoBarras = codigo;
  }
  if (b.disponivelPresencial !== undefined) m.presencial = lerBooleano(b.disponivelPresencial, 'disponivelPresencial');
  if (b.disponivelOnline !== undefined) m.online = lerBooleano(b.disponivelOnline, 'disponivelOnline');
  if (b.ativo !== undefined) m.ativo = lerBooleano(b.ativo, 'ativo');
  if (Object.keys(m).length === 0) throw new ApiErro(400, 'Informe ao menos um campo para atualizar.');
  Object.assign(produto, m);
  return { corpo: paraProduto(produto) };
});

// --- pedidos (todas exigem token) ---
rota('GET', '/pedidos', (req, body, p, q) => {
  autenticar(req);
  const inteiro = (campo, padrao, min, max) => {
    const v = q.get(campo);
    if (v === null || v === '') return padrao;
    if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) throw new ApiErro(400, `O parâmetro '${campo}' deve ser um número inteiro entre ${min} e ${max}.`, campo);
    return Number(v);
  };
  const pagina = inteiro('pagina', 1, 1, 1000000);
  const limite = inteiro('limite', 20, 1, 100);
  let lista = pedidos;
  if (q.get('status')) {
    const s = q.get('status').toUpperCase();
    if (!STATUS.includes(s)) throw new ApiErro(400, `Status inválido. Use: ${STATUS.join(', ')}.`, 'status');
    lista = lista.filter((x) => x.status === s);
  }
  if (q.get('canal')) {
    const c = q.get('canal').toUpperCase();
    if (!['PRESENCIAL', 'ONLINE'].includes(c)) throw new ApiErro(400, 'Canal inválido. Use: PRESENCIAL ou ONLINE.', 'canal');
    lista = lista.filter((x) => x.canal === c);
  }
  const dados = lista.slice((pagina - 1) * limite, pagina * limite).map(({ pagamentos, ...resto }) => resto);
  return { corpo: { dados, pagina, limite, total: lista.length, totalPaginas: Math.ceil(lista.length / limite) } };
});

rota('GET', '/pedidos/(\\d+)', (req, body, p) => {
  autenticar(req);
  const pedido = pedidos.find((x) => x.id === parseId(p[1]));
  if (!pedido) throw new ApiErro(404, 'Pedido não encontrado.');
  return { corpo: pedido };
});

// POST /pedidos: mesmas validações do backend (canal, itens, produto ativo, estoque) e baixa de estoque.
rota('POST', '/pedidos', (req, body) => {
  const usuario = autenticar(req);
  const { canal, itens } = body ?? {};
  const canalLido = typeof canal === 'string' ? canal.trim().toUpperCase() : '';
  if (!['PRESENCIAL', 'ONLINE'].includes(canalLido)) throw new ApiErro(400, 'Canal inválido. Use: PRESENCIAL ou ONLINE.', 'canal');
  if (!Array.isArray(itens) || itens.length === 0 || itens.length > 100) throw new ApiErro(400, "Informe a lista 'itens' com 1 a 100 itens.", 'itens');

  const vistos = new Set();
  const lidos = itens.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new ApiErro(400, `O item ${i + 1} deve ser um objeto { produtoId, quantidade }.`, `itens[${i}]`);
    const produtoId = parseId(item.produtoId);
    const q = item.quantidade;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1) throw new ApiErro(400, `A quantidade do item ${i + 1} deve ser um número inteiro maior que zero.`, `itens[${i}].quantidade`);
    if (vistos.has(produtoId)) throw new ApiErro(400, `O produto ${produtoId} aparece mais de uma vez em 'itens'. Some as quantidades num único item.`, 'itens');
    vistos.add(produtoId);
    return { produtoId, quantidade: q };
  });

  // Valida tudo antes de gravar (o backend real faz numa transação: ou grava tudo, ou nada).
  const linhas = lidos.map(({ produtoId, quantidade }) => {
    const produto = produtos.find((x) => x.id === produtoId);
    if (!produto) throw new ApiErro(400, `O produto ${produtoId} não existe.`, 'itens');
    if (!produto.ativo) throw new ApiErro(400, `O produto "${produto.nome}" está inativo.`, 'itens');
    const disponivel = produto.fisica - produto.reservada;
    if (disponivel < quantidade) throw new ApiErro(400, `Estoque insuficiente para "${produto.nome}": disponível ${Math.max(0, disponivel)}, solicitado ${quantidade}.`, 'itens');
    return { produto, quantidade };
  });

  const id = proximoId(pedidos);
  const itensPedido = linhas.map(({ produto, quantidade }, idx) => ({
    id: id * 10 + idx, produtoId: produto.id, nome: produto.nome, imagemUrl: produto.imagemUrl ?? '',
    quantidade, precoUnitario: produto.preco, subtotal: arred(produto.preco * quantidade),
  }));
  linhas.forEach(({ produto, quantidade }) => (produto.fisica -= quantidade));
  const novo = {
    id, canal: canalLido, status: 'ABERTO', total: arred(itensPedido.reduce((s, it) => s + it.subtotal, 0)),
    usuarioId: usuario.id, clienteId: null, criadoEm: new Date().toISOString(), itens: itensPedido, pagamentos: [],
  };
  linhas.forEach(({ produto, quantidade }) =>
    movimentacoes.push({ id: proximoId(movimentacoes), produtoId: produto.id, usuarioId: usuario.id, tipo: 'SAIDA', quantidade, motivo: `Venda - pedido #${id}`, criadoEm: new Date().toISOString() }),
  );
  pedidos.unshift(novo);
  return { status: 201, corpo: novo };
});

// --- pagamentos (todas exigem token; qualquer perfil) ---
// Igual ao backend: um pagamento com o valor EXATO do pedido, já APROVADO, e o pedido vira PAGO.
const STATUS_PAGAVEIS = ['ABERTO', 'ENVIADO_AO_CAIXA', 'AGUARDANDO_PAGAMENTO'];

function garantirPedidoPagavel(status) {
  if (status === 'PAGO') throw new ApiErro(400, 'Este pedido já está pago.', 'pedidoId');
  if (status === 'CANCELADO' || status === 'ESTORNADO') throw new ApiErro(400, `Pedido ${status.toLowerCase()} não pode receber pagamento.`, 'pedidoId');
  if (!STATUS_PAGAVEIS.includes(status)) throw new ApiErro(400, `Este pedido já foi pago e está em andamento (status ${status}).`, 'pedidoId');
}

rota('POST', '/pagamentos', (req, body) => {
  autenticar(req);
  const { pedidoId: pedidoIdBruto, formaPagamento, valor } = body ?? {};
  const pedidoId = parseId(pedidoIdBruto, 'pedidoId');
  const forma = typeof formaPagamento === 'string' ? formaPagamento.trim().toUpperCase() : '';
  if (!['PIX', 'CARTAO', 'DINHEIRO'].includes(forma)) throw new ApiErro(400, 'Forma de pagamento inválida. Use: PIX, CARTAO, DINHEIRO.', 'formaPagamento');
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) throw new ApiErro(400, 'O valor deve ser um número maior que zero (ex.: 12.5).', 'valor');
  if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6) throw new ApiErro(400, 'O valor deve ter no máximo 2 casas decimais.', 'valor');

  const pedido = pedidos.find((x) => x.id === pedidoId);
  if (!pedido) throw new ApiErro(400, 'Pedido não encontrado.', 'pedidoId');
  garantirPedidoPagavel(pedido.status);
  if (Math.round(valor * 100) !== Math.round(pedido.total * 100)) {
    throw new ApiErro(400, `O valor (${valor}) deve ser igual ao total do pedido (${pedido.total}).`, 'valor');
  }

  const proximo = pedidos.flatMap((x) => x.pagamentos).reduce((m, pg) => Math.max(m, pg.id), 0) + 1;
  const pagamento = { id: proximo, formaPagamento: forma, statusPagamento: 'APROVADO', valor, identificadorExterno: null, criadoEm: new Date().toISOString() };
  pedido.pagamentos.push(pagamento);
  pedido.status = 'PAGO';
  return { status: 201, corpo: { ...pagamento, pedidoId, pedido: { id: pedidoId, status: 'PAGO', total: valor } } };
});

rota('GET', '/pagamentos/pedido/(\\d+)', (req, body, p) => {
  autenticar(req);
  const pedido = pedidos.find((x) => x.id === parseId(p[1], 'pedidoId'));
  if (!pedido) throw new ApiErro(404, 'Pedido não encontrado.');
  return { corpo: pedido.pagamentos.map((pg) => ({ ...pg, pedidoId: pedido.id })) };
});

// --- estoque e movimentações ---
// Réplica fiel do módulo do Murilo: SEM autenticação, usuarioId vem no corpo e os erros vêm como { erro }.
const paraEstoque = (p) => ({
  id: p.id, produtoId: p.id, quantidadeFisica: p.fisica, quantidadeReservada: p.reservada, estoqueMinimo: p.minimo,
  produto: { id: p.id, nome: p.nome, codigoBarras: p.codigoBarras },
});

const paraMovimentacao = (m) => ({
  ...m,
  produto: { id: m.produtoId, nome: produtos.find((x) => x.id === m.produtoId)?.nome ?? '' },
  usuario: { id: m.usuarioId, nome: usuarios.find((x) => x.id === m.usuarioId)?.nome ?? '' },
});

rota('GET', '/estoque', () => ({ corpo: [...produtos].sort((a, b) => a.id - b.id).map(paraEstoque) }));

rota('GET', '/estoque/(\\d+)', (req, body, p) => {
  const produto = produtos.find((x) => x.id === Number(p[1]));
  if (!produto) throw new ErroSimples(404, 'Estoque não encontrado para esse produto');
  return { corpo: paraEstoque(produto) };
});

rota('PUT', '/estoque/(\\d+)', (req, body, p) => {
  const minimo = Number(body?.estoqueMinimo);
  if (Number.isNaN(minimo) || minimo < 0) throw new ErroSimples(400, 'estoqueMinimo é obrigatório e não pode ser negativo');
  const produto = produtos.find((x) => x.id === Number(p[1]));
  if (!produto) throw new ErroSimples(404, 'Estoque não encontrado para esse produto');
  produto.minimo = minimo;
  return { corpo: paraEstoque(produto) };
});

rota('POST', '/movimentacoes', (req, body) => {
  const b = body ?? {};
  const produtoId = Number(b.produtoId);
  const usuarioId = Number(b.usuarioId);
  const quantidade = Number(b.quantidade);
  const { tipo, motivo } = b;
  if (!produtoId || !usuarioId || !tipo || Number.isNaN(quantidade)) throw new ErroSimples(400, 'produtoId, usuarioId, tipo e quantidade são obrigatórios');
  if (!['ENTRADA', 'SAIDA', 'PERDA', 'AJUSTE'].includes(tipo)) throw new ErroSimples(400, 'tipo inválido, use um de: ENTRADA, SAIDA, PERDA, AJUSTE');
  if (tipo === 'AJUSTE') {
    if (quantidade === 0) throw new ErroSimples(400, 'quantidade do ajuste não pode ser zero');
  } else if (quantidade <= 0) throw new ErroSimples(400, 'quantidade deve ser maior que zero');

  const produto = produtos.find((x) => x.id === produtoId);
  if (!produto || !usuarios.some((u) => u.id === usuarioId)) throw new ErroSimples(500, 'Erro ao registrar movimentação'); // chave estrangeira inválida
  const delta = tipo === 'SAIDA' || tipo === 'PERDA' ? -quantidade : quantidade;
  const nova = produto.fisica + delta;
  if (nova < 0) throw new ErroSimples(400, 'Estoque insuficiente para essa saída/perda');

  const movimentacao = { id: proximoId(movimentacoes), produtoId, usuarioId, tipo, quantidade, motivo: motivo || null, criadoEm: new Date().toISOString() };
  movimentacoes.push(movimentacao);
  produto.fisica = nova;
  return { status: 201, corpo: movimentacao };
});

rota('GET', '/movimentacoes', (req, body, p, q) => {
  const produtoId = q.get('produtoId');
  const lista = movimentacoes.filter((m) => !produtoId || m.produtoId === Number(produtoId));
  return { corpo: [...lista].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.id - a.id).map(paraMovimentacao) };
});

rota('DELETE', '/movimentacoes/(\\d+)', (req, body, p) => {
  const id = Number(p[1]);
  const indice = movimentacoes.findIndex((m) => m.id === id);
  if (indice === -1) throw new ErroSimples(404, 'Movimentação não encontrada');
  const mov = movimentacoes[indice];
  const delta = mov.tipo === 'ENTRADA' ? -mov.quantidade : mov.tipo === 'SAIDA' || mov.tipo === 'PERDA' ? mov.quantidade : -mov.quantidade;
  const produto = produtos.find((x) => x.id === mov.produtoId);
  if (produto) produto.fisica = Math.max(0, produto.fisica + delta);
  movimentacoes.splice(indice, 1);
  return { status: 204 };
});

/* ---------- Servidor ---------- */

function lerCorpo(req) {
  return new Promise((resolver, rejeitar) => {
    let texto = '';
    req.on('data', (parte) => (texto += parte));
    req.on('end', () => {
      if (!texto) return resolver(undefined);
      try {
        resolver(JSON.parse(texto));
      } catch {
        rejeitar(new ApiErro(400, 'Corpo da requisição não é um JSON válido.'));
      }
    });
  });
}

const enviar = (res, status, corpo) => {
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    await new Promise((r) => setTimeout(r, ATRASO_MS));
    try {
      const body = await lerCorpo(req);
      for (const [metodo, expressao, funcao] of rotas) {
        const achou = expressao.exec(url.pathname);
        if (metodo === req.method && achou) {
          const { status = 200, corpo } = funcao(req, body, achou, url.searchParams);
          console.log(`${req.method} ${url.pathname}${url.search} -> ${status}`);
          return enviar(res, status, corpo);
        }
      }
      throw new ApiErro(404, `Rota não encontrada: ${req.method} ${url.pathname}`);
    } catch (erro) {
      if (erro instanceof ErroSimples) {
        console.log(`${req.method} ${url.pathname}${url.search} -> ${erro.status} (${erro.message})`);
        return enviar(res, erro.status, { erro: erro.message });
      }
      if (erro instanceof ApiErro) {
        console.log(`${req.method} ${url.pathname}${url.search} -> ${erro.status} (${erro.message})`);
        return enviar(res, erro.status, { mensagem: erro.message, campo: erro.campo });
      }
      console.error(erro);
      return enviar(res, 500, { mensagem: 'Erro interno do servidor.' });
    }
  })
  .listen(PORT, () => {
    console.log(`Servidor de MENTIRA rodando em http://localhost:${PORT}`);
    console.log('Logins: admin/admin123 · caixa/123456 · atendente/123456 · paula/123456 (inativa)');
  });
