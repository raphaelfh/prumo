/**
 * The wire-contract `state` literals on a derived input, as display.
 *
 * `state` says WHY a row contributed nothing, and the BACKEND is the only
 * thing that decides it — a client that recomputes scope to render this can
 * disagree with the payload it is rendering. Two surfaces read it (the overall
 * banner's breakdown and the per-domain recommendation chip) and a third reads
 * the judgment-level predicate, so the literals and their tones live here
 * rather than in whichever component happened to need them first.
 *
 * What is deliberately NOT shared is each surface's fallback wording for a row
 * carrying no state: an overall's input is a domain ("Not judged"), a
 * recommendation's is a signaling question ("Not answered"). Folding those
 * together would need a parameter and would lose a real distinction.
 */

import { qa } from "@/lib/copy/qa";

/** The wire literal for a row the template's scope rules took out of play. */
export const OUT_OF_SCOPE = "out-of-scope";

export interface StateDisplay {
  text: string;
  tone: string;
}

/**
 * Display for a row's `state`, or null when it carries none.
 *
 * Only `"in-progress"` is a gap a reviewer can act on, so only it is
 * warning-toned. `"unreported"` (the study never did this performance type)
 * and `"out-of-scope"` (the study type takes the whole section out of play)
 * are muted: there is nothing owed.
 */
export function derivedInputStateDisplay(
  state: string | null | undefined,
): StateDisplay | null {
  switch (state) {
    case OUT_OF_SCOPE:
      return { text: qa.outOfScopeValue, tone: "text-muted-foreground" };
    case "unreported":
      return { text: qa.derivedInputUnreported, tone: "text-muted-foreground" };
    case "in-progress":
      return { text: qa.derivedInputInProgress, tone: "text-warning" };
    default:
      return null;
  }
}

/**
 * Whether every input behind a derived judgment is out of scope.
 *
 * The rules exclude whole parts, so there is no mixed case in practice — but
 * the empty guard is explicit because `[].every()` is vacuously true, and an
 * entry whose inputs never resolved must not read as inapplicable.
 */
export function isJudgmentOutOfScope(
  inputs: ReadonlyArray<{ state?: string | null }> | null | undefined,
): boolean {
  return (
    inputs !== null &&
    inputs !== undefined &&
    inputs.length > 0 &&
    inputs.every((input) => input.state === OUT_OF_SCOPE)
  );
}
