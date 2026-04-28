/**
 * UI copy for layout (sidebar, app shell). English only.
 */
export const layout = {
    defaultProjectName: 'Project',
    backToProjects: 'Back to projects',
    dashboard: 'Dashboard',
    settings: 'Settings',
    signOut: 'Sign out',
    profile: 'Profile',
    inviteMembers: 'Invite members',
    helpAndSupport: 'Help & support',
    projects: 'Projects',
    loadingProjects: 'Loading projects…',
    createNewProject: 'Create new project',

    // Sidebar sections (used by sidebarConfig or components)
    sectionProject: 'Project',
    sectionReview: 'Review',
    navOverview: 'Overview',
    navMembers: 'Members',
    navArticles: 'Articles',
    navScreening: 'Screening',
    navDataExtraction: 'Data extraction',
    navPrismaReport: 'PRISMA report',
    navSettings: 'Settings',

    // Coming soon placeholder
    comingSoonTitle: 'Coming soon',
    comingSoonBody: 'This area is being built and will be available shortly.',

    // Theme toggle
    themeToggleLight: 'Switch to dark theme',
    themeToggleDark: 'Switch to system theme',
    themeToggleSystem: 'Switch to light theme',
    themeToggleAriaLabel: 'Toggle theme',

    // Resize handle
    resizeHandleTooltip: 'Click to collapse · Drag to resize',

    // Sidebar toggle
    sidebarToggleAriaLabel: 'Toggle sidebar',
} as const;

export type LayoutCopy = typeof layout;
