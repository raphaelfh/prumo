import { t } from '@/lib/copy';

export interface SectionView {
  value: string;
  label: string;
  urlParam: string;
  managerOnly?: boolean;
}

const sectionViews: Record<string, SectionView[]> = {
  extraction: [
    { value: 'extraction', label: t('extraction', 'tabWorklist'), urlParam: 'extractionTab' },
    { value: 'dashboard', label: t('extraction', 'tabDashboard'), urlParam: 'extractionTab' },
    { value: 'configuration', label: t('extraction', 'tabConfiguration'), urlParam: 'extractionTab', managerOnly: true },
  ],
  quality: [
    { value: 'assessment', label: t('qa', 'tabAssessment'), urlParam: 'qaTab' },
    { value: 'dashboard', label: t('qa', 'tabDashboard'), urlParam: 'qaTab' },
    { value: 'configuration', label: t('qa', 'tabConfiguration'), urlParam: 'qaTab', managerOnly: true },
  ],
};

export function getSectionViews(sectionId: string): SectionView[] {
  return sectionViews[sectionId] ?? [];
}

export const sectionDescriptionKey: Record<string, string> = {
  extraction: 'sectionDescriptionExtraction',
  quality: 'sectionDescriptionQuality',
};
