import {createContext, ReactNode, useContext, useEffect, useState} from 'react';

interface SidebarContextType {
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
    mobileOpen: boolean;
    toggleMobile: () => void;
    setMobileOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

const STORAGE_KEY = 'prumo:sidebar:collapsed';

function readInitialCollapsed(fallback: boolean): boolean {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        return fallback;
    } catch {
        return fallback;
    }
}

interface SidebarProviderProps {
    children: ReactNode;
    defaultCollapsed?: boolean;
    /**
     * When false, the collapse state is view-scoped: it ignores the persisted
     * baseline on init (starting at `defaultCollapsed`), never writes
     * localStorage, and does not sync across tabs. Used by focus shells
     * (per-article extraction/QA) so they default collapsed without clobbering
     * the user's project-view preference. See
     * docs/superpowers/specs/2026-06-21-sidebar-sota-polish-design.md §3.
     */
    persist?: boolean;
}

export function SidebarProvider({children, defaultCollapsed = false, persist = true}: SidebarProviderProps) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
        persist ? readInitialCollapsed(defaultCollapsed) : defaultCollapsed,
    );
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        if (!persist) return;
        try {
            localStorage.setItem(STORAGE_KEY, String(sidebarCollapsed));
        } catch {
            /* ignore */
        }
    }, [sidebarCollapsed, persist]);

    useEffect(() => {
        if (!persist) return undefined;
        function onStorage(e: StorageEvent) {
            if (e.key !== STORAGE_KEY || e.newValue == null) return;
            if (e.newValue === 'true') setSidebarCollapsed(true);
            else if (e.newValue === 'false') setSidebarCollapsed(false);
        }
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [persist]);

    const toggleSidebar = () => setSidebarCollapsed((p) => !p);
    const toggleMobile = () => setMobileOpen((p) => !p);

    return (
        <SidebarContext.Provider
            value={{sidebarCollapsed, toggleSidebar, setSidebarCollapsed, mobileOpen, toggleMobile, setMobileOpen}}
        >
            {children}
        </SidebarContext.Provider>
    );
}

export function useSidebar() {
    const ctx = useContext(SidebarContext);
    if (ctx === undefined) throw new Error('useSidebar must be used within a SidebarProvider');
    return ctx;
}
