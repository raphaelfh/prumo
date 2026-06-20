/**
 * Pure gate that decides what ExtractionFullScreen renders from the
 * loading/error/data flags of its hooks.
 *
 * Background (#324 regression): the run-open form sources entity_types from the
 * server RunView (``runDetail``) rather than a live template read. When the
 * session-open or RunView fetch fails — or simply has not resolved yet —
 * ``runDetail`` is absent and the derived ``entity_types`` is ``[]``. The page
 * used to render the "No fields for extraction" empty state in that case,
 * masking a failed / in-flight run-open as a (false) "template has no fields".
 *
 * This gate makes the distinction explicit: ``'no-fields'`` is only reported
 * when the run is actually LOADED and genuinely carries no entity types. A
 * missing run is either ``'loading'`` (still resolving) or ``'run-error'``
 * (open/fetch failed) — never a silent empty state.
 *
 * No hooks, no side-effects, no copy — safe to unit-test and import anywhere.
 */

export type ExtractionViewState =
  | {kind: 'loading'}
  | {kind: 'load-error'}
  | {kind: 'run-error'; message: string | null}
  | {kind: 'no-fields'}
  | {kind: 'ready'};

export interface ExtractionViewStateInput {
  /** Page bootstrap (article/project/template) is still loading. */
  bootstrapLoading: boolean;
  /** Bootstrap finished and produced both an article and a template. */
  hasArticleAndTemplate: boolean;
  /** The RunView (``runDetail``) is present — the run has loaded. */
  runDetailLoaded: boolean;
  /** Session-open error message, if the open() call failed. */
  sessionError: string | null;
  /** The RunView fetch (``useRun``) is in an error state. */
  runError: boolean;
  /** Optional RunView error message for display. */
  runErrorMessage?: string | null;
  /** The extracted-values read is still loading. */
  valuesLoading: boolean;
  /** Number of entity types derived from the loaded RunView. */
  entityTypesCount: number;
}

export function resolveExtractionViewState(
  input: ExtractionViewStateInput,
): ExtractionViewState {
  if (input.bootstrapLoading) {
    return {kind: 'loading'};
  }
  if (!input.hasArticleAndTemplate) {
    return {kind: 'load-error'};
  }

  // The run/session has not produced a RunView yet. Distinguish a real failure
  // (surface it, with retry) from work still in flight (keep the loader) —
  // never fall through to the "no fields" empty state here.
  if (!input.runDetailLoaded) {
    if (input.sessionError || input.runError) {
      return {kind: 'run-error', message: input.sessionError ?? input.runErrorMessage ?? null};
    }
    return {kind: 'loading'};
  }

  // RunView is loaded from here on.
  if (input.valuesLoading) {
    return {kind: 'loading'};
  }
  if (input.entityTypesCount === 0) {
    return {kind: 'no-fields'};
  }
  return {kind: 'ready'};
}
