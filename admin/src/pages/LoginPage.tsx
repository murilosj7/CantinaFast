import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alerta, Button, Campo, Entrada } from '../components/ui';
import { lerErro } from '../lib/api';

export function LoginPage() {
  const { usuario, entrar, aviso, limparAviso } = useAuth();
  const local = useLocation();
  const destino = (local.state as { de?: string } | null)?.de ?? '/';

  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erros, setErros] = useState<{ login?: string; senha?: string }>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to={destino} replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    limparAviso();
    setErroGeral(null);

    const novos: { login?: string; senha?: string } = {};
    if (login.trim() === '') novos.login = 'Informe o login.';
    if (senha === '') novos.senha = 'Informe a senha.';
    setErros(novos);
    if (Object.keys(novos).length > 0) return;

    setEnviando(true);
    try {
      // Ao dar certo, o AuthContext guarda o usuário e esta página redireciona sozinha.
      await entrar(login.trim(), senha);
    } catch (err) {
      // O backend usa uma mensagem única ("Login ou senha inválidos.") para não revelar qual dos dois errou.
      setErroGeral(lerErro(err).mensagem);
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-between bg-carvao p-12 text-creme lg:flex">
        <p className="font-display text-2xl font-semibold tracking-tight">
          Cantina<span className="text-brasa-400">Fast</span>
        </p>
        <div>
          <h1 className="max-w-md text-5xl font-semibold leading-tight">Pedidos, produtos e equipe num só lugar.</h1>
          <p className="mt-4 max-w-sm text-creme/70">Painel interno para quem cuida da cantina.</p>
        </div>
        <p className="text-sm text-creme/50">Acesso para atendentes, caixas e administradores.</p>
      </div>

      <main className="flex items-center justify-center px-6 py-12">
        <form onSubmit={enviar} noValidate className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-3xl font-semibold">Entrar</h2>
            <p className="mt-1 text-sm text-carvao/70">Use o login e a senha que o administrador cadastrou para você.</p>
          </div>

          {aviso && <Alerta tipo="aviso">{aviso}</Alerta>}
          {erroGeral && <Alerta>{erroGeral}</Alerta>}

          <Campo rotulo="Login" id="login" erro={erros.login}>
            <Entrada
              id="login"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              erro={erros.login}
              autoComplete="username"
              autoFocus
            />
          </Campo>

          <Campo rotulo="Senha" id="senha" erro={erros.senha}>
            <Entrada
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              erro={erros.senha}
              autoComplete="current-password"
            />
          </Campo>

          <Button type="submit" carregando={enviando} className="w-full">
            Entrar
          </Button>
        </form>
      </main>
    </div>
  );
}
