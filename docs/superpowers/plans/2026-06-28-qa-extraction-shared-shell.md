# QA ↔ Extraction shared shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the QA and Extraction session screens onto one shared
split-workspace shell (form-left / PDF-right), add a shared per-domain
"Extract with AI" button to QA, and wire QA so AI-suggestion evidence
locates + highlights in the markdown like Extraction.

**Architecture:** Promote `AssessmentShell` → `components/runs/RunSplitShell`
with two new optional props (`subHeader`, `viewerStore`); both pages adopt it.
A new shared `SectionAIExtractButton` owns `useSectionExtraction`. QA's evidence
highlight is a pure wiring fix (page-level `viewerStore` + `store=` threading +
`subscribeReaderLocate`) — no backend/data change.

**Tech Stack:** React 19 + TS strict, Vite, vitest + @testing-library/react,
`@prumo/pdf-viewer` (Zustand viewer store), shadcn/Radix, react-resizable-panels.

## Global Constraints

- **English only** for code, comments, copy keys.
- All user-facing text via `frontend/lib/copy/` — never hardcode strings.
- **React Compiler** (`panicThreshold: all_errors`): no `try/finally` or `throw`
  in component/hook bodies; IO via services returning `ErrorResult`; use
  `.then().catch()` promise chains.
- Frontend tooling runs from the **repo root** (no `frontend/package.json`).
  In this worktree, `node_modules` resolves upward to the parent checkout.
- Run vitest with `npm run test:run` (NOT `npm test` — watch mode hangs).
- No backend, schema, migration, or RLS changes anywhere in this plan.
- Keep `assessment-shell*` `data-testid` strings on the shell (the QA
  fullscreen test at `frontend/test/QualityAssessmentFullScreen.test.tsx:262-267`
  asserts `assessment-shell`, `assessment-shell-show-pdf`, `assessment-shell-pdf`).

---

## File structure

**New**

- `frontend/components/runs/RunSplitShell.tsx` — shared shell (moved from
  `assessment/AssessmentShell.tsx`; flipped order; `subHeader` + `viewerStore`).
- `frontend/components/runs/RunSplitShell.test.tsx` — shell unit tests
  (migrated + extended).
- `frontend/components/extraction/ai/shared/SectionAIExtractButton.tsx` —
  shared per-section ✨ button.
- `frontend/components/extraction/ai/shared/SectionAIExtractButton.test.tsx`.

**Modified**

- `frontend/components/extraction/ExtractionPDFPanel.tsx` — reduce to
  content-only `ExtractionPdfContent` (drop `ResizableHandle`/`ResizablePanel`).
- `frontend/pages/ExtractionFullScreen.tsx` — adopt `RunSplitShell`;
  `showPDF`→`usePdfPanel`; `subscribeReaderLocate`→`pdf.open()`.
- `frontend/components/extraction/SectionAccordion.tsx` — use
  `SectionAIExtractButton`.
- `frontend/pages/QualityAssessmentFullScreen.tsx` — adopt `RunSplitShell`;
  add `viewerStore` + `store=` + `subscribeReaderLocate`; thread section-extract
  props + handler.
- `frontend/components/assessment/QASectionAccordion.tsx` — render
  `SectionAIExtractButton`; accept `articleId`/`templateId`/`runId`/
  `onExtractionComplete`.

**Removed**

- `frontend/components/assessment/AssessmentShell.tsx`
- `frontend/test/AssessmentShell.test.tsx`

---

## Task 1: `RunSplitShell` (shared split-workspace shell)

**Files:**
- Create: `frontend/components/runs/RunSplitShell.tsx`
- Create: `frontend/components/runs/RunSplitShell.test.tsx`
- Delete: `frontend/components/assessment/AssessmentShell.tsx`,
  `frontend/test/AssessmentShell.test.tsx`

**Interfaces:**
- Consumes: `usePdfPanel` (`@/hooks/usePdfPanel`), `ResizablePanelGroup`/
  `ResizablePanel`/`ResizableHandle` (`@/components/ui/resizable`),
  `ViewerProvider` + `ViewerState` (`@prumo/pdf-viewer`), `StoreApi` (`zustand`).
- Produces: `RunSplitShell`, `RunSplitShellProps { pdfPanel, formPanel, header?,
  subHeader?, initialPdfOpen?, pdfState?, viewerStore? }`.

- [ ] **Step 1: Write the failing test** — `frontend/components/runs/RunSplitShell.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunSplitShell } from "@/components/runs/RunSplitShell";
import { createViewerStore } from "@prumo/pdf-viewer";
import { useReaderLocate } from "@/hooks/extraction/useReaderLocate";

function Probe() {
  const { isAvailable } = useReaderLocate();
  return <div data-testid="probe">{isAvailable ? "avail" : "n/a"}</div>;
}

describe("RunSplitShell", () => {
  it("renders header + form by default; PDF hidden; show button present", () => {
    render(
      <RunSplitShell
        pdfPanel={<div data-testid="pdf-content">PDF</div>}
        formPanel={<div data-testid="form-content">FORM</div>}
        header={<div data-testid="header">HEAD</div>}
      />,
    );
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-content")).not.toBeInTheDocument();
    expect(screen.getByTestId("assessment-shell-show-pdf")).toBeInTheDocument();
  });

  it("form panel renders before the PDF panel in DOM order (form-left)", () => {
    render(
      <RunSplitShell
        initialPdfOpen
        pdfPanel={<div data-testid="pdf-content">PDF</div>}
        formPanel={<div data-testid="form-content">FORM</div>}
      />,
    );
    const form = screen.getByTestId("form-content");
    const pdf = screen.getByTestId("pdf-content");
    // form precedes pdf in document order ⇒ Node.DOCUMENT_POSITION_FOLLOWING (4)
    expect(form.compareDocumentPosition(pdf) & 4).toBeTruthy();
  });

  it("renders subHeader between header and panels", () => {
    render(
      <RunSplitShell
        header={<div data-testid="header">HEAD</div>}
        subHeader={<div data-testid="subheader">SUB</div>}
        pdfPanel={<div>PDF</div>}
        formPanel={<div data-testid="form-content">FORM</div>}
      />,
    );
    expect(screen.getByTestId("subheader")).toBeInTheDocument();
  });

  it("wraps panels in a ViewerProvider only when viewerStore is passed", () => {
    const store = createViewerStore();
    const { rerender } = render(
      <RunSplitShell pdfPanel={<div>PDF</div>} formPanel={<Probe />} />,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("n/a");
    rerender(
      <RunSplitShell viewerStore={store} pdfPanel={<div>PDF</div>} formPanel={<Probe />} />,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("avail");
  });

  it("a formPanel inside the shell drives the SAME viewerStore (locate → reader mode)", () => {
    // Proves the §5.1 invariant: the form panel resolves the shared store, so an
    // evidence-popover locate() reaches the reader. Default mode is not 'reader';
    // locate() switches it.
    const store = createViewerStore();
    function LocateProbe() {
      const { locate, isAvailable } = useReaderLocate();
      return (
        <button data-testid="do-locate" disabled={!isAvailable} onClick={() => locate("hello", 1, [])}>
          go
        </button>
      );
    }
    render(<RunSplitShell viewerStore={store} pdfPanel={<div>PDF</div>} formPanel={<LocateProbe />} />);
    expect(store.getState().mode).not.toBe("reader");
    fireEvent.click(screen.getByTestId("do-locate"));
    expect(store.getState().mode).toBe("reader");
  });

  it("Show/Hide PDF toggles the panel when no pdfState is provided", () => {
    render(
      <RunSplitShell
        pdfPanel={<div data-testid="pdf-content">PDF</div>}
        formPanel={<div>FORM</div>}
      />,
    );
    fireEvent.click(screen.getByTestId("assessment-shell-show-pdf"));
    expect(screen.getByTestId("pdf-content")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("assessment-shell-hide-pdf"));
    expect(screen.queryByTestId("pdf-content")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/components/runs/RunSplitShell.test.tsx`
Expected: FAIL — `Cannot find module '@/components/runs/RunSplitShell'`.

- [ ] **Step 3: Write `RunSplitShell.tsx`**

```tsx
import { ReactNode } from "react";
import type { StoreApi } from "zustand";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ViewerProvider, type ViewerState } from "@prumo/pdf-viewer";
import { usePdfPanel, type UsePdfPanelResult } from "@/hooks/usePdfPanel";

export interface RunSplitShellProps {
  /** PDF/markdown viewer content for the RIGHT panel (order 2). */
  pdfPanel: ReactNode;
  /** Form / evaluation content for the LEFT panel (order 1). */
  formPanel: ReactNode;
  /** Optional sticky header above the panels. */
  header?: ReactNode;
  /** Optional strip between header and panels (e.g. HITL status badges). */
  subHeader?: ReactNode;
  /** When true, the PDF panel starts open. Default false (collapsed). */
  initialPdfOpen?: boolean;
  /** Externally-owned PDF panel state (so a RunHeader.PanelToggle can drive it). */
  pdfState?: UsePdfPanelResult;
  /**
   * Shared viewer store. When provided, BOTH panels are wrapped in one
   * <ViewerProvider store={viewerStore}> so the form panel's evidence popover
   * (useReaderLocate) and the PDF reader resolve the SAME store. The PDF
   * content passed as `pdfPanel` MUST also thread `store={viewerStore}` into
   * its <PrumoPdfViewer> — the provider wrap alone is not sufficient because
   * Viewer.Root self-creates a store when none is passed.
   */
  viewerStore?: StoreApi<ViewerState>;
}

/**
 * Shared split-workspace shell for the Extraction + Quality-Assessment session
 * screens. Canonical layout: form LEFT (order 1), PDF RIGHT (order 2).
 *
 * NOTE: keeps the legacy `assessment-shell*` data-testids (consumed by the QA
 * fullscreen test) even though the component is named RunSplitShell.
 */
export function RunSplitShell({
  pdfPanel,
  formPanel,
  header,
  subHeader,
  initialPdfOpen = false,
  pdfState,
  viewerStore,
}: RunSplitShellProps) {
  const internalPdf = usePdfPanel({ initialOpen: initialPdfOpen });
  const pdf = pdfState ?? internalPdf;

  const panels = (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel
        id="run-split-form"
        order={1}
        defaultSize={pdf.isOpen ? 50 : 100}
        minSize={30}
        data-testid="assessment-shell-form"
      >
        <div className="flex h-full flex-col">
          {/* In-shell PDF toggle: hidden when the caller owns the toggle
              (e.g. a page wiring RunHeader.PanelToggle via pdfState). */}
          {!pdfState && (
            <div className="flex shrink-0 items-center justify-end px-3 py-2">
              {pdf.isOpen ? (
                <button
                  type="button"
                  onClick={pdf.close}
                  className="text-sm text-muted-foreground hover:underline"
                  data-testid="assessment-shell-hide-pdf"
                >
                  Hide PDF
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pdf.open}
                  className="text-sm text-muted-foreground hover:underline"
                  data-testid="assessment-shell-show-pdf"
                >
                  Show PDF
                </button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">{formPanel}</div>
        </div>
      </ResizablePanel>
      {pdf.isOpen ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="run-split-pdf"
            order={2}
            defaultSize={50}
            minSize={30}
            maxSize={70}
            data-testid="assessment-shell-pdf"
          >
            {pdfPanel}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );

  return (
    <div className="flex h-full w-full flex-col" data-testid="assessment-shell">
      {header ? <div className="shrink-0">{header}</div> : null}
      {subHeader ? <div className="shrink-0">{subHeader}</div> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {viewerStore ? (
          <ViewerProvider store={viewerStore}>{panels}</ViewerProvider>
        ) : (
          panels
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Delete the old shell + test, run the suite**

```bash
git rm frontend/components/assessment/AssessmentShell.tsx frontend/test/AssessmentShell.test.tsx
npm run test:run -- frontend/components/runs/RunSplitShell.test.tsx
```
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck   # or: npx tsc -p tsconfig.app.json --noEmit
git add frontend/components/runs/RunSplitShell.tsx frontend/components/runs/RunSplitShell.test.tsx
git commit -m "refactor(runs): RunSplitShell shared shell (form-left/PDF-right) + viewerStore/subHeader"
```
Expected: tsc clean (QA + Extraction pages still import the old path — they are
migrated in Tasks 3 & 5; if tsc is run repo-wide it will error there, so run
this commit's tsc AFTER Tasks 3/5, or scope tsc to the new file. Acceptable to
defer the repo-wide tsc gate to Task 5's commit.)

> **Note for executor:** because deleting `AssessmentShell` breaks the two page
> imports until Tasks 3 & 5 land, treat Tasks 1→3→5 as a tight sequence; do not
> run the repo-wide `tsc`/quality gate until Task 5 is committed. Per-file
> vitest still runs green in between.

---

## Task 2: `SectionAIExtractButton` (shared per-section ✨)

**Files:**
- Create: `frontend/components/extraction/ai/shared/SectionAIExtractButton.tsx`
- Create: `frontend/components/extraction/ai/shared/SectionAIExtractButton.test.tsx`

**Interfaces:**
- Consumes: `useSectionExtraction` (`@/hooks/extraction/useSectionExtraction`)
  → `{ extractSection, loading }`; `extractSection(params:
  AsyncSectionExtractionParams)` where the relevant fields are `{ projectId,
  articleId, templateId, entityTypeId?, parentInstanceId?, runId? }`; `t`
  (`@/lib/copy`); `Button`, `Tooltip*`, `Sparkles`/`Loader2`.
- Produces: `SectionAIExtractButton`, `SectionAIExtractButtonProps { projectId,
  articleId, templateId, entityTypeId, entityLabel, runId?, parentInstanceId?,
  disabled?, onExtractionComplete? }`. Emits `data-testid={`section-ai-extract-${entityTypeId}`}`.

- [ ] **Step 1: Write the failing test** — `SectionAIExtractButton.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const extractSection = vi.fn().mockResolvedValue(undefined);
let loading = false;
vi.mock("@/hooks/extraction/useSectionExtraction", () => ({
  useSectionExtraction: () => ({ extractSection, loading, error: null }),
}));

import { SectionAIExtractButton } from "@/components/extraction/ai/shared/SectionAIExtractButton";

const baseProps = {
  projectId: "p1",
  articleId: "a1",
  templateId: "t1",
  entityTypeId: "et1",
  entityLabel: "Participants",
  runId: "r1",
};

afterEach(() => {
  extractSection.mockClear();
  loading = false;
});

describe("SectionAIExtractButton", () => {
  it("renders the ✨ button with an accessible label", () => {
    render(<SectionAIExtractButton {...baseProps} />);
    const btn = screen.getByTestId("section-ai-extract-et1");
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute("aria-label", "Extract Participants with AI");
  });

  it("calls extractSection with the section coordinates on click", () => {
    render(<SectionAIExtractButton {...baseProps} parentInstanceId="m1" />);
    fireEvent.click(screen.getByTestId("section-ai-extract-et1"));
    expect(extractSection).toHaveBeenCalledWith({
      projectId: "p1",
      articleId: "a1",
      templateId: "t1",
      entityTypeId: "et1",
      parentInstanceId: "m1",
      runId: "r1",
    });
  });

  it("is disabled (and does not extract) when disabled=true", () => {
    render(<SectionAIExtractButton {...baseProps} disabled />);
    const btn = screen.getByTestId("section-ai-extract-et1");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(extractSection).not.toHaveBeenCalled();
  });

  it("shows the spinner while loading", () => {
    loading = true;
    render(<SectionAIExtractButton {...baseProps} />);
    const btn = screen.getByTestId("section-ai-extract-et1");
    expect(btn).toBeDisabled();
    expect(btn.querySelector(".animate-spin")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/components/extraction/ai/shared/SectionAIExtractButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `SectionAIExtractButton.tsx`**

```tsx
/**
 * Shared per-section "Extract with AI" button.
 *
 * Owns the `useSectionExtraction` job + tooltip + spinner so both
 * `SectionAccordion` (data extraction) and `QASectionAccordion` (quality
 * assessment) render an identical per-section ✨ affordance. Section
 * extraction is per entity-type; the backend extracts a whole section at once.
 */

import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/lib/copy";
import { useSectionExtraction } from "@/hooks/extraction/useSectionExtraction";

export interface SectionAIExtractButtonProps {
  projectId: string;
  articleId: string;
  templateId: string;
  entityTypeId: string;
  entityLabel: string;
  runId?: string | null;
  parentInstanceId?: string;
  /** Disable + swap the tooltip (e.g. single-cardinality section, no instance). */
  disabled?: boolean;
  onExtractionComplete?: (runId?: string) => void | Promise<void>;
}

export function SectionAIExtractButton({
  projectId,
  articleId,
  templateId,
  entityTypeId,
  entityLabel,
  runId,
  parentInstanceId,
  disabled = false,
  onExtractionComplete,
}: SectionAIExtractButtonProps) {
  const { extractSection, loading } = useSectionExtraction({
    onSuccess: (completedRunId) => {
      // Background refresh; never block the hook's loading reset.
      if (!onExtractionComplete) return;
      Promise.resolve(onExtractionComplete(completedRunId)).catch(
        (err: unknown) => {
          console.error("SectionAIExtractButton onExtractionComplete failed:", err);
        },
      );
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // never toggle a wrapping accordion
    void extractSection({
      projectId,
      articleId,
      templateId,
      entityTypeId,
      parentInstanceId,
      runId: runId ?? undefined,
    }).catch((error: unknown) => {
      // Errors already surfaced as a toast by the hook.
      console.error("Section extraction failed:", error);
    });
  };

  const label = disabled
    ? t("extraction", "createInstanceBeforeExtract")
    : loading
      ? t("extraction", "extractingWithAI")
      : t("extraction", "extractSectionWithAI").replace("{{label}}", entityLabel);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={handleClick}
            disabled={disabled || loading}
            title={label}
            aria-label={label}
            data-testid={`section-ai-extract-${entityTypeId}`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Sparkles className="h-4 w-4 text-primary" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- frontend/components/extraction/ai/shared/SectionAIExtractButton.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/ai/shared/SectionAIExtractButton.tsx \
        frontend/components/extraction/ai/shared/SectionAIExtractButton.test.tsx
git commit -m "feat(extraction): shared SectionAIExtractButton (per-section AI extract)"
```

---

## Task 3: Extraction adopts `RunSplitShell`

**Files:**
- Modify: `frontend/components/extraction/ExtractionPDFPanel.tsx` (→ content-only `ExtractionPdfContent`)
- Modify: `frontend/pages/ExtractionFullScreen.tsx`

**Interfaces:**
- Consumes: `RunSplitShell` (Task 1), `usePdfPanel`, `ExtractionPdfContent`.
- Produces: `ExtractionPdfContent` (props `{ articleId, projectId, store? }`,
  content-only — no ResizablePanel wrapper).

- [ ] **Step 1: Reduce `ExtractionPDFPanel` to content-only `ExtractionPdfContent`**

Replace the body so it renders ONLY the document switcher + viewer (the shell
owns the `ResizableHandle`/`ResizablePanel` now). Remove the `showPDF` prop and
the `if (!showPDF) return null` early-return; keep the `handleSelect`
store-clearing logic and the `memo` wrapper. Rename the export to
`ExtractionPdfContent` (keep the file path).

```tsx
import { memo } from "react";
import type { StoreApi } from "zustand";
import { PrumoPdfViewer } from "@prumo/pdf-viewer";
import type { ViewerState } from "@prumo/pdf-viewer";
import { useArticleDocuments } from "@/hooks/extraction/useArticleDocuments";
import { DocumentSwitcher, ParseStatusControl } from "./DocumentSwitcher";

export interface ExtractionPdfContentProps {
  articleId: string;
  projectId: string;
  /** Shared viewer store (joins the page-level ViewerProvider). */
  store?: StoreApi<ViewerState>;
}

function ExtractionPdfContentComponent({ articleId, store }: ExtractionPdfContentProps) {
  const {
    files, selectedFileId, setSelectedFileId, selectedFile,
    source, readerBlocks, readerLoading,
  } = useArticleDocuments(articleId);

  const handleSelect = (id: string) => {
    if (id === selectedFileId) return;
    const actions = store?.getState().actions;
    actions?.clearReaderLocate();
    actions?.clearSearch();
    actions?.goToPage(1);
    setSelectedFileId(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {files.length > 0 && (
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <DocumentSwitcher files={files} selectedFileId={selectedFileId} onSelect={handleSelect} />
          {selectedFile && <ParseStatusControl articleId={articleId} file={selectedFile} />}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <PrumoPdfViewer source={source} store={store} readerBlocks={readerBlocks} readerLoading={readerLoading} className="h-full" />
      </div>
    </div>
  );
}

// kept: custom comparator — compiler does not replicate arePropsEqual
export const ExtractionPdfContent = memo(
  ExtractionPdfContentComponent,
  (prev, next) =>
    prev.articleId === next.articleId &&
    prev.projectId === next.projectId &&
    prev.store === next.store,
);
ExtractionPdfContent.displayName = "ExtractionPdfContent";
```

- [ ] **Step 2: Rewire `ExtractionFullScreen.tsx` PDF state to `usePdfPanel`**

In `frontend/pages/ExtractionFullScreen.tsx`:
- Add imports: `import { usePdfPanel } from "@/hooks/usePdfPanel";`,
  `import { RunSplitShell } from "@/components/runs/RunSplitShell";`,
  `import { ExtractionPdfContent } from "@/components/extraction/ExtractionPDFPanel";`.
  Remove the `ResizablePanel, ResizablePanelGroup` import and the
  `ExtractionPDFPanel` import.
- Replace `const [showPDF, setShowPDF] = useState(false);` (line ~124) with:
  ```tsx
  const pdf = usePdfPanel({ initialOpen: false });
  ```
- Replace the locate subscription (line ~129) with the **ref pattern** —
  `pdf.open` is a fresh closure each render, so subscribe ONCE per store
  (identical to the QA Task 5 fix; the raw `[viewerStore, pdf.open]` deps would
  re-subscribe every render and can drop a locate event mid-resubscribe):
  ```tsx
  const openPdfRef = useRef(pdf.open);
  useEffect(() => { openPdfRef.current = pdf.open; }, [pdf.open]);
  useEffect(() => subscribeReaderLocate(viewerStore, () => openPdfRef.current()), [viewerStore]);
  ```
  (Keep the existing `subscribeReaderLocate` import; `useRef` is already imported.)
- Replace every other `showPDF` read with `pdf.isOpen` and the toggle with
  `pdf.toggle`:
  - `ExtractionHeader` props: `showPDF={pdf.isOpen}` and
    `onTogglePDF={pdf.toggle}`.
  - `ExtractionFormPanel showPDF={pdf.isOpen}`.

- [ ] **Step 3: Replace the inline `ResizablePanelGroup` block with `RunSplitShell`**

Replace the whole `return (...)` main-content region. The page-level
`<ViewerProvider store={viewerStore}>` wrapper and the inline
`ResizablePanelGroup` (lines ~1175-1258) are removed — `RunSplitShell` owns both
now (it wraps in `ViewerProvider` via `viewerStore`). Build the three slots:

```tsx
const subHeader =
  (parentRunId || isFinalized || (!activeRunId && finalizedRun)) ? (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
      <HITLStatusBadges
        kind="extraction"
        finalized={isFinalized || (!activeRunId && !!finalizedRun)}
        parentRunId={parentRunId}
      />
    </div>
  ) : null;

const formPanel =
  inConsensusStage && runDetail ? (
    <div className="h-full min-h-0 overflow-y-auto" data-testid="extraction-consensus-area">
      <ConsensusPanel /* …existing props… */ />
    </div>
  ) : (
    <ExtractionFormPanel
      viewMode={viewMode}
      showPDF={pdf.isOpen}
      formViewProps={{ /* …existing… */ }}
      compareViewProps={{ /* …existing… */ }}
    />
  );

const pdfPanel = (
  <ExtractionPdfContent articleId={articleId || ""} projectId={projectId || ""} store={viewerStore} />
);

return (
  <div className="h-full flex flex-col bg-background">
    {/* AI progress overlay + dialogs stay as fixed-position siblings (unchanged) */}
    <RunSplitShell
      header={<ExtractionHeader /* …existing props, showPDF={pdf.isOpen} onTogglePDF={pdf.toggle}… */ />}
      subHeader={subHeader}
      formPanel={formPanel}
      pdfPanel={pdfPanel}
      pdfState={pdf}
      viewerStore={viewerStore}
    />
    {/* FullAIExtractionProgress overlay (unchanged) */}
    {/* AddModelDialog / RemoveModelDialog (unchanged) */}
  </div>
);
```

Keep `data-scroll-container="extraction-form"` (inside `ExtractionFormPanel`)
and the viewer's `data-scroll-container="true"` node intact for
`usePreserveScroll`. The `FullAIExtractionProgress` overlay and the two dialogs
remain rendered as siblings (fixed-position; DOM placement irrelevant).

> **Behavior note:** the PDF content now mounts only when the panel is open
> (lazy `useArticleDocuments`). A citation-locate from a collapsed panel opens
> it via `subscribeReaderLocate`; the locate request persists in the store
> (nonce-based) so the Reader honors it once mounted. Verify in design-review.

- [ ] **Step 4: Verify the extraction suite + typecheck**

```bash
npm run test:run -- frontend/components/extraction frontend/test
npm run typecheck
```
Expected: existing extraction tests PASS; tsc clean (QA page still on old import
until Task 5 — if repo-wide tsc errors only in `QualityAssessmentFullScreen.tsx`,
that is expected and resolved in Task 5).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/ExtractionPDFPanel.tsx frontend/pages/ExtractionFullScreen.tsx
git commit -m "refactor(extraction): adopt RunSplitShell + content-only ExtractionPdfContent"
```

---

## Task 4: `SectionAccordion` uses `SectionAIExtractButton`

**Files:**
- Modify: `frontend/components/extraction/SectionAccordion.tsx`

**Interfaces:**
- Consumes: `SectionAIExtractButton` (Task 2).

- [ ] **Step 1: Replace the inline button + hook**

In `SectionAccordion.tsx`:
- Remove `useSectionExtraction` import + the `extractSection`/`extractionLoading`
  hook call (lines ~72-83) + `handleExtractSection` (lines ~90-109).
- Remove now-unused imports: `Loader2`, `Sparkles`, `Tooltip*`. Keep
  `ChevronDown`, `Plus`, `Button`.
- Add `import { SectionAIExtractButton } from "@/components/extraction/ai/shared/SectionAIExtractButton";`.
- Replace the inline `<TooltipProvider>…</TooltipProvider>` button (lines
  ~179-214) with:
  ```tsx
  <SectionAIExtractButton
    projectId={projectId}
    articleId={articleId}
    templateId={templateId}
    entityTypeId={entityType.id}
    entityLabel={entityType.label}
    runId={props.runId}
    parentInstanceId={props.parentInstanceId}
    disabled={instances.length === 0 && !isMultiple}
    onExtractionComplete={props.onExtractionComplete}
  />
  ```
  (The button remains a SIBLING of `AccordionPrimitive.Trigger`, before the
  chevron — no nested buttons.)

- [ ] **Step 2: Verify extraction suite + typecheck**

```bash
npm run test:run -- frontend/components/extraction
npm run typecheck
```
Expected: PASS; the per-section button renders with
`data-testid="section-ai-extract-<entityTypeId>"`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/extraction/SectionAccordion.tsx
git commit -m "refactor(extraction): SectionAccordion uses shared SectionAIExtractButton"
```

---

## Task 5: QA adopts `RunSplitShell` + evidence locate/highlight (Parts 3 + 5)

**Files:**
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx`

**Interfaces:**
- Consumes: `RunSplitShell` (Task 1), `createViewerStore`,
  `subscribeReaderLocate` (`@prumo/pdf-viewer`).

- [ ] **Step 1: Swap the shell import + create the shared store**

- Replace `import { AssessmentShell } from "@/components/assessment/AssessmentShell";`
  with `import { RunSplitShell } from "@/components/runs/RunSplitShell";`.
- Extend the existing pdf-viewer import:
  `import { PrumoPdfViewer, createViewerStore, subscribeReaderLocate } from "@prumo/pdf-viewer";`.
- Near `pdfPanelState` (line ~310) add:
  ```tsx
  // ONE stable viewer store shared by the form panel (evidence popover) and
  // the PDF reader — the prerequisite for locate + highlight (mirrors Extraction).
  const [viewerStore] = useState(createViewerStore);

  // A citation-locate reveals the (default-collapsed) PDF panel so the reader
  // can scroll + flash the cited passage. `usePdfPanel.open` is a fresh closure
  // each render, so hold it in a ref and subscribe ONCE per store (mirrors the
  // existing togglePdfRef keyboard-shortcut pattern at lines ~320-336). Cleanup
  // via return (not try/finally) for the React Compiler.
  const openPdfRef = useRef(pdfPanelState.open);
  useEffect(() => {
    openPdfRef.current = pdfPanelState.open;
  }, [pdfPanelState.open]);
  useEffect(
    () => subscribeReaderLocate(viewerStore, () => openPdfRef.current()),
    [viewerStore],
  );
  ```
  (`useRef` is already imported in this file.)

- [ ] **Step 2: Thread the store into the viewer + adopt the shell**

- In the `pdfPanel` JSX (line ~659) add `store={viewerStore}` to
  `<PrumoPdfViewer …>`:
  ```tsx
  <PrumoPdfViewer
    source={documents.source}
    store={viewerStore}
    readerBlocks={documents.readerBlocks}
    readerLoading={documents.readerLoading}
    className="h-full"
  />
  ```
- Replace the final `return (<AssessmentShell … />)` (lines ~789-796) with:
  ```tsx
  return (
    <RunSplitShell
      pdfPanel={pdfPanel}
      formPanel={formPanel}
      header={header}
      pdfState={pdfPanelState}
      viewerStore={viewerStore}
    />
  );
  ```

- [ ] **Step 3: Extend the QA test's `@prumo/pdf-viewer` mock (REQUIRED — else every QA test crashes)**

`frontend/test/QualityAssessmentFullScreen.test.tsx` (~line 139) currently mocks
`@prumo/pdf-viewer` with only `PrumoPdfViewer` + `articleFileSourceFromStorageKey`.
Task 5 Step 1 adds module-scope imports of `createViewerStore` and
`subscribeReaderLocate` from that module — under the partial mock both resolve to
`undefined`, so `useState(createViewerStore)` → `useState(undefined)` and
`subscribeReaderLocate(viewerStore, …)` → `undefined(...)` → **TypeError at render**,
crashing all ~15 `renderPage()` tests. Extend the mock factory to also export:
```ts
createViewerStore: actual.createViewerStore,      // use the real impl via importActual…
subscribeReaderLocate: () => () => {},            // …or a no-op returning an unsub
ViewerProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
```
Use `await vi.importActual<typeof import("@prumo/pdf-viewer")>("@prumo/pdf-viewer")`
inside the factory for `createViewerStore` (a real store keeps `useState` honest),
or stub it as `() => ({ getState: () => ({ actions: {} }), subscribe: () => () => {} })`
if importActual is undesirable. Keep the existing `PrumoPdfViewer` stub.

- [ ] **Step 4: Verify QA suite + typecheck (now whole-repo clean)**

```bash
npm run test:run -- frontend/test/QualityAssessmentFullScreen.test.tsx
npm run typecheck
```
Expected: QA fullscreen test PASS (the `assessment-shell*` testids are retained);
repo-wide tsc clean (old shell import is fully gone). If `renderPage` throws
`subscribeReaderLocate is not a function`, Step 3's mock was not applied.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/QualityAssessmentFullScreen.tsx frontend/test/QualityAssessmentFullScreen.test.tsx
git commit -m "feat(qa): adopt RunSplitShell + shared viewer store so evidence locates/highlights"
```

---

## Task 6: QA per-domain ✨ (`QASectionAccordion` + page wiring)

**Files:**
- Modify: `frontend/components/assessment/QASectionAccordion.tsx`
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx`

**Interfaces:**
- Consumes: `SectionAIExtractButton` (Task 2).
- Produces: `QASectionAccordionProps` gains `articleId`, `templateId`,
  `runId?`, `onExtractionComplete?`.

- [ ] **Step 1: Write the failing test** — extend
  `frontend/test/QualityAssessmentFullScreen.test.tsx` (or a focused
  `QASectionAccordion.test.tsx`). Minimal focused test:

```tsx
// frontend/components/assessment/QASectionAccordion.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/extraction/useSectionExtraction", () => ({
  useSectionExtraction: () => ({ extractSection: vi.fn(), loading: false, error: null }),
}));

import { QASectionAccordion } from "@/components/assessment/QASectionAccordion";

const domain = {
  entityType: { id: "et1", name: "participants", label: "Participants", description: "" },
  fields: [{ id: "f1", name: "q1", label: "Q1", field_type: "text", is_required: false }],
} as never;

describe("QASectionAccordion", () => {
  it("renders a per-domain AI extract button", () => {
    render(
      <QASectionAccordion
        domain={domain}
        values={{}}
        onValueChange={() => {}}
        projectId="p1"
        articleId="a1"
        templateId="t1"
        runId="r1"
        instanceId="i1"
        defaultOpen
      />,
    );
    expect(screen.getByTestId("section-ai-extract-et1")).toBeInTheDocument();
  });
});
```

Run: `npm run test:run -- frontend/components/assessment/QASectionAccordion.test.tsx`
Expected: FAIL (button absent).

- [ ] **Step 2: Add the button to `QASectionAccordion` header**

- Add props to `QASectionAccordionProps`: `articleId: string`, `templateId:
  string`, `runId?: string | null`, `onExtractionComplete?: (runId?: string) =>
  void | Promise<void>`.
- Add `import { SectionAIExtractButton } from "@/components/extraction/ai/shared/SectionAIExtractButton";`.
- Wrap the existing `<AccordionTrigger>` in a flex row with the button as a
  SIBLING (no nested buttons):
  ```tsx
  <div className="flex items-center gap-1 pr-2">
    <AccordionTrigger className="flex-1 px-4 py-3 hover:no-underline">
      {/* …existing trigger content (icon + label + badge + avatars)… */}
    </AccordionTrigger>
    <SectionAIExtractButton
      projectId={projectId}
      articleId={articleId}
      templateId={templateId}
      entityTypeId={entityType.id}
      entityLabel={sectionLabel}
      runId={runId}
      onExtractionComplete={onExtractionComplete}
    />
  </div>
  ```

- [ ] **Step 3: Thread props from the QA page**

In `QualityAssessmentFullScreen.tsx`, add the complete handler and pass it +
ids to each `<QASectionAccordion>`:

```tsx
const handleSectionExtractionComplete = async () => {
  await refetchSession();
  await refetchRun();
  await refreshAISuggestions();
};
```

```tsx
<QASectionAccordion
  /* …existing props… */
  articleId={articleId}
  templateId={session.projectTemplateId}
  runId={session.runId}
  onExtractionComplete={handleSectionExtractionComplete}
/>
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run test:run -- frontend/components/assessment frontend/test/QualityAssessmentFullScreen.test.tsx
npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/assessment/QASectionAccordion.tsx \
        frontend/components/assessment/QASectionAccordion.test.tsx \
        frontend/pages/QualityAssessmentFullScreen.tsx
git commit -m "feat(qa): per-domain AI extract button in QASectionAccordion"
```

---

## Final verification (whole diff)

- [ ] `npm run lint && npm run typecheck && npm run test:run` — all green.
- [ ] `make quality-scan` — lint + typecheck + tests + arch fitness green.
- [ ] `/design-review` on `/projects/:id/extraction/:articleId` and
  `/projects/:id/articles/:articleId/quality-assessment/:templateId`:
  1. Both form-left / PDF-right.
  2. Extraction evidence-highlight + scroll-preservation still work.
  3. QA shows a per-domain ✨ that extracts.
  4. QA evidence popover shows the locate affordance; clicking opens the PDF
     panel and flashes the cited passage in the markdown.

## Self-review notes

- **Spec coverage:** Part 1 → Task 1; Part 2 → Tasks 3+4; Part 3 → Task 5;
  Part 4 → Tasks 2+4+6; Part 5 → Task 5. All five parts covered.
- **Type consistency:** `RunSplitShellProps`, `SectionAIExtractButtonProps`,
  `ExtractionPdfContentProps` names used consistently across consuming tasks.
- **Testid contract:** `assessment-shell*` retained on `RunSplitShell` (QA
  fullscreen test); `section-ai-extract-<id>` is the new button hook.
- **React Compiler:** all new code uses `.then().catch()` / effect-return
  cleanup; `useState(createViewerStore)` lazy initializer; no `try/finally`.
