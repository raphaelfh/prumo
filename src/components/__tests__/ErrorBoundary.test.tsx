import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// Componente que força um erro para teste
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Limpar console.error para evitar spam nos testes
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('deve renderizar children quando não há erro', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('deve renderizar fallback quando há erro', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
    expect(screen.getByText('Ocorreu um erro inesperado na aplicação.')).toBeInTheDocument();
  });

  it('deve mostrar contexto personalizado quando fornecido', () => {
    render(
      <ErrorBoundary context="Teste de Contexto">
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
    expect(screen.getByText('Ocorreu um erro inesperado em Teste de Contexto.')).toBeInTheDocument();
  });

  it('deve permitir reset do erro', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();

    // Simular tentativa de reset (não funcionará devido à natureza do erro)
    const resetButton = screen.getByText('Tentar novamente');
    fireEvent.click(resetButton);

    // O erro ainda deve estar presente pois o componente filho continua lançando erro
    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
  });

  it('deve mostrar detalhes técnicos quando showDetails é true', () => {
    render(
      <ErrorBoundary showDetails={true}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    const detailsButton = screen.getByText('Detalhes técnicos');
    expect(detailsButton).toBeInTheDocument();

    fireEvent.click(detailsButton);

    expect(screen.getByText('Test error')).toBeInTheDocument();
    expect(screen.getByText('Stack Trace:')).toBeInTheDocument();
  });

  it('deve usar fallback customizado quando fornecido', () => {
    const customFallback = <div>Custom fallback</div>;

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    expect(screen.queryByText('Algo deu errado')).not.toBeInTheDocument();
  });

  it('deve chamar onError callback quando fornecido', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Test error',
      }),
      expect.objectContaining({
        componentStack: expect.any(String),
      })
    );
  });

  it('deve mostrar ID do erro', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // Verificar se há um ID de erro na interface
    const errorIdElement = screen.getByText(/ID do erro:/);
    expect(errorIdElement).toBeInTheDocument();
  });
});
