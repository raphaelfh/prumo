import { createContext, useContext, useState } from 'react';

export interface SectionOpenState {
  /** Whether a section is open — `byDefault` until someone opens or closes it. */
  isOpen: (id: string, byDefault: boolean) => boolean;
  setOpen: (id: string, open: boolean) => void;
}

/** Provided by `SectionNavLayout`. */
export const SectionOpenContext = createContext<SectionOpenState | null>(null);

/**
 * A section accordion's open state. Inside `SectionNavLayout` it is shared, so the
 * rail and the "next required field" jump can open the section; anywhere else it
 * is the accordion's own.
 */
export function useSectionOpen(id: string, byDefault: boolean): [boolean, (open: boolean) => void] {
  const shared = useContext(SectionOpenContext);
  const [local, setLocal] = useState(byDefault);
  if (shared) return [shared.isOpen(id, byDefault), (open) => shared.setOpen(id, open)];
  return [local, setLocal];
}
