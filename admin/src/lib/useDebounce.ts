import { useEffect, useState } from 'react';

// Devolve o valor só depois que ele para de mudar por `atrasoMs` (evita uma busca a cada tecla).
export function useDebounce<T>(valor: T, atrasoMs = 350): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setAtrasado(valor), atrasoMs);
    return () => clearTimeout(id);
  }, [valor, atrasoMs]);
  return atrasado;
}
