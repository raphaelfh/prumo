/**
 * The QA Configuration tab's per-tool instruction + publish controls.
 *
 * Until this landed, quality-assessment templates had NO instruction editor
 * anywhere: the ✨ control mounts inside the extraction Configuration tab,
 * whose template list filters to `kind: 'extraction'`. That is the surface
 * where the instruction matters most — PROBAST+AI's applicability items are
 * judged "as stated in the review's general instructions".
 *
 * The controls themselves are reused verbatim; what this file pins is the
 * WIRING, which is where the mistakes live: mounting them for a tool that is
 * off, mounting them against the wrong clone, letting two diff sheets stack,
 * and mounting Export/Import — the two publish-family endpoints that really
 * are hard-gated to extraction.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn(), info: vi.fn()}),
}));

vi.mock('@/hooks/hitl/useHITLProjectTemplates', () => ({
  useHITLProjectTemplates: vi.fn(),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({userId: 'cfg-user'}),
}));
vi.mock('@/hooks/shared/useComparisonPermissions', () => ({
  useComparisonPermissions: () => ({loading: true}),
}));
// Pulls the supabase client at import time; the blind toggle is not under
// test here.
vi.mock('@/services/hitlConfigService', () => ({
  setManagerReviewVisibility: vi.fn().mockResolvedValue(undefined),
}));

// The two borrowed controls are rendered as identifiable stubs: this file is
// about the wiring, and their own behaviour is covered by their own suites.
vi.mock('@/components/extraction/TemplateInstructionControl', () => ({
  TemplateInstructionControl: ({templateId}: {templateId: string}) => (
    <div data-testid={`instruction-${templateId}`} />
  ),
}));
vi.mock(
  '@/components/extraction/template-config/TemplateConfigPublishControls',
  () => ({
    TemplateConfigPublishControls: ({
      templateId,
      diffSheetOpen,
      onDiffSheetOpenChange,
    }: {
      templateId: string;
      diffSheetOpen: boolean;
      onDiffSheetOpenChange: (open: boolean) => void;
    }) => (
      <button
        data-testid={`publish-${templateId}`}
        data-open={String(diffSheetOpen)}
        onClick={() => onDiffSheetOpenChange(true)}
      >
        publish
      </button>
    ),
  }),
);

import {useHITLProjectTemplates} from '@/hooks/hitl/useHITLProjectTemplates';
import {QualityAssessmentConfiguration} from '@/components/quality/QualityAssessmentConfiguration';

const PROJECT_ID = 'p-1';
const PROBAST = {id: 'g-probast', name: 'PROBAST+AI', version: '2.2.0', description: null};
const QUADAS = {id: 'g-quadas', name: 'QUADAS-2', version: '1.0.0', description: null};

function mockTemplates(templates: unknown[], enabledGlobals: string[]) {
  vi.mocked(useHITLProjectTemplates).mockReturnValue({
    templates,
    globalTemplates: [PROBAST, QUADAS],
    loading: false,
    error: null,
    cloneTemplate: vi.fn(),
    setTemplateActive: vi.fn(),
    isTemplateImported: (id: string) => enabledGlobals.includes(id),
  } as unknown as ReturnType<typeof useHITLProjectTemplates>);
}

beforeEach(() => vi.clearAllMocks());

describe('QA Configuration per-tool controls', () => {
  it('mounts them against the ACTIVE clone of an enabled tool', () => {
    mockTemplates(
      [
        {id: 'clone-old', global_template_id: 'g-probast', is_active: false},
        {id: 'clone-live', global_template_id: 'g-probast', is_active: true},
      ],
      ['g-probast'],
    );

    render(<QualityAssessmentConfiguration projectId={PROJECT_ID} />);

    // An inactive clone survives a toggle-off, so picking the wrong one would
    // silently edit a template no run uses.
    expect(screen.getByTestId('instruction-clone-live')).toBeInTheDocument();
    expect(screen.queryByTestId('instruction-clone-old')).toBeNull();
  });

  it('does not mount them for a tool that is switched off', () => {
    mockTemplates(
      [{id: 'clone-live', global_template_id: 'g-probast', is_active: true}],
      ['g-probast'],
    );

    render(<QualityAssessmentConfiguration projectId={PROJECT_ID} />);

    expect(screen.getByTestId('publish-clone-live')).toBeInTheDocument();
    // QUADAS-2 is listed but never enabled — no clone, so nothing to configure.
    expect(screen.queryByTestId('publish-g-quadas')).toBeNull();
  });

  it('keeps at most one diff sheet open across tools', async () => {
    const user = userEvent.setup();
    mockTemplates(
      [
        {id: 'clone-probast', global_template_id: 'g-probast', is_active: true},
        {id: 'clone-quadas', global_template_id: 'g-quadas', is_active: true},
      ],
      ['g-probast', 'g-quadas'],
    );

    render(<QualityAssessmentConfiguration projectId={PROJECT_ID} />);

    await user.click(screen.getByTestId('publish-clone-probast'));

    // Two stacked modal sheets trap focus — the same reason the extraction
    // editor hoists this state instead of letting each row own it.
    expect(screen.getByTestId('publish-clone-probast')).toHaveAttribute(
      'data-open',
      'true',
    );
    expect(screen.getByTestId('publish-clone-quadas')).toHaveAttribute(
      'data-open',
      'false',
    );

    await user.click(screen.getByTestId('publish-clone-quadas'));
    expect(screen.getByTestId('publish-clone-probast')).toHaveAttribute(
      'data-open',
      'false',
    );
  });

  it('mounts no import/export affordance', () => {
    mockTemplates(
      [{id: 'clone-live', global_template_id: 'g-probast', is_active: true}],
      ['g-probast'],
    );

    render(<QualityAssessmentConfiguration projectId={PROJECT_ID} />);

    // `to_portable` 404s on a QA template id and `parse_portable_document`
    // 422s — these are the only publish-family endpoints actually gated to
    // extraction, so offering them here would be a dead button.
    expect(screen.queryByRole('button', {name: /import/i})).toBeNull();
    expect(screen.queryByRole('button', {name: /export/i})).toBeNull();
  });
});
