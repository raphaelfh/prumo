import { cva, type VariantProps } from 'class-variance-authority';

// Shared chip/pill for header metadata (AI count, reviewers divergence, role,
// kind badge). Replaces the hand-rolled per-call-site pills so radius / focus
// ring / type floor / touch target are defined once.
export const headerChip = cva(
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border/50 px-2 text-header-meta text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11',
  {
    variants: {
      interactive: {
        true: 'cursor-pointer transition-colors hover:bg-muted/60 hover:text-foreground',
        false: '',
      },
    },
    defaultVariants: { interactive: false },
  },
);

export type HeaderChipVariants = VariantProps<typeof headerChip>;
