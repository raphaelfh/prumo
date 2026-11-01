import { t } from '@/lib/copy';

export interface SectionView {
  value: string;
  label: string;
  urlParam: string;
  managerOnly?: boolean;
  /** The view shown when the URL names none (or an unknown one); else the first. */
  isDefault?: true;
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
  screening: [
    { value: 'duplicates', label: t('duplicates', 'tabDuplicates'), urlParam: 'screeningTab', managerOnly: true },
    { value: 'title_abstract', label: t('screening', 'tabTitleAbstract'), urlParam: 'screeningTab', isDefault: true },
    { value: 'full_text', label: t('screening', 'tabFullText'), urlParam: 'screeningTab' },
    { value: 'settings', label: t('screening', 'tabSettings'), urlParam: 'screeningTab', managerOnly: true },
  ],
};

export function defaultSectionView(views: SectionView[]): SectionView {
  return views.find((v) => v.isDefault) ?? views[0];
}

export function getSectionViews(sectionId: string): SectionView[] {
  return sectionViews[sectionId] ?? [];
}

export const sectionDescriptionKey: Record<string, 'sectionDescriptionExtraction' | 'sectionDescriptionQuality'> = {
  extraction: 'sectionDescriptionExtraction',
  quality: 'sectionDescriptionQuality',
};
