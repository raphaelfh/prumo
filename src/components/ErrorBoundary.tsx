import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { toast } from 'sonner';
import { errorTracker } from '@/services/errorTracking';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
  context?: string; // Contexto onde o erro ocorreu (ex: "PDF Viewer", "Assessment")
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: '',
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorId: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // Capturar erro no errorTracker para observabilidade centralizada
    errorTracker.captureError(error, {
      component: this.props.context || 'ErrorBoundary',
      metadata: {
        componentStack: errorInfo.componentStack,
        errorId: this.state.errorId,
        timestamp: new Date().toISOString(),
      },
    });

    // Log do erro no console para desenvolvimento (mantido para debug)
    if (import.meta.env.DEV) {
      console.error(`[ErrorBoundary${this.props.context ? ` - ${this.props.context}` : ''}]`, {
        error: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        errorId: this.state.errorId,
        timestamp: new Date().toISOString(),
      });
    }

    // Callback personalizado para tratamento adicional
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Toast de erro para feedback imediato
    toast.error(`Erro inesperado${this.props.context ? ` em ${this.props.context}` : ''}`, {
      description: 'Os detalhes foram registrados. Tente recarregar a página.',
      duration: 5000,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: '',
    });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Fallback customizado se fornecido
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <CardTitle className="text-xl">Algo deu errado</CardTitle>
              <CardDescription>
                {this.props.context 
                  ? `Ocorreu um erro inesperado em ${this.props.context}.`
                  : 'Ocorreu um erro inesperado na aplicação.'
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Detalhes do erro (apenas em desenvolvimento) */}
              {this.props.showDetails && this.state.error && (
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-gray-700 hover:text-gray-900">
                    <Bug className="mr-2 inline h-4 w-4" />
                    Detalhes técnicos
                  </summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <strong>Erro:</strong> {this.state.error.message}
                    </div>
                    <div>
                      <strong>ID do Erro:</strong> {this.state.errorId}
                    </div>
                    {this.state.error.stack && (
                      <div>
                        <strong>Stack Trace:</strong>
                        <pre className="mt-1 max-h-32 overflow-auto rounded bg-gray-100 p-2 text-xs">
                          {this.state.error.stack}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}

              {/* Ações */}
              <div className="flex flex-col gap-2">
                <Button onClick={this.handleReset} className="w-full">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Tentar novamente
                </Button>
                <Button onClick={this.handleReload} variant="outline" className="w-full">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Recarregar página
                </Button>
                <Button onClick={this.handleGoHome} variant="ghost" className="w-full">
                  <Home className="mr-2 h-4 w-4" />
                  Voltar ao início
                </Button>
              </div>

              {/* Informações de suporte */}
              <div className="text-center text-xs text-gray-500">
                Se o problema persistir, entre em contato com o suporte.
                <br />
                ID do erro: {this.state.errorId}
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook para usar error boundary em componentes funcionais
export const useErrorHandler = () => {
  const handleError = (error: Error, context?: string) => {
    console.error(`[useErrorHandler${context ? ` - ${context}` : ''}]`, error);
    toast.error(`Erro${context ? ` em ${context}` : ''}: ${error.message}`);
  };

  return { handleError };
};

// HOC para wrappear componentes com ErrorBoundary
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) => {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  
  return WrappedComponent;
};
