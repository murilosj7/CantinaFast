import { useEffect, useState } from 'react';
import { lerErro } from './api';

// Busca dados quando os `deps` mudam e devolve { dados, carregando, erro, recarregar }.
// Mantém os dados antigos na tela enquanto a nova busca roda e descarta respostas atrasadas.
export function useCarregar<T>(buscar: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    buscar()
      .then((resultado) => {
        if (!cancelado) setDados(resultado);
      })
      .catch((e) => {
        if (!cancelado) setErro(lerErro(e).mensagem);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, versao]);

  return { dados, carregando, erro, recarregar: () => setVersao((v) => v + 1) };
}
