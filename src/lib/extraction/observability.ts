/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Sistema de Observabilidade para Extração
 * 
 * Fornece logging estruturado, métricas e tracking para facilitar
 * debug, monitoramento e análise de performance do módulo de extração.
 * 
 * @module lib/extraction/observability
 */

// =================== TIPOS ===================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  operation: string;
  message: string;
  context?: Record<string, any>;
  duration?: number;
  error?: Error;
}

export interface PerformanceMetric {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

// =================== CONFIGURAÇÃO ===================

const CONFIG = {
  // Habilitar logs no console (desabilitar em produção se necessário)
  enableConsole: import.meta.env.DEV,
  
  // Nível mínimo de log
  minLevel: import.meta.env.DEV ? 'debug' : 'info',
  
  // Habilitar métricas de performance
  enableMetrics: true,
  
  // Enviar para analytics (Sentry, etc)
  enableAnalytics: false,
};

// =================== STORAGE ===================

class LogStorage {
  private logs: LogEntry[] = [];
  private maxSize = 100; // Manter últimas 100 entradas

  add(entry: LogEntry) {
    this.logs.push(entry);
    if (this.logs.length > this.maxSize) {
      this.logs.shift();
    }
  }

  getAll(): LogEntry[] {
    return [...this.logs];
  }

  getByOperation(operation: string): LogEntry[] {
    return this.logs.filter(log => log.operation === operation);
  }

  getErrors(): LogEntry[] {
    return this.logs.filter(log => log.level === 'error');
  }

  clear() {
    this.logs = [];
  }
}

class MetricsStorage {
  private metrics: PerformanceMetric[] = [];
  private maxSize = 50;

  add(metric: PerformanceMetric) {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxSize) {
      this.metrics.shift();
    }
  }

  getAll(): PerformanceMetric[] {
    return [...this.metrics];
  }

  getByOperation(operation: string): PerformanceMetric[] {
    return this.metrics.filter(m => m.operation === operation);
  }

  getStats(operation: string): {
    count: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
  } | null {
    const metrics = this.getByOperation(operation).filter(m => m.duration);
    
    if (metrics.length === 0) return null;

    const durations = metrics.map(m => m.duration!);
    
    return {
      count: metrics.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations)
    };
  }

  clear() {
    this.metrics = [];
  }
}

// =================== SINGLETONS ===================

const logStorage = new LogStorage();
const metricsStorage = new MetricsStorage();

// =================== LOGGER ===================

export class ExtractionLogger {
  private context: Record<string, any>;

  constructor(context: Record<string, any> = {}) {
    this.context = context;
  }

  /**
   * Log com nível debug
   */
  debug(operation: string, message: string, context?: Record<string, any>) {
    this.log('debug', operation, message, context);
  }

  /**
   * Log com nível info
   */
  info(operation: string, message: string, context?: Record<string, any>) {
    this.log('info', operation, message, context);
  }

  /**
   * Log com nível warn
   */
  warn(operation: string, message: string, context?: Record<string, any>) {
    this.log('warn', operation, message, context);
  }

  /**
   * Log com nível error
   */
  error(operation: string, message: string, error?: Error, context?: Record<string, any>) {
    this.log('error', operation, message, { ...context, error: error?.message, stack: error?.stack }, error);
  }

  /**
   * Log genérico
   */
  private log(
    level: LogLevel,
    operation: string,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      operation,
      message,
      context: { ...this.context, ...context },
      error
    };

    // Armazenar no storage
    logStorage.add(entry);

    // Log no console se habilitado
    if (CONFIG.enableConsole) {
      this.consoleLog(entry);
    }

    // Enviar para analytics se erro e habilitado
    if (level === 'error' && CONFIG.enableAnalytics && error) {
      this.sendToAnalytics(entry);
    }
  }

  /**
   * Formata e exibe log no console
   */
  private consoleLog(entry: LogEntry) {
    const emoji = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌'
    }[entry.level];

    const prefix = `${emoji} [${entry.operation}]`;
    const logFn = entry.level === 'error' ? console.error : 
                  entry.level === 'warn' ? console.warn : console.log;

    if (entry.error) {
      logFn(prefix, entry.message, entry.context, entry.error);
    } else if (entry.context && Object.keys(entry.context).length > 0) {
      logFn(prefix, entry.message, entry.context);
    } else {
      logFn(prefix, entry.message);
    }
  }

  /**
   * Envia erro para sistema de analytics (Sentry, etc)
   */
  private sendToAnalytics(entry: LogEntry) {
    // TODO: Integrar com Sentry ou similar
    // if (window.Sentry) {
    //   window.Sentry.captureException(entry.error, {
    //     tags: { operation: entry.operation },
    //     extra: entry.context
    //   });
    // }
  }
}

// =================== PERFORMANCE TRACKER ===================

export class PerformanceTracker {
  private activeMetrics = new Map<string, PerformanceMetric>();

  /**
   * Inicia tracking de uma operação
   */
  start(operation: string, metadata?: Record<string, any>): string {
    const id = `${operation}-${Date.now()}-${Math.random()}`;
    
    this.activeMetrics.set(id, {
      operation,
      startTime: performance.now(),
      metadata
    });

    return id;
  }

  /**
   * Finaliza tracking de uma operação
   */
  end(id: string): number | null {
    const metric = this.activeMetrics.get(id);
    
    if (!metric) {
      console.warn('⚠️ [PerformanceTracker] Métrica não encontrada:', id);
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - metric.startTime;

    const completedMetric: PerformanceMetric = {
      ...metric,
      endTime,
      duration
    };

    if (CONFIG.enableMetrics) {
      metricsStorage.add(completedMetric);
    }

    this.activeMetrics.delete(id);

    // Log se operação demorou muito (> 1s)
    if (duration > 1000) {
      console.warn(
        `⏱️ [Performance] ${metric.operation} demorou ${duration.toFixed(0)}ms`,
        metric.metadata
      );
    }

    return duration;
  }

  /**
   * Helper para medir função assíncrona
   */
  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const id = this.start(operation, metadata);
    
    try {
      const result = await fn();
      const duration = this.end(id);
      
      if (CONFIG.enableConsole && duration !== null) {
        console.log(`⏱️ [${operation}] ${duration.toFixed(0)}ms`);
      }
      
      return result;
    } catch (error) {
      this.end(id);
      throw error;
    }
  }

  /**
   * Obter estatísticas de uma operação
   */
  getStats(operation: string) {
    return metricsStorage.getStats(operation);
  }
}

// =================== API PÚBLICA ===================

/**
 * Logger singleton para extração
 */
export const extractionLogger = new ExtractionLogger({ module: 'extraction' });

/**
 * Performance tracker singleton
 */
export const performanceTracker = new PerformanceTracker();

/**
 * Criar logger com contexto específico
 */
export function createLogger(context: Record<string, any>): ExtractionLogger {
  return new ExtractionLogger(context);
}

/**
 * Obter todos os logs (útil para debug)
 */
export function getLogs(): LogEntry[] {
  return logStorage.getAll();
}

/**
 * Obter logs de uma operação específica
 */
export function getLogsByOperation(operation: string): LogEntry[] {
  return logStorage.getByOperation(operation);
}

/**
 * Obter todos os erros
 */
export function getErrors(): LogEntry[] {
  return logStorage.getErrors();
}

/**
 * Obter métricas de performance
 */
export function getMetrics(): PerformanceMetric[] {
  return metricsStorage.getAll();
}

/**
 * Obter estatísticas de performance
 */
export function getPerformanceStats(operation: string) {
  return metricsStorage.getStats(operation);
}

/**
 * Limpar logs e métricas (útil para testes)
 */
export function clearObservability() {
  logStorage.clear();
  metricsStorage.clear();
}

/**
 * Exportar logs como JSON (útil para análise)
 */
export function exportLogs(): string {
  return JSON.stringify({
    logs: logStorage.getAll(),
    metrics: metricsStorage.getAll(),
    exportedAt: new Date().toISOString()
  }, null, 2);
}

// =================== HELPER PARA DEBUGGING ===================

/**
 * Adicionar logs ao window para debug no console
 */
if (import.meta.env.DEV) {
  (window as any).extractionDebug = {
    getLogs,
    getErrors,
    getMetrics,
    getStats: getPerformanceStats,
    export: exportLogs,
    clear: clearObservability
  };
  
  console.log('🔍 Debug utilities available: window.extractionDebug');
}

