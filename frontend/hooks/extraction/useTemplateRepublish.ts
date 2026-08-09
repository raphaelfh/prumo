/**
 * The template-config PUBLISH path + its cache contract (slice B-4).
 *
 * Config edits are draft edits: they stamp the DB draft marker and only
 * refresh the grid + Draft chip caches (`invalidateStructure`). The
 * explicit Publish button calls `republish`, which mints the version,
 * re-pins editable-stage runs server-side, and then refreshes the
 * run-scoped and ACTIVE-snapshot caches too (`invalidateAll`). Import
 * flows invalidate the `.all` families (`invalidateAfterImport`) because
 * an import may target a DIFFERENT template than the current selection.
 * Discard (`invalidateAfterDiscard`) rewinds the draft without minting a
 * version, so it refreshes the structure caches plus the instruction and
 * leaves the ACTIVE-snapshot and run caches alone.
 *
 * @module hooks/extraction/useTemplateRepublish
 */

import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {PgError} from '@/lib/error-utils';
import {runsKeys} from '@/hooks/runs/types';
import {
  templateActiveStructureKeys,
  templateConfigStatusKeys,
  templateEntityTypesKeys,
  templateInstructionKeys,
} from '@/lib/query-keys/extraction';
import {
  republishTemplateVersion,
  type RepublishTemplateVersionResponse,
} from '@/services/templateService';

export function useTemplateConfigCaches(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const queryClient = useQueryClient();

  /** After a config edit: the grid + the Draft chip re-read. */
  const invalidateStructure = async (): Promise<void> => {
    if (!projectId || !templateId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: templateEntityTypesKeys.byTemplate(templateId),
      }),
      queryClient.invalidateQueries({
        queryKey: templateConfigStatusKeys.byTemplate(projectId, templateId),
      }),
    ]);
  };

  /** After a publish: run-scoped reads and the ACTIVE snapshot moved too. */
  const invalidateAll = async (): Promise<void> => {
    if (!projectId || !templateId) return;
    await Promise.all([
      invalidateStructure(),
      queryClient.invalidateQueries({queryKey: runsKeys.all}),
      queryClient.invalidateQueries({
        queryKey: templateActiveStructureKeys.byTemplate(projectId, templateId),
      }),
    ]);
  };

  /**
   * After a Discard (B-9c2 D7): the live structure rewound to the published
   * version, so the grid + the Draft chip must re-read — and the general AI
   * instruction with them, since Discard can reset it
   * (`DiscardDraftResponse.instruction_reset`).
   *
   * Deliberately NOT `runsKeys.all` or `templateActiveStructureKeys`: a
   * discard never mints a version, so the ACTIVE snapshot and every
   * run-scoped read are still correct — refetching the runs tree would be
   * pure waste.
   */
  const invalidateAfterDiscard = async (): Promise<void> => {
    if (!projectId || !templateId) return;
    await Promise.all([
      invalidateStructure(),
      queryClient.invalidateQueries({
        queryKey: templateInstructionKeys.byTemplate(projectId, templateId),
      }),
    ]);
  };

  /** After an import (server-side publish, possibly of ANOTHER template):
   * id-free `.all` invalidation. */
  const invalidateAfterImport = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({queryKey: templateEntityTypesKeys.all}),
      queryClient.invalidateQueries({queryKey: templateConfigStatusKeys.all}),
      queryClient.invalidateQueries({queryKey: templateActiveStructureKeys.all}),
      queryClient.invalidateQueries({queryKey: runsKeys.all}),
    ]);
  };

  return {
    invalidateStructure,
    invalidateAll,
    invalidateAfterDiscard,
    invalidateAfterImport,
  };
}

export function useTemplateRepublish(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const {invalidateAll} = useTemplateConfigCaches(projectId, templateId);

  /**
   * Publish the live structure. Returns the publish result (for the
   * success toast's version number) or null on failure — the failure
   * toast lives here so every caller reports consistently.
   */
  const republish = async (): Promise<RepublishTemplateVersionResponse | null> => {
    if (!projectId || !templateId) return null;

    const result = await republishTemplateVersion(projectId, templateId);
    if (!result.ok) {
      console.error('[useTemplateRepublish] publish failed:', result.error);
      // PgError('409') is the publish-time cardinality re-check (B-8
      // review): the server message names the offending section — show
      // it verbatim instead of the generic failure copy.
      toast.error(
        result.error instanceof PgError && result.error.code === '409'
          ? result.error.message
          : t('extraction', 'errors_republishTemplate'),
      );
      return null;
    }

    await invalidateAll();
    return result.data;
  };

  return {republish};
}
