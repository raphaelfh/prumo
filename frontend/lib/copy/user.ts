/**
 * UI copy for user area (settings: profile, security, integrations, API keys). English only.
 */
export const user = {
    // Settings page
    settingsTitle: 'Settings',
    settingsAriaSections: 'Settings sections',
    ariaGoBack: 'Go back',
    tabProfile: 'Profile',
    tabSecurity: 'Security',
    tabIntegrations: 'Integrations',
    tabProfileDesc: 'Personal information and avatar',
    tabSecurityDesc: 'Password and authentication',
    tabIntegrationsDesc: 'External services and APIs',

    // Profile
    profilePicture: 'Profile picture',
    profileUploadComingSoon: 'Upload coming soon',
    profileEmailLabel: 'Email',
    profileEmailHint: 'Managed by the authentication system — cannot be changed.',
    profileFullNameLabel: 'Full name',
    profileFullNameHint: 'Your full name as shown to others.',
    profileFullNamePlaceholder: 'Your full name',
    profileSaving: 'Saving…',
    profileSaveChanges: 'Save changes',
    profileNameRequired: 'Name is required',
    profileNameMaxLength: 'Name too long (max 100 characters)',
    profileErrorNotAuthenticated: 'User not authenticated',
    profileErrorLoading: 'Error loading profile',
    profileUpdated: 'Profile updated successfully!',
    profileErrorSaving: 'Error saving profile',

    // Security
    securityAlertDescription: 'Choose a strong password with at least 8 characters, including uppercase, lowercase letters and numbers.',
    securityNewPasswordLabel: 'New password',
    securityNewPasswordPlaceholder: 'Enter your new password',
    securityConfirmLabel: 'Confirm new password',
    securityConfirmPlaceholder: 'Confirm your new password',
    securityPasswordStrength: 'Password strength:',
    securityStrengthWeak: 'Weak',
    securityStrengthMedium: 'Medium',
    securityStrengthStrong: 'Strong',
    securityAriaHidePassword: 'Hide password',
    securityAriaShowPassword: 'Show password',
    securityAriaHideConfirm: 'Hide confirmation',
    securityAriaShowConfirm: 'Show confirmation',
    securityPasswordsMatch: 'Passwords match',
    securityPasswordsDoNotMatch: 'Passwords do not match',
    securityUpdating: 'Updating…',
    securityChangePassword: 'Change password',
    securityPasswordChanged: 'Password changed successfully!',
    securityErrorChanging: 'Error changing password',
    securitySchemaMin: 'Password must be at least 8 characters',
    securitySchemaUppercase: 'Password must contain at least one uppercase letter',
    securitySchemaLowercase: 'Password must contain at least one lowercase letter',
    securitySchemaNumber: 'Password must contain at least one number',
    securitySchemaConfirm: 'Confirm your new password',
    securitySchemaMismatch: 'Passwords do not match',

    // Integrations
    integrationsZoteroTitle: 'Zotero',
    integrationsZoteroDescription: 'Import articles from your Zotero library.',

} as const;

