import {cn} from '@/lib/utils';

export function ArticleViewButton({
  active,
  onClick,
  label,
  disabled,
  title,
  describedById,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  title?: string;
  describedById?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      aria-disabled={disabled}
      aria-describedby={describedById}
      className={cn(
        'h-6 rounded-sm px-2 text-[12px] transition-colors',
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
        disabled && 'opacity-50',
      )}
    >
      {label}
    </button>
  );
}
