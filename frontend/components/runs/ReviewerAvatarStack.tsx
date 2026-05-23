/**
 * Compact stacked-avatar indicator showing the reviewers who have
 * touched a coordinate (instance, field) or domain.
 *
 * Up to `max` avatars are shown side-by-side with a slight overlap;
 * any overflow is collapsed into a "+N" pill. Each avatar carries an
 * `aria-label` and a `title` so the name is accessible on hover for
 * sighted users and via screen reader. No external avatar dependency
 * — falls back to initial-letter when the profile has no avatar_url.
 */

import { cn } from "@/lib/utils";

export interface ReviewerAvatarEntry {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface ReviewerAvatarStackProps {
  reviewers: ReviewerAvatarEntry[];
  /** Maximum avatars to render before collapsing into "+N". Default 3. */
  max?: number;
  /** Tailwind size class — pick from a small palette. Default "size-6". */
  sizeClass?: "size-5" | "size-6" | "size-7";
  className?: string;
  /** data-testid base; receives `-{id}` suffix per avatar. */
  testId?: string;
}

function initials(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

// Literal lookup map — Tailwind cannot scan dynamic class names, so each
// slot is a full string of class names. Opacity modifier `/20` (or `/30`
// in dark mode) gives the soft tint without needing a separate `200`
// shade per hue. Backed by --reviewer-1..5 CSS tokens in
// frontend/index.css (light + dark variants).
const PALETTE: readonly string[] = [
  "bg-reviewer-1/20 text-reviewer-1 dark:bg-reviewer-1/30 dark:text-reviewer-1",
  "bg-reviewer-2/20 text-reviewer-2 dark:bg-reviewer-2/30 dark:text-reviewer-2",
  "bg-reviewer-3/20 text-reviewer-3 dark:bg-reviewer-3/30 dark:text-reviewer-3",
  "bg-reviewer-4/20 text-reviewer-4 dark:bg-reviewer-4/30 dark:text-reviewer-4",
  "bg-reviewer-5/20 text-reviewer-5 dark:bg-reviewer-5/30 dark:text-reviewer-5",
] as const;

function colorFor(id: string): string {
  // Deterministic-ish hash: pick a slot from PALETTE by id char codes.
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % 1024;
  return PALETTE[hash % PALETTE.length];
}

export function ReviewerAvatarStack({
  reviewers,
  max = 3,
  sizeClass = "size-6",
  className,
  testId = "reviewer-avatar",
}: ReviewerAvatarStackProps) {
  if (reviewers.length === 0) return null;
  const visible = reviewers.slice(0, max);
  const overflow = reviewers.length - visible.length;

  return (
    <div
      className={cn(
        "flex items-center -space-x-1",
        className,
      )}
      data-testid={`${testId}-stack`}
    >
      {visible.map((r) => {
        const colorClass = colorFor(r.id);
        const ring =
          "ring-2 ring-background dark:ring-background";
        const baseClass = cn(
          sizeClass,
          "flex items-center justify-center rounded-full text-[10px] font-semibold",
          ring,
          colorClass,
        );
        return r.avatarUrl ? (
          <img
            key={r.id}
            src={r.avatarUrl}
            alt={r.name}
            title={r.name}
            aria-label={r.name}
            className={cn(sizeClass, "rounded-full object-cover", ring)}
            data-testid={`${testId}-${r.id}`}
          />
        ) : (
          <span
            key={r.id}
            className={baseClass}
            title={r.name}
            aria-label={r.name}
            data-testid={`${testId}-${r.id}`}
          >
            {initials(r.name)}
          </span>
        );
      })}
      {overflow > 0 ? (
        <span
          className={cn(
            sizeClass,
            "flex items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background",
          )}
          title={`+${overflow} more`}
          aria-label={`+${overflow} more`}
          data-testid={`${testId}-overflow`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
