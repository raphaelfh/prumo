import { useActiveSection } from '@/hooks/extraction/useActiveSection';
import { buildFlatSectionRegistry } from '@/lib/extraction/sectionRegistry';
import type { QADomain } from '@/types/qa';

/**
 * The QA form's section rail: the domains the form renders (those with a session
 * instance), their rail entries — counted by the same builder as extraction's —
 * and the scroll-spy that tracks and scrolls to them.
 */
export function useQASectionNav(
  domains: QADomain[],
  instancesByEntityType: Record<string, string> | undefined,
  values: Record<string, unknown>,
) {
  const renderedDomains = domains.flatMap((domain) => {
    const instanceId = instancesByEntityType?.[domain.entityType.id];
    return instanceId ? [{ domain, instanceId }] : [];
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
