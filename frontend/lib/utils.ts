import {type ClassValue, clsx} from "clsx";
import {extendTailwindMerge} from "tailwind-merge";

// Teach tailwind-merge about our custom utilities so they correctly dedupe
// against the built-in scale they belong to. tailwind-merge only knows the
// stock utility names; a project `@utility` (frontend/index.css) is opaque to
// it, so without an entry here BOTH classes survive the merge and the
// later-in-stylesheet rule wins instead of the later-in-call-order one —
// silently neutralising the override the caller intended.
//
// Any new custom utility that shares a CSS property with a built-in scale
// belongs in this list.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // dedupes against the built-in box-shadow scale, incl. the shadcn <Card> base
      shadow: ["shadow-elev-card", "shadow-elev-popover", "shadow-elev-header"],
      // dedupes against the built-in z-index scale ("z" is tailwind-merge's group id)
      z: ["z-header"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
