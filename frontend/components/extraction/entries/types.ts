/**
 * One entry of a repeating section, as the run form renders it.
 *
 * Lifted out of `ModelSelector` (trees B3) because the type outlived the
 * component: `useExtractionFormAIActions` and
 * `useBatchAllModelsSectionsExtraction` both consume it and both survive
 * this slice. Keeping it in a component that is being deleted would have
 * made the deletion a cascade.
 *
 * `progress` is optional: a group renders its entries before their
 * required-field counts have been derived.
 */
export interface Entry {
  instanceId: string;
  /** The entry's human-facing name — `label` on the instance row. */
  entryName: string;
  progress?: {
    completed: number;
    total: number;
    percentage: number;
  };
}
