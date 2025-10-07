import { memo, ComponentType } from 'react';

/**
 * HOC para adicionar memoização a componentes de lista
 */
export function withListMemo<P extends object>(
  Component: ComponentType<P>,
  propsAreEqual?: (prevProps: Readonly<P>, nextProps: Readonly<P>) => boolean
) {
  const MemoizedComponent = memo(Component, propsAreEqual);
  MemoizedComponent.displayName = `withListMemo(${Component.displayName || Component.name})`;
  return MemoizedComponent;
}

/**
 * HOC para memoização personalizada baseada em uma chave
 */
export function withCustomMemo<P extends object>(
  Component: ComponentType<P>,
  getComparisonKey: (props: P) => string
) {
  return memo(Component, (prevProps, nextProps) => {
    return getComparisonKey(prevProps) === getComparisonKey(nextProps);
  });
}

