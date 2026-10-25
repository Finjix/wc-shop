import { useEffect } from 'react';

/** Router blockers do not handle reloads, tab/window closure, or external navigation. */
export function useBrowserLeaveWarning(shouldWarn: boolean) {
  useEffect(() => {
    if (!shouldWarn) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require returnValue in addition to preventDefault().
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [shouldWarn]);
}
