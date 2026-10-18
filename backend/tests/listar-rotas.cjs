'use strict';
// Auxiliar do teste guardião (não é uma suíte): carrega src/server.ts SEM abrir a porta e imprime em JSON todas as rotas
// registradas no Express, com a proteção de cada uma. Roda sob o tsx: `tsx tests/listar-rotas.cjs`.
const http = require('http');
const path = require('path');
const express = require('express');

const registro = { montagens: [], rotasDiretas: [] };

// Impede o app.listen de abrir a porta (o servidor de teste já usa a 3000).
http.Server.prototype.listen = function () {
  return this;
};

// app.use("/prefixo", roteador): anota o prefixo de cada roteador montado.
const useOriginal = express.application.use;
express.application.use = function (...args) {
  if (typeof args[0] === 'string') registro.montagens.push({ prefixo: args[0], fns: args.slice(1).flat() });
  return useOriginal.apply(this, args);
};
// app.get/post/...("/caminho", ...handlers): rotas declaradas direto no server.ts (app.get("chave") de 1 argumento é leitura de config).
for (const metodo of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = express.application[metodo];
  express.application[metodo] = function (...args) {
    if (args.length > 1 && typeof args[0] === 'string') registro.rotasDiretas.push({ metodo: metodo.toUpperCase(), caminho: args[0], fns: args.slice(1).flat() });
    return original.apply(this, args);
  };
}

require(path.resolve(__dirname, '..', 'src', 'server.ts'));
const auth = require(path.resolve(__dirname, '..', 'src', 'middlewares', 'auth.middleware.ts'));

// Resume uma cadeia de handlers: autenticar (interno), autenticarCliente e a lista de perfis do exigirPerfil (null se não houver).
function proteger(fns) {
  let perfis = null;
  for (const fn of fns) if (Array.isArray(fn.perfisPermitidos)) perfis = fn.perfisPermitidos;
  return {
    autenticar: fns.includes(auth.autenticar),
    autenticarCliente: fns.includes(auth.autenticarCliente),
    perfis,
  };
}

const juntar = (prefixo, caminho) => {
  const p = (prefixo + (caminho === '/' ? '' : caminho)).replace(/\/+$/, '');
  return p === '' ? '/' : p;
};

const rotas = [];
for (const { metodo, caminho, fns } of registro.rotasDiretas) rotas.push({ metodo, caminho: juntar('', caminho), ...proteger(fns) });
for (const { prefixo, fns } of registro.montagens) {
  for (const roteador of fns) {
    if (!roteador || !Array.isArray(roteador.stack)) continue;
    // Handlers de router.use(...) valem para todas as rotas declaradas depois deles.
    const globais = [];
    for (const camada of roteador.stack) {
      if (!camada.route) {
        globais.push(camada.handle);
        continue;
      }
      const cadeia = [...globais, ...camada.route.stack.map((c) => c.handle)];
      for (const metodo of Object.keys(camada.route.methods)) {
        rotas.push({ metodo: metodo.toUpperCase(), caminho: juntar(prefixo, camada.route.path), ...proteger(cadeia) });
      }
    }
  }
}
process.stdout.write('ROTAS_JSON:' + JSON.stringify(rotas));
process.exit(0);
