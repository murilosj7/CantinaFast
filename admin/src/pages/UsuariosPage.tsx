import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alerta, Badge, Button, Campo, Confirmacao, Entrada, LinhaMensagem, Modal, PaginaCabecalho, Selecao, tabela } from '../components/ui';
import { lerErro } from '../lib/api';
import { dataHora, PERFIL_ROTULO } from '../lib/format';
import { useCarregar } from '../lib/useCarregar';
import { useDebounce } from '../lib/useDebounce';
import { usuarioService } from '../services/usuarioService';
import type { Perfil, UsuarioInterno } from '../types';

const PERFIS: Perfil[] = ['atendente', 'caixa', 'administrador'];
const CAMPOS_DO_FORM = ['nome', 'login', 'senha', 'perfil'];

export function UsuariosPage() {
  const { usuario: eu } = useAuth();

  const [busca, setBusca] = useState('');
  const [perfil, setPerfil] = useState<Perfil | ''>('');
  const [status, setStatus] = useState<'' | 'ativo' | 'inativo'>('');
  const buscaAtrasada = useDebounce(busca);

  const { dados, carregando, erro, recarregar } = useCarregar(
    () => usuarioService.listar({ busca: buscaAtrasada, perfil, status }),
    [buscaAtrasada, perfil, status],
  );
  const usuarios = dados ?? [];

  const [editando, setEditando] = useState<UsuarioInterno | 'novo' | null>(null);
  const [alvoInativar, setAlvoInativar] = useState<UsuarioInterno | null>(null);
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function alterarAtivo(alvo: UsuarioInterno, ativo: boolean) {
    setProcessando(true);
    setMensagem(null);
    setErroAcao(null);
    try {
      await usuarioService.atualizar(alvo.id, { ativo });
      setMensagem(ativo ? `${alvo.nome} foi reativado.` : `${alvo.nome} foi inativado.`);
      recarregar();
    } catch (e) {
      // Ex.: 409 "Não é possível inativar nem alterar o perfil do último administrador ativo."
      setErroAcao(lerErro(e).mensagem);
    } finally {
      setProcessando(false);
      setAlvoInativar(null);
    }
  }

  function aoSalvar(texto: string) {
    setEditando(null);
    setErroAcao(null);
    setMensagem(texto);
    recarregar();
  }

  return (
    <>
      <PaginaCabecalho
        titulo="Usuários"
        descricao="Quem pode entrar no sistema interno. Usuários não são excluídos: ao inativar, o histórico é preservado."
        acao={<Button onClick={() => setEditando('novo')}>Novo usuário</Button>}
      />

      <div className="space-y-4">
        {mensagem && <Alerta tipo="sucesso">{mensagem}</Alerta>}
        {erroAcao && <Alerta>{erroAcao}</Alerta>}
        {erro && (
          <Alerta
            acao={
              <Button variante="secundario" tamanho="sm" onClick={recarregar}>
                Tentar de novo
              </Button>
            }
          >
            {erro}
          </Alerta>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_11rem_11rem]">
          <Entrada
            aria-label="Buscar por nome ou login"
            placeholder="Buscar por nome ou login"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Selecao aria-label="Filtrar por perfil" value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil | '')}>
            <option value="">Todos os perfis</option>
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {PERFIL_ROTULO[p]}
              </option>
            ))}
          </Selecao>
          <Selecao aria-label="Filtrar por situação" value={status} onChange={(e) => setStatus(e.target.value as '' | 'ativo' | 'inativo')}>
            <option value="">Todas as situações</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </Selecao>
        </div>

        <div className={tabela.caixa}>
          <table className={tabela.base}>
            <thead className={tabela.cabecalho}>
              <tr>
                <th className={tabela.th}>Nome</th>
                <th className={tabela.th}>Login</th>
                <th className={tabela.th}>Perfil</th>
                <th className={tabela.th}>Situação</th>
                <th className={tabela.th}>Cadastrado em</th>
                <th className={`${tabela.th} text-right`}>Ações</th>
              </tr>
            </thead>
            <tbody className={carregando && dados ? 'opacity-60' : ''}>
              {!dados && carregando ? (
                <LinhaMensagem colunas={6}>Carregando…</LinhaMensagem>
              ) : usuarios.length === 0 ? (
                <LinhaMensagem colunas={6}>Nenhum usuário encontrado com esses filtros.</LinhaMensagem>
              ) : (
                usuarios.map((u) => {
                  const ehEu = u.id === eu?.id;
                  return (
                    <tr key={u.id} className={tabela.linha}>
                      <td className={`${tabela.td} font-medium`}>
                        {u.nome}
                        {ehEu && <span className="ml-2 text-xs font-normal text-carvao/60">(você)</span>}
                      </td>
                      <td className={tabela.td}>{u.login}</td>
                      <td className={tabela.td}>{PERFIL_ROTULO[u.perfil]}</td>
                      <td className={tabela.td}>
                        <Badge tom={u.ativo ? 'verde' : 'neutro'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge>
                      </td>
                      <td className={tabela.td}>{dataHora(u.criadoEm)}</td>
                      <td className={`${tabela.td} text-right`}>
                        <div className="flex justify-end gap-1">
                          <Button variante="fantasma" tamanho="sm" onClick={() => setEditando(u)}>
                            Editar
                          </Button>
                          {u.ativo ? (
                            <Button
                              variante="fantasma"
                              tamanho="sm"
                              disabled={ehEu}
                              title={ehEu ? 'Você não pode inativar a si mesmo.' : undefined}
                              onClick={() => setAlvoInativar(u)}
                            >
                              Inativar
                            </Button>
                          ) : (
                            <Button variante="fantasma" tamanho="sm" disabled={processando} onClick={() => alterarAtivo(u, true)}>
                              Reativar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal aberto={editando !== null} titulo={editando === 'novo' ? 'Novo usuário' : 'Editar usuário'} aoFechar={() => setEditando(null)}>
        {editando !== null && (
          <FormUsuario
            key={editando === 'novo' ? 'novo' : editando.id}
            usuario={editando === 'novo' ? null : editando}
            ehEu={editando !== 'novo' && editando.id === eu?.id}
            aoSalvar={aoSalvar}
            aoCancelar={() => setEditando(null)}
          />
        )}
      </Modal>

      <Confirmacao
        aberto={alvoInativar !== null}
        titulo="Inativar usuário"
        mensagem={
          alvoInativar
            ? `${alvoInativar.nome} perderá o acesso ao sistema na hora. O histórico é mantido e você pode reativar depois.`
            : ''
        }
        rotulo="Inativar"
        processando={processando}
        aoConfirmar={() => alvoInativar && alterarAtivo(alvoInativar, false)}
        aoCancelar={() => setAlvoInativar(null)}
      />
    </>
  );
}

function FormUsuario({
  usuario,
  ehEu,
  aoSalvar,
  aoCancelar,
}: {
  usuario: UsuarioInterno | null;
  ehEu: boolean;
  aoSalvar: (mensagem: string) => void;
  aoCancelar: () => void;
}) {
  const edicao = usuario !== null;
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [login, setLogin] = useState(usuario?.login ?? '');
  const [senha, setSenha] = useState('');
  const [perfil, setPerfil] = useState<Perfil>(usuario?.perfil ?? 'atendente');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErroGeral(null);

    const novos: Record<string, string> = {};
    if (nome.trim() === '' || nome.trim().length > 120) novos.nome = 'Informe o nome (até 120 caracteres).';
    if (!edicao && (login.trim() === '' || login.trim().length > 120)) novos.login = 'Informe o login (até 120 caracteres).';
    // Cadastro exige senha; na edição, senha em branco mantém a atual.
    if ((!edicao || senha !== '') && senha.length < 6) novos.senha = 'A senha deve ter pelo menos 6 caracteres.';
    setErros(novos);
    if (Object.keys(novos).length > 0) return;

    setSalvando(true);
    try {
      if (usuario) {
        await usuarioService.atualizar(usuario.id, { nome: nome.trim(), perfil, ...(senha !== '' ? { senha } : {}) });
        aoSalvar('Usuário atualizado.');
      } else {
        await usuarioService.criar({ nome: nome.trim(), login: login.trim(), senha, perfil });
        aoSalvar('Usuário cadastrado.');
      }
    } catch (err) {
      const erro = lerErro(err);
      // Erro de campo (ex.: 409 login duplicado) aparece embaixo do input; o resto vai no alerta geral.
      if (erro.campo && CAMPOS_DO_FORM.includes(erro.campo)) setErros({ [erro.campo]: erro.mensagem });
      else setErroGeral(erro.mensagem);
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      {erroGeral && <Alerta>{erroGeral}</Alerta>}

      <Campo rotulo="Nome" id="usuario-nome" erro={erros.nome} obrigatorio>
        <Entrada id="usuario-nome" value={nome} onChange={(e) => setNome(e.target.value)} erro={erros.nome} maxLength={120} autoFocus />
      </Campo>

      <Campo
        rotulo="Login"
        id="usuario-login"
        erro={erros.login}
        obrigatorio
        dica={edicao ? 'O login não pode ser alterado.' : undefined}
      >
        <Entrada
          id="usuario-login"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          erro={erros.login}
          maxLength={120}
          disabled={edicao}
          autoComplete="off"
        />
      </Campo>

      <Campo
        rotulo={edicao ? 'Nova senha' : 'Senha'}
        id="usuario-senha"
        erro={erros.senha}
        obrigatorio={!edicao}
        dica={edicao ? 'Deixe em branco para manter a senha atual.' : 'Mínimo de 6 caracteres.'}
      >
        <Entrada
          id="usuario-senha"
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          erro={erros.senha}
          autoComplete="new-password"
        />
      </Campo>

      <Campo
        rotulo="Perfil"
        id="usuario-perfil"
        erro={erros.perfil}
        obrigatorio
        dica={ehEu ? 'Você não pode alterar o próprio perfil.' : undefined}
      >
        <Selecao id="usuario-perfil" value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil)} erro={erros.perfil} disabled={ehEu}>
          {PERFIS.map((p) => (
            <option key={p} value={p}>
              {PERFIL_ROTULO[p]}
            </option>
          ))}
        </Selecao>
      </Campo>

      <div className="flex justify-end gap-2 pt-2">
        <Button variante="secundario" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" carregando={salvando}>
          {edicao ? 'Salvar alterações' : 'Cadastrar usuário'}
        </Button>
      </div>
    </form>
  );
}
