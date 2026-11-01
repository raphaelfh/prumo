import type {ScreeningPhase} from '@/services/screeningService';

/**
 * The screening keyboard as a pure function: a keydown becomes one action, or
 * `null` to let the key through. Escape is not mapped: the reasons dialog
 * closes itself.
 *
 * Title/abstract: 1 include, 2 exclude, 3 maybe, E arms the reason list;
 * armed, 1–9 picks a reason. Full text: 1 include; 2 or E arm the reason list
 * (a reason is required); 3 does nothing; not_retrieved has no key.
 */
export type ScreeningKeyAction =
  | {kind: 'decide'; decision: 'include' | 'exclude' | 'maybe'}
  | {kind: 'open_reasons'}
  | {kind: 'reason'; index: number}
  | null;

interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

const DECISION_KEYS = {'1': 'include', '2': 'exclude', '3': 'maybe'} as const;

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function screeningKeyAction(
  event: KeyEventLike,
  armed: boolean,
  phase: ScreeningPhase,
): ScreeningKeyAction {
  if (event.metaKey || event.ctrlKey || event.altKey || isTextTarget(event.target)) return null;
  if (armed) {
    return /^[1-9]$/.test(event.key) ? {kind: 'reason', index: Number(event.key) - 1} : null;
  }
  if (event.key === 'e' || event.key === 'E') return {kind: 'open_reasons'};
  if (phase === 'full_text') {
    if (event.key === '1') return {kind: 'decide', decision: 'include'};
    return event.key === '2' ? {kind: 'open_reasons'} : null;
  }
  const decision = DECISION_KEYS[event.key as keyof typeof DECISION_KEYS];
  return decision ? {kind: 'decide', decision} : null;
}
