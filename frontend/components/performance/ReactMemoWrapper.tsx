import {ComponentType, memo} from 'react';

/**
 * HOC to add memoization to list components
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
 * HOC for custom memoization based on a key
 */
export function withCustomMemo<P extends object>(
  Component: ComponentType<P>,
  getComparisonKey: (props: P) => string
) {
  return memo(Component, (prevProps, nextProps) => {
    return getComparisonKey(prevProps) === getComparisonKey(nextProps);
  });
}

