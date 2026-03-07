/**
 * Error tracking and observability service
 * Centralizes error handling and application metrics
 */

export interface ErrorContext {
  userId?: string;
  projectId?: string;
  articleId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, any>;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count';
  context?: ErrorContext;
}

export interface ErrorReport {
  id: string;
  message: string;
  stack?: string;
  context: ErrorContext;
  timestamp: string;
  userAgent: string;
  url: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

class ErrorTrackingService {
  private errors: ErrorReport[] = [];
  private metrics: PerformanceMetric[] = [];
  private isDevelopment = import.meta.env.DEV;

  /**
   * Captura e reporta um erro
   */
  captureError(error: Error, context: ErrorContext = {}): string {
    const errorId = this.generateErrorId();
    
    const errorReport: ErrorReport = {
      id: errorId,
      message: error.message,
      stack: error.stack,
      context: {
        ...context,
        component: context.component || 'Unknown',
      },
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      severity: this.determineSeverity(error, context),
    };

      // Add to local list
    this.errors.push(errorReport);

      // Log to console in development
    if (this.isDevelopment) {
      console.group(`🚨 Error Captured: ${errorId}`);
      console.error('Error:', error);
        console.warn('Context:', context);
        console.warn('Report:', errorReport);
      console.groupEnd();
    }

      // In production, send to monitoring service
    if (!this.isDevelopment) {
      this.sendToMonitoring(errorReport);
    }

    return errorId;
  }

  /**
   * Captures performance metrics
   */
  captureMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    if (this.isDevelopment) {
        console.warn(`📊 Metric: ${metric.name} = ${metric.value}${metric.unit}`);
    }

      // In production, send to metrics service
    if (!this.isDevelopment) {
      this.sendMetric(metric);
    }
  }

  /**
   * Starts performance measurement
   */
  startPerformanceMeasurement(name: string, context?: ErrorContext): () => void {
    const startTime = performance.now();
    
    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      this.captureMetric({
        name,
        value: duration,
        unit: 'ms',
        context,
      });
    };
  }

  /**
   * Captures memory usage
   */
  captureMemoryUsage(context?: ErrorContext): void {
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      
      this.captureMetric({
        name: 'memory.used',
        value: Math.round(memory.usedJSHeapSize / 1024 / 1024),
        unit: 'bytes',
        context,
      });
      
      this.captureMetric({
        name: 'memory.total',
        value: Math.round(memory.totalJSHeapSize / 1024 / 1024),
        unit: 'bytes',
        context,
      });
    }
  }

  /**
   * Captures AI metrics
   */
  captureAIUsage(model: string, tokens: number, duration: number, context?: ErrorContext): void {
    this.captureMetric({
      name: `ai.${model}.tokens`,
      value: tokens,
      unit: 'count',
      context: { ...context, metadata: { ...context?.metadata, model } },
    });

    this.captureMetric({
      name: `ai.${model}.duration`,
      value: duration,
      unit: 'ms',
      context: { ...context, metadata: { ...context?.metadata, model } },
    });
  }

  /**
   * Captures PDF metrics
   */
  capturePDFMetrics(pages: number, loadTime: number, fileSize: number, context?: ErrorContext): void {
    this.captureMetric({
      name: 'pdf.pages',
      value: pages,
      unit: 'count',
      context,
    });

    this.captureMetric({
      name: 'pdf.load_time',
      value: loadTime,
      unit: 'ms',
      context,
    });

    this.captureMetric({
      name: 'pdf.file_size',
      value: Math.round(fileSize / 1024 / 1024),
      unit: 'bytes',
      context,
    });
  }

  /**
   * Gets error report
   */
  getErrorReport(): { errors: ErrorReport[]; metrics: PerformanceMetric[] } {
    return {
      errors: [...this.errors],
      metrics: [...this.metrics],
    };
  }

  /**
   * Clears local data
   */
  clear(): void {
    this.errors = [];
    this.metrics = [];
  }

  private generateErrorId(): string {
    return `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private determineSeverity(error: Error, context: ErrorContext): ErrorReport['severity'] {
      // Logic to determine severity from error and context
    if (error.message.includes('Network') || error.message.includes('fetch')) {
      return 'medium';
    }
    
    if (error.message.includes('Authentication') || error.message.includes('Unauthorized')) {
      return 'high';
    }
    
    if (context.component?.includes('PDF') || context.component?.includes('Assessment')) {
      return 'high';
    }
    
    return 'medium';
  }

  private async sendToMonitoring(errorReport: ErrorReport): Promise<void> {
    try {
        // Here you would integrate with Sentry, LogRocket, etc.
        // For now, just simulate send
        console.warn('Sending error to monitoring service:', errorReport);

        // Example integration with your own API
      // await fetch('/api/errors', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(errorReport),
      // });
    } catch (err) {
      console.error('Failed to send error to monitoring:', err);
    }
  }

  private async sendMetric(metric: PerformanceMetric): Promise<void> {
    try {
        // Here you would integrate with DataDog, New Relic, etc.
        console.warn('Sending metric to monitoring service:', metric);

        // Example integration with your own API
      // await fetch('/api/metrics', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(metric),
      // });
    } catch (err) {
      console.error('Failed to send metric to monitoring:', err);
    }
  }
}

// Singleton instance
export const errorTracker = new ErrorTrackingService();

// Hook for use in React
export const useErrorTracking = () => {
  const captureError = (error: Error, context: ErrorContext = {}) => {
    return errorTracker.captureError(error, context);
  };

  const captureMetric = (metric: PerformanceMetric) => {
    errorTracker.captureMetric(metric);
  };

  const startMeasurement = (name: string, context?: ErrorContext) => {
    return errorTracker.startPerformanceMeasurement(name, context);
  };

  return {
    captureError,
    captureMetric,
    startMeasurement,
    captureMemoryUsage: () => errorTracker.captureMemoryUsage(),
    captureAIUsage: (model: string, tokens: number, duration: number, context?: ErrorContext) => {
      errorTracker.captureAIUsage(model, tokens, duration, context);
    },
    capturePDFMetrics: (pages: number, loadTime: number, fileSize: number, context?: ErrorContext) => {
      errorTracker.capturePDFMetrics(pages, loadTime, fileSize, context);
    },
  };
};
