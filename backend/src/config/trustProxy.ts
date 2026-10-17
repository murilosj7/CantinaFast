// TRUST_PROXY: quantos proxies reversos da hospedagem a API deve confiar para descobrir o IP real do cliente.
// Sem isso, atrás de um proxy todas as requisições chegam com o IP do PRÓPRIO proxy e a chave IP + alvo dos limites de
// requisições perde o sentido (todo mundo parece vir do mesmo IP).
// Carrega o arquivo .env (idempotente): é de lá que pode vir a TRUST_PROXY.
import "dotenv/config";

// Maior número de saltos aceito. Hospedagens reais têm 1 ou 2 proxies; um valor alto quase sempre é erro de digitação.
const MAXIMO_SALTOS = 10;

// Lê o texto da variável TRUST_PROXY e devolve o número de proxies confiáveis, ou undefined para NÃO confiar em nenhum.
//
// IMPORTANTE: o número tem de ser EXATAMENTE a quantidade de proxies da hospedagem. O Express lê o X-Forwarded-For de trás
// para frente; se o número for MAIOR que o real, ele passa a usar uma entrada que o próprio cliente pode forjar, e quem
// forja o IP escapa dos limites de requisições. Por isso NUNCA aceitamos `true`, listas de endereços ("loopback") nem
// números fora de 1 a 10: o `true` faria o Express confiar em qualquer X-Forwarded-For.
export function lerTrustProxy(valor: string | undefined): number | undefined {
  // Tira os espaços das pontas (variável ausente vira texto vazio).
  const texto = (valor ?? "").trim();
  // Ausente ou vazia: nada é confiado, sem aviso (é o comportamento padrão, o de desenvolvimento local).
  if (texto === "") return undefined;
  // Só aceita dígitos puros: recusa "true", "-1", "1.5", "1e3", "1,2" e "loopback".
  if (/^\d+$/.test(texto)) {
    // Converte para número e confere a faixa permitida (0 significaria "não confiar", que já é o padrão: tratado como erro de digitação).
    const saltos = Number(texto);
    if (Number.isSafeInteger(saltos) && saltos >= 1 && saltos <= MAXIMO_SALTOS) return saltos;
  }
  // Preenchida mas inválida: avisa no terminal para não passar despercebido e NÃO confia em nenhum proxy.
  console.warn(`TRUST_PROXY inválida ('${texto}'): ignorada (use um inteiro de 1 a ${MAXIMO_SALTOS}). Nenhum proxy será confiado.`);
  return undefined;
}

// Número de proxies confiáveis lido uma vez, na subida do servidor (undefined = não confia em nenhum).
export const saltosProxyConfiaveis = lerTrustProxy(process.env.TRUST_PROXY);
