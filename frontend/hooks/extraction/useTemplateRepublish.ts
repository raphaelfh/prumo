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
import {runsKeys} from '@/hooks/runs/types';
import {
  templateActiveStructureKeys,
  templateConfigStatusKeys,
  templateEntityTypesKeys,
  templateInstructionKeys,
} from '@/lib/query-keys/extraction';
import {
  republishTemplateVersion,
  TemplatePublishRefusal,
  type RepublishTemplateVersionRequest,
  type RepublishTemplateVersionResponse,
} from '@/services/templateService';

/**
 * The sentence for a failed publish (B-9b0 D4).
 *
 * A typed refusal is a policy outcome, so it gets its own copy with every
 * offending section named; anything else — 500, timeout, offline — keeps
 * the generic failure copy. The server's prose is never rendered: it is
 * diagnostic, the code and the labels are the contract.
 */
function publishFailureMessage(error: Error): string {
  if (!(error instanceof TemplatePublishRefusal)) {
    return t('extraction', 'errors_republishTemplate');
  }
  // The two B-9b2b refusals are about the sheet, not the template's shape,
  // so they get their own sentences rather than the section-list one.
  if (error.code === 'PUBLISH_DIFF_DRIFTED') {
    return t('templateConfig', 'errors_publishDrifted');
  }
  if (error.code === 'PUBLISH_MISSING_ACKNOWLEDGEMENT') {
    return t('templateConfig', 'errors_publishMissingAck');
  }
  const {sectionLabels} = error;
  if (sectionLabels.length === 0) {
    return t('templateConfig', 'errors_publishBlockedPlain');
  }
  // Labels are user-authored and may contain commas, so each is quoted
  // before the join — the list has to stay readable with several sections.
  const listed = sectionLabels.map((label) => `“${label}”`).join(', ');
  return t(
    'templateConfig',
    sectionLabels.length === 1 ? 'errors_publishBlockedOne' : 'errors_publishBlockedOther',
  ).replace('{{sections}}', listed);
}

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

  /**
   * After an import (server-side publish, possibly of ANOTHER template):
   * id-free `.all` invalidation of the template STRUCTURE caches.
   *
   * The project's template LIST is not one of them — it is refreshed by the
   * write itself (`hooks/hitl/useProjectTemplates`: every mutation there
   * invalidates `projectTemplatesKeys.all` and awaits it before resolving,
   * which is what lets callers re-point a selection onto a row that already
   * exists). Folding it in here would make every caller of this helper wait
   * on the run and structure families too, so the two stay separate: an
   * import path needs BOTH.
   */
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
  const republish = async (
    contract: RepublishTemplateVersionRequest,
  ): Promise<RepublishTemplateVersionResponse | null> => {
    if (!projectId || !templateId) return null;

    const result = await republishTemplateVersion(projectId, templateId, contract);
    if (!result.ok) {
      console.error('[useTemplateRepublish] publish failed:', result.error);
      toast.error(publishFailureMessage(result.error));
      return null;
    }

    await invalidateAll();
    return result.data;
  };

  return {republish};
}
