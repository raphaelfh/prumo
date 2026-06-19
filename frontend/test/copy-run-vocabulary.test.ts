/**
 * Regression guard: the internal HITL "Run" entity term must NOT leak into
 * user-facing copy. The *verb* "to run" ("Run AI") is fine; only the entity
 * *noun* is banned. See:
 * docs/superpowers/specs/2026-05-30-run-user-facing-vocabulary-design.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import copy, { consensus, extraction, qa } from '@/lib/copy';

const here = dirname(fileURLToPath(import.meta.url));

/** Recursively yield every string leaf in a copy namespace tree. */
function* strings(value: unknown): Iterable<string> {
  if (typeof value === 'string') {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* strings(item);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) yield* strings(item);
  }
}

describe('user-facing copy does not leak the internal "Run" entity', () => {
  it('phrases the consensus banner around "article", never "Run"', () => {
    expect(consensus.runsBannerTitle).toBe(
      'These settings only affect articles started from now on',
    );
    expect(consensus.runsBannerBody).toBe(
      'Articles already in progress keep the settings they started with. Changes here apply the next time an article is opened for extraction or assessment.',
    );
    expect(consensus.runsBannerTitle).not.toMatch(/\bRuns?\b/);
    expect(consensus.runsBannerBody).not.toMatch(/\bRuns?\b/);
  });

  it('uses "AI extraction" vocabulary in the AI suggestions panel', () => {
    expect(extraction.aiPanelHistoryTitle).toBe('AI extraction history');
    expect(extraction.aiPanelHistoryDesc).toBe(
      'Previous AI extractions for this article',
    );
    expect(extraction.aiPanelNoRunsFound).toBe('No AI extractions found');
    expect(extraction.aiPanelStatusNotRun).toBe('Not started');
    expect(extraction.panelNotRun).toBe('Not started');
  });

  it('contains no copy value with the capitalized plural entity-noun "Runs"', () => {
    const offenders = [...strings(copy)].filter((s) => /\bRuns\b/.test(s));
    expect(offenders).toEqual([]);
  });

  it('phrases the QA finalize toast as "Assessment finalized.", never "Run finalized"', () => {
    // The toast now reads from the copy layer (qa.finalizationSuccess) rather
    // than an inline literal in the page; assert the copy value directly.
    expect(qa.finalizationSuccess).toBe('Assessment finalized.');
    expect(qa.finalizationSuccess).not.toMatch(/\bRun\b/);
  });

  it('no longer ships the "Finalize run" labels in the shared consensus panel', () => {
    const src = readFileSync(
      resolve(here, '../components/runs/ConsensusPanel.tsx'),
      'utf8',
    );
    // The panel is shared by extraction + QA, so the finalize affordance is
    // phrased neutrally ("Finalize") rather than leaking the internal "run".
    expect(src).not.toMatch(/Finalize run/);
    expect(src).not.toMatch(/finalize the run/);
  });
});
