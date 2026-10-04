import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from 'tdesign-react';

type Request = { message: string; resolve: (confirmed: boolean) => void };
const Context = createContext<(message: string) => Promise<boolean>>(() => Promise.resolve(false));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const confirm = useCallback((message: string) => new Promise<boolean>((resolve) => {
    pending.current?.resolve(false);
    pending.current = { message, resolve };
    setRequest(pending.current);
  }), []);
  const finish = (value: boolean) => {
    pending.current?.resolve(value);
    pending.current = null;
    setRequest(null);
  };
  useEffect(() => () => { pending.current?.resolve(false); }, []);
  return <Context.Provider value={confirm}>{children}<Dialog visible={Boolean(request)} header="确认操作" confirmBtn="确定" cancelBtn="取消" onConfirm={() => finish(true)} onClose={() => finish(false)}>{request?.message}</Dialog></Context.Provider>;
}

export const useConfirm = () => useContext(Context);
