/**
 * The one overlay frame (spec 2026-09-12 § 4.5 and § 9.5), shared by Dialog,
 * AlertDialog and Sheet so the three cannot drift apart. Classes only.
 *
 * Centring uses `inset-0 m-auto`, not translate: Tailwind v4's `translate`
 * property and tailwindcss-animate's keyframe `transform` compose
 * differently than in v3, and a translate-centred dialog jumps as it animates.
 */
import {cva} from 'class-variance-authority';

const surface =
  'z-50 flex flex-col gap-0 overflow-hidden border border-border/40 bg-background p-0 shadow-elev-overlay outline-none dark:bg-popover';

const motion = 'ease-out data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none';

export const overlayBackdrop =
  'fixed inset-0 z-50 bg-black/60 duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:animate-none';

export const overlayHeader = 'flex shrink-0 flex-col gap-1 px-5 pt-5 pb-3 pr-12 text-left';
export const overlayTitle = 'text-[15px] font-medium leading-5 text-foreground';
export const overlayDescription = 'text-[13px] text-muted-foreground';
export const overlayBody = 'min-h-0 flex-1 overflow-y-auto px-5 py-2 first:pt-5 last:pb-5';
export const overlayFooter = 'flex shrink-0 flex-col-reverse gap-2 px-5 pt-3 pb-5 sm:flex-row sm:justify-end';
export const overlayCloseButton = 'absolute right-3 top-3 text-muted-foreground hover:text-foreground';

export const dialogFrame = cva(
  [
    surface,
    motion,
    'fixed inset-x-0 bottom-0 max-h-[92dvh] w-full rounded-t-xl',
    'sm:inset-0 sm:m-auto sm:w-[calc(100vw-2rem)] sm:rounded-lg',
    'data-[state=open]:duration-150 data-[state=closed]:duration-100 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
    'max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom',
    'sm:data-[state=open]:zoom-in-[0.98] sm:data-[state=closed]:zoom-out-[0.98]',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'sm:h-fit sm:max-h-[85dvh] sm:max-w-[400px]',
        md: 'sm:h-fit sm:max-h-[85dvh] sm:max-w-[560px]',
        lg: 'sm:h-[85dvh] sm:max-w-[800px]',
      },
    },
    defaultVariants: {size: 'md'},
  },
);

export const sheetFrame = cva(
  [surface, motion, 'fixed inset-y-0 h-full max-w-[calc(100vw-2rem)] border-y-0', 'data-[state=open]:duration-200 data-[state=closed]:duration-150'].join(' '),
  {
    variants: {
      side: {
        left: 'left-0 border-l-0 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        right: 'right-0 border-r-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
      },
      size: {
        default: 'w-[420px]',
        narrow: 'w-[320px]',
      },
    },
    defaultVariants: {side: 'right', size: 'default'},
  },
);
