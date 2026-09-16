/**
 * Select-all checkbox for a list header, with indeterminate rendering.
 *
 * Radix's Checkbox has no indeterminate visual, so a partial selection shows
 * as unchecked with a dimmed fill. Mirrors ``ArticleExtractionTable``'s own
 * header checkbox so both article lists select identically.
 */

import { Checkbox } from "@/components/ui/checkbox";

interface HITLHeaderCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label"?: string;
}

export function HITLHeaderCheckbox({
  checked,
  indeterminate,
  onCheckedChange,
  ...props
}: HITLHeaderCheckboxProps) {
  return (
    <Checkbox
      checked={indeterminate ? false : checked}
      onCheckedChange={onCheckedChange}
      className={indeterminate ? "data-[state=checked]:bg-primary/50" : ""}
      {...props}
    />
  );
}
