import {createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode} from 'react';
import App from './App';

type User = {id: string; email?: string};
type Session = {access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; user: User};
type AuthValue = {user: User; accessToken: string; signOut: () => Promise<void>};
type Mode = 'login' | 'signup' | 'recover';

const projectUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const storageKey = 'amazon-analyzer-auth-session';
const AuthContext = createContext<AuthValue | null>(null);

function configured() {
  return Boolean(projectUrl && anonKey);
}

function sessionFrom(value: Partial<Session> | null): Session | null {
  if (!value?.access_token || !value.refresh_token || !value.user?.id) return null;
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_at: value.expires_at ?? (value.expires_in ? Math.floor(Date.now() / 1000) + value.expires_in : undefined),
    user: value.user,
  };
}

function storeSession(session: Session | null) {
  if (!session) localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, JSON.stringify(session));
}

function readSession(): Session | null {
  try {
    return sessionFrom(JSON.parse(localStorage.getItem(storageKey) || 'null'));
  } catch {
    storeSession(null);
    return null;
  }
}

async function authRequest<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${projectUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.msg || result.message || result.error_description || result.error || '认证服务暂时不可用，请稍后重试。';
    throw new Error(message);
  }
  return result as T;
}

async function refreshSession(session: Session): Promise<Session | null> {
  try {
    const refreshed = await authRequest<Session>('token?grant_type=refresh_token', {refresh_token: session.refresh_token});
    const next = sessionFrom(refreshed);
    storeSession(next);
    return next;
  } catch {
    storeSession(null);
    return null;
  }
}

function AuthScreen() {
  const [recoveryToken, setRecoveryToken] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    return fragment.get('type') === 'recovery' ? fragment.get('access_token') : null;
  });
  const [mode, setMode] = useState<Mode>(recoveryToken ? 'recover' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const title = mode === 'signup' ? '创建账号' : mode === 'recover' ? '重置密码' : '登录工作台';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'signup') {
        if (password.length < 8) throw new Error('密码至少需要 8 位。');
        if (password !== confirmPassword) throw new Error('两次输入的密码不一致。');
        const result = await authRequest<Session & {user?: User}>(`signup?redirect_to=${encodeURIComponent(window.location.origin + window.location.pathname)}`, {email: email.trim(), password});
        const session = sessionFrom(result);
        if (session) {
          storeSession(session);
          window.location.reload();
        } else {
          setNotice('账号已创建。请查收邮箱并完成验证，然后返回此页面登录。');
          setMode('login');
          setPassword('');
          setConfirmPassword('');
        }
      } else if (mode === 'recover' && recoveryToken) {
        if (password.length < 8) throw new Error('密码至少需要 8 位。');
        if (password !== confirmPassword) throw new Error('两次输入的密码不一致。');
        const response = await fetch(`${projectUrl}/auth/v1/user`, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${recoveryToken}`},
          body: JSON.stringify({password}),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.msg || result.message || '密码重置失败，重置链接可能已过期。');
        }
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setRecoveryToken(null);
        setPassword('');
        setConfirmPassword('');
        setNotice('密码已更新，请使用新密码登录。');
        setMode('login');
      } else if (mode === 'recover') {
        await authRequest(`recover?redirect_to=${encodeURIComponent(window.location.origin + window.location.pathname)}`, {email: email.trim()});
        setNotice('如果该邮箱已注册，密码重置邮件很快会发出，请查看收件箱。');
      } else {
        const result = await authRequest<Session>('token?grant_type=password', {email: email.trim(), password});
        const session = sessionFrom(result);
        if (!session) throw new Error('登录没有返回有效会话，请检查邮箱验证状态。');
        storeSession(session);
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 flex items-center justify-center">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-2xl">📊</div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">Amazon Data Analyzer</p>
          <h1 className="mt-2 text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">请使用个人邮箱账号访问数据分析工作台</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {!(mode === 'recover' && recoveryToken) && <label className="block text-sm font-medium text-slate-300">
            邮箱
            <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-blue-500" placeholder="name@example.com" />
          </label>}
          {(mode !== 'recover' || recoveryToken) && <label className="block text-sm font-medium text-slate-300">
            {mode === 'recover' ? '新密码' : '密码'}
            <input required type="password" minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-blue-500" placeholder={mode === 'signup' ? '至少 8 位' : '输入密码'} />
          </label>}
          {(mode === 'signup' || (mode === 'recover' && recoveryToken)) && <label className="block text-sm font-medium text-slate-300">
            确认密码
            <input required type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-blue-500" placeholder="再次输入密码" />
          </label>}
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{notice}</p>}
          <button disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">
            {busy ? '请稍候…' : mode === 'signup' ? '注册账号' : mode === 'recover' ? recoveryToken ? '保存新密码' : '发送重置邮件' : '登录'}
          </button>
        </form>
        <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-blue-300">
          {mode === 'login' ? <>
            <button onClick={() => {setMode('signup'); setError(''); setNotice('');}}>创建新账号</button>
            <button onClick={() => {setMode('recover'); setError(''); setNotice('');}}>忘记密码</button>
          </> : <button onClick={() => {setMode('login'); setError(''); setNotice('');}}>返回登录</button>}
        </div>
        <p className="mt-7 text-center text-xs leading-relaxed text-slate-500">密码由 Supabase Auth 安全管理。登录后上传的 SQP 分析将保存到云端，并向所有登录用户开放查看。</p>
      </section>
    </main>
  );
}

function AuthenticatedApp({session}: {session: Session}) {
  const value = useMemo<AuthValue>(() => ({
    user: session.user,
    accessToken: session.access_token,
    signOut: async () => {
      try { await authRequest('logout', undefined, session.access_token); } finally { storeSession(null); window.location.reload(); }
    },
  }), [session]);
  return <AuthContext.Provider value={value}>
    <div className="relative">
      <App />
      <AccountMenu />
    </div>
  </AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthGate');
  return auth;
}

function AccountMenu() {
  const auth = useContext(AuthContext);
  if (!auth) return null;
  return <div className="fixed right-3 top-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg">
    <span className="max-w-40 truncate">{auth.user.email}</span>
    <button onClick={() => void auth.signOut()} className="rounded-full bg-slate-700 px-2.5 py-1 font-semibold hover:bg-slate-600">退出</button>
  </div>;
}

export default function AuthGate({children}: {children?: ReactNode}) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!configured()) {
      setReady(true);
      return;
    }
    let active = true;
    const initialize = async () => {
      let current = readSession();
      if (current?.expires_at && current.expires_at * 1000 < Date.now() + 30_000) {
        current = await refreshSession(current);
      }
      if (active) {
        setSession(current);
        setReady(true);
      }
    };
    void initialize();
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) setSession(readSession());
    };
    window.addEventListener('storage', onStorage);
    return () => { active = false; window.removeEventListener('storage', onStorage); };
  }, []);

  if (!ready) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">正在检查登录状态…</div>;
  if (!configured()) return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100"><section className="max-w-lg rounded-2xl border border-amber-500/30 bg-slate-900 p-7"><h1 className="text-xl font-bold">登录服务尚未配置</h1><p className="mt-3 text-sm leading-6 text-slate-300">工作台已启用个人账号登录。请先配置 GitHub Actions Variables：VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY，然后重新部署。</p></section></main>;
  if (!session) return <AuthScreen />;
  return <AuthenticatedApp session={session}>{children}</AuthenticatedApp>;
}

