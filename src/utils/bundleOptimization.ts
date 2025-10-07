import React from 'react';

/**
 * Utilitários para otimização de bundle size
 * Implementa tree shaking, lazy loading e análise de dependências
 */

import { lazy, ComponentType } from 'react';

/**
 * Análise de bundle size
 */
export const bundleAnalyzer = {
  /**
   * Estimar tamanho de um módulo
   */
  estimateModuleSize: (module: any): number => {
    try {
      const serialized = JSON.stringify(module);
      return new Blob([serialized]).size;
    } catch {
      return 0;
    }
  },

  /**
   * Analisar dependências de um componente
   */
  analyzeDependencies: (component: ComponentType<any>): string[] => {
    const componentString = component.toString();
    const imports = componentString.match(/import.*from\s+['"]([^'"]+)['"]/g) || [];
    return imports.map(imp => imp.match(/['"]([^'"]+)['"]/)?.[1]).filter(Boolean) as string[];
  },

  /**
   * Verificar se um import é usado
   */
  isImportUsed: (code: string, importName: string): boolean => {
    const regex = new RegExp(`\\b${importName}\\b`, 'g');
    return regex.test(code);
  },
};

/**
 * Tree shaking utilities
 */
export const treeShaking = {
  /**
   * Import específico de ícones (evita importar biblioteca inteira)
   */
  importIcon: async (iconName: string) => {
    try {
      const { [iconName]: Icon } = await import('lucide-react');
      return Icon;
    } catch {
      console.warn(`Icon ${iconName} not found`);
      return null;
    }
  },

  /**
   * Import específico de componentes UI
   * NOTA: Vite requer extensão de arquivo em imports dinâmicos
   */
  importUIComponent: async (componentPath: string) => {
    try {
      // Adicionar .tsx se não tiver extensão
      const path = componentPath.endsWith('.tsx') ? componentPath : `${componentPath}.tsx`;
      
      // Import direto sem template string no caminho estático
      // Para funcionar com Vite, use um switch/case ou mapa estático
      console.warn(`Dynamic UI import requires static paths. Component: ${path}`);
      return null;
    } catch {
      console.warn(`UI component ${componentPath} not found`);
      return null;
    }
  },

  /**
   * Import condicional baseado em feature flags
   */
  conditionalImport: <T>(
    condition: boolean,
    importFn: () => Promise<T>,
    fallback?: T
  ): Promise<T | undefined> => {
    if (condition) {
      return importFn();
    }
    return Promise.resolve(fallback);
  },
};

/**
 * Lazy loading otimizado
 */
export const optimizedLazy = {
  /**
   * Lazy loading com preload
   */
  withPreload: <P extends object>(
    importFn: () => Promise<{ default: ComponentType<P> }>,
    preloadTrigger?: () => boolean
  ) => {
    const LazyComponent = lazy(importFn);

    // Preload quando trigger for verdadeiro
    if (preloadTrigger) {
      const preload = () => {
        if (preloadTrigger()) {
          importFn();
        }
      };

      // Preload após delay
      setTimeout(preload, 1000);
    }

    return LazyComponent;
  },

  /**
   * Lazy loading com retry
   */
  withRetry: <P extends object>(
    importFn: () => Promise<{ default: ComponentType<P> }>,
    maxRetries: number = 3
  ) => {
    return lazy(async () => {
      let lastError: Error;
      
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await importFn();
        } catch (error) {
          lastError = error as Error;
          console.warn(`Lazy loading attempt ${i + 1} failed:`, error);
          
          if (i < maxRetries - 1) {
            // Delay antes da próxima tentativa
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          }
        }
      }
      
      throw lastError!;
    });
  },

  /**
   * Lazy loading com fallback
   */
  withFallback: <P extends object>(
    importFn: () => Promise<{ default: ComponentType<P> }>,
    fallbackComponent: ComponentType<P>
  ) => {
    return lazy(async () => {
      try {
        return await importFn();
      } catch {
        return { default: fallbackComponent };
      }
    });
  },
};

/**
 * Code splitting por rotas
 */
export const routeCodeSplitting = {
  /**
   * Split por página
   */
  createPageSplit: <P extends object>(
    pageName: string,
    importFn: () => Promise<{ default: ComponentType<P> }>
  ) => {
    console.log(`📦 Loading page: ${pageName}`);
    return lazy(importFn);
  },

  /**
   * Split por feature
   */
  createFeatureSplit: <P extends object>(
    featureName: string,
    importFn: () => Promise<{ default: ComponentType<P> }>
  ) => {
    console.log(`🎯 Loading feature: ${featureName}`);
    return lazy(importFn);
  },

  /**
   * Split por componente pesado
   */
  createHeavyComponentSplit: <P extends object>(
    componentName: string,
    importFn: () => Promise<{ default: ComponentType<P> }>
  ) => {
    console.log(`⚡ Loading heavy component: ${componentName}`);
    return lazy(importFn);
  },
};

/**
 * Otimização de imports
 */
export const importOptimization = {
  /**
   * Import dinâmico com cache
   */
  cachedImport: <T>(() => {
    const cache = new Map<string, Promise<T>>();
    
    return (importFn: () => Promise<T>, cacheKey: string): Promise<T> => {
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey)!;
      }
      
      const promise = importFn();
      cache.set(cacheKey, promise);
      
      return promise;
    };
  })(),

  /**
   * Import com timeout
   */
  importWithTimeout: <T>(
    importFn: () => Promise<T>,
    timeoutMs: number = 10000
  ): Promise<T> => {
    return Promise.race([
      importFn(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Import timeout')), timeoutMs)
      )
    ]);
  },

  /**
   * Import com retry automático
   */
  importWithRetry: <T>(
    importFn: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      const attempt = () => {
        importFn()
          .then(resolve)
          .catch(error => {
            attempts++;
            if (attempts < maxRetries) {
              console.warn(`Import attempt ${attempts} failed, retrying...`, error);
              setTimeout(attempt, 1000 * attempts);
            } else {
              reject(error);
            }
          });
      };
      
      attempt();
    });
  },
};

/**
 * Análise de bundle
 */
export const bundleAnalysis = {
  /**
   * Analisar tamanho de dependências
   */
  analyzeDependencies: async (): Promise<void> => {
    if (import.meta.env.DEV) {
      console.group('📊 Bundle Analysis');
      
      try {
        // Analisar imports dinâmicos
        const dynamicImports = document.querySelectorAll('script[type="module"]');
        console.log(`Dynamic imports found: ${dynamicImports.length}`);
        
        // Analisar tamanho de localStorage
        const localStorageSize = new Blob(Object.values(localStorage)).size;
        console.log(`localStorage size: ${(localStorageSize / 1024).toFixed(2)}KB`);
        
        // Analisar performance de carregamento
        const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        if (navigationTiming) {
          console.log(`DOM Content Loaded: ${navigationTiming.domContentLoadedEventEnd - navigationTiming.domContentLoadedEventStart}ms`);
          console.log(`Load Complete: ${navigationTiming.loadEventEnd - navigationTiming.loadEventStart}ms`);
        }
        
      } catch (error) {
        console.error('Bundle analysis failed:', error);
      }
      
      console.groupEnd();
    }
  },

  /**
   * Monitorar carregamento de chunks
   */
  monitorChunkLoading: (): void => {
    if (import.meta.env.DEV) {
      const originalImport = window.import;
      
      window.import = async (specifier: string) => {
        const startTime = performance.now();
        console.log(`📦 Loading chunk: ${specifier}`);
        
        try {
          const result = await originalImport(specifier);
          const loadTime = performance.now() - startTime;
          console.log(`✅ Chunk loaded in ${loadTime.toFixed(2)}ms: ${specifier}`);
          return result;
        } catch (error) {
          const loadTime = performance.now() - startTime;
          console.error(`❌ Chunk failed after ${loadTime.toFixed(2)}ms: ${specifier}`, error);
          throw error;
        }
      };
    }
  },
};

/**
 * Otimizações específicas para diferentes ambientes
 */
export const environmentOptimizations = {
  /**
   * Otimizações para desenvolvimento
   */
  development: () => {
    if (import.meta.env.DEV) {
      // Habilitar análise de bundle
      bundleAnalysis.analyzeDependencies();
      bundleAnalysis.monitorChunkLoading();
      
      // Log de imports dinâmicos
      console.log('🚀 Development optimizations enabled');
    }
  },

  /**
   * Otimizações para produção
   */
  production: () => {
    if (import.meta.env.PROD) {
      // Preload de componentes críticos
      const preloadCriticalComponents = async () => {
        try {
          // Preload componentes mais usados
          await Promise.all([
            import('@/pages/Dashboard'),
            import('@/pages/ProjectView'),
            import('@/components/PDFViewer/index'),
          ]);
          console.log('✅ Critical components preloaded');
        } catch (error) {
          console.warn('⚠️ Failed to preload some components:', error);
        }
      };

      // Preload após carregamento inicial
      setTimeout(preloadCriticalComponents, 2000);
      
      console.log('🚀 Production optimizations enabled');
    }
  },
};

/**
 * Hook para otimizações de bundle
 */
export const useBundleOptimization = () => {
  React.useEffect(() => {
    environmentOptimizations.development();
    environmentOptimizations.production();
  }, []);

  return {
    bundleAnalyzer,
    treeShaking,
    optimizedLazy,
    routeCodeSplitting,
    importOptimization,
    bundleAnalysis,
  };
};
