/**
 * Logger Centralizado para Edge Functions
 * 
 * Logging estruturado com suporte a contexto, métricas e rastreabilidade.
 * 
 * CARACTERÍSTICAS:
 * - Logs estruturados em JSON para fácil parsing
 * - Contexto hierárquico (logger.child() para sub-contextos)
 * - Suporte a métricas (performance tracking)
 * - Rastreabilidade via traceId
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: any;
}

export class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = { ...context };
  }

  /**
   * Cria um logger filho com contexto adicional
   * Útil para adicionar contexto específico (ex: runId, userId) sem poluir o logger pai
   */
  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  /**
   * Log de debug (apenas em desenvolvimento ou quando explicitamente habilitado)
   */
  debug(message: string, data?: LogContext): void {
    this.log("debug", message, data);
  }

  /**
   * Log informativo
   */
  info(message: string, data?: LogContext): void {
    this.log("info", message, data);
  }

  /**
   * Log de warning
   */
  warn(message: string, data?: LogContext): void {
    this.log("warn", message, data);
  }

  /**
   * Log de erro
   */
  error(message: string, error?: Error | unknown, data?: LogContext): void {
    const errorData: LogContext = {
      ...data,
      error: error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : error,
    };

    this.log("error", message, errorData);
  }

  /**
   * Log de métrica (performance tracking)
   */
  metric(name: string, value: number, unit: string = "ms", data?: LogContext): void {
    this.info(`[METRIC] ${name}`, {
      ...data,
      metric: {
        name,
        value,
        unit,
      },
    });
  }

  /**
   * Método interno de logging
   */
  private log(level: LogLevel, message: string, data?: LogContext): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...this.context,
      ...data,
    };

    // Usar console apropriado baseado no nível
    switch (level) {
      case "debug":
        console.debug(JSON.stringify(logEntry));
        break;
      case "info":
        console.info(JSON.stringify(logEntry));
        break;
      case "warn":
        console.warn(JSON.stringify(logEntry));
        break;
      case "error":
        console.error(JSON.stringify(logEntry));
        break;
    }
  }
}

