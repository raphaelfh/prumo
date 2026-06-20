/**
 * Per-project high-quality-parsing toggle (LlamaParse).
 *
 * Manager-only control. When ON, newly ingested PDFs are parsed by the cloud
 * LlamaParse backend (non-PHI projects only — the backend factory fail-closes
 * PHI projects to the self-hosted parser regardless). Requires a stored
 * `llama_cloud` BYOK key, mirroring how other integrations are activated.
 */
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/copy';
import { setParserType } from '@/services/parserSettingsService';

interface HighQualityParsingToggleProps {
  projectId: string;
  currentType: 'standard' | 'llamaparse';
  /** True when the user has a stored llama_cloud BYOK key. */
  hasLlamaCloudKey: boolean;
  /** Disabled unless the viewer is a manager. */
  disabled?: boolean;
}

export function HighQualityParsingToggle({
  projectId,
  currentType,
  hasLlamaCloudKey,
  disabled = false,
}: HighQualityParsingToggleProps) {
  const [checked, setChecked] = useState(currentType === 'llamaparse');
  const [saving, setSaving] = useState(false);

  // render-phase prev-sync (codebase idiom) so a late settings load re-syncs.
  const [prevType, setPrevType] = useState(currentType);
  if (prevType !== currentType) {
    setPrevType(currentType);
    setChecked(currentType === 'llamaparse');
  }

  const onToggle = (next: boolean) => {
    setChecked(next); // optimistic
    setSaving(true);
    setParserType(projectId, next ? 'llamaparse' : 'standard')
      .then(() => toast.success(t('parsing', 'parserSaved')))
      .catch((e: unknown) => {
        setChecked(!next); // revert
        toast.error(e instanceof Error ? e.message : t('parsing', 'parserError'));
      })
      .finally(() => setSaving(false));
  };

  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('parsing', 'highQualityLabel')}
        </label>
        <p className="text-xs text-muted-foreground">
          {hasLlamaCloudKey ? t('parsing', 'highQualityHint') : t('parsing', 'highQualityNeedsKey')}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled || saving || !hasLlamaCloudKey}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
