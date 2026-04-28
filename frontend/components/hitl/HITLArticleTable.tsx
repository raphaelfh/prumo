/**
 * Article table shared by both HITL flows (extraction & quality assessment).
 *
 * Renders the same Title / Authors / Year / Progress / Status / Actions
 * layout that ``ArticleExtractionTable`` introduced, but parameterised by
 * ``kind`` and a caller-supplied ``rowActionHref`` so each page can route
 * into its own full-screen surface (extraction or QA).
 *
 * Progress is computed from the user's ``extraction_reviewer_states``
 * keyed by template — kind-agnostic, so flipping the active template in
 * the mini-header above re-queries this table without other changes.
 *
 * The richer extraction-only affordances (batch AI extraction, column
 * resizing, multi-select) live on ``ArticleExtractionTable`` and stay
 * there until extraction is migrated. This table covers the QA workflow
 * and the structural parity the user asked for.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, Circle, FileText } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ActiveFilterChips,
  buildActiveFiltersList,
  FilterButtonWithPopover,
  isFilterValueEmpty,
  ListCount,
  ListDisplaySortPopover,
  ListFilterPanel,
  ListToolbarSearch,
  SortIconHeader,
  type FilterFieldConfig,
  type FilterValues,
} from "@/components/shared/list";
import { DataTableWrapper } from "@/components/shared/list/DataTableWrapper";
import { useListKeyboardShortcuts } from "@/hooks/useListKeyboardShortcuts";
import { supabase } from "@/integrations/supabase/client";
import { t } from "@/lib/copy";
import { TABLE_CELL_CLASS } from "@/lib/table-constants";
import type { HITLKind } from "@/hooks/hitl/useHITLProjectTemplates";

interface Article {
  id: string;
  title: string | null;
  authors: string[] | null;
  publication_year: number | null;
  created_at: string;
}

interface ExtractionInstanceRow {
  id: string;
  article_id: string | null;
  template_id: string;
  entity_type_id: string;
  status: string;
}

interface ReviewerValueRow {
  instance_id: string;
  field_id: string;
  value: unknown;
  decision: string;
}

interface ArticleWithProgress extends Article {
  instances: ExtractionInstanceRow[];
  values: ReviewerValueRow[];
}

type SortField =
  | "title"
  | "publication_year"
  | "progress"
  | "status"
  | "created_at";
type SortDirection = "asc" | "desc";

const FILTER_FIELDS: FilterFieldConfig[] = [
  {
    id: "status",
    label: t("extraction", "tableColumnStatus"),
    type: "categorical",
    options: [
      { value: "not_started", label: t("extraction", "listStatusNotStarted") },
      { value: "in_progress", label: t("extraction", "listStatusInProgress") },
      { value: "complete", label: t("extraction", "listStatusComplete") },
    ],
  },
  {
    id: "publication_year",
    label: t("extraction", "tableColumnYear"),
    type: "numericRange",
    minBound: 1990,
    maxBound: new Date().getFullYear(),
    step: 1,
  },
  {
    id: "title",
    label: t("extraction", "tableColumnTitle"),
    type: "text",
    placeholder: t("extraction", "tableSearchTitle"),
  },
  {
    id: "authors",
    label: t("extraction", "tableColumnAuthors"),
    type: "text",
    placeholder: t("extraction", "tableSearchAuthor"),
  },
];

const INITIAL_FILTERS: FilterValues = {
  status: [],
  publication_year: {},
  title: "",
  authors: "",
};

interface Props {
  kind: HITLKind;
  projectId: string;
  templateId: string;
  rowActionHref: (articleId: string, templateId: string) => string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function HITLArticleTable({
  kind,
  projectId,
  templateId,
  rowActionHref,
  emptyTitle,
  emptyDescription,
}: Props) {
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [articles, setArticles] = useState<ArticleWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [globalFilter, setGlobalFilter] = useState("");
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>(INITIAL_FILTERS);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setCurrentUserId(data.user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectId || !templateId || !currentUserId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const articlesRes = await supabase
          .from("articles")
          .select("id, title, authors, publication_year, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        if (articlesRes.error) throw articlesRes.error;

        const baseArticles = (articlesRes.data ?? []) as Article[];
        if (baseArticles.length === 0) {
          if (!cancelled) {
            setArticles([]);
          }
          return;
        }

        const instancesRes = await supabase
          .from("extraction_instances")
          .select("id, article_id, template_id, entity_type_id, status")
          .eq("project_id", projectId)
          .eq("template_id", templateId);
        if (instancesRes.error) throw instancesRes.error;
        const instances = (instancesRes.data ?? []) as ExtractionInstanceRow[];

        const instanceIds = instances.map((i) => i.id);
        let values: ReviewerValueRow[] = [];
        if (instanceIds.length > 0) {
          const statesRes = await supabase
            .from("extraction_reviewer_states")
            .select(
              `instance_id, current_decision_id,
               reviewer_decision:extraction_reviewer_decisions!fk_extraction_reviewer_states_decision_run_match(field_id, value, decision)`,
            )
            .in("instance_id", instanceIds)
            .eq("reviewer_id", currentUserId);
          if (statesRes.error) throw statesRes.error;
          values = (statesRes.data ?? [])
            .map((row: any) => {
              const dec = Array.isArray(row.reviewer_decision)
                ? row.reviewer_decision[0]
                : row.reviewer_decision;
              if (!dec || dec.decision === "reject") return null;
              return {
                instance_id: row.instance_id as string,
                field_id: dec.field_id as string,
                value: dec.value,
                decision: dec.decision as string,
              };
            })
            .filter((v): v is ReviewerValueRow => v !== null);
        }

        const merged: ArticleWithProgress[] = baseArticles.map((article) => {
          const articleInstances = instances.filter(
            (i) => i.article_id === article.id,
          );
          const articleValues = values.filter((v) =>
            articleInstances.some((i) => i.id === v.instance_id),
          );
          return {
            ...article,
            instances: articleInstances,
            values: articleValues,
          };
        });

        if (!cancelled) setArticles(merged);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to load articles";
          setError(message);
          toast.error(`${t("extraction", "tableErrorLoadArticles")}: ${message}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, templateId, currentUserId]);

  const calcProgress = (article: ArticleWithProgress): number => {
    if (article.instances.length === 0) return 0;
    const allCompleted = article.instances.every(
      (i) => i.status === "completed",
    );
    if (allCompleted) return 100;
    const filled = article.instances.filter((instance) =>
      article.values.some((v) => v.instance_id === instance.id),
    ).length;
    return Math.round((filled / article.instances.length) * 100);
  };

  const filteredAndSorted = useMemo(() => {
    const visible = articles.filter((article) => {
      if (globalFilter) {
        const q = globalFilter.toLowerCase();
        const matchesTitle = article.title?.toLowerCase().includes(q) ?? false;
        const matchesAuthors =
          article.authors?.some((a) => a.toLowerCase().includes(q)) ?? false;
        const matchesYear =
          article.publication_year?.toString().includes(q) ?? false;
        if (!matchesTitle && !matchesAuthors && !matchesYear) return false;
      }
      const titleFilter = filterValues.title as string | undefined;
      if (
        titleFilter?.trim() &&
        !article.title?.toLowerCase().includes(titleFilter.toLowerCase())
      ) {
        return false;
      }
      const authorsFilter = filterValues.authors as string | undefined;
      if (authorsFilter?.trim() && article.authors) {
        const ok = article.authors.some((a) =>
          a.toLowerCase().includes(authorsFilter.toLowerCase()),
        );
        if (!ok) return false;
      }
      const statusFilter = filterValues.status as string[] | undefined;
      if (statusFilter?.length) {
        const progress = calcProgress(article);
        const status =
          progress >= 100
            ? "complete"
            : progress > 0
              ? "in_progress"
              : "not_started";
        if (!statusFilter.includes(status)) return false;
      }
      const yearRange = filterValues.publication_year as
        | { min?: number; max?: number }
        | undefined;
      if (
        yearRange &&
        (yearRange.min != null || yearRange.max != null) &&
        article.publication_year != null
      ) {
        const y = article.publication_year;
        if (yearRange.min != null && y < yearRange.min) return false;
        if (yearRange.max != null && y > yearRange.max) return false;
      }
      return true;
    });

    visible.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      switch (sortField) {
        case "title":
          aVal = a.title?.toLowerCase() ?? "";
          bVal = b.title?.toLowerCase() ?? "";
          break;
        case "publication_year":
          aVal = a.publication_year ?? 0;
          bVal = b.publication_year ?? 0;
          break;
        case "progress":
          aVal = calcProgress(a);
          bVal = calcProgress(b);
          break;
        case "status": {
          const ap = calcProgress(a);
          const bp = calcProgress(b);
          aVal = a.instances.length === 0 ? 0 : ap >= 100 ? 2 : 1;
          bVal = b.instances.length === 0 ? 0 : bp >= 100 ? 2 : 1;
          break;
        }
        case "created_at":
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
          break;
      }
      if (sortDirection === "asc") return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    });

    return visible;
  }, [articles, globalFilter, filterValues, sortField, sortDirection]);

  const activeFiltersCount = useMemo(() => {
    let n = globalFilter.trim() ? 1 : 0;
    FILTER_FIELDS.forEach((f) => {
      if (!isFilterValueEmpty(filterValues[f.id])) n += 1;
    });
    return n;
  }, [globalFilter, filterValues]);

  const filterLabels = useMemo(
    () =>
      Object.fromEntries(FILTER_FIELDS.map((f) => [f.id, f.label])) as Record<
        string,
        string
      >,
    [],
  );
  const activeFiltersList = useMemo(
    () => buildActiveFiltersList(FILTER_FIELDS, filterValues, filterLabels),
    [filterValues, filterLabels],
  );

  const clearFilterField = (fieldId: string) => {
    const f = FILTER_FIELDS.find((field) => field.id === fieldId);
    if (!f) return;
    setFilterValues((prev) => ({
      ...prev,
      [fieldId]:
        f.type === "categorical"
          ? []
          : f.type === "numericRange"
            ? {}
            : "",
    }));
  };
  const clearAllFilters = () => {
    setGlobalFilter("");
    setFilterValues(INITIAL_FILTERS);
  };

  useListKeyboardShortcuts({
    searchInputRef,
    setFilterPopoverOpen,
    filterPopoverOpen,
    deselectAll: () => undefined,
    selectedCount: 0,
    hasActiveFilters: activeFiltersCount > 0,
    selectAll: () => undefined,
    selectFiltered: () => undefined,
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const renderStatus = (article: ArticleWithProgress) => {
    const progress = calcProgress(article);
    const status =
      progress >= 100
        ? "complete"
        : progress > 0
          ? "in_progress"
          : "not_started";
    if (status === "not_started") {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="h-7 w-7 cursor-default justify-center rounded-full border border-blue-200/70 bg-blue-50/60 p-0 text-blue-700 shadow-none dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300"
              >
                <Circle className="h-3 w-3" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("extraction", "listStatusNotStarted")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    if (status === "complete") {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="h-7 w-7 cursor-default justify-center rounded-full border border-emerald-200/70 bg-emerald-50/60 p-0 text-emerald-700 shadow-none dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
              >
                <CheckCircle2 className="h-3 w-3" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("extraction", "listStatusComplete")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              className="h-7 w-7 cursor-default justify-center rounded-full border border-amber-200/80 bg-amber-50/70 p-0 text-amber-700 shadow-none dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
            >
              <span className="text-[9px] font-semibold leading-none">
                {progress}%
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t("extraction", "listStatusInProgress")}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  if (loading) {
    return (
      <div className="space-y-3" data-testid={`hitl-${kind}-table-loading`}>
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <div className="flex items-center gap-3 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <div>
            <p className="font-medium">
              {t("extraction", "tableErrorLoadArticles")}
            </p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/40 bg-muted/10 px-4 py-24"
        data-testid={`hitl-${kind}-table-empty`}
      >
        <FileText
          className="mb-4 h-10 w-10 text-muted-foreground/30"
          strokeWidth={1.2}
        />
        <h3 className="mb-1.5 text-center text-base font-medium text-foreground">
          {emptyTitle ?? t("extraction", "listNoArticles")}
        </h3>
        <p className="mx-auto max-w-xs text-center text-[13px] text-muted-foreground">
          {emptyDescription ?? t("extraction", "listNoArticlesDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`hitl-${kind}-table`}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ListToolbarSearch
            ref={searchInputRef}
            placeholder={t("extraction", "tableSearchPlaceholderShortcut")}
            value={globalFilter}
            onChange={setGlobalFilter}
          />
          <FilterButtonWithPopover
            open={filterPopoverOpen}
            onOpenChange={setFilterPopoverOpen}
            activeCount={activeFiltersCount}
            tooltipLabel={t("extraction", "tableShortcutFilter")}
            ariaLabel={t("extraction", "tableShortcutFilter")}
          >
            <ListFilterPanel
              fields={FILTER_FIELDS}
              values={filterValues}
              onChange={setFilterValues}
            />
          </FilterButtonWithPopover>
          <ListDisplaySortPopover
            sortOptions={[
              { value: "title", label: t("extraction", "tableColumnTitle") },
              {
                value: "publication_year",
                label: t("extraction", "tableColumnYear"),
              },
              {
                value: "progress",
                label: t("extraction", "tableColumnProgress"),
              },
              { value: "status", label: t("extraction", "tableColumnStatus") },
              {
                value: "created_at",
                label: t("extraction", "tableColumnCreatedAt"),
              },
            ]}
            sortField={sortField}
            sortDirection={sortDirection}
            onSortFieldChange={(v) => setSortField(v as SortField)}
            onSortDirectionChange={() =>
              setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
            }
            orderLabel={t("extraction", "tableOrdering")}
            tooltipLabel={t("extraction", "tableDisplayAndSort")}
            ariaLabel={t("extraction", "tableDisplayOptions")}
          />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ListCount
              visible={filteredAndSorted.length}
              total={articles.length}
              label={t("extraction", "tableArticlesCount")}
            />
          </div>
        </div>
        <ActiveFilterChips
          filters={activeFiltersList}
          onClearField={clearFilterField}
          onClearAll={clearAllFilters}
          clearAllLabel={t("extraction", "tableClearAll")}
          removeFilterAriaLabel={(label) =>
            t("extraction", "tableRemoveFilter").replace("{{label}}", label)
          }
        />
      </div>

      <DataTableWrapper className="overflow-hidden rounded-md border border-border/40">
        <Table>
          <TableHeader className="bg-transparent">
            <TableRow className="h-8 border-b border-border/40 hover:bg-transparent">
              <TableHead className={`${TABLE_CELL_CLASS} w-[40%]`}>
                <SortIconHeader
                  label={t("extraction", "tableColumnTitle")}
                  direction={sortField === "title" ? sortDirection : null}
                  onSort={() => handleSort("title")}
                />
              </TableHead>
              <TableHead className={`${TABLE_CELL_CLASS} hidden md:table-cell w-[20%]`}>
                {t("extraction", "tableColumnAuthors")}
              </TableHead>
              <TableHead className={`${TABLE_CELL_CLASS} hidden md:table-cell w-[10%]`}>
                <SortIconHeader
                  label={t("extraction", "tableColumnYear")}
                  direction={
                    sortField === "publication_year" ? sortDirection : null
                  }
                  onSort={() => handleSort("publication_year")}
                />
              </TableHead>
              <TableHead className={`${TABLE_CELL_CLASS} w-[16%]`}>
                <SortIconHeader
                  label={t("extraction", "tableColumnProgress")}
                  direction={sortField === "progress" ? sortDirection : null}
                  onSort={() => handleSort("progress")}
                />
              </TableHead>
              <TableHead className={`${TABLE_CELL_CLASS} w-[8%]`}>
                <SortIconHeader
                  label={t("extraction", "tableColumnStatus")}
                  direction={sortField === "status" ? sortDirection : null}
                  onSort={() => handleSort("status")}
                />
              </TableHead>
              <TableHead className={`${TABLE_CELL_CLASS} w-[6%] text-right`}>
                {t("extraction", "tableActions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.map((article) => {
              const progress = calcProgress(article);
              return (
                <TableRow
                  key={article.id}
                  data-testid={`hitl-${kind}-row-${article.id}`}
                  className="h-12 border-b border-border/30 hover:bg-accent/30"
                >
                  <TableCell className={TABLE_CELL_CLASS}>
                    <div className="line-clamp-2 font-medium">
                      {article.title ?? t("qa", "untitledArticle")}
                    </div>
                  </TableCell>
                  <TableCell className={`${TABLE_CELL_CLASS} hidden md:table-cell`}>
                    <span className="line-clamp-1 text-sm text-muted-foreground">
                      {article.authors?.length
                        ? article.authors.slice(0, 3).join(", ") +
                          (article.authors.length > 3 ? " et al." : "")
                        : "—"}
                    </span>
                  </TableCell>
                  <TableCell className={`${TABLE_CELL_CLASS} hidden md:table-cell`}>
                    <span className="text-sm text-muted-foreground">
                      {article.publication_year ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className={TABLE_CELL_CLASS}>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full max-w-[100px] overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${
                            progress >= 100
                              ? "bg-emerald-500"
                              : progress > 0
                                ? "bg-amber-500"
                                : "bg-blue-500/40"
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {progress}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={TABLE_CELL_CLASS}>
                    {renderStatus(article)}
                  </TableCell>
                  <TableCell className={`${TABLE_CELL_CLASS} text-right`}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => navigate(rowActionHref(article.id, templateId))}
                      data-testid={`hitl-${kind}-row-action-${article.id}`}
                    >
                      {t("extraction", "tableActionOpen")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTableWrapper>
    </div>
  );
}
