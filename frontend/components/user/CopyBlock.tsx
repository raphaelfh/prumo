import {Button} from '@/components/ui/button';
import {useCopyToClipboard} from '@/hooks/useCopyToClipboard';
import {t} from '@/lib/copy';

export function CopyBlock({label, code, copyAriaLabel}: {label: string; code: string; copyAriaLabel?: string}) {
  const {copied, copy} = useCopyToClipboard();
  return (
    <div className="space-y-1">
      <p className="text-[13px] font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px]">{code}</pre>
        <Button type="button" size="sm" variant="ghost" onClick={() => copy(code)} aria-label={copyAriaLabel ?? t('personalAccessTokens', 'copy')}>
          {copied ? t('personalAccessTokens', 'copied') : t('personalAccessTokens', 'copy')}
        </Button>
      </div>
    </div>
  );
}
