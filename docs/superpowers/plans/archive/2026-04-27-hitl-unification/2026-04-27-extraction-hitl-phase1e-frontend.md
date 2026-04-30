# Phase 1E: Frontend Shell + PDF Collapsed + HITL Hooks

> Subagent-driven. `- [ ]` checkboxes.

**Goal:** Ship the user-visible UX changes (PDF starts collapsed) plus the shared frontend foundation (`AssessmentShell`, `usePdfPanel`, HITL data hooks) needed for Plan 2 (QA page). Test extensively with vitest + RTL + playwright.

## Spec
`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` §8 (frontend).

---

## Files to create

| File | Purpose |
|---|---|
| `frontend/hooks/usePdfPanel.ts` | Encapsulates PDF show/hide state; `initialOpen` defaults to **false**. |
| `frontend/components/assessment/AssessmentShell.tsx` | Shared layout: PDF panel left + form panel right + header. Used by both extraction and (future) QA pages. |
| `frontend/hooks/runs/useRun.ts` | TanStack Query: GET `/api/v1/runs/{id}`. |
| `frontend/hooks/runs/useCreateProposal.ts` | useMutation: POST `/api/v1/runs/{id}/proposals`. |
| `frontend/hooks/runs/useCreateDecision.ts` | useMutation: POST `/api/v1/runs/{id}/decisions`. |
| `frontend/hooks/runs/useCreateConsensus.ts` | useMutation: POST `/api/v1/runs/{id}/consensus`. |
| `frontend/hooks/runs/useAdvanceRun.ts` | useMutation: POST `/api/v1/runs/{id}/advance`. |
| `frontend/hooks/runs/useCreateRun.ts` | useMutation: POST `/api/v1/runs`. |
| `frontend/hooks/runs/index.ts` | Barrel export. |
| `frontend/test/usePdfPanel.test.ts` | vitest unit tests. |
| `frontend/test/AssessmentShell.test.tsx` | RTL component tests. |
| `frontend/test/hooks-runs.test.tsx` | Mock-API tests for the 6 hooks. |
| `frontend/e2e/flows/pdf-collapsed-default.ui.e2e.ts` | Playwright: assert PDF starts collapsed. |

## Files to modify

- `frontend/pages/ExtractionFullScreen.tsx` — replace direct `useState(true)` with `usePdfPanel({ initialOpen: false })`, OPTIONALLY also wrap in `AssessmentShell` (deferred if too invasive — see below).
- `frontend/components/assessment/UnifiedReviewQueueTable.tsx` — refactor to consume `/api/v1/runs/{id}` aggregate data via `useRun`.
- `frontend/components/assessment/UnifiedConsensusPanel.tsx` — same refactor.

---

## Task 1: `usePdfPanel` hook + tests

**Default collapsed.** Encapsulates open/closed state with toggle method.

```ts
// frontend/hooks/usePdfPanel.ts
import { useState, useCallback } from "react";

export interface UsePdfPanelResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function usePdfPanel(opts?: { initialOpen?: boolean }): UsePdfPanelResult {
  const [isOpen, setIsOpen] = useState(opts?.initialOpen ?? false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(v => !v), []);
  return { isOpen, open, close, toggle };
}
```

Tests in `frontend/test/usePdfPanel.test.ts`:
- defaults to closed (initialOpen omitted)
- defaults to closed (initialOpen=false explicit)
- defaults to open when initialOpen=true
- toggle flips
- open / close idempotent

Run: `npm run test -- usePdfPanel` from project root.

Commit: `feat(frontend): add usePdfPanel hook with collapsed default`

---

## Task 2: `AssessmentShell` component + tests

Shared layout: ResizablePanels with PDF left (collapsible per `usePdfPanel`) + form right + header slot. Children receive `isPdfOpen` so they can render a "show PDF" button when collapsed.

```tsx
// frontend/components/assessment/AssessmentShell.tsx
import { ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { usePdfPanel } from "@/hooks/usePdfPanel";

export interface AssessmentShellProps {
  pdfPanel: ReactNode;
  formPanel: ReactNode;
  header?: ReactNode;
  initialPdfOpen?: boolean;
}

export function AssessmentShell({
  pdfPanel,
  formPanel,
  header,
  initialPdfOpen = false,
}: AssessmentShellProps) {
  const pdf = usePdfPanel({ initialOpen: initialPdfOpen });
  return (
    <div className="flex h-full flex-col" data-testid="assessment-shell">
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {pdf.isOpen ? (
            <>
              <ResizablePanel defaultSize={50} minSize={30} data-testid="assessment-shell-pdf">
                {pdfPanel}
              </ResizablePanel>
              <ResizableHandle />
            </>
          ) : null}
          <ResizablePanel defaultSize={pdf.isOpen ? 50 : 100} minSize={30} data-testid="assessment-shell-form">
            <div className="flex h-full flex-col">
              {!pdf.isOpen ? (
                <button
                  type="button"
                  onClick={pdf.open}
                  className="self-end px-3 py-1 text-sm hover:underline"
                  data-testid="assessment-shell-show-pdf"
                >
                  Show PDF
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pdf.close}
                  className="self-end px-3 py-1 text-sm hover:underline"
                  data-testid="assessment-shell-hide-pdf"
                >
                  Hide PDF
                </button>
              )}
              <div className="flex-1 overflow-auto">{formPanel}</div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
```

Tests in `frontend/test/AssessmentShell.test.tsx`:
- renders without PDF panel by default
- "Show PDF" button toggles to open (Pdf panel + "Hide PDF" button visible)
- "Hide PDF" toggles back to closed
- `initialPdfOpen=true` opens immediately
- Form panel always visible

Run: `npm run test -- AssessmentShell`.

Commit: `feat(frontend): add AssessmentShell shared component for extraction + QA layouts`

---

## Task 3: Flip ExtractionFullScreen PDF default to collapsed

Minimal change: replace the direct `useState(true)` in `frontend/pages/ExtractionFullScreen.tsx:77` with `usePdfPanel({ initialOpen: false })` and adjust the consumers.

DO NOT migrate the whole page to `AssessmentShell` — that's a bigger refactor; defer to a follow-up. The goal here is just the user-visible behavior change.

After the change: existing playwright tests should still pass; if any test depended on PDF being open by default, update the test to click "Show PDF" first.

Commit: `feat(frontend): ExtractionFullScreen — PDF panel starts collapsed by default`

---

## Task 4: HITL data hooks (TanStack Query mutations + queries)

For each hook, follow the existing pattern in `frontend/hooks/`:

```ts
// frontend/hooks/runs/useRun.ts
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api"; // adjust to actual client path

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: ["runs", runId],
    queryFn: async () => {
      if (!runId) throw new Error("runId required");
      const res = await apiClient.get(`/runs/${runId}`);
      return res.data.data; // ApiResponse envelope
    },
    enabled: !!runId,
  });
}
```

Mutations follow the same pattern with `useMutation`. Each invalidates `["runs", runId]` on success.

Tests in `frontend/test/hooks-runs.test.tsx` use MSW (or fetch-mock) to verify each hook hits the right URL with the right body and parses the envelope correctly.

Commit: `feat(frontend): add /v1/runs TanStack Query hooks + tests`

---

## Task 5: Refactor `UnifiedReviewQueueTable` + `UnifiedConsensusPanel`

These are stubs from the 008 era. Update them to consume `useRun(runId)` and call `useCreateDecision`/`useCreateConsensus`.

Keep tests minimal (~3-5 per component): renders with mock data, calls the right mutation on action click.

Commit: `refactor(frontend): UnifiedReviewQueueTable + UnifiedConsensusPanel use /v1/runs hooks`

---

## Task 6: Playwright E2E for PDF default

`frontend/e2e/flows/pdf-collapsed-default.ui.e2e.ts`:

1. Start at extraction page for a known article+template fixture.
2. Assert form panel is full-width (no PDF visible).
3. Click "Show PDF" button.
4. Assert PDF panel is now visible.
5. Click "Hide PDF".
6. Assert PDF panel hidden again.

Run via existing playwright config: `npm run test:e2e:local`.

Commit: `test(frontend): E2E for PDF panel collapsed-by-default behavior`

---

## Task 7: Full frontend suite green

```bash
npm run lint
npm run test
npm run test:e2e:local  # if dev stack is running
```

Apply formatting fixes if any. Commit `chore: ruff/eslint/prettier on Plan 1E files` if needed.

---

## Out of scope

- Full ExtractionFullScreen migration to AssessmentShell (deferred — invasive, cosmetic).
- QualityAssessmentFullScreen page (Plan 2).
- Refactor model_extraction_service / section_extraction_service (deferred from 1C-2).
