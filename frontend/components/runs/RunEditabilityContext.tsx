import { createContext, useContext, type ReactNode } from 'react';

import { isRunEditable } from '@/lib/runs/editability';

/**
 * Run-scoped view flags for form/review surfaces: write access (stage-derived)
 * and peer-identity display. One provider per run surface — both screens wrap
 * their form panels (extract AND consensus mounts) in it.
 */
export interface RunEditabilityValue {
  readOnly: boolean;
  /**
   * Caller may see peer identity (`peers_revealed || canSeeOthers` — D3).
   * Gates the popover's "Run by {name}" headers and the generation dialog's
   * "Ran by" rows. Fail-closed: provider-less renders and providers that omit
   * the prop show no identity. Display consistency only — the backend history
   * payload is not scrubbed by this flag (server-side scrub is PR 2 scope).
   */
  showPeerIdentity: boolean;
}

// Editable default: a FieldInput rendered outside any provider (tests,
// dev harness) behaves exactly as before. Identity stays fail-closed.
const DEFAULT: RunEditabilityValue = { readOnly: false, showPeerIdentity: false };

const RunEditabilityCtx = createContext<RunEditabilityValue>(DEFAULT);

export function RunEditabilityProvider({
  stage,
  showPeerIdentity = false,
  children,
}: {
  stage: string | null | undefined;
  showPeerIdentity?: boolean;
  children: ReactNode;
}) {
  const value = { readOnly: !isRunEditable(stage), showPeerIdentity };
  return <RunEditabilityCtx.Provider value={value}>{children}</RunEditabilityCtx.Provider>;
}

export function useRunEditability(): RunEditabilityValue {
  return useContext(RunEditabilityCtx);
}
