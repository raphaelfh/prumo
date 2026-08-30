/**
 * Engine settings — the POLICY half of the extraction-engine surface
 * (slice C).
 *
 * The picker popover (`LlmEngineChip`) selects a model and nothing else.
 * Everything configured once per project rather than chosen per run lives
 * here: the Fast/Verified mode, the retired-engine alert, the attribution
 * line, the alternate-engine list, and the way into the custom-endpoints
 * manager.
 *
 * Why the alternates picker is a plain checkbox list: in the popover this
 * was a MODE that flipped the same Command list into multi-select, so one
 * list had two behaviours and every row needed `managingAlternates` in its
 * disabled/aria/onSelect logic. With room in a dialog it is just a list.
 *
 * Every mutation goes through `toUpdateBody`, which omits `alternates` when
 * the read didn't carry the field (old backend during the promotion window)
 * and rides the current mode along explicitly so a server-side default can
 * never silently downgrade a verified project.
 */
import {useState} from 'react';
import {AlertTriangle, Server, X} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {LlmEndpointsDialog} from '@/components/extraction/LlmEndpointsDialog';
import {useLlmEngine, useSetLlmEngine} from '@/hooks/extraction/useLlmEngine';
import {t} from '@/lib/copy';
import {
  toUpdateBody,
  type LlmEngineAlternatePair,
} from '@/lib/llmEngineUpdateBody';
import {cn} from '@/lib/utils';
import type {
  LlmEngineAlternateRead,
  LlmEngineCatalogEntry,
  LlmEngineRead,
} from '@/services/llmEngineService';

function attributionLine(engine: LlmEngineRead): string {
  const name = engine.updated_by_name ?? '—';
  const date = engine.updated_at
    ? new Date(engine.updated_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : '—';
  const template = engine.previous_model
    ? t('llmEngine', 'attribution').replace('{{model}}', engine.previous_model)
    : t('llmEngine', 'attributionNoPrevious');
  return template.replace('{{name}}', name).replace('{{date}}', date);
}

interface LlmEngineSettingsDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LlmEngineSettingsDialog({
  projectId,
  open,
  onOpenChange,
}: LlmEngineSettingsDialogProps) {
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const query = useLlmEngine(projectId);
  const setEngine = useSetLlmEngine(projectId);

  const engine = query.data;
  if (!engine) return null;

  const alternateKeys = new Set(engine.alternates.map((a) => a.canonical));
  const catalogByCanonical = new Map(
    engine.catalog.map((entry) => [entry.canonical, entry]),
  );

  const mutationCallbacks = {
    onSuccess: () => toast.success(t('llmEngine', 'saveSuccess')),
    onError: (error: Error) =>
      toast.error(`${t('llmEngine', 'saveError')}: ${error.message}`),
  };

  // Alternates edits get their own copy — "Extraction model updated." on a
  // membership toggle would report a change that never happened.
  const alternatesMutationCallbacks = {
    onSuccess: () => toast.success(t('llmEngine', 'alternatesSaveSuccess')),
    onError: (error: Error) =>
      toast.error(`${t('llmEngine', 'alternatesSaveError')}: ${error.message}`),
  };

  const handleModeChange = (next: string) => {
    // Radix fires '' when the active item is re-clicked (deselect) — a mode
    // can't be unset, so only the two literals ever mutate.
    if (next !== 'fast' && next !== 'verified') return;
    setEngine.mutate(toUpdateBody(engine, {mode: next}), mutationCallbacks);
  };

  const saveAlternates = (next: readonly LlmEngineAlternatePair[]) => {
    // While a mutation is in flight the toggles render disabled AND no-op: a
    // back-to-back toggle would compute `next` from the pre-PUT list and
    // silently revert the change still in flight (lost-update race).
    if (setEngine.isPending) return;
    setEngine.mutate(
      toUpdateBody(engine, {alternates: next}),
      alternatesMutationCallbacks,
    );
  };

  const toggleAlternate = (entry: LlmEngineCatalogEntry) => {
    saveAlternates(
      alternateKeys.has(entry.canonical)
        ? engine.alternates.filter((a) => a.canonical !== entry.canonical)
        : [...engine.alternates, entry],
    );
  };

  const removeAlternate = (alt: LlmEngineAlternateRead) => {
    saveAlternates(
      engine.alternates.filter((a) => a.canonical !== alt.canonical),
    );
  };

  const isDefault = (entry: LlmEngineCatalogEntry) =>
    entry.provider === engine.provider && entry.model === engine.model;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto"
          data-testid="llm-engine-settings-dialog"
        >
          <DialogHeader>
            <DialogTitle>{t('llmEngine', 'settingsTitle')}</DialogTitle>
            <DialogDescription>
              {t('llmEngine', 'settingsDesc')}
            </DialogDescription>
          </DialogHeader>

          <TooltipProvider>
            <section className="space-y-2">
              <h3 className="text-[13px] font-medium text-foreground">
                {t('llmEngine', 'modeSectionLabel')}
              </h3>
              <ToggleGroup
                type="single"
                value={engine.mode}
                onValueChange={handleModeChange}
                variant="outline"
                size="sm"
                className="justify-start"
                aria-label={t('llmEngine', 'modeGroupAria')}
              >
                <ToggleGroupItem
                  value="fast"
                  className="px-2.5"
                  aria-label={t('llmEngine', 'modeFast')}
                >
                  {t('llmEngine', 'modeFast')}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="verified"
                  className="px-2.5"
                  aria-label={t('llmEngine', 'modeVerified')}
                >
                  {t('llmEngine', 'modeVerified')}
                </ToggleGroupItem>
              </ToggleGroup>
              {engine.retired && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-2 text-xs text-warning"
                >
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">{t('llmEngine', 'retiredNote')}</span>
                </div>
              )}
              {engine.source === 'project' && (
                <p className="text-[11px] text-muted-foreground">
                  {attributionLine(engine)}
                </p>
              )}
            </section>

            <section className="space-y-2 border-t border-border/40 pt-4">
              <h3 className="text-[13px] font-medium text-foreground">
                {t('llmEngine', 'alternatesTitle')}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {t('llmEngine', 'alternatesHelper')}
              </p>

              {engine.alternates.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t('llmEngine', 'alternatesEmpty')}
                </p>
              ) : (
                <ul className="space-y-1">
                  {engine.alternates.map((alt) => {
                    const entry = catalogByCanonical.get(alt.canonical);
                    return (
                      <li
                        key={alt.canonical}
                        data-testid={`llm-engine-alternate-${alt.canonical}`}
                        className={cn(
                          'flex items-start gap-2 rounded-md px-1.5 py-1 text-xs',
                          // Same amber treatment as retiredNote: the pair left
                          // the catalogue, runs on it will block.
                          alt.retired &&
                            'border border-warning/50 bg-warning/10 text-warning',
                        )}
                      >
                        {alt.retired && (
                          <AlertTriangle
                            className="mt-0.5 h-3 w-3 shrink-0"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {entry?.label ?? alt.canonical}
                          </span>
                          {entry?.byok_only === true && (
                            <span className="block text-[11px] text-muted-foreground">
                              {t('llmEngine', 'alternatesByokWarn')}
                            </span>
                          )}
                        </div>
                        {engine.hasAlternates && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                                aria-label={t('llmEngine', 'alternatesRemoveAria')}
                                disabled={setEngine.isPending}
                                onClick={() => removeAlternate(alt)}
                              >
                                <X className="h-3 w-3" strokeWidth={1.5} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('llmEngine', 'alternatesRemoveAria')}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Deploy window: an old backend 422s ANY alternates write, so
                  the picker hides until the read carries the field — the
                  (empty) list above still renders. */}
              {engine.hasAlternates && (
                <ul className="space-y-0.5 pt-1" data-testid="llm-engine-alternates-picker">
                  {engine.catalog.map((entry) => {
                    const current = isDefault(entry);
                    return (
                      <li key={entry.canonical}>
                        <label
                          className={cn(
                            'flex items-center gap-2 rounded-md px-1.5 py-1 text-xs',
                            current
                              ? 'text-muted-foreground'
                              : 'cursor-pointer hover:bg-muted/50',
                          )}
                        >
                          <Checkbox
                            checked={alternateKeys.has(entry.canonical)}
                            // The current default is not an alternate of
                            // itself; every row freezes while a write is in
                            // flight (lost-update race).
                            disabled={current || setEngine.isPending}
                            onCheckedChange={() => toggleAlternate(entry)}
                            aria-label={entry.label}
                            data-testid={`llm-engine-alternate-toggle-${entry.canonical}`}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {entry.label}
                          </span>
                          {current && (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {t('llmEngine', 'alternatesPrimaryNote')}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="border-t border-border/40 pt-4">
              {/* The dialog closes first: a second modal opened from inside
                  this one would otherwise fight it for the focus trap. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  setEndpointsOpen(true);
                }}
                data-testid="llm-engine-manage-endpoints"
              >
                <Server className="mr-2 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                {t('llmEngine', 'manageEndpoints')}
              </Button>
            </section>
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      <LlmEndpointsDialog
        projectId={projectId}
        open={endpointsOpen}
        onOpenChange={setEndpointsOpen}
      />
    </>
  );
}
