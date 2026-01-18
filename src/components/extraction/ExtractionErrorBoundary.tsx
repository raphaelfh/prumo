/**
 * Error Boundary Específica para Extração
 * 
 * Captura erros no módulo de extração e exibe UI de fallback
 * amigável, permitindo recuperação sem perder todo o contexto.
 * 
 * @component
 */

import React, { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { extractionLogger, exportLogs } from '@/lib/extraction/observability';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ExtractionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log erro no sistema de observabilidade
    extractionLogger.error(
      'ExtractionErrorBoundary',
      'Erro não tratado na interface de extração',
      error,
      {
        componentStack: errorInfo.componentStack,
      }
    );

    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleExportLogs = () => {
    const logs = exportLogs();
    const blob = new Blob([logs], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extraction-error-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Se fallback customizado fornecido, usar ele
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // UI de erro padrão
      return (
        <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
          <Card className="max-w-2xl w-full">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <CardTitle className="text-2xl">Erro na Extração</CardTitle>
              </div>
              <CardDescription>
                Ocorreu um erro inesperado. Você pode tentar recuperar ou voltar à página inicial.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mensagem de erro */}
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="font-semibold text-sm text-destructive mb-2">
                  Detalhes do Erro:
                </p>
                <p className="text-sm font-mono text-slate-700">
                  {this.state.error?.message || 'Erro desconhecido'}
                </p>
              </div>

              {/* Stack trace (apenas em dev) */}
              {import.meta.env.DEV && this.state.errorInfo && (
                <details className="bg-slate-100 rounded-lg p-4">
                  <summary className="cursor-pointer font-semibold text-sm text-slate-700 mb-2">
                    Stack Trace (Dev Only)
                  </summary>
                  <pre className="text-xs overflow-auto max-h-60 text-slate-600">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}

              {/* Ações */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={this.handleReset} className="flex-1">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Tentar Novamente
                </Button>
                <Button onClick={this.handleGoHome} variant="outline" className="flex-1">
                  <Home className="mr-2 h-4 w-4" />
                  Voltar ao Início
                </Button>
                <Button onClick={this.handleExportLogs} variant="ghost" className="flex-1">
                  Exportar Logs
                </Button>
              </div>

              {/* Sugestões */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="font-semibold text-sm text-blue-900 mb-2">
                  💡 Sugestões:
                </p>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                  <li>Recarregue a página (F5)</li>
                  <li>Limpe o cache do navegador</li>
                  <li>Verifique sua conexão com internet</li>
                  <li>Se o erro persistir, exporte os logs e contate o suporte</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * HOC para envolver componente com error boundary
 */
export function withExtractionErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ExtractionErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ExtractionErrorBoundary>
    );
  };
}

