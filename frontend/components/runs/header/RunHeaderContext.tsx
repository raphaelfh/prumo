import { createContext, useContext, type ReactNode } from 'react';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { UserRole } from '@/lib/comparison/permissions';

export type RunKind = 'extraction' | 'qa';

export type StageTransition =
  | { to: string; label: string; tooltip?: string; gate: { ok: true }; onAdvance: () => void | Promise<void> }
  | {
      to: string;
      label: string;
      tooltip?: string;
      gate: { ok: false; reason: string; remaining: number };
      onAdvance: () => void | Promise<void>;
    };

export interface RunHeaderValue {
  kind: RunKind;
  stage: ExtractionRunStage | null;
  isRevision: boolean;
  role?: UserRole;
  isBlind: boolean;
  canReveal: boolean;
  onReveal?: () => void;
  progress: { completed: number; total: number; pct: number };
  reviewers: { count: number; required: number; divergent: number };
  transition: StageTransition | null;
  submitting?: boolean;
  onJumpToDivergence?: () => void;
}

const RunHeaderCtx = createContext<RunHeaderValue | null>(null);

export function RunHeaderProvider({ value, children }: { value: RunHeaderValue; children: ReactNode }) {
  return <RunHeaderCtx.Provider value={value}>{children}</RunHeaderCtx.Provider>;
}

export function useRunHeader(): RunHeaderValue {
  const ctx = useContext(RunHeaderCtx);
  if (!ctx) throw new Error('useRunHeader must be used within <RunHeader>');
  return ctx;
}
