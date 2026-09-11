import { useActiveSection } from '@/hooks/extraction/useActiveSection';
import { buildFlatSectionRegistry } from '@/lib/extraction/sectionRegistry';
import type { QADomain } from '@/types/qa';

/** A copy whose fields are all optional; the template's own domains stay untouched. */
function notOwed(domain: QADomain): QADomain {
  return { ...domain, fields: domain.fields.map((field) => ({ ...field, is_required: false })) };
}

/**
 * The QA form's section rail: the domains the form renders (those with a session
 * instance), their rail entries — counted by the same builder as extraction's —
 * and the scroll-spy that tracks and scrolls to them.
 *
 * `outOfScope` (`outOfScopeSectionsOnForm`) applies first, the way the worklist's
 * `scopedRowProgress` drops those sections before measuring: nothing in an
 * out-of-scope domain is owed, so its fields stop being required. The form renders
 * these same domains, so the rail entry (0/0, never pending) and the rows (no
 * pending accent, so no jump target) cannot disagree. Input stays open.
 */
export function useQASectionNav(
  domains: QADomain[],
  instancesByEntityType: Record<string, string> | undefined,
  values: Record<string, unknown>,
  outOfScope: ReadonlySet<string>,
) {
  const renderedDomains = domains.flatMap((domain) => {
    const instanceId = instancesByEntityType?.[domain.entityType.id];
    const scoped = outOfScope.has(domain.entityType.name) ? notOwed(domain) : domain;
    return instanceId ? [{ domain: scoped, instanceId }] : [];
  });
  const items = buildFlatSectionRegistry(
    renderedDomains.map(({ domain, instanceId }) => ({
      id: domain.entityType.id,
      label: domain.entityType.label || domain.entityType.name,
      fields: domain.fields,
      isRequired: domain.entityType.is_required,
      instanceId,
    })),
    values,
  );
  const { activeId, registerSection, scrollToSection } = useActiveSection(items.map((s) => s.id));
  return { renderedDomains, items, activeId, registerSection, scrollToSection };
}
