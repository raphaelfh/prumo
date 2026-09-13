/**
 * Per-project high-quality-parsing toggle (LlamaParse).
 *
 * Manager-only control. When ON, newly ingested PDFs are parsed by the cloud
 * LlamaParse backend; otherwise the self-hosted parser is used. Requires a
 * stored `llama_cloud` BYOK key, mirroring how other integrations are activated.
 *
 * Renders a SettingsRow; place it inside a SettingsGroup.
 */
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { SettingsRow } from '@/components/settings';
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
  const needsKeyId = `${id}-needs-key`;
  return (
    <SettingsRow
      label={t('parsing', 'highQualityLabel')}
      htmlFor={id}
      hint={t('parsing', 'highQualityHint')}
      align={hasLlamaCloudKey ? 'center' : 'start'}
    >
      {({ describedBy }) => (
        <div className="space-y-1">
          <Switch
            id={id}
            checked={checked}
            disabled={disabled || saving || !hasLlamaCloudKey}
            onCheckedChange={onToggle}
            aria-describedby={[describedBy, hasLlamaCloudKey ? undefined : needsKeyId].filter(Boolean).join(' ') || undefined}
          />
          {!hasLlamaCloudKey && (
            // A disabled reason stays visible text, never behind the hint.
            <p id={needsKeyId} className="text-[13px] text-muted-foreground">
              {t('parsing', 'highQualityNeedsKey')}
            </p>
          )}
        </div>
      )}
    </SettingsRow>
  );
}
