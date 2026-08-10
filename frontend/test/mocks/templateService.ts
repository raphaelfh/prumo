/**
 * The shared `vi.mock('@/services/templateService')` module for the
 * Configuration-tab suites (`TemplateConfigPublish`, `TemplateConfigDiffSheet`).
 *
 * Both files used to declare their own copy of this factory — the same
 * spies and the same two refusal classes — so a signature change had to be
 * found twice, or one suite's `instanceof` quietly stopped matching.
 *
 * HOISTING CONTRACT. `vi.mock` factories are hoisted above the test file's
 * imports, so a factory cannot close over a static import. It reaches this
 * module through a dynamic `import()` inside an ASYNC factory, which runs
 * when the mocked module is first requested — by which time this module is
 * fully evaluated:
 *
 *     vi.mock('@/services/templateService', async () => {
 *       const {templateServiceMock} = await import('./mocks/templateService');
 *       return templateServiceMock();
 *     });
 *
 * The real module is never imported here (it pulls in the supabase client,
 * which throws on import when env is absent, e.g. CI). A suite drives the
 * spies below by importing them directly, and reads the refusal classes
 * back from the MOCKED module so `instanceof` matches what the component
 * under test checks.
 */
import {vi} from 'vitest';

export const loadTemplateConfigDiff = vi.fn();
export const loadTemplateVersionHistory = vi.fn();
export const loadTemplateConfigStatus = vi.fn();
export const republishTemplateVersion = vi.fn();
export const discardTemplateDraft = vi.fn();
export const updateSection = vi.fn();

/** Mirrors the real class (B-9c2): a 409 the server deliberately refused,
 * carrying the code and the fields a Discard would strand. */
export class TemplateDiscardRefusal extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly orphans: readonly {
      nodeId: string | null;
      label: string;
    }[] = [],
  ) {
    super(message);
    this.name = 'TemplateDiscardRefusal';
  }
}

/** The publish counterpart (B-9b0 D4): useTemplateRepublish reads this
 * binding on EVERY failed publish, typed or not. */
export class TemplatePublishRefusal extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly sectionLabels: readonly string[] = [],
  ) {
    super(message);
    this.name = 'TemplatePublishRefusal';
  }
}

/** The module shape `vi.mock` returns — spies plus the two real classes. */
export function templateServiceMock() {
  return {
    loadTemplateConfigDiff,
    loadTemplateVersionHistory,
    loadTemplateConfigStatus,
    republishTemplateVersion,
    discardTemplateDraft,
    updateSection,
    TemplateDiscardRefusal,
    TemplatePublishRefusal,
  };
}
