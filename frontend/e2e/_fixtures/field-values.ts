/**
 * E2E helper: a value a field's write-time contract accepts.
 *
 * Reviewer decisions and consensus overrides are held to the field's pinned
 * contract (`backend/app/services/value_contract.py`): a select takes one of its
 * option codes, a multiselect a list of them, a number a finite number, and so
 * on — the shapes the run form sends. Flows that plant a value on an arbitrary
 * field read its shape with `FIELD_SHAPE_COLUMNS` and write the value this
 * helper builds, so the plant keeps working whatever field type the coordinate
 * resolves to.
 */

import type { Database, Json } from "../../integrations/supabase/types";

/** `extraction_fields` columns `contractValue` reads (PostgREST `select=`). */
export const FIELD_SHAPE_COLUMNS = "id,field_type,allowed_values";

export type FieldShape = {
  id: string;
  field_type: Database["public"]["Enums"]["extraction_field_type"];
  allowed_values: Json | null;
};

/**
 * The in-band disposition strings the backend rewrites into an absent marker
 * when a field lists them as options (`value_semantics._DISPOSITION_TO_REASON`).
 * Skipped so a planted value stays a value.
 */
const DISPOSITION_STRINGS = new Set([
  "No information",
  "Not applicable",
  "Not evaluated",
  "NI",
  "NA",
]);

/** Option codes in stored order, from any stored shape (mirrors `normalize_options`). */
function optionCodes(allowedValues: Json | null): string[] {
  const options =
    allowedValues && typeof allowedValues === "object" && !Array.isArray(allowedValues)
      ? allowedValues.options
      : allowedValues;
  if (!Array.isArray(options)) return [];
  return options.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item] : [];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const code = item.value || item.label;
      return code ? [String(code)] : [];
    }
    return [];
  });
}

/** The first substantive option code that is not in `exclude`. */
export function pickOptionCode(field: FieldShape, exclude: unknown[] = []): string {
  const code = optionCodes(field.allowed_values).find(
    (c) => !DISPOSITION_STRINGS.has(c) && !exclude.includes(c),
  );
  if (code === undefined) {
    throw new Error(`field ${field.id} has no option code to plant`);
  }
  return code;
}

/**
 * The inner value (the `value` of `{ value }`) the contract accepts for
 * `field`. A text field gets `text`, so a flow's planted marker stays
 * recognisable where the field type allows it.
 */
export function contractValue(field: FieldShape, text: string): Json {
  switch (field.field_type) {
    case "select":
      return pickOptionCode(field);
    case "multiselect":
      return [pickOptionCode(field)];
    case "number":
      return 1;
    case "date":
      return "2024-01-01";
    case "boolean":
      return true;
    case "text":
      return text;
  }
}
