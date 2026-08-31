/**
 * AiConfigDialog — everything the AI is configured with, in one popup.
 *
 * Three panes, one surface: the MODEL that runs (project regime, applies to
 * the next run), the project's REVIEW QUESTION (PICOTS, sent with every AI
 * call) and the template's GENERAL AI INSTRUCTION (part of the template
 * draft, ships on Publish). The config bar used to give each its own surface
 * — a dialog and two popovers — and the bar's hairline taught the scope
 * split; inside one dialog a scope hint above each tab carries that instead.
 *
 * Sizing is the point of this component, because its predecessor shipped the
 * failure: six stacked slot editors in an unclamped dialog painted past both
 * viewport edges, with the page scroll-locked behind it. Here the frame is
 * responsive (`w-[calc(100vw-2rem)]` under a `max-w-2xl` cap) and the tab
 * panels have ONE fixed height shared by every tab — switching tabs never
 * resizes the dialog, and content that outgrows the panel scrolls inside it.
 *
 * Tab panels are force-mounted and hidden when inactive: Radix unmounts
 * inactive tab content by default, which would destroy a half-typed draft on
 * every tab switch.
 *
 * Every data hook lives INSIDE `DialogContent`, which Radix mounts only while
 * the dialog is open — a tab-label count read by the shell itself would fire
 * a request on every page that merely renders a trigger.
 */

import {useState} from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {t} from '@/lib/copy';
import {useAiContext} from '@/hooks/project/useAiContext';
import {useTemplateInstruction} from '@/hooks/extraction/useTemplateInstruction';
import {PicotsPane} from './PicotsPane';
import {TemplateInstructionPane} from '@/components/extraction/TemplateInstructionPane';
import {LlmEnginePane} from '@/components/extraction/LlmEnginePane';

export type AiConfigTab = 'model' | 'picots' | 'instruction';

const SLOT_TOTAL = 6;

/** Tighter horizontal padding than the base trigger: three labels plus their
 * badges overflow a 390px phone at `px-3`, and a tab strip that scrolls to
 * reach its third tab is worse than a slightly tighter one. */
const TAB_CLASS = 'shrink-0 px-2 sm:px-3';
const CUSTOMIZE_SLOT = /\[customize:[^\]]*\]/g;

/** The fixed panel every pane renders into — identical for every tab, so the
 * dialog holds one size no matter which tab is active or how tall its content
 * is. `60dvh` keeps the whole frame inside any viewport; `28rem` stops it
 * from sprawling on a tall monitor. A flex column that clips: each pane
 * decides what scrolls inside it, so a pinned footer sits flush on the
 * panel's real bottom edge (sticky-inside-a-padded-scrollport floats a
 * padding-width gap above it). */
const PANE_CLASS =
  'mt-0 flex h-[min(60dvh,28rem)] min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden';

interface TemplateSlot {
  id: string;
  /** Owned by the trigger so it survives the dialog closing — see
   * `TemplateInstructionPane`. */
  instructionDraft: string | null;
  onInstructionDraftChange: (draft: string | null) => void;
}

interface AiConfigDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which tab a trigger opens onto. The state resets with the content on
   * close, so each open lands on the trigger's own tab. */
  initialTab?: AiConfigTab;
  /** The model tab — mounted on the extraction surfaces, where an engine is
   * what the project actually runs on. */
  withModel?: boolean;
  /** Without a template there is no instruction to edit (the project
   * settings summary opens the dialog this way). */
  template?: TemplateSlot;
}

/** A muted count/state badge on a tab, so the OTHER tab's state is legible
 * without visiting it — the bar chips carry this outside the dialog. */
function TabBadge({children, tone}: {children: string; tone?: 'warning'}) {
  return (
    <span
      className={
        tone === 'warning'
          ? 'ml-1.5 shrink-0 rounded-full border border-warning/50 bg-warning/10 px-1.5 text-[11px] text-warning'
          : 'ml-1.5 shrink-0 text-[11px] tabular-nums text-muted-foreground'
      }
    >
      {children}
    </span>
  );
}

interface AiConfigTabsProps {
  projectId: string;
  initialTab: AiConfigTab;
  withModel: boolean;
  template?: TemplateSlot;
  onClose: () => void;
}

/** Mounted inside DialogContent so both the active-tab state and the reads
 * behind the badges live only while the dialog is open. */
function AiConfigTabs({
  projectId,
  initialTab,
  withModel,
  template,
  onClose,
}: AiConfigTabsProps) {
  const [tab, setTab] = useState<AiConfigTab>(initialTab);
  const {data: aiContext} = useAiContext(projectId);
  const {data: instruction} = useTemplateInstruction(
    projectId,
    template?.id ?? '',
  );

  const filled = aiContext
    ? Object.values(
        aiContext.picots as unknown as Record<string, {description?: string}>,
      ).filter((slot) => slot?.description).length
    : 0;
  const slotCount = (
    instruction?.llm_template_instruction?.match(CUSTOMIZE_SLOT) ?? []
  ).length;

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => setTab(next as AiConfigTab)}
      className="flex min-h-0 flex-col"
    >
      {/* `overflow-x-auto` is the backstop, not the plan: TAB_CLASS tightens
          the triggers enough to fit a 390px phone, and the scroll only ever
          engages on a narrower one — where a reachable tab beats a clipped
          one. `shrink-0` keeps the labels from squashing first. */}
      <TabsList className="mx-4 mt-3 shrink-0 justify-start overflow-x-auto">
        {withModel && (
          <TabsTrigger value="model" className={TAB_CLASS}>
            {t('llmEngine', 'modelTabLabel')}
          </TabsTrigger>
        )}
        <TabsTrigger value="picots" className={TAB_CLASS}>
          {t('aiContext', 'dialogTitle')}
          <TabBadge>{`${filled}/${SLOT_TOTAL}`}</TabBadge>
        </TabsTrigger>
        {template && (
          <TabsTrigger value="instruction" className={TAB_CLASS}>
            {t('extraction', 'instructionTabLabel')}
            {slotCount > 0 && (
              <TabBadge tone="warning">{String(slotCount)}</TabBadge>
            )}
          </TabsTrigger>
        )}
      </TabsList>

      {withModel && (
        <TabsContent
          forceMount
          value="model"
          data-testid="ai-config-model-panel"
          className={PANE_CLASS}
        >
          <p className="mx-4 mb-2 mt-3 shrink-0 text-xs text-muted-foreground">
            {t('llmEngine', 'modelScopeHint')}
          </p>
          <LlmEnginePane projectId={projectId} />
        </TabsContent>
      )}

      <TabsContent
        forceMount
        value="picots"
        data-testid="ai-config-picots-panel"
        className={PANE_CLASS}
      >
        <p className="mx-4 mb-2 mt-3 shrink-0 text-xs text-muted-foreground">
          {t('aiContext', 'picotsScopeHint')}
        </p>
        <PicotsPane projectId={projectId} onClose={onClose} />
      </TabsContent>

      {template && (
        <TabsContent
          forceMount
          value="instruction"
          data-testid="ai-config-instruction-panel"
          className={`${PANE_CLASS} px-4 pb-4`}
        >
          <p className="mb-2 mt-3 shrink-0 text-xs text-muted-foreground">
            {t('extraction', 'instructionScopeHint')}
          </p>
          <TemplateInstructionPane
            projectId={projectId}
            templateId={template.id}
            draft={template.instructionDraft}
            onDraftChange={template.onInstructionDraftChange}
            onClose={onClose}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

export function AiConfigDialog({
  projectId,
  open,
  onOpenChange,
  initialTab = 'picots',
  withModel = false,
  template,
}: AiConfigDialogProps) {
  const close = () => onOpenChange(false);
  const tabbed = withModel || template != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 rounded-lg p-0">
        {/* `text-left` overrides shadcn's centred narrow default: a centred
            title under a left-aligned tab row reads as two designs. */}
        <DialogHeader className="shrink-0 space-y-0.5 border-b border-border/40 px-4 py-3 pr-10 text-left sm:text-left">
          <DialogTitle className="text-[15px]">
            {tabbed
              ? t('aiContext', 'configDialogTitle')
              : t('aiContext', 'dialogTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {tabbed
              ? t('aiContext', 'configDialogDesc')
              : t('aiContext', 'dialogDesc')}
          </DialogDescription>
        </DialogHeader>
        {tabbed ? (
          <AiConfigTabs
            projectId={projectId}
            initialTab={initialTab}
            withModel={withModel}
            template={template}
            onClose={close}
          />
        ) : (
          <div className={`${PANE_CLASS} pt-3`}>
            <PicotsPane projectId={projectId} onClose={close} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
