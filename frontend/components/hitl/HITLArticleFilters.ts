/**
 * Filter and sort configuration for ``HITLArticleTable``.
 *
 * Declarative data, not behaviour: the field list the filter popover renders,
 * the empty value each field resets to, and the sort vocabulary the column
 * headers drive. It lives beside the table rather than inside it because the
 * table reached its size ceiling, and because this is the part that changes
 * when a column is added — not the rendering.
 */

import { t } from "@/lib/copy";
import type { FilterFieldConfig, FilterValues } from "@/components/shared/list";

export type SortField = "title" | "publication_year" | "progress" | "created_at";

export type SortDirection = "asc" | "desc";

export const FILTER_FIELDS: FilterFieldConfig[] = [
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

export const INITIAL_FILTERS: FilterValues = {
  status: [],
  publication_year: {},
  title: "",
  authors: "",
};
