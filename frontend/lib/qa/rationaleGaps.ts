/**
 * The rationale coordinates a QA run still owes before it can finalize.
 *
 * The backend refuses to finalize a run whose PUBLISHED judgment overrides its
 * derived default with an empty rationale (`DivergenceRationaleError` → 400),
 * and stamps `rationale_required` on the derived-judgment payload so the client
 * can render the same verdict without recomputing it.
 *
 * Feeding these coordinates to the consensus panel as `requiredCoords` is what
 * makes them REACHABLE. Without it the run is a dead end: the assess form (the
 * only surface with a rationale input) is unmounted at consensus,
 * `consensus → extract` is not an allowed transition, `reopen_to_extract`
 * refuses quality-assessment runs by kind, and the compare table suppresses its
 * own Override button on an untouched coordinate (`canAct` is false for
 * `undefined` status) — so the manager could read the refusal and have nowhere
 * to answer it. Classified as a `required_gap`, the row becomes actionable, is
 * surfaced by the default "needs attention" filter, and blocks the client-side
 * finalize so the 400 is never reached in the first place.
 */

interface DerivedJudgmentLike {
  rationale_required?: boolean;
  target_entity_type_id?: string | null;
  rationale_field_id?: string | null;
}

/** `instance::field` keys for every rationale the server says is still owed. */
export function rationaleGapCoords(
  derivedJudgments: readonly DerivedJudgmentLike[] | undefined,
  instancesByEntityType: Readonly<Record<string, string>> | undefined,
): string[] {
  if (!derivedJudgments || !instancesByEntityType) return [];
  const coords: string[] = [];
  for (const entry of derivedJudgments) {
    if (!entry.rationale_required) continue;
    // Both ids are nullable on the wire: a spec pointer that no longer resolves
    // against the run's tree yields null rather than a dangling coordinate.
    // Nothing to point the manager at, so nothing to require.
    if (!entry.target_entity_type_id || !entry.rationale_field_id) continue;
    const instanceId = instancesByEntityType[entry.target_entity_type_id];
    if (!instanceId) continue;
    coords.push(`${instanceId}::${entry.rationale_field_id}`);
  }
  return coords;
}
