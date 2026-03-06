import {LARGE_PDF_THRESHOLD, PDF_OPTIONS, PERFORMANCE_CONFIG} from '@/lib/pdf-config';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL} from '@/config/supabase-env';

/**
 * Centralized application configuration
 * Single place for all settings for easier maintenance
 */

export const APP_CONFIG = {
    // Application settings
  app: {
    name: 'Review Hub',
    version: '1.0.0',
    environment: import.meta.env.MODE,
    isDevelopment: import.meta.env.DEV,
    isProduction: import.meta.env.PROD,
  },

    // PDF settings
  pdf: {
    options: PDF_OPTIONS,
    performance: PERFORMANCE_CONFIG,
    largeThreshold: LARGE_PDF_THRESHOLD,
  },

    // AI settings
  ai: {
    maxConcurrency: 3,
      timeout: 30000, // 30 seconds
    retryAttempts: 3,
      retryDelay: 1000, // 1 second
    models: {
      default: 'gpt-5-mini',
      fallback: 'gpt-4o-mini',
    },
    rateLimits: {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
    },
  },

    // Security settings
  security: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedFileTypes: ['application/pdf'],
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
    maxLoginAttempts: 5,
      lockoutDuration: 15 * 60 * 1000, // 15 minutes
  },

    // Performance settings
  performance: {
    debounceDelay: 300, // ms
    throttleDelay: 100, // ms
      cacheTimeout: 5 * 60 * 1000, // 5 minutes
      maxCacheSize: 100, // items
    lazyLoadingThreshold: 200, // px
  },

    // UI/UX settings
  ui: {
    animationDuration: 200, // ms
    toastDuration: 5000, // ms
    modalBackdropBlur: true,
    theme: {
      default: 'light',
      supported: ['light', 'dark', 'system'],
    },
  },

    // API settings
  api: {
      timeout: 10000, // 10 seconds
    retryAttempts: 3,
      retryDelay: 1000, // 1 second
    endpoints: {
      supabase: SUPABASE_URL,
    },
  },

    // Observability settings
  observability: {
    enableErrorTracking: !import.meta.env.DEV,
    enablePerformanceTracking: !import.meta.env.DEV,
    enableUserTracking: false, // GDPR compliance
    logLevel: import.meta.env.DEV ? 'debug' : 'error',
    batchSize: 10,
      flushInterval: 5000, // 5 seconds
  },

    // Testing settings
  testing: {
    mockDelay: 1000, // ms
    timeout: 10000, // ms
    retries: 3,
  },
} as const;

// Types derived from config
export type AppConfig = typeof APP_CONFIG;
export type AIConfig = typeof APP_CONFIG.ai;
export type SecurityConfig = typeof APP_CONFIG.security;
export type PerformanceConfig = typeof APP_CONFIG.performance;
export type UIConfig = typeof APP_CONFIG.ui;

// Validate required settings
export const validateConfig = (): void => {
  const missing: string[] = [];

  if (!SUPABASE_URL) {
    missing.push(
      'VITE_SUPABASE_URL (or SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL)'
    );
  }

  if (!SUPABASE_PUBLISHABLE_KEY) {
    missing.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY)'
    );
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

// Helper to get config with fallback
export const getConfig = <K extends keyof AppConfig>(
  key: K
): AppConfig[K] => {
  return APP_CONFIG[key];
};

// Helper to check if a feature is enabled
export const isFeatureEnabled = (feature: string): boolean => {
  const featureFlags = import.meta.env.VITE_FEATURE_FLAGS?.split(',') || [];
  return featureFlags.includes(feature);
};

// Helper to get development config
export const getDevConfig = () => ({
  enableReactQueryDevtools: import.meta.env.DEV,
  enableErrorBoundaryDetails: import.meta.env.DEV,
  enablePerformanceLogging: import.meta.env.DEV,
  enableMockData: import.meta.env.VITE_ENABLE_MOCK_DATA === 'true',
});

// Run validation on load
if (typeof window !== 'undefined') {
  validateConfig();
}
