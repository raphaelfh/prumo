---
status: in_progress
last_reviewed: 2026-09-13
owner: '@raphaelfh'
---

# Configuration as Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the review question and the template instruction out of `AiConfigDialog` into the views that own them, give every Project → Configuration section a URL, and let `lg` dialogs hug their content.

**Architecture:** Project settings reads its section from `?section=`. The review question becomes an inline settings section with its own dirty footer and a discard confirm on section switch. `TemplateInstructionPane` becomes host-agnostic and is mounted by two hosts: the extraction grid inspector (no-selection state) and an inline expander on each QA tool row. `AiConfigDialog` is deleted.

**Tech Stack:** React 19 + TypeScript strict, React Router (`useSearchParams`), TanStack Query, shadcn/Radix, Tailwind v3, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-13-configuration-as-views-design.md` (read §8 amendments first — they override the body).

## Global Constraints

- Run every frontend command from the **repo root** (no `frontend/package.json`).
- English only; every user-facing string goes through `frontend/lib/copy/*.ts`. A copy key with no reference fails `scripts/fitness/check_copy_keys.py`; delete keys whose last consumer you delete, in the same task.
- No dead code: `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` at zero after every task.
- `scripts/fitness/check_file_size.py` fails any `.ts/.tsx` over 800 lines; `TemplateConfigGridPanel.tsx` is at exactly 800 and its test file is frozen at 1038 (never add to it — new panel tests go in a new file).
- `scripts/fitness/check_ui_primitives.py`: no width/height/padding/`min-h-`/`max-h-` class on `<DialogContent>`, `<AlertDialogContent>` or `<SheetContent>`; icon-only buttons are `IconButton`; no `cursor-pointer|default|not-allowed` classes; no `TooltipProvider` outside `App.tsx` (tests excepted).
- Buttons take a named `size` (`sm` for product chrome); never an `h-*` class on a `Button`.
- React Compiler builds with `panicThreshold: 'all_errors'`: no `try/finally` in component bodies; no refs read during render; derive state in render rather than syncing it in an effect.
- Vitest: mock `@/lib/copy` as `t: (_ns, key) => key` only where the neighbouring tests already do; mock any service that imports the API client (it builds the Supabase client at module scope and throws in CI without env).
- Commits: conventional, one per task, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- PR #892 (`fix(shortcuts): gate chords on open AlertDialogs`, merged) already suppresses app chords under the discard confirm; nothing here re-implements it. Merge `origin/dev` into the branch before Task 3.

## File map

| File | Task | Responsibility |
|---|---|---|
| `frontend/components/ui/overlay-frame.ts` | 1 | `lg` = `h-fit` + `max-h-[85dvh]` |
| `frontend/components/ui/dialog.test.tsx` | 1 | frame contract |
| `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx`, `frontend/components/articles/ZoteroImportDialog.tsx` | 1 | loading-body height reserve |
| `.claude/skills/frontend-ux/SKILL.md`, `.claude/skills/ui-styling/SKILL.md` | 1 | docs of the frame |
| `frontend/components/project/ProjectSettings.tsx` | 2, 3 | URL section, rail, discard guard |
| `frontend/lib/copy/project.ts` | 2, 3 | rail + discard copy |
| `frontend/test/components/ProjectSettings.sections.test.tsx` (new) | 2, 3 | URL + guard wiring |
| `frontend/components/project/PicotsPane.tsx` | 3 | inline pane, dirty footer, read-only |
| `frontend/components/project/settings/ReviewQuestionSection.tsx` (new) | 3 | section host |
| `frontend/components/project/settings/ReviewDetailsSection.tsx` | 3 | loses the review-question card |
| `frontend/test/components/ReviewQuestionSection.test.tsx` (new) | 3 | ported PICOTS tests + footer |
| `frontend/lib/copy/aiContext.ts` | 3, 4 | dead keys removed |
| `frontend/components/extraction/TemplateInstructionPane.tsx` | 4 | host-agnostic pane |
| `frontend/components/extraction/TemplateInstructionControl.tsx` | 4 | toggle/reveal trigger, no dialog |
| `frontend/components/quality/QualityAssessmentConfiguration.tsx` | 4 | inline expander, drafts |
| `frontend/components/project/AiConfigDialog.tsx`, `frontend/test/AiConfigDialog.test.tsx` | 4 | deleted |
| `frontend/test/components/TemplateInstructionControl.test.tsx` | 4 | trigger contract |
| `frontend/test/components/TemplateInstructionPane.test.tsx` (new) | 4 | pane behaviour |
| `frontend/test/components/QualityAssessmentConfigurationControls.test.tsx` | 4 | expander wiring |
| `frontend/components/extraction/template-config/useInspectorHost.ts` (new) | 5 | docked/sheet visibility |
| `frontend/components/extraction/template-config/TemplateInspectorTemplatePane.tsx` (new) | 5 | no-selection pane |
| `frontend/components/extraction/template-config/TemplateInspector.tsx` | 5 | renders the template pane |
| `frontend/components/extraction/template-config/TemplateConfigGridPanel.tsx` | 5 | template focus + instruction prop |
| `frontend/components/extraction/TemplateConfigEditor.tsx` | 5 | owns the draft, mounts ✨ |
| `frontend/components/extraction/template-config/TemplateConfigGridPanel.templateFocus.test.tsx` (new) | 5 | panel wiring |
| `frontend/components/extraction/template-config/TemplateInspectorTemplatePane.test.tsx` (new) | 5 | pane host |
| `frontend/lib/copy/extraction.ts` | 4, 5 | dead keys removed |
| `frontend/pages/ProjectView.tsx` | 6 | every tab full-bleed |
| `frontend/components/extraction/ExtractionInterface.tsx`, `frontend/components/quality/QualityAssessmentInterface.tsx` | 6 | one `p-2` view inset |
| `.claude/skills/frontend-ux/SKILL.md` §6, `.claude/rules/frontend.md` | 6 | gutter rule = Articles |

---

### Task 1: `lg` dialogs hug their content

**Files:**
- Modify: `frontend/components/ui/overlay-frame.ts` (the `lg` variant, ~line 42)
- Modify: `frontend/components/ui/dialog.test.tsx:19`
- Modify: `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx` (loading branch, ~line 151)
- Modify: `frontend/components/articles/ZoteroImportDialog.tsx` (loading branch, ~line 238)
- Modify: `.claude/skills/frontend-ux/SKILL.md:261`, `.claude/skills/ui-styling/SKILL.md:351`

**Interfaces:**
- Consumes: nothing.
- Produces: `dialogFrame({size: 'lg'})` emits `sm:h-fit sm:max-h-[85dvh] sm:max-w-[800px]`.

- [ ] **Step 1: Write the failing test** — change the `lg` row in `dialog.test.tsx` and add a negative assertion:

```tsx
  it.each([
    [undefined, 'sm:max-w-[560px]', 'sm:max-h-[85dvh]'],
    ['sm', 'sm:max-w-[400px]', 'sm:max-h-[85dvh]'],
    ['md', 'sm:max-w-[560px]', 'sm:max-h-[85dvh]'],
    ['lg', 'sm:max-w-[800px]', 'sm:max-h-[85dvh]'],
  ] as const)('size=%s is %s wide and %s tall', (size, width, height) => {
    const dialog = open(
      <DialogContent size={size}>
        <DialogTitle>T</DialogTitle>
        <DialogDescription>D</DialogDescription>
      </DialogContent>,
    );
    expect(classesOf(dialog)).toEqual(expect.arrayContaining([width, height, 'sm:h-fit']));
    // No size is a fixed height: short content must not leave dead space.
    expect(classesOf(dialog)).not.toContain('sm:h-[85dvh]');
  });
```

- [ ] **Step 2: Run it** — `npx vitest run frontend/components/ui/dialog.test.tsx`. Expected: FAIL on `size=lg` (`sm:h-[85dvh]` present, `sm:h-fit` absent).

- [ ] **Step 3: Implement** — in `overlay-frame.ts`:

```ts
        lg: 'sm:h-fit sm:max-h-[85dvh] sm:max-w-[800px]',
```

- [ ] **Step 4: Reserve height on the two loading bodies.** Open each file at the loading branch (`grep -n "loadingTemplates ?" frontend/components/extraction/dialogs/ImportTemplateDialog.tsx`, `grep -n "loadingCollections ?" frontend/components/articles/ZoteroImportDialog.tsx`). The element directly under `? (` is the loading wrapper `<div className="…">`; append `min-h-[50dvh]` to that wrapper's class string (inside the body, never on `DialogContent`). `ArticleFileUploadDialogNew` has no loading body; leave it.

- [ ] **Step 5: Update the docs.** `frontend-ux/SKILL.md` §8 table row becomes:

```markdown
| `lg` | 800px | content, ≤85dvh | lists, pickers, imports — a loading body reserves `min-h-[50dvh]` so the frame does not jump |
```

and `ui-styling/SKILL.md` line 351 becomes: `` jump. `sm`, `md` and `lg` all use `h-fit` + `max-h-[85dvh]`; a loading body reserves its own min height. Width ``.

- [ ] **Step 6: Verify** — `npx vitest run frontend/components/ui/ frontend/components/extraction/dialogs/ frontend/test/components/` then `python3 scripts/fitness/check_ui_primitives.py`. Expected: PASS, gate exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/ui/overlay-frame.ts frontend/components/ui/dialog.test.tsx frontend/components/extraction/dialogs/ImportTemplateDialog.tsx frontend/components/articles/ZoteroImportDialog.tsx .claude/skills/frontend-ux/SKILL.md .claude/skills/ui-styling/SKILL.md
git commit -m "feat(ui): lg dialogs hug their content up to 85dvh"
```

---

### Task 2: Project settings sections in the URL

**Files:**
- Modify: `frontend/components/project/ProjectSettings.tsx`
- Modify: `frontend/lib/copy/project.ts` (tab keys, ~line 28)
- Create: `frontend/test/components/ProjectSettings.sections.test.tsx`

**Interfaces:**
- Consumes: `useProjectSettings(projectId)` → `{project, loading, hasUnsavedChanges, updateProject, saveProject}`; `useProjectMemberRole(projectId)` → `{isManager}`.
- Produces: `export type SectionId = 'basic' | 'review' | 'review-question' | 'ai-engine' | 'team' | 'consensus' | 'advanced'`; the URL param `section`. Task 3 mounts `ReviewQuestionSection` in the `review-question` slot this task renders as a placeholder-free branch.

- [ ] **Step 1: Write the failing test** — create `frontend/test/components/ProjectSettings.sections.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/hooks/useProjectSettings', () => ({
  useProjectSettings: () => ({
    project: {id: 'p1', name: 'P'},
    loading: false,
    hasUnsavedChanges: false,
    updateProject: vi.fn(),
    saveProject: vi.fn(),
  }),
}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => ({isManager: true}),
}));
// The sections are stubs: this file pins navigation wiring only.
vi.mock('@/components/project/settings/BasicInfoSection', () => ({
  BasicInfoSection: () => <div data-testid="section-basic" />,
}));
vi.mock('@/components/project/settings/ReviewDetailsSection', () => ({
  ReviewDetailsSection: () => <div data-testid="section-review" />,
}));
vi.mock('@/components/project/settings/AiEngineSection', () => ({
  AiEngineSection: () => <div data-testid="section-ai-engine" />,
}));
vi.mock('@/components/project/settings/TeamMembersSection', () => ({
  TeamMembersSection: () => <div data-testid="section-team" />,
}));
vi.mock('@/components/project/settings/ReviewConsensusSection', () => ({
  ReviewConsensusSection: () => <div data-testid="section-consensus" />,
}));
vi.mock('@/components/project/settings/AdvancedSettingsSection', () => ({
  AdvancedSettingsSection: () => <div data-testid="section-advanced" />,
}));

import {ProjectSettings} from '@/components/project/ProjectSettings';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/p1${search}`]}>
      <ProjectSettings projectId="p1" />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectSettings sections', () => {
  it('renders the section named in the URL', () => {
    renderAt('?tab=settings&section=ai-engine');
    expect(screen.getByTestId('section-ai-engine')).toBeInTheDocument();
    expect(screen.queryByTestId('section-review')).toBeNull();
  });

  it('falls back to basic for a missing or unknown section', () => {
    renderAt('?tab=settings&section=nope');
    expect(screen.getByTestId('section-basic')).toBeInTheDocument();
  });

  it('writes the section on a rail click and keeps the other params', async () => {
    renderAt('?tab=settings');
    await userEvent.click(screen.getByRole('button', {name: 'tabAiEngine'}));
    expect(screen.getByTestId('section-ai-engine')).toBeInTheDocument();
    const params = new URLSearchParams(screen.getByTestId('search').textContent ?? '');
    expect(params.get('section')).toBe('ai-engine');
    expect(params.get('tab')).toBe('settings');
  });

  it('no longer stacks the AI engine under review details', () => {
    renderAt('?tab=settings&section=review');
    expect(screen.getByTestId('section-review')).toBeInTheDocument();
    expect(screen.queryByTestId('section-ai-engine')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run frontend/test/components/ProjectSettings.sections.test.tsx`. Expected: FAIL (no `tabAiEngine` button; section ignores the URL).

- [ ] **Step 3: Add copy keys** — in `frontend/lib/copy/project.ts`, replace the `tabReviewDesc` line and add the two new tabs after it:

```ts
    tabReviewDesc: 'Title, context, rationale and search strategy',
    tabReviewQuestion: 'Review question',
    tabReviewQuestionDesc: 'What the AI is told this review asks',
    tabAiEngine: 'AI engine',
    tabAiEngineDesc: 'Default model, mode and shared keys',
```

- [ ] **Step 4: Implement** — in `ProjectSettings.tsx`:

Replace the imports line `import {useState} from 'react';` with `import {useSearchParams} from 'react-router';`, add `Bot, MessageSquareText` to the lucide import, and replace `TabId`/`TABS`/the `useState` with:

```tsx
export type SectionId =
  | 'basic'
  | 'review'
  | 'review-question'
  | 'ai-engine'
  | 'team'
  | 'consensus'
  | 'advanced';

interface SectionConfig {
  id: SectionId;
  label: string;
  icon: typeof Info;
  description: string;
}

const SECTIONS: SectionConfig[] = [
  {id: 'basic', label: t('project', 'tabBasic'), icon: Info, description: t('project', 'tabBasicDesc')},
  {id: 'review', label: t('project', 'tabReview'), icon: FileText, description: t('project', 'tabReviewDesc')},
  {
    id: 'review-question',
    label: t('project', 'tabReviewQuestion'),
    icon: MessageSquareText,
    description: t('project', 'tabReviewQuestionDesc'),
  },
  {id: 'ai-engine', label: t('project', 'tabAiEngine'), icon: Bot, description: t('project', 'tabAiEngineDesc')},
  {id: 'team', label: t('project', 'tabTeam'), icon: Users, description: t('project', 'tabTeamDesc')},
  {id: 'consensus', label: t('consensus', 'tabConsensus'), icon: ShieldCheck, description: t('consensus', 'tabConsensusDesc')},
  {id: 'advanced', label: t('project', 'tabAdvanced'), icon: SettingsIcon, description: t('project', 'tabAdvancedDesc')},
];

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

/** The URL owns the section: read every render, never mirrored into state. */
function parseSection(value: string | null): SectionId {
  return value && SECTION_IDS.has(value) ? (value as SectionId) : 'basic';
}
```

In the component body (before the loading early return — hooks first):

```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = parseSection(searchParams.get('section'));
  const selectSection = (id: SectionId) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('section', id);
        return next;
      },
      {replace: true},
    );
```

Rename every `activeTab`/`TABS`/`activeTabConfig` use to `activeSection`/`SECTIONS`/`activeSectionConfig`; the rail button's `onClick` becomes `() => selectSection(section.id)`. Replace the `<aside>` class with `"w-56 shrink-0 overflow-y-auto border-r border-border/40"` (drops the hardcoded hex). Replace the `review` branch and add the new ones:

```tsx
                {activeSection === 'review' && (
                    <ReviewDetailsSection projectId={projectId} project={project} onChange={updateProject}/>
                )}
                {activeSection === 'ai-engine' && <AiEngineSection projectId={projectId}/>}
```

(`review-question` is wired in Task 3; until then it renders nothing below the header.)

- [ ] **Step 5: Run the test** — same command. Expected: PASS (4 tests).

- [ ] **Step 6: Gates** — `npm run typecheck && npx knip --no-tag-hints && python3 scripts/fitness/check_copy_keys.py`. Expected: exit 0 each.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/project/ProjectSettings.tsx frontend/lib/copy/project.ts frontend/test/components/ProjectSettings.sections.test.tsx
git commit -m "feat(settings): project configuration sections live in the URL"
```

---

### Task 3: Review question as an inline settings section

**Files:**
- Modify: `frontend/components/project/PicotsPane.tsx`
- Create: `frontend/components/project/settings/ReviewQuestionSection.tsx`
- Modify: `frontend/components/project/settings/ReviewDetailsSection.tsx`
- Modify: `frontend/components/project/ProjectSettings.tsx`
- Modify: `frontend/lib/copy/project.ts`, `frontend/lib/copy/aiContext.ts`
- Create: `frontend/test/components/ReviewQuestionSection.test.tsx`
- Modify: `frontend/test/components/ProjectSettings.sections.test.tsx`
- Modify: `frontend/test/AiConfigDialog.test.tsx` (remove the two describes this task moves)

**Interfaces:**
- Consumes: `SectionId`, `selectSection` from Task 2; `useAiContext(projectId)` → `{data?: ProjectAiContextRead, isError}`; `useSetAiContext(projectId)` → `{mutate, isPending}`; `useProjectMemberRole(projectId)` → `{isManager}`.
- Produces: `PicotsPane({projectId, onDirtyChange?}: {projectId: string; onDirtyChange?: (dirty: boolean) => void})`; `ReviewQuestionSection({projectId, onDirtyChange}: {projectId: string; onDirtyChange: (dirty: boolean) => void})`.

- [ ] **Step 1: Write the failing section test** — create `frontend/test/components/ReviewQuestionSection.test.tsx`. Port the PICOTS assertions from `frontend/test/AiConfigDialog.test.tsx` (the `describe('AiConfigDialog — review question (no template)')` block: slot labels from the server, verbatim preview, typed PUT body, append-not-replace, criteria only on Population, stored criteria kept visible, refuse to save on a failed read) by copying the mocks, `readModel`, `EMPTY_SLOT`, `PROJECT_ID` and `beforeEach` from that file verbatim and replacing every `render(<AiConfigDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />)` with `render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />)` (declare `const onDirtyChange = vi.fn();` at module scope, reset by `vi.clearAllMocks()`). In the "saves through the typed PUT" test, type into Population first (`await user.type(screen.getByLabelText('Population'), '!')`) because the footer now appears only while dirty, and assert `body.picots.population.description` is `'Adults!'`. In "APPENDS a criterion", likewise the Save button exists after the tag add. Replace the "refuse to save" assertion's copy with the same text. Then add:

```tsx
describe('ReviewQuestionSection footer', () => {
  it('shows no Save until the form differs from the server read', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    expect(screen.queryByRole('button', {name: 'Save'})).toBeNull();
    await user.type(screen.getByLabelText('Population'), ' with HF');
    expect(screen.getByRole('button', {name: 'Save'})).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('Cancel restores the server read and hides the footer', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    await user.type(screen.getByLabelText('Population'), ' with HF');
    await user.click(screen.getByRole('button', {name: 'Cancel'}));

    expect(screen.getByLabelText('Population')).toHaveValue('Adults');
    expect(screen.queryByRole('button', {name: 'Save'})).toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('a successful save clears dirty', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_body, opts) => opts?.onSuccess?.());
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    await user.type(screen.getByLabelText('Population'), ' with HF');
    await user.click(screen.getByRole('button', {name: 'Save'}));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('a non-manager sees the preview and the reason, never the form', () => {
    vi.mocked(useProjectMemberRole).mockReturnValue({
      isManager: false,
    } as unknown as ReturnType<typeof useProjectMemberRole>);
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    expect(screen.getByText('Only project managers can change the review question.')).toBeInTheDocument();
    expect(document.querySelector('pre')?.textContent).toBe('- Population: Adults\n  Include: NYHA II-IV');
    expect(screen.queryByLabelText('Population')).toBeNull();
  });
});
```

Imports at the top of the new file: `import {ReviewQuestionSection} from '@/components/project/settings/ReviewQuestionSection';` plus the ones copied from `AiConfigDialog.test.tsx` minus `AiConfigDialog`, `ReviewDetailsSection`, `useState`, `MemoryRouter`, `QueryClient*`, `within`, and the template-instruction service mock.

- [ ] **Step 2: Run it** — `npx vitest run frontend/test/components/ReviewQuestionSection.test.tsx`. Expected: FAIL (module not found).

- [ ] **Step 3: Rewrite `PicotsPane.tsx`.** Keep the header comment's first three paragraphs; replace its last paragraph with: `It is mounted inline by ReviewQuestionSection (Project → Configuration → Review question). The form owns its draft; the host only hears whether it is dirty.` Then:

`PicotsForm` props become `{initial, pending, onSave, onCancel, onDirtyChange}` where `onDirtyChange: (dirty: boolean) => void`. Track dirty in the handlers, not an effect:

```tsx
function PicotsForm({initial, pending, onSave, onCancel, onDirtyChange}: PicotsFormProps) {
  const [draft, setDraft] = useState<PicotsSlots>(() => initial.picots);
  const [enabled, setEnabled] = useState(() => initial.picots_enabled ?? true);
  const baseline = JSON.stringify([initial.picots, initial.picots_enabled ?? true]);
  const dirty = JSON.stringify([draft, enabled]) !== baseline;

  const commit = (nextDraft: PicotsSlots, nextEnabled: boolean) => {
    setDraft(nextDraft);
    setEnabled(nextEnabled);
    onDirtyChange(JSON.stringify([nextDraft, nextEnabled]) !== baseline);
  };

  const slots = draft as unknown as Record<string, PicotsSlot>;

  const writeSlot = (key: string, next: PicotsSlot) =>
    commit(
      {...(slots as Record<string, PicotsSlot>), [key]: next} as unknown as PicotsSlots,
      enabled,
    );
```

(`updateField`, `addItem`, `removeItem` keep their bodies — they already go through `writeSlot`.) The switch becomes `onCheckedChange={(value) => commit(draft, value)}`. The outer wrapper becomes `<div className="space-y-3">` (drop the fixed-panel flex/overflow wrappers and the `px-5 pb-5`), and the footer becomes:

```tsx
      {dirty && (
        <div className="sticky bottom-0 flex justify-end gap-1.5 border-t border-border/40 bg-background py-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            {t('aiContext', 'cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => onSave({picots: draft, picots_enabled: enabled})}
            disabled={pending}
          >
            {pending ? t('aiContext', 'saving') : t('aiContext', 'save')}
          </Button>
        </div>
      )}
```

`PicotsPane` becomes:

```tsx
interface PicotsPaneProps {
  projectId: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export function PicotsPane({projectId, onDirtyChange}: PicotsPaneProps) {
  const {data, isError} = useAiContext(projectId);
  const mutation = useSetAiContext(projectId);
  // Bumped on Cancel and after a save: the form is keyed by it, so it
  // re-seeds from the latest read without an effect.
  const [formSeq, setFormSeq] = useState(0);
  const reportDirty = (dirty: boolean) => onDirtyChange?.(dirty);

  const reset = () => {
    setFormSeq((n) => n + 1);
    reportDirty(false);
  };

  const save = (body: {picots: PicotsSlots; picots_enabled: boolean}) => {
    mutation.mutate(body, {
      onSuccess: () => {
        toast.success(t('aiContext', 'saveSuccess'));
        reset();
      },
      onError: () => toast.error(t('aiContext', 'saveError')),
    });
  };

  if (isError) {
    // Save stays unreachable: with no read there is no draft, and an empty
    // one would overwrite the stored review question with blanks.
    return <p className="text-[13px] text-destructive">{t('aiContext', 'loadError')}</p>;
  }
  if (!data) {
    return <p className="text-[13px] text-muted-foreground">{t('aiContext', 'saving')}</p>;
  }
  return (
    <PicotsForm
      key={formSeq}
      initial={data}
      pending={mutation.isPending}
      onSave={save}
      onCancel={reset}
      onDirtyChange={reportDirty}
    />
  );
}
```

Also export a read-only preview for the section host, in the same file:

```tsx
/** What a non-manager sees: the server-rendered prompt text, verbatim. */
export function PicotsPreview({projectId}: {projectId: string}) {
  const {data} = useAiContext(projectId);
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-muted/40 p-2.5 text-xs whitespace-pre-wrap">
      {data?.preview ?? t('aiContext', 'previewEmpty')}
    </pre>
  );
}
```

- [ ] **Step 4: Create `ReviewQuestionSection.tsx`:**

```tsx
/**
 * Project → Configuration → Review question. The review question used to be
 * a dialog opened from a card in Review details; it is configuration, so it
 * is a section of the configuration view (spec 2026-09-13 §4.2).
 */
import {SettingsSection} from '@/components/settings';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {t} from '@/lib/copy';

import {PicotsPane, PicotsPreview} from '../PicotsPane';

interface ReviewQuestionSectionProps {
  projectId: string;
  onDirtyChange: (dirty: boolean) => void;
}

export function ReviewQuestionSection({projectId, onDirtyChange}: ReviewQuestionSectionProps) {
  const {isManager} = useProjectMemberRole(projectId);
  return (
    <SettingsSection title={t('aiContext', 'sectionTitle')} description={t('aiContext', 'sectionDesc')}>
      {isManager ? (
        <PicotsPane projectId={projectId} onDirtyChange={onDirtyChange} />
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] text-muted-foreground">{t('aiContext', 'managerOnly')}</p>
          <PicotsPreview projectId={projectId} />
        </div>
      )}
    </SettingsSection>
  );
}
```

- [ ] **Step 5: Run the section test** — same command as Step 2. Expected: PASS.

- [ ] **Step 6: Strip `ReviewDetailsSection.tsx`.** Delete the review-question `SettingsCard` (from `<SettingsCard title={t('aiContext', 'sectionTitle')}` through its closing tag), the `<AiConfigDialog …/>` mount, `const [picotsOpen, setPicotsOpen]`, `useAiContext`, `useProjectMemberRole`, `filled`, `SLOT_KEYS`, and the now-unused imports (`useState`, `Button`, `Tooltip*`, `AiConfigDialog`, `useAiContext`, `useProjectMemberRole`). Replace the file header comment with:

```tsx
/**
 * Review details section — the review's prose fields (title, condition,
 * context, rationale, search strategy). The AI review question (PICOTS) is its
 * own section, `ReviewQuestionSection`, written through a manager-gated typed
 * PUT rather than this section's batched PostgREST draft.
 */
```

`projectId` stays in the props only if still used; if not, remove it from `ReviewDetailsSectionProps` and from the `ProjectSettings` call site.

- [ ] **Step 7: Delete the moved tests** from `frontend/test/AiConfigDialog.test.tsx`: the whole `describe('AiConfigDialog — review question (no template)'…)` and `describe('ReviewDetailsSection PICOTS summary'…)` blocks, and the `ReviewDetailsSection` import.

- [ ] **Step 8: Write the failing guard test** — append to `frontend/test/components/ProjectSettings.sections.test.tsx` (and add the stub mock at the top next to the others):

```tsx
vi.mock('@/components/project/settings/ReviewQuestionSection', () => ({
  ReviewQuestionSection: ({onDirtyChange}: {onDirtyChange: (d: boolean) => void}) => (
    <button type="button" data-testid="section-review-question" onClick={() => onDirtyChange(true)}>
      dirty
    </button>
  ),
}));
```

```tsx
describe('ProjectSettings unsaved review question', () => {
  it('asks before leaving a dirty review question, and Cancel stays', async () => {
    renderAt('?tab=settings&section=review-question');
    await userEvent.click(screen.getByTestId('section-review-question'));
    await userEvent.click(screen.getByRole('button', {name: 'tabTeam'}));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'settingsDiscardCancel'}));
    expect(screen.getByTestId('section-review-question')).toBeInTheDocument();
  });

  it('Discard switches to the section that was clicked', async () => {
    renderAt('?tab=settings&section=review-question');
    await userEvent.click(screen.getByTestId('section-review-question'));
    await userEvent.click(screen.getByRole('button', {name: 'tabTeam'}));
    await userEvent.click(screen.getByRole('button', {name: 'settingsDiscardConfirm'}));

    expect(screen.getByTestId('section-team')).toBeInTheDocument();
  });

  it('switches without asking while the review question is clean', async () => {
    renderAt('?tab=settings&section=review-question');
    await userEvent.click(screen.getByRole('button', {name: 'tabTeam'}));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('section-team')).toBeInTheDocument();
  });
});
```

Run `npx vitest run frontend/test/components/ProjectSettings.sections.test.tsx`. Expected: the three new tests FAIL.

- [ ] **Step 9: Implement the guard** in `ProjectSettings.tsx`. Add copy keys to `project.ts` after `settingsSaveError`:

```ts
    settingsDiscardTitle: 'Discard unsaved changes?',
    settingsDiscardBody: 'Your edits to the review question have not been saved.',
    settingsDiscardCancel: 'Keep editing',
    settingsDiscardConfirm: 'Discard',
```

Add `import {useState} from 'react';` back, the `AlertDialog*` imports from `@/components/ui/alert-dialog`, and `import {ReviewQuestionSection} from './settings/ReviewQuestionSection';`. In the body, after `selectSection`:

```tsx
  const [reviewQuestionDirty, setReviewQuestionDirty] = useState(false);
  const [pendingSection, setPendingSection] = useState<SectionId | null>(null);
  const requestSection = (id: SectionId) => {
    if (id === activeSection) return;
    if (activeSection === 'review-question' && reviewQuestionDirty) {
      setPendingSection(id);
      return;
    }
    selectSection(id);
  };
```

The rail `onClick` becomes `() => requestSection(section.id)`. Add the branch and the dialog (dialog as the last child of the root `div`):

```tsx
                {activeSection === 'review-question' && (
                    <ReviewQuestionSection projectId={projectId} onDirtyChange={setReviewQuestionDirty}/>
                )}
```

```tsx
      <AlertDialog open={pendingSection !== null} onOpenChange={(open) => !open && setPendingSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('project', 'settingsDiscardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('project', 'settingsDiscardBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('project', 'settingsDiscardCancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const next = pendingSection;
                setPendingSection(null);
                setReviewQuestionDirty(false);
                if (next) selectSection(next);
              }}
            >
              {t('project', 'settingsDiscardConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

(If `AlertDialogAction` does not accept `variant`, check `frontend/components/ui/alert-dialog.tsx` and use the prop name it exposes; sub-project 1 added the destructive variant there.)

- [ ] **Step 10: Delete dead copy.** Remove from `aiContext.ts`: `editAction`, `summaryEmpty`, `filledCountFormat`, `disabledNotice`. Run `python3 scripts/fitness/check_copy_keys.py`; delete any other key it reports as newly dead that this task orphaned (never one that was already baselined).

- [ ] **Step 11: Verify** — `npx vitest run frontend/test/components/ProjectSettings.sections.test.tsx frontend/test/components/ReviewQuestionSection.test.tsx frontend/test/AiConfigDialog.test.tsx && npm run typecheck && npx knip --no-tag-hints && npx knip --production --no-tag-hints`. Expected: all PASS / exit 0.

- [ ] **Step 12: Commit**

```bash
git add frontend/components/project frontend/lib/copy/project.ts frontend/lib/copy/aiContext.ts frontend/test/components/ProjectSettings.sections.test.tsx frontend/test/components/ReviewQuestionSection.test.tsx frontend/test/AiConfigDialog.test.tsx
git commit -m "feat(settings): review question is an inline configuration section"
```

---

### Task 4: Template instruction pane without a dialog; QA inline expander

**Files:**
- Modify: `frontend/components/extraction/TemplateInstructionPane.tsx`
- Modify: `frontend/components/extraction/TemplateInstructionControl.tsx`
- Modify: `frontend/components/quality/QualityAssessmentConfiguration.tsx` (instruction controls block, ~lines 204-236)
- Delete: `frontend/components/project/AiConfigDialog.tsx`, `frontend/test/AiConfigDialog.test.tsx`
- Create: `frontend/test/components/TemplateInstructionPane.test.tsx`
- Modify: `frontend/test/components/TemplateInstructionControl.test.tsx`
- Modify: `frontend/test/components/QualityAssessmentConfigurationControls.test.tsx`
- Modify: `frontend/lib/copy/aiContext.ts`, `frontend/lib/copy/extraction.ts`

**Interfaces:**
- Consumes: `useTemplateInstruction(projectId, templateId)` → `{data?: {llm_template_instruction: string | null; default_instruction: string | null}, isLoading}`; `useUpdateTemplateInstruction(projectId, templateId)` → `{mutate, isPending}`.
- Produces:
  - `TemplateInstructionPane({projectId, templateId, draft, onDraftChange}: {projectId: string; templateId: string; draft: string | null; onDraftChange: (draft: string | null) => void})`
  - `TemplateInstructionControl({projectId, templateId, draft, expanded, onActivate}: {projectId: string; templateId: string; draft: string | null; expanded?: boolean; onActivate: () => void})`

- [ ] **Step 1: Write the failing pane test** — create `frontend/test/components/TemplateInstructionPane.test.tsx`, moving the edit/save and reset-to-default cases out of the control test:

```tsx
import {useState} from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const getTemplateInstruction = vi.fn();
const updateTemplateInstruction = vi.fn();
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: (...a: unknown[]) => getTemplateInstruction(...a),
  updateTemplateInstruction: (...a: unknown[]) => updateTemplateInstruction(...a),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {TemplateInstructionPane} from '@/components/extraction/TemplateInstructionPane';

function Host() {
  const [draft, setDraft] = useState<string | null>(null);
  return <TemplateInstructionPane projectId="p1" templateId="t1" draft={draft} onDraftChange={setDraft} />;
}

function renderPane() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={queryClient}>
      <Host />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('TemplateInstructionPane', () => {
  it('edits and saves through the mutation', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Old text', default_instruction: null});
    updateTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'New text'});
    renderPane();
    const textarea = await screen.findByRole('textbox');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'New text');
    await userEvent.click(screen.getByRole('button', {name: 'instructionSave'}));
    await waitFor(() => expect(updateTemplateInstruction).toHaveBeenCalledWith('p1', 't1', 'New text'));
  });

  it('reset-to-default fills the textarea with the origin text', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Customized', default_instruction: 'Origin default'});
    renderPane();
    await userEvent.click(await screen.findByRole('button', {name: 'instructionResetDefault'}));
    expect(screen.getByRole('textbox')).toHaveValue('Origin default');
  });

  it('offers Cancel only while a draft differs, and Cancel discards it', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Old text', default_instruction: null});
    renderPane();
    const textarea = await screen.findByRole('textbox');
    expect(screen.queryByRole('button', {name: 'instructionCancel'})).toBeNull();
    await userEvent.type(textarea, ' plus mine');
    await userEvent.click(screen.getByRole('button', {name: 'instructionCancel'}));
    expect(screen.getByRole('textbox')).toHaveValue('Old text');
  });
});
```

Run `npx vitest run frontend/test/components/TemplateInstructionPane.test.tsx`. Expected: FAIL (the third test — Cancel is always rendered today; also `onClose` is a required prop).

- [ ] **Step 2: Make the pane host-agnostic.** In `TemplateInstructionPane.tsx`: delete `onClose` from the props and its doc line; in `save`'s `onSuccess` delete `onClose();`; change the wrapper to `<div className="flex flex-col gap-2">`; the textarea class becomes `"min-h-40 resize-y text-[13px]"`; render Cancel only when `unsaved`, with `onClick={() => onDraftChange(null)}`; give every button in the row `size="sm"`. Update the component doc comment to: `The template-level general AI instruction editor. Hosted inline by the extraction inspector and the QA configuration row; the host owns the draft so collapsing or re-selecting never destroys it.`

Run the pane test. Expected: PASS.

- [ ] **Step 3: Write the failing control + QA tests.** In `frontend/test/components/TemplateInstructionControl.test.tsx`: delete the `useAiContext` mock, the `MemoryRouter` wrapper and the three dialog-behaviour tests ("expands, edits, and saves…", "reset-to-default…", "preserves an unsaved draft when the dialog is dismissed"); change `renderControl` to accept `{draft = null, expanded, onActivate = vi.fn()}: {draft?: string | null; expanded?: boolean; onActivate?: () => void} = {}` and render `<TemplateInstructionControl projectId="p1" templateId="t1" draft={draft} expanded={expanded} onActivate={onActivate} />`. Add:

```tsx
  it('activates its host instead of opening a dialog', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Set', default_instruction: null});
    const onActivate = vi.fn();
    renderControl({onActivate});
    await userEvent.click(await screen.findByRole('button', {name: /instructionTitle/}));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports expansion only when the host tracks it', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Set', default_instruction: null});
    const {unmount} = renderControl({expanded: true});
    expect(await screen.findByRole('button', {name: /instructionTitle/})).toHaveAttribute('aria-expanded', 'true');
    unmount();
    renderControl();
    expect(await screen.findByRole('button', {name: /instructionTitle/})).not.toHaveAttribute('aria-expanded');
  });

  it('marks an unsaved host draft in its accessible name', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Set', default_instruction: null});
    renderControl({draft: 'Set, edited'});
    expect(await screen.findByRole('button', {name: /instructionTitle/})).toHaveAccessibleName(
      expect.stringContaining('instructionUnsavedDraft'),
    );
  });
```

In `frontend/test/components/QualityAssessmentConfigurationControls.test.tsx`, change the `TemplateInstructionControl` stub to a button that calls `onActivate`, add a pane stub, and add a test:

```tsx
vi.mock('@/components/extraction/TemplateInstructionControl', () => ({
  TemplateInstructionControl: ({templateId, expanded, onActivate}: {templateId: string; expanded?: boolean; onActivate: () => void}) => (
    <button data-testid={`instruction-${templateId}`} aria-expanded={expanded} onClick={onActivate} />
  ),
}));
vi.mock('@/components/extraction/TemplateInstructionPane', () => ({
  TemplateInstructionPane: ({templateId, draft, onDraftChange}: {templateId: string; draft: string | null; onDraftChange: (d: string | null) => void}) => (
    <input data-testid={`pane-${templateId}`} value={draft ?? ''} onChange={(e) => onDraftChange(e.target.value)} />
  ),
}));
```

```tsx
  it('expands one instruction editor inline and keeps its draft across a collapse', async () => {
    const user = userEvent.setup();
    mockTemplates(
      [
        {id: 'clone-probast', global_template_id: 'g-probast', is_active: true},
        {id: 'clone-quadas', global_template_id: 'g-quadas', is_active: true},
      ],
      ['g-probast', 'g-quadas'],
    );
    render(<QualityAssessmentConfiguration projectId={PROJECT_ID} />);

    expect(screen.queryByTestId('pane-clone-probast')).toBeNull();
    await user.click(screen.getByTestId('instruction-clone-probast'));
    expect(screen.getByTestId('instruction-clone-probast')).toHaveAttribute('aria-expanded', 'true');
    await user.type(screen.getByTestId('pane-clone-probast'), 'draft');

    // Opening another tool's editor closes this one — one expander at a time.
    await user.click(screen.getByTestId('instruction-clone-quadas'));
    expect(screen.queryByTestId('pane-clone-probast')).toBeNull();
    expect(screen.getByTestId('pane-clone-quadas')).toBeInTheDocument();

    await user.click(screen.getByTestId('instruction-clone-probast'));
    expect(screen.getByTestId('pane-clone-probast')).toHaveValue('draft');
  });
```

Run `npx vitest run frontend/test/components/TemplateInstructionControl.test.tsx frontend/test/components/QualityAssessmentConfigurationControls.test.tsx`. Expected: FAIL.

- [ ] **Step 4: Rewrite the control.** In `TemplateInstructionControl.tsx`: delete the `AiConfigDialog` import, `useState`, `open`, the local `draft` state and the `<AiConfigDialog …/>` element (the fragment wrapper goes with it). Props become `{projectId, templateId, draft, expanded, onActivate}` (types in Interfaces). `unsaved` is computed from the `draft` prop exactly as before. The `Button` gets `onClick={onActivate}` and `aria-expanded={expanded}`. Replace the header comment's second and last paragraphs with: `The editing surface is TemplateInstructionPane, mounted by the host: the extraction inspector (this trigger reveals it) or an inline expander on a QA tool row (this trigger toggles it, so the host passes expanded). The host owns the draft.`

- [ ] **Step 5: Add the QA expander.** In `QualityAssessmentConfiguration.tsx` add `import { TemplateInstructionPane } from "@/components/extraction/TemplateInstructionPane";` and next to `diffSheetFor`:

```tsx
  // One instruction editor open at a time; drafts are keyed by template so a
  // collapse (or opening another tool) never destroys typed text.
  const [instructionOpenFor, setInstructionOpenFor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
```

Replace the `<TemplateInstructionControl …/>` element with:

```tsx
                      <TemplateInstructionControl
                        projectId={projectId}
                        templateId={activeClone.id}
                        draft={drafts[activeClone.id] ?? null}
                        expanded={instructionOpenFor === activeClone.id}
                        onActivate={() =>
                          setInstructionOpenFor((open) =>
                            open === activeClone.id ? null : activeClone.id,
                          )
                        }
                      />
```

and directly after the closing `</div>` of the `…-config-controls-…` block (still inside the `enabled && activeClone` branch, so wrap both in a fragment), add:

```tsx
                  {enabled && activeClone && instructionOpenFor === activeClone.id ? (
                    <div className="mt-2 pl-7" data-testid={`hitl-quality_assessment-instruction-${global.id}`}>
                      <TemplateInstructionPane
                        projectId={projectId}
                        templateId={activeClone.id}
                        draft={drafts[activeClone.id] ?? null}
                        onDraftChange={(draft) =>
                          setDrafts((prev) => ({...prev, [activeClone.id]: draft}))
                        }
                      />
                    </div>
                  ) : null}
```

- [ ] **Step 6: Delete `AiConfigDialog`.** `git rm frontend/components/project/AiConfigDialog.tsx frontend/test/AiConfigDialog.test.tsx`. Delete now-dead copy: `aiContext.dialogTitle`, `dialogDesc`, `configDialogTitle`, `configDialogDesc`, `picotsScopeHint`; `extraction.instructionTabLabel`, `instructionScopeHint` only if `grep -rn "instructionScopeHint" frontend --include='*.tsx'` is empty (Task 5 reuses it — if Task 5 is not yet done, keep it and let Task 5 consume it). Run `python3 scripts/fitness/check_copy_keys.py` and remove whatever else this task orphaned.

- [ ] **Step 7: Verify** — `npx vitest run frontend/test/components/TemplateInstructionPane.test.tsx frontend/test/components/TemplateInstructionControl.test.tsx frontend/test/components/QualityAssessmentConfigurationControls.test.tsx frontend/test/components/QualityAssessmentConfiguration.test.tsx && npm run typecheck && npm run lint && npx knip --no-tag-hints && npx knip --production --no-tag-hints && python3 scripts/fitness/check_copy_keys.py`. `instructionScopeHint` will be reported dead until Task 5 if you kept it — that is the one expected finding; do not baseline it, Task 5 consumes it in the same PR. Expected otherwise: PASS / exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A frontend/components/extraction/TemplateInstructionPane.tsx frontend/components/extraction/TemplateInstructionControl.tsx frontend/components/quality/QualityAssessmentConfiguration.tsx frontend/components/project/AiConfigDialog.tsx frontend/test frontend/lib/copy
git commit -m "feat(qa): template instruction edits inline; AiConfigDialog removed"
```

---

### Task 5: Extraction template instruction in the grid inspector

**Files:**
- Create: `frontend/components/extraction/template-config/useInspectorHost.ts`
- Create: `frontend/components/extraction/template-config/TemplateInspectorTemplatePane.tsx`
- Modify: `frontend/components/extraction/template-config/TemplateInspector.tsx` (props ~69-99, no-selection branch ~553-562)
- Modify: `frontend/components/extraction/template-config/TemplateConfigGridPanel.tsx`
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx` (state ~88-96, bar ~323-363, panel mount ~401-423)
- Create: `frontend/components/extraction/template-config/TemplateInspectorTemplatePane.test.tsx`
- Create: `frontend/components/extraction/template-config/TemplateConfigGridPanel.templateFocus.test.tsx`
- Modify: `frontend/lib/copy/extraction.ts`

**Interfaces:**
- Consumes: `TemplateInstructionPane` and `TemplateInstructionControl` from Task 4.
- Produces:
  - `useInspectorHost(isNarrow: boolean): {pressed: boolean; sheetOpen: boolean; dockedOpen: boolean; setSheetOpen: (open: boolean) => void; open: () => void; close: () => void; toggle: () => void}`
  - `interface TemplateInstructionSlot {draft: string | null; onDraftChange: (draft: string | null) => void}` (exported from `TemplateInspector.tsx`)
  - `TemplateConfigGridPanel` new props: `instruction: TemplateInstructionSlot; templateFocusSeq: number`
  - `TemplateInspector` new prop: `instruction: TemplateInstructionSlot`

- [ ] **Step 1: Extract the host hook (no behaviour change).** Create `useInspectorHost.ts`:

```ts
import {useState} from 'react';

/**
 * Which inspector host is showing: the docked pane at wide container widths
 * (open by default) or the Sheet below the breakpoint (opt-in — an overlay
 * must never auto-cover the grid on mount). ⌘., the toolbar button, the ✨
 * deep-links and the config bar's AI instruction trigger all act on the
 * ACTIVE host through this one surface.
 */
export function useInspectorHost(isNarrow: boolean) {
  const [dockedOpen, setDockedOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  return {
    dockedOpen,
    sheetOpen,
    setSheetOpen,
    pressed: isNarrow ? sheetOpen : dockedOpen,
    open: () => (isNarrow ? setSheetOpen(true) : setDockedOpen(true)),
    close: () => (isNarrow ? setSheetOpen(false) : setDockedOpen(false)),
    toggle: () => (isNarrow ? setSheetOpen((o) => !o) : setDockedOpen((o) => !o)),
  };
}
```

In `TemplateConfigGridPanel.tsx`: import it; delete the `dockedOpen` and `sheetOpen` `useState`s with their comments (lines ~162-165 and ~170); after `const isNarrow = …` add `const inspector = useInspectorHost(isNarrow);`. In `handleEscapeEscalate`, the first block becomes `if (inspector.pressed) { inspector.close(); focusGridCellSoon(); return; }`. In `handleDeepLink`, replace the two `if (isNarrow)…else…` lines with `inspector.open();`. Delete `toggleInspector` and use `inspector.toggle` at its two call sites. `inspectorPressed={inspector.pressed}`. The Sheet: `open={inspector.sheetOpen && !diffSheetOpen} onOpenChange={inspector.setSheetOpen}`. The docked branch: `inspector.dockedOpen && (`.

Run `npx vitest run frontend/components/extraction/template-config/` — Expected: PASS unchanged. Run `wc -l frontend/components/extraction/template-config/TemplateConfigGridPanel.tsx` — Expected: below 800 (record the number; Step 5 must stay ≤ 800).

- [ ] **Step 2: Write the failing inspector test** — create `TemplateInspectorTemplatePane.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/services/templateService', () => ({updateSection: vi.fn()}));
vi.mock('@/services/extractionFieldService', () => ({updateField: vi.fn()}));
vi.mock('@/components/extraction/TemplateInstructionPane', () => ({
  TemplateInstructionPane: ({templateId, draft}: {templateId: string; draft: string | null}) => (
    <textarea data-testid={`instruction-pane-${templateId}`} defaultValue={draft ?? ''} />
  ),
}));

import {TemplateInspector} from './TemplateInspector';

const base = {
  projectId: 'p1',
  templateId: 't1',
  owningSection: null,
  parentGroupLabel: null,
  onSaveField: vi.fn(),
  saving: false,
  sections: [],
  onMoveField: vi.fn(),
  moveDisabled: false,
  instruction: {draft: 'typed', onDraftChange: vi.fn()},
};

describe('TemplateInspector without a selection', () => {
  it('shows the template instruction editor with the host draft', () => {
    render(<TemplateInspector {...base} field={null} section={null} />);
    expect(screen.getByText('instructionTitle')).toBeInTheDocument();
    expect(screen.getByTestId('instruction-pane-t1')).toHaveValue('typed');
    expect(screen.getByText('inspectorEmptyHint')).toBeInTheDocument();
    expect(screen.queryByText('inspectorEmptyTitle')).toBeNull();
  });
});
```

Run `npx vitest run frontend/components/extraction/template-config/TemplateInspectorTemplatePane.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement the pane and branch.** Create `TemplateInspectorTemplatePane.tsx`:

```tsx
import {TemplateInstructionPane} from '@/components/extraction/TemplateInstructionPane';
import {t} from '@/lib/copy';

import type {TemplateInstructionSlot} from './TemplateInspector';

/**
 * The inspector with nothing selected IS the template: its general AI
 * instruction lives here, beside the grid it ships with on Publish
 * (spec 2026-09-13 §4.3). The select-a-row hint stays as one muted line.
 */
export function TemplateInspectorTemplatePane({
  projectId,
  templateId,
  instruction,
}: {
  projectId: string;
  templateId: string;
  instruction: TemplateInstructionSlot;
}) {
  return (
    <div className="space-y-2" data-testid="template-inspector-template">
      <div className="font-medium">{t('extraction', 'instructionTitle')}</div>
      <p className="text-xs text-muted-foreground">{t('extraction', 'instructionScopeHint')}</p>
      <TemplateInstructionPane
        projectId={projectId}
        templateId={templateId}
        draft={instruction.draft}
        onDraftChange={instruction.onDraftChange}
      />
      <p className="pt-1 text-xs text-muted-foreground">{t('extraction', 'inspectorEmptyHint')}</p>
    </div>
  );
}
```

In `TemplateInspector.tsx` export the slot type above `TemplateInspectorProps`:

```tsx
/** The template instruction draft, owned by the editor so re-selecting a row never destroys it. */
export interface TemplateInstructionSlot {
  draft: string | null;
  onDraftChange: (draft: string | null) => void;
}
```

add `instruction: TemplateInstructionSlot;` to the props (and destructure it), and replace the `if (!field && !section)` body with:

```tsx
    return (
      <aside style={style} className={cn(PANEL_CLASS, className)}>
        <TemplateInspectorTemplatePane
          projectId={projectId}
          templateId={templateId}
          instruction={instruction}
        />
      </aside>
    );
```

Delete `extraction.inspectorEmptyTitle` from `frontend/lib/copy/extraction.ts`. Run the Step 2 test — Expected: PASS.

- [ ] **Step 4: Write the failing panel test** — create `TemplateConfigGridPanel.templateFocus.test.tsx`, copying the `vi.mock` block, the imports it needs, `field()`, `sectionActions`, `stubInsertQueue` and `beforeEach` from `TemplateConfigGridPanel.test.tsx` (never edit that file), then:

```tsx
vi.mock('@/components/extraction/TemplateInstructionPane', () => ({
  TemplateInstructionPane: ({templateId}: {templateId: string}) => <div data-testid={`instruction-pane-${templateId}`} />,
}));

const entityTypes = [
  {id: 'sec', name: 'sec_a', label: 'Section A', description: null, cardinality: 'one', parent_entity_type_id: null, sort_order: 1, fields: [field('f1', 'sec', 'q1', 'Study design', 1)]},
];

const panel = (seq: number) => (
  <TooltipProvider>
    <TemplateConfigGridPanel
      projectId="p1"
      templateId="t1"
      onDeleteField={vi.fn()}
      history={stubStructuralHistory()}
      sectionActions={sectionActions}
      onAddSection={vi.fn()}
      onAddGroup={vi.fn()}
      instruction={{draft: null, onDraftChange: vi.fn()}}
      templateFocusSeq={seq}
    />
  </TooltipProvider>
);

describe('TemplateConfigGridPanel — template focus', () => {
  beforeEach(() => {
    vi.mocked(useTemplateEntityTypes).mockReturnValue({entityTypes: entityTypes as never, isLoading: false, isPending: false, isError: false, error: null});
    vi.mocked(useUpdateTemplateField).mockReturnValue({mutate: vi.fn(), isPending: false} as unknown as ReturnType<typeof useUpdateTemplateField>);
  });

  it('a new sequence clears the selection and shows the template pane', async () => {
    const {rerender} = render(panel(0));
    await userEvent.click(screen.getByRole('button', {name: 'Study design'}));
    expect(screen.queryByTestId('instruction-pane-t1')).toBeNull();

    rerender(panel(1));
    expect(screen.getByTestId('instruction-pane-t1')).toBeInTheDocument();
  });

  it('opens the narrow sheet host on a new sequence', () => {
    vi.mocked(useContainerNarrow).mockReturnValue(true);
    const {rerender} = render(panel(0));
    expect(screen.queryByTestId('instruction-pane-t1')).toBeNull();
    rerender(panel(1));
    expect(screen.getByTestId('instruction-pane-t1')).toBeInTheDocument();
  });

  it('does not re-open on a rerender with the same sequence', async () => {
    const {rerender} = render(panel(1));
    await userEvent.keyboard('{Escape}');
    rerender(panel(1));
    expect(screen.getByTestId('instruction-pane-t1')).toBeInTheDocument();
  });
});
```

(If the third test's Escape does not reach the panel from `document.body`, focus the grid first with `screen.getByRole('grid').focus()`; the assertion is that a same-sequence rerender does not change what is shown.) Run it — Expected: FAIL (unknown props; no pane on sequence change).

- [ ] **Step 5: Implement template focus in the panel.** Add to `TemplateConfigGridPanelProps`:

```tsx
  /** The template instruction draft (editor-owned), shown when nothing is selected. */
  instruction: TemplateInstructionSlot;
  /** Bumped by the config bar's AI instruction trigger: clear the selection, open the inspector. */
  templateFocusSeq: number;
```

destructure both, import `type TemplateInstructionSlot` from `./TemplateInspector`, and right after `const inspector = useInspectorHost(isNarrow);`:

```tsx
  // A new sequence from the config bar reveals the template pane; compared in
  // render (the focusGroup.seq pattern), never synced in an effect.
  const [handledTemplateFocus, setHandledTemplateFocus] = useState(templateFocusSeq);
  if (templateFocusSeq !== handledTemplateFocus) {
    setHandledTemplateFocus(templateFocusSeq);
    setSelection(null);
    inspector.open();
  }
```

(`setSelection` must be declared before this block — place the block after the `selection` `useState` if needed.) Add `instruction,` to `inspectorProps`. Run the Step 4 test and the whole directory: `npx vitest run frontend/components/extraction/template-config/`. Expected: PASS. Then `wc -l frontend/components/extraction/template-config/TemplateConfigGridPanel.tsx` — Expected: ≤ 800; if over, trim the comments you added here, never an existing one.

- [ ] **Step 6: Wire the editor.** In `TemplateConfigEditor.tsx` import `TemplateInstructionControl`; next to `diffSheetOpen` add:

```tsx
  // The template instruction draft outlives inspector selection changes; the
  // editor is keyed by template id, so a template switch starts clean.
  const [instructionDraft, setInstructionDraft] = useState<string | null>(null);
  const [templateFocusSeq, setTemplateFocusSeq] = useState(0);
```

In the command track, before `<TemplateExportButton …/>`:

```tsx
          <TemplateInstructionControl
            projectId={projectId}
            templateId={templateId}
            draft={instructionDraft}
            onActivate={() => setTemplateFocusSeq((n) => n + 1)}
          />
          <BarDivider />
```

and on `<TemplateConfigGridPanel …>` add `instruction={{draft: instructionDraft, onDraftChange: setInstructionDraft}}` and `templateFocusSeq={templateFocusSeq}`. Rewrite the bar comment's last sentence to: `The ✨ trigger reveals the template's AI instruction in the inspector; the engine lives on the worklist gear and the review question in Project → Configuration.` Update `TemplateConfigPublishControls.tsx:52`'s comment if it still names the removed dialog.

- [ ] **Step 7: Verify** — `npx vitest run frontend/components/extraction frontend/test/components && npm run typecheck && npm run lint && npx knip --no-tag-hints && npx knip --production --no-tag-hints && python3 scripts/fitness/check_copy_keys.py && python3 scripts/fitness/check_file_size.py && python3 scripts/fitness/check_ui_primitives.py`. Expected: all exit 0 (`instructionScopeHint` is live again).

- [ ] **Step 8: Commit**

```bash
git add frontend/components/extraction frontend/lib/copy/extraction.ts
git commit -m "fix(extraction): template AI instruction reachable again, in the inspector"
```

---

### Task 6: One view gutter — the Articles pattern

**Files:**
- Modify: `frontend/pages/ProjectView.tsx` (`FULL_BLEED_TABS` line ~21, the return block ~263-273)
- Modify: `frontend/components/extraction/ExtractionInterface.tsx` (root return, `<div className="flex min-h-0 flex-1 flex-col">` under `<div className="flex h-full min-h-0 flex-col">`, ~line 418)
- Modify: `frontend/components/quality/QualityAssessmentInterface.tsx` (every `p-4 lg:p-6`, ~lines 120, 130, 184, 196, 220)
- Modify: `.claude/skills/frontend-ux/SKILL.md` §6 table first row, `.claude/rules/frontend.md` edge-budget bullet

**Interfaces:**
- Consumes: nothing.
- Produces: every project tab is full-bleed; each view owns exactly one `p-2` inset.

- [ ] **Step 1: Measure before** (spec §4.5; one browser session against this worktree's own Vite on a non-8080 port, logged in as the e2e fixture owner — measure BEFORE editing, keep the session for Step 4). On `/projects/<id>?tab=articles`, `?tab=extraction`, `?tab=quality&qaTab=assessment` run in the page:

```js
(() => {
  const main = document.querySelector('main') ?? document.body;
  const firstInput = main.querySelector('input[type="search"], input, table, [role="grid"]');
  const sidebar = document.querySelector('[data-sidebar], aside');
  return {left: Math.round(firstInput.getBoundingClientRect().left - (sidebar?.getBoundingClientRect().right ?? 0))};
})()
```

Record the three numbers (expected ≈ 8 / 24 / 48).

- [ ] **Step 2: Implement.** `ProjectView.tsx`: delete `const FULL_BLEED_TABS = …` and `const isFullBleed = …`; the return's conditional becomes the single `<div className="flex-1 overflow-y-auto">{renderContent()}</div>`. `ExtractionInterface.tsx`: the content column `<div className="flex min-h-0 flex-1 flex-col">` becomes `<div className="flex min-h-0 flex-1 flex-col p-2">`. `QualityAssessmentInterface.tsx`: replace every `p-4 lg:p-6` with `p-2` and every `pb-4 p-4 lg:p-6` with `p-2` (`grep -n "lg:p-6" frontend/components/quality/QualityAssessmentInterface.tsx` must return nothing afterwards).

- [ ] **Step 3: Docs.** `frontend-ux/SKILL.md` §6 first row becomes:

```markdown
| Page gutter (viewport → workspace)    | `p-2`, owned by the view         | The Articles list's 8px inset. A tab never inherits a padded wrapper from `ProjectView`; each view sets its own single inset. |
```

`.claude/rules/frontend.md`: `Page gutter \`px-4 py-3 lg:px-6\` (never wider)` becomes `Page gutter \`p-2\`, owned by the view (the Articles pattern)`.

- [ ] **Step 4: Verify** — `npx vitest run frontend/components/extraction frontend/components/quality frontend/test/components frontend/pages 2>/dev/null; npm run typecheck && npx knip --no-tag-hints`, then re-run the Step 1 measurement in the SAME browser session. Expected: all three ≈ 8 (±1); no horizontal scrollbar at 390 px on any of the three tabs.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/ProjectView.tsx frontend/components/extraction/ExtractionInterface.tsx frontend/components/quality/QualityAssessmentInterface.tsx .claude/skills/frontend-ux/SKILL.md .claude/rules/frontend.md
git commit -m "feat(layout): every project view uses the Articles gutter"
```

---

### Task 7: Full gate, visual pass, PR

**Files:**
- Modify: `docs/superpowers/plans/2026-09-13-configuration-as-views.md` (tick boxes; `status: shipped` only after merge)

- [ ] **Step 1: Full deterministic gate** — `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`. Expected: every one exit 0. Record the test counts.

- [ ] **Step 2: Visual pass** (`design-review`, one browser session, the worktree's own Vite on a non-8080 port, logged in as the e2e fixture owner): at 1280 and 390 px capture Configuration → Review question (clean, after typing — footer visible, rail click → discard confirm), Configuration → AI engine, extraction Configuration after pressing ✨ (docked pane; then a narrow container → sheet), QA Configuration with an expanded instruction, the Zotero import dialog on its short state (frame hugs). Also hover an `AllowedUnitsList` item (sub-project 1 carry-over). Fix any P0/P1 and re-capture.

- [ ] **Step 3: Push and open the PR** against `dev` with a body that lists the regression fix first (extraction instruction unreachable since #889), the moved surfaces, the deleted dialog, the `lg` frame change, and the gate counts. Arm auto-merge only when the PR is `CLEAN` and no ready peer PR is ahead (`gh pr list --base dev --json number,autoMergeRequest,mergeStateStatus`).
