/**
 * Seize the advisory editor lock (B-9f).
 *
 * Invalidates the config-status family, which carries the holder — the
 * chip has to stop saying someone else is editing the moment it is ours.
 * Nothing else moved: a takeover changes WHO may write, never the tree.
 *
 * @module hooks/extraction/useTakeOverDraftLock
 */
import {useState} from 'react';
import {toast} from 'sonner';

import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {takeOverDraftLock} from '@/services/templateService';

export function useTakeOverDraftLock(projectId: string, templateId: string) {
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);
  const [takingOver, setTakingOver] = useState(false);

  const takeOver = async (): Promise<boolean> => {
    setTakingOver(true);
    const result = await takeOverDraftLock(projectId, templateId);
    setTakingOver(false);
    if (!result.ok) {
      console.error('[useTakeOverDraftLock]', result.error);
      toast.error(
        `${t('templateConfig', 'errors_takeOverDraft')}: ${result.error.message}`,
      );
      return false;
    }
    await invalidateStructure();
    const previous = result.data.previous_holder_name;
    toast.success(
      previous == null
        ? t('templateConfig', 'draftTakeOverSuccess')
        : t('templateConfig', 'draftTakeOverFrom').replace('{{who}}', previous),
    );
    return true;
  };

  return {takeOver, takingOver};
}
