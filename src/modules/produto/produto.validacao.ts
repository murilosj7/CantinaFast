// Instância única do Prisma para acessar o banco.
import { prisma } from "../../config/prisma";
// Erro padronizado (mensagem + status + campo).
import { AppError } from "../../middlewares/errorHandler";

// Validações compartilhadas por criarProduto e atualizarProduto.

// Valida o nome do produto e devolve ele sem espaços nas pontas.
export function lerNome(valor: unknown): string {
  // Precisa ser texto, não vazio e ter até 140 caracteres (limite da API).
  if (typeof valor !== "string" || valor.trim() === "" || valor.trim().length > 140) {
    throw new AppError("Informe o nome do produto (até 140 caracteres).", 400, "nome");
  }
  return valor.trim();
}

// Recebe o preço como NÚMERO (contrato: valor monetário é número) e devolve uma string "12.50"
// para gravar no Decimal(10,2) sem erro de ponto flutuante.
export function lerPreco(valor: unknown): string {
  // Só aceita número de verdade e finito (recusa texto, null, NaN e infinito).
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    throw new AppError("O preço deve ser um número (ex.: 12.5).", 400, "preco");
  }
  // Precisa ser maior que zero e caber no Decimal(10,2) da coluna precoVenda (máximo 99.999.999,99).
  if (valor <= 0 || valor > 99999999.99) {
    throw new AppError("O preço deve ser maior que zero.", 400, "preco");
  }
  // Confere se tem no máximo 2 casas decimais (multiplica por 100 e vê se sobra fração; 1e-6 é a tolerância).
  if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6) {
    throw new AppError("O preço deve ter no máximo 2 casas decimais.", 400, "preco");
  }
  // Devolve em texto com exatamente 2 casas (ex.: 7.5 -> "7.50").
  return valor.toFixed(2);
}

// Campo de texto opcional: undefined/null/"" viram null (limpa o campo); senão precisa ser string curta.
export function lerTextoOpcional(valor: unknown, campo: string, max: number): string | null {
  // Não veio nada: fica null.
  if (valor === undefined || valor === null) return null;
  // Veio algo que não é texto: erro.
  if (typeof valor !== "string") {
    throw new AppError(`O campo '${campo}' deve ser um texto.`, 400, campo);
  }
  // Tira os espaços das pontas.
  const texto = valor.trim();
  // Texto vazio também limpa o campo (vira null).
  if (texto === "") return null;
  // Passou do tamanho máximo permitido: erro.
  if (texto.length > max) {
    throw new AppError(`O campo '${campo}' aceita no máximo ${max} caracteres.`, 400, campo);
  }
  return texto;
}

// Garante que o valor é verdadeiro ou falso de verdade (não texto como "sim").
export function lerBooleano(valor: unknown, campo: string): boolean {
  if (typeof valor !== "boolean") {
    throw new AppError(`O campo '${campo}' deve ser verdadeiro ou falso.`, 400, campo);
  }
  return valor;
}

// Confere se a categoria existe e está ativa; caso contrário lança 400 apontando o campo categoriaId.
export async function garantirCategoriaAtiva(categoriaId: number) {
  // Procura a categoria no banco.
  const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId } });
  // Não existe: erro.
  if (!categoria) {
    throw new AppError("Categoria não encontrada.", 400, "categoriaId");
  }
  // Existe mas está inativa: também não pode receber produtos.
  if (!categoria.ativa) {
    throw new AppError("A categoria informada está inativa.", 400, "categoriaId");
  }
}

// Confere se o código de barras ainda não está em uso (ele é único no banco).
// `ignorarProdutoId` permite que um produto reenvie o PRÓPRIO código sem dar conflito.
export async function garantirCodigoBarrasLivre(codigoBarras: string, ignorarProdutoId?: number) {
  // Procura um produto que já use esse código.
  const emUso = await prisma.produto.findUnique({ where: { codigoBarras } });
  // Se existe e não é o próprio produto sendo editado, é conflito.
  if (emUso && emUso.id !== ignorarProdutoId) {
    throw new AppError("Já existe um produto com esse código de barras.", 409, "codigoBarras");
  }
}
