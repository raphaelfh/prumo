/**
 * UI copy for layout (sidebar, app shell). English only.
 */
export const layout = {
    defaultProjectName: 'Project',
    backToProjects: 'Back to projects',
    dashboard: 'Dashboard',
    settings: 'Settings',
    signOut: 'Sign out',
    projects: 'Projects',
    loadingProjects: 'Loading projects…',
    createNewProject: 'Create new project',

    // Sidebar sections (used by sidebarConfig or components)
    sectionProject: 'Project',
    sectionReview: 'Review',
    navArticles: 'Articles',
    navSettings: 'Settings',
    navScreening: 'Screening',
    navDataExtraction: 'Data extraction',
    navQualityAssessment: 'Quality assessment',
} as const;

export type LayoutCopy = typeof layout;
