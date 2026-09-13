import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { adminApi } from '../lib/api';
import { cloudbaseAuth, cloudbaseEnvId, requireCloudBase } from '../lib/cloudbase';
import type { AdminMember, LoginState } from '../types';

interface AuthContextValue {
  loading: boolean;
  configured: boolean;
  loginState: LoginState | null;
  member: AdminMember | null;
  error: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function memberIsAllowed(member: AdminMember | null) {
  if (!member || member.enabled === false || member.status === 'disabled') return false;
  const source = member.roles || member.role;
  const roles = Array.isArray(source) ? source : [source];
  return roles.some((role) => ['superadmin', 'admin', 'operations', 'inventory', 'customer_service', 'content'].includes(String(role)));
}

async function loadAdminMember() {
  return adminApi.call<AdminMember>('admin.me');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [loginState, setLoginState] = useState<LoginState | null>(null);
  const [member, setMember] = useState<AdminMember | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!cloudbaseAuth || !cloudbaseEnvId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const state = (await cloudbaseAuth.getLoginState()) as LoginState | null;
      if (!state) {
        setLoginState(null);
        setMember(null);
        return;
      }
      const nextMember = await loadAdminMember();
      if (!memberIsAllowed(nextMember)) {
        await cloudbaseAuth.signOut();
        throw new Error('当前账号不是启用中的后台管理员，无法访问管理后台。');
      }
      setLoginState(state);
      setMember(nextMember);
    } catch (err) {
      setLoginState(null);
      setMember(null);
      setError(err instanceof Error ? err.message : '登录状态恢复失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void refresh().then(() => {
      if (!active || !cloudbaseAuth) return;

      const result = cloudbaseAuth.onAuthStateChange((_event: unknown, session: unknown) => {
        if (!active || session) return;
        setLoginState(null);
        setMember(null);
        setLoading(false);
      });
      unsubscribe = result.data.subscription.unsubscribe;
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const { auth } = requireCloudBase();
    setLoading(true);
    setError('');
    try {
      await auth.signInWithUsernameAndPassword(username, password);
      const state = (await auth.getLoginState()) as LoginState | null;
      const nextMember = await loadAdminMember();
      if (!memberIsAllowed(nextMember)) {
        await auth.signOut();
        throw new Error('账号认证成功，但不在 adminMembers 管理员白名单中。');
      }
      setLoginState(state);
      setMember(nextMember);
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败，请检查账号和密码。';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (cloudbaseAuth) await cloudbaseAuth.signOut();
    setLoginState(null);
    setMember(null);
    setError('');
  }, []);

  const value = useMemo(() => ({
    loading,
    configured: Boolean(cloudbaseEnvId),
    loginState,
    member,
    error,
    login,
    logout,
    refresh,
  }), [loading, loginState, member, error, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用。');
  return context;
}
