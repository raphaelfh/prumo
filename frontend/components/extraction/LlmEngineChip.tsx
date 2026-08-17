/**
 * The ⚙ extraction-engine chip + picker popover (§5, C1b T6).
 *
 * Page chrome of the Configuration tab — project regime, OUTSIDE the
 * versioned template card: choosing an engine never arms the Draft chip
 * and never appears in the Publish diff. The popover is a searchable
 * combobox grouped by provider; rows the caller cannot run (BYOK
 * provider, no stored key) render locked with an "Add your key" CTA
 * deep-linking to the key-settings surface. A retired stored pair is
 * flagged amber here so a manager learns why runs will block BEFORE
 * hitting the kickoff 409.
 *
 * On a failed read the chip renders NOTHING and the rest of the tab is
 * unaffected — the deploy-race window where a new frontend hits an old
 * backend without the route.
 */
import {useState} from 'react';
import {Link, useNavigate} from 'react-router';
import {AlertTriangle, Check, KeyRound, Lock, Settings} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {useLlmEngine, useSetLlmEngine} from '@/hooks/extraction/useLlmEngine';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import type {LlmEngineCatalogEntry, LlmEngineRead} from '@/services/llmEngineService';

/** The existing key-settings surface (UserSettings → Integrations → API keys). */
const KEY_SETTINGS_ROUTE = '/settings?tab=integrations';

const PROVIDER_LABELS: Record<string, string> = {
  openai: t('llmEngine', 'providerOpenai'),
  anthropic: t('llmEngine', 'providerAnthropic'),
};

const providerLabel = (provider: string): string =>
  PROVIDER_LABELS[provider] ?? provider;

/** 128000 → "128k", 1047576 → "1M" — a display rounding, not copy. */
const formatContextWindow = (contextWindow: number): string =>
  contextWindow >= 1_000_000
    ? `${Math.round(contextWindow / 1_000_000)}M`
    : `${Math.round(contextWindow / 1000)}k`;

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

interface ProviderGroup {
  provider: string;
  entries: LlmEngineCatalogEntry[];
  byokOnly: boolean;
}

function groupByProvider(catalog: LlmEngineCatalogEntry[]): ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  for (const entry of catalog) {
    const group = groups.find((g) => g.provider === entry.provider);
    if (group) {
      group.entries.push(entry);
      group.byokOnly = group.byokOnly && entry.byok_only;
    } else {
      groups.push({provider: entry.provider, entries: [entry], byokOnly: entry.byok_only});
    }
  }
  return groups;
}

export function LlmEngineChip({projectId}: {projectId: string}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const query = useLlmEngine(projectId);
  const setEngine = useSetLlmEngine(projectId);

  // Pending AND error both render nothing — the chrome ROW included, so
  // the Configuration tab never shows an empty flex strip: the chip is
  // optional chrome, never a blocker for the tab (deploy-race 404 window
  // included).
  const engine = query.data;
  if (!engine) return null;

  const currentEntry = engine.catalog.find(
    (e) => e.provider === engine.provider && e.model === engine.model,
  );
  const chipLabel = currentEntry?.label ?? engine.model;

  const mutationCallbacks = {
    onSuccess: () => toast.success(t('llmEngine', 'saveSuccess')),
    // A 422 from an old backend (deploy window, panel B3) surfaces the
    // client's generic message here; no optimistic update means the
    // toggle re-derives from the cached read and is never stuck.
    onError: (error: Error) =>
      toast.error(`${t('llmEngine', 'saveError')}: ${error.message}`),
  };

  const handleSelect = (entry: LlmEngineCatalogEntry) => {
    setOpen(false);
    // The CURRENT mode rides along explicitly — omitting it would let the
    // server-side default silently downgrade a verified project (panel B2).
    setEngine.mutate(
      {provider: entry.provider, model: entry.model, mode: engine.mode},
      mutationCallbacks,
    );
  };

  const handleModeChange = (next: string) => {
    // Radix fires '' when the active item is re-clicked (deselect) — a mode
    // can't be unset, so only the two literals ever mutate.
    if (next !== 'fast' && next !== 'verified') return;
    setEngine.mutate(
      {provider: engine.provider, model: engine.model, mode: next},
      mutationCallbacks,
    );
  };

  return (
    <div className="flex items-center justify-end">
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[13px] font-normal text-muted-foreground hover:text-foreground"
                aria-label={t('llmEngine', 'chipAria')}
                data-testid="llm-engine-chip"
              >
                <Settings className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                <span className="max-w-[16rem] truncate font-medium text-foreground">
                  {chipLabel}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t(
                    'llmEngine',
                    engine.mode === 'verified' ? 'modeVerified' : 'modeFast',
                  )}
                </span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('llmEngine', 'chipTooltip')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="space-y-2 border-b border-border/40 p-2.5">
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
              className="h-7 px-2.5 text-xs"
              aria-label={t('llmEngine', 'modeFast')}
            >
              {t('llmEngine', 'modeFast')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="verified"
              className="h-7 px-2.5 text-xs"
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
        </div>
        <Command>
          <CommandInput placeholder={t('llmEngine', 'searchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('llmEngine', 'emptyResults')}</CommandEmpty>
            {groupByProvider(engine.catalog).map((group) => (
              <CommandGroup
                key={group.provider}
                heading={
                  group.byokOnly ? (
                    <span className="flex items-baseline gap-2">
                      {providerLabel(group.provider)}
                      <span className="font-normal text-muted-foreground/80">
                        {t('llmEngine', 'byokGroupNote')}
                      </span>
                    </span>
                  ) : (
                    providerLabel(group.provider)
                  )
                }
              >
                {group.entries.map((entry) => {
                  const runnable = engine.availability[entry.provider] === true;
                  const isCurrent =
                    entry.provider === engine.provider &&
                    entry.model === engine.model;
                  return (
                    <CommandItem
                      key={entry.canonical}
                      value={`${entry.label} ${entry.canonical}`}
                      disabled={!runnable}
                      onSelect={() => handleSelect(entry)}
                      className="items-start gap-2 px-2 py-2"
                      data-testid={`llm-engine-option-${entry.canonical}`}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          {!runnable && (
                            <Lock
                              className="h-3 w-3 shrink-0 text-muted-foreground"
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate text-[13px] font-medium">
                            {entry.label}
                          </span>
                          {isCurrent && (
                            <Check
                              className="h-3.5 w-3.5 shrink-0 text-primary"
                              strokeWidth={1.5}
                              aria-label={t('llmEngine', 'currentModelAria')}
                            />
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.best_for}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground/80">
                          {entry.canonical}
                        </span>
                        {!runnable && (
                          <Link
                            to={KEY_SETTINGS_ROUTE}
                            onClick={() => setOpen(false)}
                            // The parent item is pointer-events-none while
                            // disabled; the CTA opts back in and keeps a
                            // visible focus ring of its own.
                            className={cn(
                              'pointer-events-auto w-fit text-[11px] font-medium text-primary underline-offset-2 hover:underline',
                              'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                            )}
                          >
                            {t('llmEngine', 'lockedAddKeyCta')}
                          </Link>
                        )}
                      </div>
                      <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">
                          {formatContextWindow(entry.context_window)}
                        </span>
                        <span>{entry.cost_tier}</span>
                      </div>
                    </CommandItem>
                  );
                })}
                {engine.availability[group.provider] !== true && (
                  // cmdk's arrow keys skip disabled items, so the per-row
                  // "Add your key" link (inside a disabled row) is
                  // mouse-only. One ENABLED item per locked group keeps
                  // the CTA reachable the way the combobox teaches.
                  <CommandItem
                    value={`${providerLabel(group.provider)} ${t('llmEngine', 'lockedAddKeyItem')}`}
                    onSelect={() => {
                      setOpen(false);
                      navigate(KEY_SETTINGS_ROUTE);
                    }}
                    className="gap-2 px-2 py-2 text-[13px] font-medium text-primary"
                    data-testid={`llm-engine-add-key-${group.provider}`}
                  >
                    <KeyRound
                      className="h-3.5 w-3.5 shrink-0"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    {t('llmEngine', 'lockedAddKeyItem')}
                  </CommandItem>
                )}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
      </Popover>
    </div>
  );
}
