/**
 * Logger Centralizado
 * 
 * Logs apenas em desenvolvimento, silencioso em produção.
 * Facilita debug sem poluir produção ou vazar dados sensíveis.
 * 
 * @module lib/logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDev = import.meta.env.DEV;

class Logger {
  private log(level: LogLevel, message: string, data?: unknown) {
    if (!isDev && level === 'debug') return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch (level) {
      case 'debug':
        console.log(`${prefix} ${message}`, data !== undefined ? data : '');
        break;
      case 'info':
        console.info(`${prefix} ${message}`, data !== undefined ? data : '');
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`, data !== undefined ? data : '');
        break;
      case 'error':
        console.error(`${prefix} ${message}`, data !== undefined ? data : '');
        // TODO: Enviar para serviço de error tracking em produção
        break;
    }
  }

  debug(message: string, data?: unknown) {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown) {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.log('warn', message, data);
  }

  error(message: string, error?: unknown) {
    this.log('error', message, error);
  }
}

export const logger = new Logger();

// Helper para logs de performance
export const perfLog = {
  start(label: string) {
    if (isDev) {
      console.time(label);
    }
  },
  end(label: string) {
    if (isDev) {
      console.timeEnd(label);
    }
  }
};

