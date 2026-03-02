import {createContext, ReactNode, useContext, useState} from 'react';

interface SidebarContextType {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
    mobileOpen: boolean;
    toggleMobile: () => void;
    setMobileOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

interface SidebarProviderProps {
  children: ReactNode;
  defaultCollapsed?: boolean;
}

export function SidebarProvider({
                                    children,
                                    defaultCollapsed = false
}: SidebarProviderProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultCollapsed);
    const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => !prev);
  };

    const toggleMobile = () => {
        setMobileOpen(prev => !prev);
    };

  return (
      <SidebarContext.Provider
          value={{sidebarCollapsed, toggleSidebar, setSidebarCollapsed, mobileOpen, toggleMobile, setMobileOpen}}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
