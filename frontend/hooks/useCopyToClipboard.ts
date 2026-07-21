/**
 * useCopyToClipboard — copy text and flash a "copied" state for `resetMs`.
 *
 * The clipboard-with-checkmark idiom (copy → show a check → revert after ~2s)
 * was duplicated across the AI-suggestion surfaces (provenance prompt, cited
 * evidence). This is the single home for it.
 *
 * `copy` swallows clipboard rejections (logs them) so callers never need a
 * try/finally — which the React Compiler bans in component/hook bodies.
 */

import {useState} from 'react';

export interface UseCopyToClipboardResult {
  /** True for `resetMs` after a successful copy; never flips on failure. */
  copied: boolean;
  /** Write `text` to the clipboard; flips `copied` only on success. */
  copy: (text: string) => void;
}

export function useCopyToClipboard(resetMs = 2000): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), resetMs);
      })
      .catch((err: unknown) => {
        console.error('Failed to copy to clipboard:', err);
      });
  };

  return {copied, copy};
}
