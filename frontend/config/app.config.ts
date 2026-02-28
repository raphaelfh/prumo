import {LARGE_PDF_THRESHOLD, PDF_OPTIONS, PERFORMANCE_CONFIG} from '@/lib/pdf-config';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL} from '@/config/supabase-env';

/**
 * Configurações centralizadas da aplicação
 * Centraliza todas as configurações em um local para fácil manutenção
 */

export const APP_CONFIG = {
  // Configurações da aplicação
  app: {
    name: 'Review Hub',
    version: '1.0.0',
    environment: import.meta.env.MODE,
    isDevelopment: import.meta.env.DEV,
    isProduction: import.meta.env.PROD,
  },

  // Configurações de PDF
  pdf: {
    options: PDF_OPTIONS,
    performance: PERFORMANCE_CONFIG,
    largeThreshold: LARGE_PDF_THRESHOLD,
  },

  // Configurações de IA
  ai: {
    maxConcurrency: 3,
    timeout: 30000, // 30 segundos
    retryAttempts: 3,
    retryDelay: 1000, // 1 segundo
    models: {
      default: 'gpt-5-mini',
      fallback: 'gpt-4o-mini',
    },
    rateLimits: {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
    },
  },

  // Configurações de segurança
  security: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedFileTypes: ['application/pdf'],
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 horas
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutos
  },

  // Configurações de performance
  performance: {
    debounceDelay: 300, // ms
    throttleDelay: 100, // ms
    cacheTimeout: 5 * 60 * 1000, // 5 minutos
    maxCacheSize: 100, // itens
    lazyLoadingThreshold: 200, // px
  },

  // Configurações de UI/UX
  ui: {
    animationDuration: 200, // ms
    toastDuration: 5000, // ms
    modalBackdropBlur: true,
    theme: {
      default: 'light',
      supported: ['light', 'dark', 'system'],
    },
  },

  // Configurações de API
  api: {
    timeout: 10000, // 10 segundos
    retryAttempts: 3,
    retryDelay: 1000, // 1 segundo
    endpoints: {
      supabase: SUPABASE_URL,
    },
  },

  // Configurações de observabilidade
  observability: {
    enableErrorTracking: !import.meta.env.DEV,
    enablePerformanceTracking: !import.meta.env.DEV,
    enableUserTracking: false, // GDPR compliance
    logLevel: import.meta.env.DEV ? 'debug' : 'error',
    batchSize: 10,
    flushInterval: 5000, // 5 segundos
  },

  // Configurações de teste
  testing: {
    mockDelay: 1000, // ms
    timeout: 10000, // ms
    retries: 3,
  },
} as const;

// Tipos derivados das configurações
export type AppConfig = typeof APP_CONFIG;
export type AIConfig = typeof APP_CONFIG.ai;
export type SecurityConfig = typeof APP_CONFIG.security;
export type PerformanceConfig = typeof APP_CONFIG.performance;
export type UIConfig = typeof APP_CONFIG.ui;

// Validação das configurações obrigatórias
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

// Helper para obter configurações com fallback
export const getConfig = <K extends keyof AppConfig>(
  key: K
): AppConfig[K] => {
  return APP_CONFIG[key];
};

// Helper para verificar se uma feature está habilitada
export const isFeatureEnabled = (feature: string): boolean => {
  const featureFlags = import.meta.env.VITE_FEATURE_FLAGS?.split(',') || [];
  return featureFlags.includes(feature);
};

// Helper para obter configuração de desenvolvimento
export const getDevConfig = () => ({
  enableReactQueryDevtools: import.meta.env.DEV,
  enableErrorBoundaryDetails: import.meta.env.DEV,
  enablePerformanceLogging: import.meta.env.DEV,
  enableMockData: import.meta.env.VITE_ENABLE_MOCK_DATA === 'true',
});

// Inicializar validação
if (typeof window !== 'undefined') {
  validateConfig();
}
