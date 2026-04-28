/**
 * Shared sidebar navigation config: sections, labels, icons, and shortcuts.
 * Used by ProjectSidebar, MobileSidebar, useNavigationShortcuts, and Topbar.
 */
import type {LucideIcon} from 'lucide-react';
import {
    ClipboardCheck,
    FileBarChart,
    FileText,
    LayoutDashboard,
    ListChecks,
    ShieldCheck,
    Users,
} from 'lucide-react';
import {t} from '@/lib/copy';

export type SidebarTabId =
    | 'overview'
    | 'members'
    | 'articles'
    | 'screening'
    | 'extraction'
    | 'quality'
    | 'prisma';

export interface SidebarNavItem {
    id: SidebarTabId;
    label: string;
    icon: LucideIcon;
    /** Single uppercase letter triggered after the `G` prefix. */
    shortcut: string;
    /** Whether this tab renders a ComingSoonPanel placeholder. */
    comingSoon?: boolean;
}

export interface SidebarSection {
    title: string;
    items: SidebarNavItem[];
}

export const sidebarSections: SidebarSection[] = [
    {
        title: t('layout', 'sectionProject'),
        items: [
            {id: 'overview', label: t('layout', 'navOverview'), icon: LayoutDashboard, shortcut: 'O', comingSoon: true},
            {id: 'members', label: t('layout', 'navMembers'), icon: Users, shortcut: 'M', comingSoon: true},
        ],
    },
    {
        title: t('layout', 'sectionReview'),
        items: [
            {id: 'articles', label: t('layout', 'navArticles'), icon: FileText, shortcut: 'A'},
            {id: 'screening', label: t('layout', 'navScreening'), icon: ListChecks, shortcut: 'T', comingSoon: true},
            {id: 'extraction', label: t('layout', 'navDataExtraction'), icon: ClipboardCheck, shortcut: 'E'},
            {id: 'quality', label: t('layout', 'navQualityAssessment'), icon: ShieldCheck, shortcut: 'Q'},
            {id: 'prisma', label: t('layout', 'navPrismaReport'), icon: FileBarChart, shortcut: 'R', comingSoon: true},
        ],
    },
];

/** Flat list of items for shortcut wiring. */
export const sidebarItems: SidebarNavItem[] = sidebarSections.flatMap((s) => s.items);

/** Map tab id -> display label for Topbar and other consumers. */
export const tabIdToLabel: Record<string, string> = {
    overview: t('layout', 'navOverview'),
    members: t('layout', 'navMembers'),
    articles: t('layout', 'navArticles'),
    screening: t('layout', 'navScreening'),
    extraction: t('layout', 'navDataExtraction'),
    quality: t('layout', 'navQualityAssessment'),
    prisma: t('layout', 'navPrismaReport'),
    settings: t('layout', 'navSettings'),
};

export const VALID_TAB_IDS: readonly string[] = sidebarItems.map((i) => i.id);
