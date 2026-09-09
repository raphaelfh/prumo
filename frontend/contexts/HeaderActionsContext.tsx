/**
 * A generic slot the global Topbar exposes so a PAGE can add one action to
 * the header, without Topbar ever learning what that page is.
 *
 * Topbar is global — it renders on every route — so a page-specific control
 * (e.g. the Articles panel toggle) cannot be wired in as a Topbar prop
 * without coupling the shell to that one feature; the next feature would add
 * another branch. Instead the provider (mounted once, above both Topbar and
 * the routed page content in `AppShell`) holds the current action as state;
 * `useSetHeaderActions` lets a page fill it for as long as it stays mounted
 * and clears it on unmount, and Topbar reads it directly via
 * `useHeaderActions` — never as a prop handed down from a memoized ancestor,
 * which is the documented React Compiler hazard for subscriptions like this
 * one.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface HeaderActionsContextValue {
  actions: ReactNode;
  setActions: (actions: ReactNode) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue | null>(null);

export function HeaderActionsProvider({children}: {children: ReactNode}) {
  const [actions, setActions] = useState<ReactNode>(null);
  const value = useMemo(() => ({actions, setActions}), [actions]);
  return (
    <HeaderActionsContext.Provider value={value}>{children}</HeaderActionsContext.Provider>
  );
}

/** Topbar-side: the action node a page has provided, or null. */
export function useHeaderActions(): ReactNode {
  const ctx = useContext(HeaderActionsContext);
  return ctx?.actions ?? null;
}

/**
 * Page-side: fill the Topbar's header-actions slot for as long as the
 * calling component is mounted. Clears itself on unmount so navigating away
 * never leaves a stale action in the header.
 */
export function useSetHeaderActions(actions: ReactNode): void {
  const ctx = useContext(HeaderActionsContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setActions(actions);
    return () => ctx.setActions(null);
  }, [ctx, actions]);
}
