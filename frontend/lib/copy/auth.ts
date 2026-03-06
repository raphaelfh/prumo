/**
 * UI copy for auth flows (login, register, forgot password, reset password). English only.
 */
export const auth = {
    // Error mapping (server message key → user-facing message key)
    errorInvalidCredentials: 'Invalid email or password',
    errorEmailNotConfirmed: 'Please confirm your email before signing in',
    errorAlreadyRegistered: 'This email is already registered',
    errorPasswordMinLength: 'Password must be at least 6 characters',
    errorRateLimited: 'Too many attempts. Please wait a few minutes',
    errorLogin: 'Error signing in',
    errorCreateAccount: 'Error creating account',
    errorSendEmail: 'Error sending email',
    errorResetPassword: 'Error resetting password',

    // Password validation
    passwordMinLength: 'Password must be at least 8 characters',
    passwordUppercase: 'Password must contain at least one uppercase letter',
    passwordLowercase: 'Password must contain at least one lowercase letter',
    passwordNumber: 'Password must contain at least one number',

    // Strength labels
    strengthWeak: 'Weak',
    strengthMedium: 'Medium',
    strengthStrong: 'Strong',
    passwordStrengthLabel: 'Password strength:',

    // Match indicator
    passwordsMatch: 'Passwords match',
    passwordsDoNotMatch: 'Passwords do not match',

    // Left panel (Auth page)
    tagline: 'Systematic reviews with precision and efficiency',
    taglineDesc: 'Manage your research reviews from start to finish, with collaborative tools and full traceability.',
    featureArticlesTitle: 'Article management',
    featureArticlesDesc: 'Import, organize, and track all articles in your protocol',
    featureQualityTitle: 'Quality assessment',
    featureQualityDesc: 'Apply standard instruments such as PROBAST and CHARMS',
    featureExtractionTitle: 'Data extraction',
    featureExtractionDesc: 'Extract and harmonize data with full traceability',
    rightsReserved: 'All rights reserved',

    // Login form
    loginSuccess: 'Signed in successfully!',
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    signingIn: 'Signing in…',
    signIn: 'Sign in',
    noAccount: "Don't have an account?",
    createAccount: 'Create account',

    // Register form
    checkEmailTitle: 'Check your email',
    checkEmailDesc: 'We sent a confirmation link to',
    checkEmailAction: 'Click the link to activate your account.',
    backToLogin: 'Back to sign in',
    fullName: 'Full name',
    fullNamePlaceholder: 'Your name',
    passwordPlaceholder: 'At least 8 characters',
    confirmPassword: 'Confirm password',
    confirmPasswordPlaceholder: 'Repeat password',
    creatingAccount: 'Creating account…',
    createAccountButton: 'Create account',
    alreadyHaveAccount: 'Already have an account?',

    // Forgot password form
    emailSentTitle: 'Email sent!',
    emailSentDesc: 'Check your inbox at',
    emailSentAction: 'and click the link to reset your password.',
    enterEmailDesc: 'Enter your email and we will send you a link to reset your password.',
    sending: 'Sending…',
    sendRecoveryLink: 'Send recovery link',
    backToLoginArrow: '← Back to sign in',

    // View headings (Auth tabs)
    welcomeBack: 'Welcome back',
    welcomeBackSubtitle: 'Sign in to your account to continue',
    createAccountTitle: 'Create account',
    createAccountSubtitle: 'Sign up to start using Review Hub',
    resetPasswordTitle: 'Reset password',
    resetPasswordSubtitle: 'Enter your email to recover access',

    // Reset password page
    checkingLink: 'Checking link…',
    invalidLinkTitle: 'Invalid or expired link',
    invalidLinkDesc: 'This recovery link is invalid or has already been used. Please request a new link.',
    newPasswordTitle: 'Create new password',
    newPasswordDesc: 'Choose a strong password to protect your account.',
    newPasswordLabel: 'New password',
    resetting: 'Resetting…',
    resetPasswordButton: 'Reset password',
    passwordResetSuccessTitle: 'Password reset!',
    passwordResetSuccessDesc: 'Your password has been changed successfully. Redirecting…',
} as const;

export type AuthCopy = typeof auth;
