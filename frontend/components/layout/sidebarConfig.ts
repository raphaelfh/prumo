/**
 * Shared sidebar navigation config: sections, labels, icons, and shortcuts.
 * Used by ProjectSidebar, MobileSidebar, useNavigationShortcuts, and Topbar.
 */
import type {LucideIcon} from 'lucide-react';
import {
    ClipboardCheck,
    FileBarChart,
    FileText,
    Folder,
    LayoutDashboard,
    ListChecks,
    Settings,
    ShieldCheck,
} from 'lucide-react';
import {t} from '@/lib/copy';

export type SidebarTabId =
    | 'overview'
    | 'articles'
    | 'screening'
    | 'extraction'
    | 'quality'
    | 'prisma'
    | 'settings';

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
            {id: 'settings', label: t('layout', 'navSettings'), icon: Settings, shortcut: 'C'},
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
    articles: t('layout', 'navArticles'),
    screening: t('layout', 'navScreening'),
    extraction: t('layout', 'navDataExtraction'),
    quality: t('layout', 'navQualityAssessment'),
    prisma: t('layout', 'navPrismaReport'),
    settings: t('layout', 'navSettings'),
};

/** Workspace-level destinations, shown when no project is open. */
export interface WorkspaceNavItem {
    id: 'hub' | 'settings';
    label: string;
    icon: LucideIcon;
    path: string;
    /** Letter pressed after `G`. Absent when the item owns no sequence. */
    shortcut?: string;
}

export const workspaceSectionTitle = t('layout', 'sectionWorkspace');

/**
 * `G H` is free — project shortcuts use O/C/A/T/E/Q/R. Settings deliberately
 * has none: `⌘,` is bound app-wide by `useGlobalShortcuts`, and this rail
 * neither registers nor owns it.
 */
export const workspaceNavItems: WorkspaceNavItem[] = [
    {id: 'hub', label: t('layout', 'projects'), icon: Folder, path: '/', shortcut: 'H'},
    {id: 'settings', label: t('layout', 'settings'), icon: Settings, path: '/settings'},
];

/** One rendered nav item, already resolved to a destination and a state. */
export interface SidebarNavEntry {
    id: string;
    label: string;
    icon: LucideIcon;
    /** Letter pressed after `G`; absent when the item owns no sequence. */
    shortcut?: string;
    /** Where a click navigates. Navigation is a URL write, never a callback. */
    path: string;
    active: boolean;
}

export interface SidebarNavGroup {
    title: string;
    items: SidebarNavEntry[];
}

/**
 * The sidebar's two states, derived ONCE.
 *
 * The desktop rail and the mobile drawer render the same groups and differ
 * only in chrome (badge vs none, `h-7` vs the drawer's touch target, and the
 * drawer closing itself after navigating). Writing the ternary out in both
 * files is how the two drifted before; this is the single source.
 *
 * `active` is derived differently in each state on purpose: project sections
 * are selected by `?tab=` (which the full-screen run routes do not carry, so
 * the caller passes `activeTab` explicitly), workspace destinations by the
 * pathname.
 */
export function deriveSidebarNav({
    projectId,
    activeTab,
    pathname,
}: {
    projectId: string | null;
    activeTab: string;
    pathname: string;
}): SidebarNavGroup[] {
    if (projectId === null) {
        return [
            {
                title: workspaceSectionTitle,
                items: workspaceNavItems.map((item) => ({
                    id: item.id,
                    label: item.label,
                    icon: item.icon,
                    shortcut: item.shortcut,
                    path: item.path,
                    active: pathname === item.path,
                })),
            },
        ];
    }

    return sidebarSections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
            shortcut: item.shortcut,
            path: `/projects/${projectId}?tab=${item.id}`,
            active: activeTab === item.id,
        })),
    }));
}
