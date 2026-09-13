import {useState} from 'react';

/**
 * Runs `onFocus` once per new `seq` value — the config bar's ✨ trigger bumps
 * the sequence so a repeated click re-focuses the template instruction.
 *
 * Compared during render (the `focusGroup.seq` pattern), never in an effect
 * and never through a ref: a guarded render-phase update re-renders the
 * calling component before commit. `onFocus` may call that component's own
 * setters; its identity is irrelevant — the sequence comparison is the only
 * guard, so a fresh callback on every render cannot loop.
 */
export function useTemplateFocus(seq: number, onFocus: () => void): void {
  const [handledSeq, setHandledSeq] = useState(seq);
  if (seq !== handledSeq) {
    setHandledSeq(seq);
    onFocus();
  }
}
