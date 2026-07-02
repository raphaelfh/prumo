import { createContext, useContext, type ReactNode } from 'react';

import { isRunEditable } from '@/lib/runs/editability';

export interface RunEditabilityValue {
  readOnly: boolean;
}

// Editable default: a FieldInput rendered outside any provider (tests,
// dev harness) behaves exactly as before.
const EDITABLE: RunEditabilityValue = { readOnly: false };
const READ_ONLY: RunEditabilityValue = { readOnly: true };

const RunEditabilityCtx = createContext<RunEditabilityValue>(EDITABLE);

export function RunEditabilityProvider({
  stage,
  children,
}: {
  stage: string | null | undefined;
  children: ReactNode;
}) {
  const value = isRunEditable(stage) ? EDITABLE : READ_ONLY;
  return <RunEditabilityCtx.Provider value={value}>{children}</RunEditabilityCtx.Provider>;
}

export function useRunEditability(): RunEditabilityValue {
  return useContext(RunEditabilityCtx);
}
