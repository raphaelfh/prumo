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
 *
 * C2 A4: the popover also manages the ALTERNATE engine list (fallback
 * pairs reviewers may run when they can't run the default, labeled as
 * deviations). "Add alternate" flips the SAME Command list into a
 * multi-select that toggles membership; every mutation goes through
 * `toUpdateBody`, which omits `alternates` when the read didn't carry
 * the field (old backend during the promotion window).
 */
import {useState} from 'react';
import {Link, useNavigate} from 'react-router';
import {AlertTriangle, Check, KeyRound, Lock, Settings, X} from 'lucide-react';
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
import {toUpdateBody} from '@/services/llmEngineService';
import type {
  LlmEngineAlternate,
  LlmEngineAlternateRead,
  LlmEngineCatalogEntry,
  LlmEngineRead,
} from '@/services/llmEngineService';

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
  const [managingAlternates, setManagingAlternates] = useState(false);
  const navigate = useNavigate();
  const query = useLlmEngine(projectId);
  const setEngine = useSetLlmEngine(projectId);

  // Pending AND error both render nothing — the chrome ROW included, so
  // the Configuration tab never shows an empty flex strip: the chip is
  // optional chrome, never a blocker for the tab (deploy-race 404 window
  // included).
  const engine = query.data;
  if (!engine) return null;

  // `?? []` mirrors the service normalization for a payload an old
  // backend served without the field (deploy window) — the section still
  // renders and toUpdateBody keeps `alternates` out of plain PUTs.
  const alternates = engine.alternates ?? [];

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
    // toUpdateBody rides the CURRENT mode along explicitly (omitting it
    // would let the server-side default silently downgrade a verified
    // project, panel B2) and the stored alternates when the read carried
    // them (C2 A4 mutation invariant).
    setEngine.mutate(
      toUpdateBody(engine, {provider: entry.provider, model: entry.model}),
      mutationCallbacks,
    );
  };

  const handleModeChange = (next: string) => {
    // Radix fires '' when the active item is re-clicked (deselect) — a mode
    // can't be unset, so only the two literals ever mutate.
    if (next !== 'fast' && next !== 'verified') return;
    setEngine.mutate(toUpdateBody(engine, {mode: next}), mutationCallbacks);
  };

  const toPair = (a: {provider: string; model: string}): LlmEngineAlternate => ({
    provider: a.provider,
    model: a.model,
  });

  const isAlternate = (provider: string, model: string): boolean =>
    alternates.some((a) => a.provider === provider && a.model === model);

  const toggleAlternate = (entry: LlmEngineCatalogEntry) => {
    const next = isAlternate(entry.provider, entry.model)
      ? alternates
          .filter(
            (a) => !(a.provider === entry.provider && a.model === entry.model),
          )
          .map(toPair)
      : [...alternates.map(toPair), toPair(entry)];
    setEngine.mutate(
      toUpdateBody(engine, {alternates: next}),
      mutationCallbacks,
    );
  };

  const removeAlternate = (alt: LlmEngineAlternateRead) => {
    const next = alternates
      .filter((a) => !(a.provider === alt.provider && a.model === alt.model))
      .map(toPair);
    setEngine.mutate(
      toUpdateBody(engine, {alternates: next}),
      mutationCallbacks,
    );
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Reopening always starts in pick-a-default mode.
    if (!next) setManagingAlternates(false);
  };

  return (
    <div className="flex items-center justify-end">
      <Popover open={open} onOpenChange={handleOpenChange}>
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
        <div className="space-y-1.5 border-b border-border/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">
              {t('llmEngine', 'alternatesTitle')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setManagingAlternates(!managingAlternates)}
              data-testid="llm-engine-alternates-manage"
            >
              {t(
                'llmEngine',
                managingAlternates ? 'alternatesDoneLabel' : 'alternatesAddLabel',
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('llmEngine', 'alternatesHelper')}
          </p>
          {alternates.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {t('llmEngine', 'alternatesEmpty')}
            </p>
          ) : (
            <ul className="space-y-1">
              {alternates.map((alt) => {
                const entry = engine.catalog.find(
                  (e) => e.provider === alt.provider && e.model === alt.model,
                );
                return (
                  <li
                    key={alt.canonical}
                    data-testid={`llm-engine-alternate-${alt.canonical}`}
                    className={cn(
                      'flex items-start gap-2 rounded-md px-1.5 py-1 text-xs',
                      // Same amber treatment as the retiredNote above: the
                      // pair left the catalogue, runs on it will block.
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
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label={t('llmEngine', 'alternatesRemoveAria')}
                            onClick={() => removeAlternate(alt)}
                          >
                            <X className="h-3 w-3" strokeWidth={1.5} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('llmEngine', 'alternatesRemoveAria')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </li>
                );
              })}
            </ul>
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
                  const isMember = isAlternate(entry.provider, entry.model);
                  return (
                    <CommandItem
                      key={entry.canonical}
                      value={`${entry.label} ${entry.canonical}`}
                      // Managing mode: any pair may be a fallback (a locked
                      // provider still unblocks reviewers with their own
                      // key) — only the current default is off the table.
                      disabled={managingAlternates ? isCurrent : !runnable}
                      onSelect={() =>
                        managingAlternates
                          ? toggleAlternate(entry)
                          : handleSelect(entry)
                      }
                      className="items-start gap-2 px-2 py-2"
                      data-testid={`llm-engine-option-${entry.canonical}`}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          {!runnable && !managingAlternates && (
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
                          {managingAlternates && !isCurrent && isMember && (
                            <Check
                              className="h-3.5 w-3.5 shrink-0 text-primary"
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.best_for}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground/80">
                          {entry.canonical}
                        </span>
                        {managingAlternates && isCurrent && (
                          <span className="text-[11px] text-muted-foreground">
                            {t('llmEngine', 'alternatesPrimaryNote')}
                          </span>
                        )}
                        {!runnable && !managingAlternates && (
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
