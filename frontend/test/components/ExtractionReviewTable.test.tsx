import {act, render, screen, within, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ExtractionReviewTable, type ReviewWorkspace} from '@/components/extraction/review/ExtractionReviewTable';
import {ReviewQuickActions} from '@/components/extraction/review/ReviewQuickActions';
import {useReviewNavigation} from '@/hooks/extraction/useReviewNavigation';
import {useResizableTableColumns} from '@/components/shared/list/useResizableTableColumns';
import {SectionNavLayout} from '@/components/runs/SectionNavLayout';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import type {ExtractionField} from '@/types/extraction';
import type {AISuggestion} from '@/types/ai-extraction';

vi.mock('@/hooks/extraction/useReaderLocate', () => ({useReaderLocate: () => ({locate: vi.fn(), isAvailable: false})}));
const fields = [
  {id: 'a', label: 'Question A with a long wrapped question label', description: 'Complete description for question A', field_type: 'text', is_required: true},
  {id: 'b', label: 'Question B', description: 'Description B', field_type: 'text', is_required: true},
] as ExtractionField[];
const newer: AISuggestion = {id: 'new', runId: 'run', value: 'New proposal', confidence: .8, reasoning: 'New rationale', status: 'pending', timestamp: new Date('2026-09-02')};
const older: AISuggestion = {...newer, id: 'old', value: 'Old proposal', reasoning: 'Old rationale', timestamp: new Date('2026-09-01')};
const getHistory = vi.fn(async () => [newer, older]);
const toggle = vi.fn(async () => true);
const undo = vi.fn(async () => true);
const redo = vi.fn(async () => true);
const resume = vi.fn(async () => true);
function Harness({saving = false, pendingDecision = null, conflicted = false, error = null, canUndo = false, externalDecisions, externalValues, latest = newer}: {saving?: boolean; pendingDecision?: ReviewWorkspace['decisions']['pendingDecision']; conflicted?: boolean; error?: string | null; canUndo?: boolean; externalDecisions?: ReviewWorkspace['decisions']; externalValues?: Record<string, unknown>; latest?: AISuggestion}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const displayedValues = externalValues ?? values;
  const rows = fields.map(field => ({instanceId: 'i', fieldId: field.id, label: field.label, sectionId: 's', pending: !displayedValues[`i_${field.id}`]}));
  const navigation = useReviewNavigation({rows, scope: 'run'});
  const [widths, setWidths] = useState<Record<string, number>>({question: 270, value: 315});
  const columns = useResizableTableColumns({columnWidths: widths, setColumnWidths: setWidths, defaultColumnWidths: {question: 270, value: 315}, storageKey: 'test-columns', bounds: {question: {min: 160, max: 1600}, value: {min: 200, max: 1600}}});
  const [activeProposal, setActiveProposal] = useState<ReviewWorkspace['activeProposal']>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const review: ReviewWorkspace = {proposals: [newer, older].map(p => ({id: p.id, run_id: 'run', instance_id: 'i', field_id: 'a', source: 'ai', source_user_id: null, proposed_value: {value: p.value, verification: {verdict: 'confirmed'}}, confidence_score: p.confidence, rationale: p.reasoning, created_at: p.timestamp.toISOString()})), navigation, widths, columns, activeProposal,
    setActiveProposal: (instanceId, fieldId, proposal) => setActiveProposal(previous => previous?.proposal === proposal && previous?.fieldId === fieldId ? previous : proposal ? {instanceId, fieldId, proposal} : null),
    decisions: externalDecisions ?? {saving, pendingDecision, conflicted, error, canUndo, undoTarget: canUndo ? {instanceId: 'i', fieldId: 'a', id: 'd', expectedId: 'd', predecessorId: null, predecessor: {value: null}, value: {value: 'x'}, proposalRecordId: null} : null, canRedo: false, redoTarget: null, redoLatestLocalDecision: redo, toggle, undoLatestLocalDecision: undo, resumeDraftAfterConflict: resume, acceptedProposalIdFor: () => 'old', isAccepted: p => p.id === 'old' && p.value === older.value},
  };
  const suggestions = {i_a: latest, i_b: {...newer, id: 'b-new', value: 'B proposal'}};
  return <SectionNavLayout items={[{id: 's', label: 'Study', requiredFilled: 1, requiredTotal: 2, state: 'in_progress', level: 0}]} activeId="s" onSelect={() => {}} guideOpen={guideOpen} onGuideOpenChange={setGuideOpen} toolbar={<ReviewQuickActions review={review} rows={rows} suggestions={suggestions} guideOpen={guideOpen} onToggleGuide={() => setGuideOpen(!guideOpen)}/>}>
    <ExtractionReviewTable instanceId="i" fields={fields} values={displayedValues} onValueChange={(id, value) => {const key = `i_${id}`; setValues(previous => ({...previous, [key]: value}));}} aiSuggestions={suggestions} getSuggestionsHistory={getHistory} review={review}/>
  </SectionNavLayout>;
}
beforeEach(() => {vi.clearAllMocks(); localStorage.clear();});

describe('ExtractionReviewTable', () => {
  it('renders semantic columns and accessible editors without persistent descriptions', () => {
    render(<Harness/>);
    expect(screen.getAllByRole('columnheader').map(el => el.textContent)).toEqual(['Question', 'Extracted value', 'AI proposal']);
    expect(screen.getByRole('textbox', {name: fields[0].label})).toBeEnabled();
    expect(screen.queryByText(fields[0].description!)).not.toBeInTheDocument();
    expect(screen.getByRole('rowheader', {name: fields[0].label})).toBeVisible();
  });
  it('keeps one disclosure in a full-span associated row and does not move keyboard focus on history load', async () => {
    const user = userEvent.setup(); render(<Harness/>);
    await user.click(screen.getByRole('button', {name: 'New proposal'}));
    const preview = screen.getByRole('button', {name: 'New proposal'});
    expect(await screen.findByText('New rationale')).toBeVisible();
    expect(document.activeElement).toBe(preview);
    expect(document.getElementById(preview.getAttribute('aria-controls')!)?.closest('td')).toHaveAttribute('colspan', '3');
    await user.click(screen.getByRole('button', {name: 'B proposal'}));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(preview).toHaveAttribute('aria-expanded', 'false');
  });
  // Only one disclosure is open at a time, so opening B collapses A. When A
  // sits above B, the form loses that height and B — the row just clicked —
  // slides up out from under the cursor. jsdom has no layout, so the jump is
  // scripted on the row's own rect; what is asserted is the correction.
  it('keeps the clicked question where it was when a disclosure above it collapses', async () => {
    const user = userEvent.setup();
    const scroller = document.createElement('div');
    scroller.setAttribute('data-radix-scroll-area-viewport', '');
    const container = document.createElement('div');
    scroller.append(container);
    document.body.append(scroller);
    render(<Harness/>, {container});

    await user.click(screen.getByRole('button', {name: 'New proposal'}));
    expect(await screen.findByText('New rationale')).toBeVisible();

    const rowB = screen.getByRole('rowheader', {name: 'Question B'}).closest('tr')!;
    const tops = [400, 220];
    rowB.getBoundingClientRect = () => ({top: tops.shift() ?? 220} as DOMRect);
    scroller.scrollTop = 500;

    await user.click(screen.getByRole('button', {name: 'B proposal'}));

    expect(scroller.scrollTop).toBe(320);
    scroller.remove();
  });
  it('focus exists only in the toolbar and displays the description and disclosure', async () => {
    const user = userEvent.setup(); render(<Harness/>);
    await user.click(screen.getByRole('button', {name: 'Focus question'}));
    expect(screen.getByText(fields[0].description!)).toBeVisible();
    expect(screen.getAllByRole('button', {name: 'Leave focus'})).toHaveLength(1);
    expect(screen.queryByRole('textbox', {name: 'Question B'})).not.toBeInTheDocument();
    expect(await screen.findByText('New rationale')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Next pending question'}));
    expect(screen.getByText('Description B')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Leave focus'})).toBeVisible();
  });
  it('the collapsed check targets latest while the A shortcut targets the selected old card', async () => {
    const user = userEvent.setup(); render(<Harness/>);
    const firstRow = screen.getByRole('rowheader', {name: fields[0].label}).closest('tr')!;
    await user.click(await within(firstRow).findByRole('button', {name: 'Open accepted extraction'}));
    expect(await screen.findByText('Old rationale')).toBeVisible();
    expect(within(screen.getByRole('toolbar')).queryByRole('button', {name: /accept extraction/i})).not.toBeInTheDocument();
    await user.keyboard('a');
    expect(toggle).toHaveBeenLastCalledWith(expect.objectContaining({instanceId: 'i', fieldId: 'a', id: 'old'}));
    await user.click(within(firstRow).getByRole('button', {name: 'Accept extraction'}));
    expect(toggle).toHaveBeenLastCalledWith(expect.objectContaining({instanceId: 'i', fieldId: 'a', id: 'new'}));
  });
  it('guide toggle is first, hiding it reclaims the rail, and undo stays global after navigation', async () => {
    const user = userEvent.setup(); render(<Harness canUndo/>);
    const toolbar = screen.getByRole('toolbar');
    expect(within(toolbar).getAllByRole('button')[0]).toHaveAccessibleName('Collapse sections');
    expect(screen.getByRole('navigation')).toBeVisible();
    await user.click(within(toolbar).getAllByRole('button')[0]);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Next pending question'}));
    await user.click(screen.getByRole('button', {name: 'Undo latest local decision'}));
    expect(undo).toHaveBeenCalledWith();
    expect(toggle).not.toHaveBeenCalled();
  });
  it('undo and redo announce their chords and fire them outside fields only', async () => {
    const user = userEvent.setup();
    const decisions: ReviewWorkspace['decisions'] = {saving: false, pendingDecision: null, conflicted: false, error: null, canUndo: true, undoTarget: {instanceId: 'i', fieldId: 'a', id: 'd', expectedId: 'd', predecessorId: null, predecessor: {value: null}, value: {value: 'x'}, proposalRecordId: null}, canRedo: true, redoTarget: null, redoLatestLocalDecision: redo, toggle, undoLatestLocalDecision: undo, resumeDraftAfterConflict: resume, acceptedProposalIdFor: () => null, isAccepted: () => false};
    render(<Harness externalDecisions={decisions}/>);
    expect(screen.getByRole('button', {name: 'Undo latest local decision'})).toHaveAttribute('aria-keyshortcuts');
    expect(screen.getByRole('button', {name: 'Redo latest undone decision'})).toHaveAttribute('aria-keyshortcuts');
    // jsdom is not a Mac: `mod` is Control here.
    await user.keyboard('{Control>}z{/Control}');
    expect(undo).toHaveBeenCalledOnce();
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(redo).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('textbox', {name: fields[0].label}));
    await user.keyboard('{Control>}z{/Control}');
    expect(undo).toHaveBeenCalledOnce();
  });
  // Optimism is scoped to the CLICKED coordinate: the pending checks paint the
  // decision they are making, an untouched row keeps its authoritative state.
  it('marks only the clicked check pending and optimistic, and never swaps checks to disabled', async () => {
    const user = userEvent.setup();
    const view = render(<Harness/>);
    await user.click(screen.getByRole('button', {name: 'New proposal'}));
    await screen.findByRole('article');
    const firstRow = screen.getByRole('rowheader', {name: fields[0].label}).closest('tr')!;
    const rowCheck = within(firstRow).getByRole('button', {name: 'Accept extraction'});
    const otherCheck = within(screen.getByRole('rowheader', {name: 'Question B'}).closest('tr')!).getByRole('button', {name: 'Accept extraction'});
    const cardCheck = within(screen.getByRole('article')).getByRole('button', {name: 'Accept extraction'});
    view.rerender(<Harness saving pendingDecision={{instanceId: 'i', fieldId: 'a', proposalId: 'new'}}/>);
    for (const check of [rowCheck, otherCheck, cardCheck]) {
      expect(check).toBeInTheDocument();
      expect(check).not.toBeDisabled();
      expect(check).toHaveAttribute('aria-disabled', 'true');
    }
    expect(rowCheck).toHaveAttribute('aria-pressed', 'true');
    expect(cardCheck).toHaveAttribute('aria-pressed', 'true');
    expect(otherCheck).toHaveAttribute('aria-pressed', 'false');
    expect(rowCheck).toHaveAttribute('aria-busy', 'true');
    expect(cardCheck).toHaveAttribute('aria-busy', 'true');
    expect(otherCheck).not.toHaveAttribute('aria-busy');
    await user.click(rowCheck); await user.click(otherCheck);
    expect(toggle).not.toHaveBeenCalled();
    view.rerender(<Harness/>);
    // Same nodes: nothing remounted across pending -> settled.
    expect(within(firstRow).getByRole('button', {name: 'Accept extraction'})).toBe(rowCheck);
    expect(within(screen.getByRole('article')).getByRole('button', {name: 'Accept extraction'})).toBe(cardCheck);
    expect(rowCheck).not.toHaveAttribute('aria-busy');
    expect(rowCheck).not.toHaveAttribute('aria-disabled');
  });
  it('blocks save actions and offers explicit conflict recovery without auto retrying undo', async () => {
    const user = userEvent.setup(); const view = render(<Harness saving canUndo/>);
    expect(screen.getByRole('button', {name: 'Undo latest local decision'})).toBeDisabled();
    for (const button of screen.getAllByRole('button', {name: 'Accept extraction'})) expect(button).toHaveAttribute('aria-disabled', 'true');
    view.rerender(<Harness conflicted canUndo error="Conflict error"/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Conflict error');
    expect(undo).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', {name: 'Resume my retained draft'}));
    expect(resume).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
  });
});

import {FieldValueEditor} from '@/components/extraction/FieldValueEditor';

describe('compact editor accessible names', () => {
  it.each([
    ['select', false, 'combobox'],
    ['select', true, 'combobox'],
    ['multiselect', false, 'button'],
    ['multiselect', true, 'button'],
    ['number', false, 'spinbutton'],
    ['boolean', false, 'switch'],
  ])('names the %s editor with other=%s', (fieldType, allowOther, role) => {
    render(<FieldValueEditor field={{id: 'choice', label: 'Study design', field_type: String(fieldType), allow_other: Boolean(allowOther), allowed_values: [{value: 'code', label: 'Human label'}]}} value="" onChange={() => {}} density="compact"/>);
    expect(screen.getByRole(String(role), {name: 'Study design'})).toBeEnabled();
  });
});

import {ExtractionFormView} from '@/components/extraction/ExtractionFormView';
import type {ExtractionEntityTypeWithFields, ExtractionInstance} from '@/types/extraction';
vi.mock('@/components/extraction/ai/shared/SectionAIExtractButton', () => ({SectionAIExtractButton: ({entityTypeId}: {entityTypeId: string}) => <button aria-label={`Extract section ${entityTypeId}`}/> }));
vi.mock('@/hooks/extraction/useExtractionFormAIActions', () => ({useExtractionFormAIActions: () => ({})}));
const inertDecisions: ReviewWorkspace['decisions'] = {saving: false, pendingDecision: null, conflicted: false, error: null, canUndo: false, undoTarget: null, canRedo: false, redoTarget: null, redoLatestLocalDecision: redo, toggle, undoLatestLocalDecision: undo, resumeDraftAfterConflict: resume, acceptedProposalIdFor: () => null, isAccepted: () => false};
function FormHarness({nested = false, sorted = false, twoSections = false}: {nested?: boolean; sorted?: boolean; twoSections?: boolean}) {
  const [activeEntries, setActiveEntries] = useState<Record<string, string>>({});
  const study = {id: 's', name: 'study', label: 'Study section', description: 'Section description', cardinality: 'one', parent_entity_type_id: null};
  const entityTypes = nested ? [
    {id: 'models', name: 'models', label: 'Models', cardinality: 'many', parent_entity_type_id: null, fields: []},
    {id: 'predictors', name: 'predictors', label: 'Predictors', cardinality: 'many', parent_entity_type_id: 'models', fields: [{...fields[0], id: 'nested', label: 'Nested question'}]},
  ] : twoSections ? [
    {...study, fields: [fields[0]]},
    {id: 't', name: 'outcome', label: 'Outcome section', cardinality: 'one', parent_entity_type_id: null, fields: [fields[1]]},
  ] : [{...study, fields}];
  const instances = nested ? [
    {id: 'm1', label: 'Model one', entity_type_id: 'models', parent_instance_id: null, sort_order: sorted ? 2 : 0},
    {id: 'm2', label: 'Model two', entity_type_id: 'models', parent_instance_id: null, sort_order: sorted ? 1 : 0},
    {id: 'p1', label: 'Predictor one', entity_type_id: 'predictors', parent_instance_id: 'm1'},
    {id: 'p2', label: 'Predictor two', entity_type_id: 'predictors', parent_instance_id: 'm2'},
  ] : [{id: 'i', entity_type_id: 's', parent_instance_id: null}, ...(twoSections ? [{id: 'j', entity_type_id: 't', parent_instance_id: null}] : [])];
  return <ExtractionFormView presentation="review-table" reviewDecisions={inertDecisions} reviewerId="me" entityTypes={entityTypes as ExtractionEntityTypeWithFields[]} instances={instances as ExtractionInstance[]} activeEntries={activeEntries} setActiveEntry={(slot, id) => setActiveEntries(previous => ({...previous, [slot]: id}))} handleOpenRenameDialog={() => {}} values={{}} updateValue={() => {}} aiSuggestions={{i_a: newer, p1_nested: newer, p2_nested: newer}} acceptSuggestion={async () => {}} selectSuggestion={async () => {}} rejectSuggestion={async () => {}} getSuggestionsHistory={getHistory} onRefreshInstances={async () => {}} handleAddInstance={() => {}} projectId="p" articleId="article" templateId="template" runId="run"/>;
}
describe('production form presentation integration', () => {
  it('does not prefetch histories for the table and keeps section extraction available collapsed', async () => {
    const user = userEvent.setup(); render(<FormHarness/>);
    expect(getHistory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', {name: /Study section.*0\/2/, expanded: true}));
    expect(screen.getByRole('button', {name: 'Extract section s'})).toBeVisible();
    expect(screen.queryByRole('textbox', {name: fields[0].label})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: /Study section.*0\/2/, expanded: false}));
    await user.click(screen.getByRole('button', {name: 'New proposal'}));
    expect(await screen.findByText('New rationale')).toBeVisible();
    expect(getHistory).toHaveBeenCalledTimes(1);
  });
  it('focus mode keeps the section guide on the focused question section', async () => {
    const user = userEvent.setup(); render(<FormHarness twoSections/>);
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('button', {current: true})).toHaveTextContent('Study section');
    act(() => screen.getByRole('rowheader', {name: /Question B/}).querySelector<HTMLElement>('[tabindex="0"]')!.focus());
    expect(within(screen.getByRole('toolbar')).getByText('Question B')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Focus question'}));
    expect(within(screen.getByRole('navigation')).getByRole('button', {current: true})).toHaveTextContent('Outcome section');
  });
  it('question navigation in the same section keeps the destination instead of reselecting its first field', async () => {
    const user = userEvent.setup(); render(<FormHarness/>);
    await user.click(screen.getByRole('button', {name: 'Next pending question'}));
    expect(within(screen.getByRole('toolbar')).getByText('Question B')).toBeVisible();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'review-question-i_b'));
  });
});

it('responds to observed pane width: resizes at 900, hides handles below it, overlays the guide below 600', () => {
  const observers: ResizeObserverCallback[] = [];
  const OriginalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {observers.push(callback);}
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
  const view = render(<FormHarness/>);
  const resize = (width: number) => act(() => observers.forEach(callback => callback([{contentRect: {width}} as ResizeObserverEntry], {} as ResizeObserver)));
  resize(900);
  expect(screen.getAllByRole('separator')).toHaveLength(2);
  resize(899);
  expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  resize(599);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  resize(900);
  expect(screen.getByRole('navigation')).toBeVisible();
  view.unmount();
  global.ResizeObserver = OriginalObserver;
});

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {http, HttpResponse} from 'msw';
import {server} from '@/test/mocks/server';
import {useProposalDecision} from '@/hooks/extraction/useProposalDecision';
import type {ReviewerDecisionResponse} from '@/hooks/runs/types';
import type {components} from '@/types/api/schema';
vi.mock('@/integrations/supabase/client', () => ({supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test'}}}))}}}));
const baseline = {i_a: 'Original A'};
let savedHistory: ReviewerDecisionResponse[];
function WriterHarness({latest, initial = baseline}: {latest?: AISuggestion; initial?: Record<string, unknown>}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const writer = useProposalDecision({runId: 'run', reviewerId: 'me', stage: 'extract', enabled: true, values, baselineValues: initial, decisions: savedHistory, debounceMs: 60000, onConfirmed: (coordinate, value) => {const key = `${coordinate.instanceId}_${coordinate.fieldId}`; setValues(previous => ({...previous, [key]: value}));}});
  return <Harness externalDecisions={writer} externalValues={values} latest={latest}/>;
}
it('an older accepted proposal with a verification envelope shows the accepted indicator while the newer pending check stays neutral', async () => {
  // Real decision logic: the run-detail proposal row carries the stored envelope
  // ({value, verification}); acceptance compares the TYPED value.
  savedHistory = [{id: '1', run_id: 'run', instance_id: 'i', field_id: 'a', reviewer_id: 'me', decision: 'edit', proposal_record_id: 'old', value: {value: older.value}, rationale: null, created_at: '2026-09-15T00:00:01Z'}];
  render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}})}><WriterHarness initial={{i_a: older.value}}/></QueryClientProvider>);
  const firstRow = screen.getByRole('rowheader', {name: fields[0].label}).closest('tr')!;
  expect(within(firstRow).getByRole('button', {name: 'Open accepted extraction'})).toBeVisible();
  expect(within(firstRow).getByRole('button', {name: 'Accept extraction'})).toHaveAttribute('aria-pressed', 'false');
});
it('accepts a served suggestion as its typed value and shows the confirmed acceptance in the row', async () => {
  type Request = components['schemas']['CreateDecisionRequest'];
  savedHistory = [];
  const requests: Request[] = [];
  server.use(
    http.get('*/api/v1/runs/run/view', () => HttpResponse.json({ok: true, data: {run: {id: 'run', stage: 'extract'}, decisions: savedHistory}})),
    http.post('*/api/v1/runs/run/decisions', async ({request}) => {
      const body = await request.json() as Request;
      requests.push(body);
      const row = {id: String(savedHistory.length + 1), run_id: 'run', reviewer_id: 'me', rationale: null, created_at: `2026-09-15T00:00:0${savedHistory.length + 1}Z`, ...body} as ReviewerDecisionResponse;
      savedHistory.push(row);
      return HttpResponse.json({ok: true, data: row});
    }),
  );
  // aiSuggestionService serves the unwrapped typed value; acceptance must send exactly it.
  const user = userEvent.setup();
  render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}})}><WriterHarness latest={newer}/></QueryClientProvider>);
  const firstRow = screen.getByRole('rowheader', {name: fields[0].label}).closest('tr')!;
  await user.click(within(firstRow).getByRole('button', {name: 'Accept extraction'}));
  await waitFor(() => expect(within(firstRow).getByRole('button', {name: 'Unaccept extraction'})).toBeEnabled());
  expect(requests).toEqual([expect.objectContaining({field_id: 'a', proposal_record_id: 'new', value: {value: 'New proposal'}})]);
  expect(within(firstRow).getByRole('button', {name: 'Unaccept extraction'})).toHaveAttribute('aria-pressed', 'true');
});
it('accepts A, disables pending saves, navigates to B, retries failed global undo and restores A only', async () => {
  type Request = components['schemas']['CreateDecisionRequest'];
  savedHistory = [{id: '1', run_id: 'run', instance_id: 'i', field_id: 'a', reviewer_id: 'me', decision: 'edit', proposal_record_id: null, value: {value: 'Original A'}, rationale: null, created_at: '2026-09-15T00:00:01Z'}];
  const requests: Request[] = [];
  let fail = false;
  let release!: () => void;
  let gate: Promise<void> | null = new Promise(resolve => {release = resolve;});
  server.use(
    http.get('*/api/v1/runs/run/view', () => HttpResponse.json({ok: true, data: {run: {id: 'run', stage: 'extract'}, decisions: savedHistory}})),
    http.post('*/api/v1/runs/run/decisions', async ({request}) => {
      const body = await request.json() as Request;
      requests.push(body);
      if (gate) await gate;
      if (fail) return HttpResponse.json({ok: false, error: {code: 'FAILED', message: 'Save failed'}}, {status: 500});
      const row = {...savedHistory[0], ...body, id: String(savedHistory.length + 1), created_at: `2026-09-15T00:00:0${savedHistory.length + 1}Z`} as ReviewerDecisionResponse;
      savedHistory.push(row);
      return HttpResponse.json({ok: true, data: row});
    }),
  );
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const user = userEvent.setup();
  render(<QueryClientProvider client={queryClient}><WriterHarness/></QueryClientProvider>);
  await user.keyboard('a');
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(screen.getByRole('textbox', {name: fields[0].label})).toHaveValue('Original A');
  expect(screen.getByRole('button', {name: 'Undo latest local decision'})).toBeDisabled();
  await act(async () => {release(); gate = null;});
  await waitFor(() => expect(screen.getByRole('textbox', {name: fields[0].label})).toHaveValue('New proposal'));
  await user.click(screen.getByRole('button', {name: 'Next pending question'}));
  fail = true;
  await user.click(screen.getByRole('button', {name: 'Undo latest local decision'}));
  await screen.findByRole('alert');
  expect(requests.at(-1)).toMatchObject({field_id: 'a', expected_current_decision_id: '2'});
  expect(screen.getByRole('button', {name: 'Undo latest local decision'})).toBeEnabled();
  fail = false;
  await user.click(screen.getByRole('button', {name: 'Undo latest local decision'}));
  await waitFor(() => expect(screen.getByRole('button', {name: 'Undo latest local decision'})).toBeDisabled());
  await user.click(screen.getByRole('button', {name: 'Previous question'}));
  expect(screen.getByRole('textbox', {name: fields[0].label})).toHaveValue('Original A');
  expect(screen.getByRole('textbox', {name: 'Question B'})).toHaveValue('');
  expect(requests.every(request => request.field_id === 'a')).toBe(true);
});

 it('preserves nested repeating coordinates when switching the outer active entry', async () => {
  const user = userEvent.setup(); render(<FormHarness nested/>);
  expect(document.getElementById('review-question-p1_nested')).toBeInTheDocument();
  expect(document.getElementById('review-question-p2_nested')).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', {name: /Model two/}));
  expect(document.getElementById('review-question-p2_nested')).toBeInTheDocument();
  expect(document.getElementById('review-question-p1_nested')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', {name: 'Nested question'})).toBeEnabled();
});

describe('restored entry review navigation', () => {
  it.each([
    ['persisted selection', 'm2', false],
    ['sorted fallback', null, true],
    ['invalid restored selection', 'deleted', true],
  ] as const)('keeps focus and toolbar on the rendered entry after %s', async (_case, stored, sorted) => {
    if (stored) localStorage.setItem('active-entry-article-models-root', stored);
    const user = userEvent.setup();
    const view = render(<FormHarness nested sorted={sorted}/>);
    view.unmount();
    render(<FormHarness nested sorted={sorted}/>);
    expect(document.getElementById('review-question-p2_nested')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Focus question'}));
    expect(document.getElementById('review-question-p2_nested')).toBeVisible();
    await user.keyboard('a');
    expect(toggle).toHaveBeenLastCalledWith(expect.objectContaining({instanceId: 'p2', fieldId: 'nested', id: 'new'}));
  });
});

it('a bare review shortcut stays off a focused closed Select trigger, which keeps its typeahead', async () => {
  const accept = vi.fn(); const onChange = vi.fn();
  function Row() {
    useKeyboardShortcuts({enabled: true, bindings: [{type: 'chord', key: 'a', handler: accept}]});
    return <FieldValueEditor field={{id: 'population', label: 'Population', field_type: 'select', allow_other: false, allowed_values: [{value: 'adults', label: 'Adults'}, {value: 'children', label: 'Children'}]}} value="" onChange={onChange} density="compact"/>;
  }
  const user = userEvent.setup(); render(<Row/>);
  const trigger = screen.getByRole('combobox', {name: 'Population'});
  act(() => trigger.focus());
  await user.keyboard('a');
  expect(onChange).toHaveBeenCalledWith('adults');
  expect(accept).not.toHaveBeenCalled();
  act(() => trigger.blur());
  await user.keyboard('a');
  expect(accept).toHaveBeenCalledTimes(1);
});
