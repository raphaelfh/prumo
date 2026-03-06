/**
 * UI copy for patterns (PageHeader, ErrorState, etc.). English only.
 */
export const patterns = {
    errorDefaultTitle: 'Something went wrong',
    errorTryAgain: 'Try again',
} as const;

export type PatternsCopy = typeof patterns;
