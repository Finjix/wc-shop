import type { LoginState } from '../types';

interface SessionAuth {
  getSession: () => Promise<{ data: { session?: unknown }; error: unknown }>;
}

export async function readPersistentSession(auth: SessionAuth): Promise<LoginState | null> {
  // getSession restores local credentials and refreshes an expired access token.
  // Unlike getLoginState, it reports refresh/network failures instead of returning null.
  const result = await auth.getSession();
  if (result.error) throw result.error;
  return (result.data.session || null) as LoginState | null;
}
