/**
 * The ⚙ extraction-engine chip + picker popover (§5, C1b T6; slice C).
 *
 * Page chrome of the Configuration tab — project regime, OUTSIDE the
 * versioned template card: choosing an engine never arms the Draft chip and
 * never appears in the Publish diff.
 *
 * **The popover selects a model and nothing else.** Policy — mode, the
 * retired alert, attribution, alternates, custom endpoints — lives in
 * `LlmEngineSettingsDialog`, behind the footer link. Before that split this
 * popover was 544px tall and spent 156px of it on configuration ABOVE the
 * search box, while the model list showed 300px of 653px of content.
 *
 * Each row is `label` plus a right-aligned `<context> · <cost>`; the
 * `best_for` description and the canonical id move to a hover tooltip, which
 * is the house pattern (`.claude/rules/frontend.md`: short-label controls
 * explain themselves on hover).
 *
 * Three things that look like policy stay here because they govern whether a
 * row is SELECTABLE: locked BYOK rows with their "Add your key" CTA, custom
 * endpoint groups, and endpoint rows blocked by the project's mode.
 *
 * On a failed read the chip renders NOTHING and the rest of the tab is
 * unaffected — the deploy-race window where a new frontend hits an old
 * backend without the route.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  AlertTriangle,
  Check,
  KeyRound,
  Lock,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LlmEngineSettingsDialog } from "@/components/extraction/LlmEngineSettingsDialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLlmEngine, useSetLlmEngine } from "@/hooks/extraction/useLlmEngine";
import { useLlmEndpoints } from "@/hooks/extraction/useLlmEndpoints";
import { t } from "@/lib/copy";
import { endpointHost } from "@/lib/llmEndpointHost";
import { toUpdateBody } from "@/lib/llmEngineUpdateBody";
import { cn } from "@/lib/utils";
import type { LlmEngineCatalogEntry } from "@/services/llmEngineService";

/** The existing key-settings surface (UserSettings → Integrations → API keys). */
const KEY_SETTINGS_ROUTE = "/settings?tab=integrations";

const PROVIDER_LABELS: Record<string, string> = {
  openai: t("llmEngine", "providerOpenai"),
  anthropic: t("llmEngine", "providerAnthropic"),
};

const providerLabel = (provider: string): string =>
  PROVIDER_LABELS[provider] ?? provider;

/** 128000 → "128k", 1047576 → "1M" — a display rounding, not copy. */
const formatContextWindow = (contextWindow: number): string =>
  contextWindow >= 1_000_000
    ? `${Math.round(contextWindow / 1_000_000)}M`
    : `${Math.round(contextWindow / 1000)}k`;

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
      groups.push({
        provider: entry.provider,
        entries: [entry],
        byokOnly: entry.byok_only,
      });
    }
  }
  return groups;
}

export function LlmEngineChip({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const query = useLlmEngine(projectId);
  const setEngine = useSetLlmEngine(projectId);
  // Decision 12: the picker's endpoint groups derive from the endpoints hook,
  // never from a matrix on the engine read (which carries only the scalar
  // `endpoint_label`, for the chip). A failed read (old backend without the
  // routes) simply yields no groups.
  const endpointsQuery = useLlmEndpoints(projectId);

  // Pending AND error both render nothing — the chrome ROW included, so the
  // Configuration tab never shows an empty flex strip: the chip is optional
  // chrome, never a blocker for the tab (deploy-race 404 window included).
  const engine = query.data;
  if (!engine) return null;

  const currentEntry = engine.catalog.find(
    (e) => e.provider === engine.provider && e.model === engine.model,
  );
  // An endpoint engine has no catalogue entry to borrow a label from: it
  // reads as "<model> · <endpoint>", from the read's scalar label.
  const chipLabel =
    engine.endpoint_id && engine.endpoint_label
      ? `${engine.model} · ${engine.endpoint_label}`
      : (currentEntry?.label ?? engine.model);

  // Only a VERIFIED endpoint with at least one allowed model can back an
  // extraction: a heading with zero rows under it is dead UI that implies
  // models the endpoint does not offer.
  const runnableEndpoints = (endpointsQuery.data ?? []).filter(
    (endpoint) =>
      endpoint.validation_status === "ok" && endpoint.allowed_models.length > 0,
  );

  const mutationCallbacks = {
    onSuccess: () => toast.success(t("llmEngine", "saveSuccess")),
    // A 422 from an old backend (deploy window, panel B3) surfaces the
    // client's generic message here; no optimistic update means the picker
    // re-derives from the cached read and is never stuck.
    onError: (error: Error) =>
      toast.error(`${t("llmEngine", "saveError")}: ${error.message}`),
  };

  const handleSelect = (entry: LlmEngineCatalogEntry) => {
    setOpen(false);
    // toUpdateBody rides the CURRENT mode along explicitly (omitting it would
    // let the server-side default silently downgrade a verified project,
    // panel B2) and the stored alternates when the read carried them.
    setEngine.mutate(
      toUpdateBody(engine, {
        provider: entry.provider,
        model: entry.model,
        // Clearing is EXPLICIT and only when there is something to clear: a
        // catalogue pair carrying a live endpoint pointer would keep routing
        // runs at the endpoint. A project that never had one keeps sending
        // the pre-endpoints body.
        ...(engine.endpoint_id ? { endpoint_id: null } : {}),
      }),
      mutationCallbacks,
    );
  };

  const handleSelectEndpointModel = (endpointId: string, model: string) => {
    setOpen(false);
    setEngine.mutate(
      toUpdateBody(engine, {
        provider: "openai_compatible",
        model,
        endpoint_id: endpointId,
      }),
      mutationCallbacks,
    );
  };

  return (
    <div className="flex items-center justify-end">
      {/* ONE provider for the whole chip: the trigger tooltip and every row
          tooltip share it (PopoverContent portals, which preserves context).
          `delayDuration={0}`: the row description is the ONLY place `best_for`
          lives now, so scanning the list must not cost a hover delay per row. */}
      <TooltipProvider delayDuration={0}>
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-[13px] font-normal text-muted-foreground hover:text-foreground"
                  aria-label={t("llmEngine", "chipAria")}
                  data-testid="llm-engine-chip"
                >
                  <Settings
                    className="h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.5}
                  />
                  {/* Container queries against the config bar this chip is
                      composed into (2026-08-29). They are MAX-width, so they
                      are inert wherever no `configbar` container exists — the
                      standalone no-template placement keeps the full label.
                      The gear, the aria-label and the tooltip survive every
                      rung, so nothing becomes unidentifiable. */}
                  <span className="max-w-[16rem] truncate font-medium text-foreground @max-[40rem]/configbar:hidden">
                    {chipLabel}
                  </span>
                  <span
                    aria-hidden="true"
                    className="@max-[52rem]/configbar:hidden"
                  >
                    ·
                  </span>
                  <span className="@max-[52rem]/configbar:hidden">
                    {t(
                      "llmEngine",
                      engine.mode === "verified" ? "modeVerified" : "modeFast",
                    )}
                  </span>
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("llmEngine", "chipTooltip")}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-[22rem] p-0">
            <Command>
              <CommandInput placeholder={t("llmEngine", "searchPlaceholder")} />
              <CommandList>
                <CommandEmpty>{t("llmEngine", "emptyResults")}</CommandEmpty>
                {groupByProvider(engine.catalog).map((group) => (
                  <CommandGroup
                    key={group.provider}
                    heading={
                      group.byokOnly ? (
                        <span className="flex items-baseline gap-2">
                          {providerLabel(group.provider)}
                          <span className="font-normal text-muted-foreground/80">
                            {t("llmEngine", "byokGroupNote")}
                          </span>
                        </span>
                      ) : (
                        providerLabel(group.provider)
                      )
                    }
                  >
                    {group.entries.map((entry) => {
                      const runnable =
                        engine.availability[entry.provider] === true;
                      const isCurrent =
                        entry.provider === engine.provider &&
                        entry.model === engine.model;
                      return (
                        <CommandItem
                          key={entry.canonical}
                          value={`${entry.label} ${entry.canonical}`}
                          disabled={!runnable}
                          onSelect={() => handleSelect(entry)}
                          className={cn(
                            "group flex-col items-stretch gap-0.5 px-2 py-1.5",
                            isCurrent && "bg-primary/5",
                          )}
                          data-testid={`llm-engine-option-${entry.canonical}`}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
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
                                aria-label={t("llmEngine", "currentModelAria")}
                              />
                            )}
                            {!runnable && (
                              <Link
                                to={KEY_SETTINGS_ROUTE}
                                onClick={() => setOpen(false)}
                                // The parent item is pointer-events-none
                                // while disabled; the CTA opts back in and
                                // keeps a visible focus ring of its own.
                                className={cn(
                                  "pointer-events-auto shrink-0 text-[11px] font-medium text-primary underline-offset-2 hover:underline",
                                  "rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                )}
                              >
                                {t("llmEngine", "lockedAddKeyCta")}
                              </Link>
                            )}
                            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {formatContextWindow(entry.context_window)} ·{" "}
                              {entry.cost_tier}
                            </span>
                          </span>
                          {/* `best_for` and the canonical id left the row
                                  so the list reads as one line per model. They
                                  reveal on the ACTIVE row — cmdk sets
                                  data-selected on hover AND on arrow-key
                                  navigation, so unlike a tooltip this also
                                  reaches keyboard users. */}
                          <span className="hidden pl-0.5 text-xs text-muted-foreground group-data-[selected=true]:block">
                            {entry.best_for}
                            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground/80">
                              {entry.canonical}
                            </span>
                          </span>
                        </CommandItem>
                      );
                    })}
                    {engine.availability[group.provider] !== true && (
                      // cmdk's arrow keys skip disabled items, so the per-row
                      // "Add your key" link (inside a disabled row) is
                      // mouse-only. One ENABLED item per locked group keeps the
                      // CTA reachable the way the combobox teaches.
                      <CommandItem
                        value={`${providerLabel(group.provider)} ${t("llmEngine", "lockedAddKeyItem")}`}
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
                        {t("llmEngine", "lockedAddKeyItem")}
                      </CommandItem>
                    )}
                  </CommandGroup>
                ))}
                {runnableEndpoints.map((endpoint) => {
                  // Decision 10: the backend REJECTS mode="verified" on a
                  // prompted-only endpoint. Since slice C the mode toggle
                  // lives in the settings dialog, so the cause is off-screen —
                  // the blocked row therefore names WHERE to change it
                  // (`endpointPromptedBlocked`), never a dead click into a
                  // generic save-error toast.
                  const promptedOnly =
                    endpoint.capabilities.output_mode === "prompted";
                  const blocked = promptedOnly && engine.mode === "verified";
                  return (
                    <CommandGroup
                      key={endpoint.id}
                      heading={
                        <span className="flex flex-col gap-0.5">
                          <span className="flex items-baseline gap-2">
                            {endpoint.label}
                            <span className="truncate font-normal text-muted-foreground/80">
                              {endpointHost(endpoint.base_url)}
                            </span>
                          </span>
                          <span className="font-normal text-muted-foreground/80">
                            {t("llmEngine", "endpointGroupNote")}
                          </span>
                          {promptedOnly && (
                            <span className="flex items-start gap-1.5 font-normal text-warning">
                              <AlertTriangle
                                className="mt-0.5 h-3 w-3 shrink-0"
                                strokeWidth={1.5}
                                aria-hidden="true"
                              />
                              <span className="min-w-0">
                                {t("llmEngine", "endpointPromptedGroupNote")}
                              </span>
                            </span>
                          )}
                        </span>
                      }
                    >
                      {endpoint.allowed_models.map((model) => {
                        const isCurrent =
                          engine.endpoint_id === endpoint.id &&
                          engine.model === model;
                        return (
                          <CommandItem
                            key={`${endpoint.id}:${model}`}
                            value={`${endpoint.label} ${model}`}
                            disabled={blocked}
                            onSelect={() =>
                              handleSelectEndpointModel(endpoint.id, model)
                            }
                            className={cn(
                              "items-start gap-2 px-2 py-1.5",
                              isCurrent && "bg-primary/5",
                            )}
                            data-testid={`llm-engine-endpoint-option-${endpoint.id}-${model}`}
                          >
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate font-mono text-[13px]">
                                  {model}
                                </span>
                                {isCurrent && (
                                  <Check
                                    className="h-3.5 w-3.5 shrink-0 text-primary"
                                    strokeWidth={1.5}
                                    aria-label={t(
                                      "llmEngine",
                                      "currentModelAria",
                                    )}
                                  />
                                )}
                              </span>
                              {blocked && (
                                <span className="text-[11px] text-muted-foreground">
                                  {t("llmEngine", "endpointPromptedBlocked")}
                                </span>
                              )}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  );
                })}
              </CommandList>
            </Command>
            <div className="border-t border-border/40 p-1.5">
              {/* The popover closes first: a modal dialog opened from inside a
                  popover would otherwise fight it for the focus trap. */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setOpen(false);
                  setSettingsOpen(true);
                }}
                data-testid="llm-engine-open-settings"
              >
                <SlidersHorizontal
                  className="h-3.5 w-3.5 shrink-0"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                {t("llmEngine", "settingsLink")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </TooltipProvider>

      <LlmEngineSettingsDialog
        projectId={projectId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}
