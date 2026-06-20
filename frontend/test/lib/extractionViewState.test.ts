/**
 * Unit tests for resolveExtractionViewState — the pure gate that decides what
 * ExtractionFullScreen renders (loader / load-error / run-error / no-fields /
 * form) from the loading+error+data flags of its hooks.
 *
 * Regression under test (#324): the form sources entity_types from the RunView
 * (runDetail). When the session-open or RunView fetch fails or has not yet
 * resolved, runDetail is absent and entity_types is []. The OLD page rendered
 * the "No fields for extraction" empty state in that case — masking a failed /
 * in-flight run-open as a (false) "template has no fields". This gate must only
 * report 'no-fields' when the run is actually LOADED and genuinely empty.
 *
 * Step 1 (RED): module is absent — these tests fail at import.
 */
import {describe, expect, it} from 'vitest';

import {resolveExtractionViewState} from '@/lib/extraction/extractionViewState';

type Input = Parameters<typeof resolveExtractionViewState>[0];

/** A fully-resolved, happy-path input; override per scenario. */
function base(overrides: Partial<Input> = {}): Input {
  return {
    bootstrapLoading: false,
    hasArticleAndTemplate: true,
    runDetailLoaded: true,
    sessionError: null,
    runError: false,
    runErrorMessage: null,
    valuesLoading: false,
    entityTypesCount: 14,
    ...overrides,
  };
}

describe('resolveExtractionViewState', () => {
  it('shows the loader while the page bootstrap (article/project/template) is loading', () => {
    // bootstrap wins over everything, even a would-be run error
    expect(
      resolveExtractionViewState(
        base({bootstrapLoading: true, runDetailLoaded: false, sessionError: 'boom'}),
      ),
    ).toEqual({kind: 'loading'});
  });

  it('shows the load-error when bootstrap finished without an article/template', () => {
    expect(resolveExtractionViewState(base({hasArticleAndTemplate: false}))).toEqual({
      kind: 'load-error',
    });
  });

  it('shows run-error (NOT no-fields) when the session-open failed and runDetail is absent', () => {
    // This is the #324 masking bug: previously rendered "No fields for extraction".
    expect(
      resolveExtractionViewState(
        base({runDetailLoaded: false, sessionError: 'Connection error.', entityTypesCount: 0}),
      ),
    ).toEqual({kind: 'run-error', message: 'Connection error.'});
  });

  it('shows run-error when the RunView fetch errored and runDetail is absent', () => {
    expect(
      resolveExtractionViewState(
        base({
          runDetailLoaded: false,
          runError: true,
          runErrorMessage: 'HTTP 500',
          entityTypesCount: 0,
        }),
      ),
    ).toEqual({kind: 'run-error', message: 'HTTP 500'});
  });

  it('falls back to a null run-error message when no error text is available', () => {
    expect(
      resolveExtractionViewState(base({runDetailLoaded: false, runError: true})),
    ).toEqual({kind: 'run-error', message: null});
  });

  it('shows the loader while the session/run is still resolving (no runDetail, no error)', () => {
    // Previously this rendered a "No fields" flash before the run opened.
    expect(
      resolveExtractionViewState(base({runDetailLoaded: false, entityTypesCount: 0})),
    ).toEqual({kind: 'loading'});
  });

  it('shows the loader while values load even though the run is present', () => {
    expect(resolveExtractionViewState(base({valuesLoading: true}))).toEqual({kind: 'loading'});
  });

  it('shows no-fields only when the run IS loaded and entity_types is genuinely empty', () => {
    expect(resolveExtractionViewState(base({entityTypesCount: 0}))).toEqual({kind: 'no-fields'});
  });

  it('shows ready on the happy path (run loaded, has entity types, values done)', () => {
    expect(resolveExtractionViewState(base())).toEqual({kind: 'ready'});
  });

  it('does not surface a stale error once runDetail has actually loaded', () => {
    // A prior transient sessionError must not override a successfully-loaded run.
    expect(
      resolveExtractionViewState(base({sessionError: 'stale', runError: true})),
    ).toEqual({kind: 'ready'});
  });
});
