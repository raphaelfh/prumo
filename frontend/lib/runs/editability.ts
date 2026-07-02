/**
 * Single editability invariant (spec 2026-07-02 D1): the form is editable
 * exactly when autosave persists — both derive from this predicate so the
 * UI can never accept input the backend will drop. Absent/unknown stages
 * (still loading, cancelled) are read-only.
 */
export function isRunEditable(stage: string | null | undefined): boolean {
  return stage === 'extract';
}
