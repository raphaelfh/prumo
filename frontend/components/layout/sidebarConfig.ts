/**
 * Shared sidebar navigation config: sections and tab labels from copy.
 * Used by ProjectSidebar, MobileSidebar, and Topbar.
 */

import type {LucideIcon} from 'lucide-react';
import {BarChart3, ClipboardCheck, FileText, Settings} from 'lucide-react';
import {t} from '@/lib/copy';

export interface SidebarNavItem {
    id: string;
    label: string;
    icon: LucideIcon;
}

export interface SidebarSection {
    title: string;
    items: SidebarNavItem[];
}

export const sidebarSections: SidebarSection[] = [
    {
        title: t('layout', 'sectionProject'),
        items: [
            {id: 'articles', label: t('layout', 'navArticles'), icon: FileText},
            {id: 'settings', label: t('layout', 'navSettings'), icon: Settings},
        ],
    },
    {
        title: t('layout', 'sectionReview'),
        items: [
            {id: 'extraction', label: t('layout', 'navDataExtraction'), icon: ClipboardCheck},
            {id: 'assessment', label: t('layout', 'navQualityAssessment'), icon: BarChart3},
        ],
    },
];

/** Map tab id -> display label for Topbar and other consumers */
export const tabIdToLabel: Record<string, string> = {
    articles: t('layout', 'navArticles'),
    extraction: t('layout', 'navDataExtraction'),
    assessment: t('layout', 'navQualityAssessment'),
    settings: t('layout', 'navSettings'),
};
