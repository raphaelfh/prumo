import {type ClassValue, clsx} from "clsx";
import {extendTailwindMerge} from "tailwind-merge";

// Teach tailwind-merge about our custom box-shadow tokens so they
// correctly dedupe against the built-in `shadow-{size}` utilities
// (`shadow-sm`, `shadow-md`, …) and the shadcn `<Card>` base
// `shadow-sm`. Without this, consumers stacking `shadow-elev-popover`
// on top of a primitive's `shadow-sm` end up with both rules emitted
// and the later-in-stylesheet one wins (usually `shadow-sm`),
// silently neutralising the override.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: ["shadow-elev-card", "shadow-elev-popover"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
