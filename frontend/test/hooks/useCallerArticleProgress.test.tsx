/** R37: ONE place derives the progress user id from auth. `useAuth` and the progress
 * read are mocked at the module boundary; the gate under test is real. */
import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {useAuthMock, valuesMock, refetch} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  valuesMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({useAuth: () => useAuthMock()}));
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: (...args: unknown[]) => valuesMock(...args),
}));

import {resolveProgressGate, useCallerArticleProgress} from '@/hooks/extraction/useCallerArticleProgress';

const DISABLED = {
  valuesByArticle: new Map(),
  isLoading: false,
  isError: false,
  isUnavailable: true,
  refetch,
};

beforeEach(() => {
  vi.clearAllMocks();
  valuesMock.mockReturnValue(DISABLED);
});

describe('useCallerArticleProgress', () => {
  it('reports auth resolving and passes no user id while the user lookup resolves', () => {
    useAuthMock.mockReturnValue({user: null, loading: true});
    const {result} = renderHook(() => useCallerArticleProgress('p1', 't1'));

    expect(valuesMock).toHaveBeenLastCalledWith('p1', 't1', undefined, 'extraction');
    expect(result.current).toHaveProperty('userId');
    expect(result.current.userId).toBeUndefined();
    expect(result.current.isAuthResolving).toBe(true);
    expect(result.current.isSignedOut).toBe(false);
  });

  it('reports signed out and passes a null user id once auth resolves with no user', () => {
    useAuthMock.mockReturnValue({user: null, loading: false});
    const {result} = renderHook(() => useCallerArticleProgress('p1', 't1'));

    expect(valuesMock).toHaveBeenLastCalledWith('p1', 't1', null, 'extraction');
    expect(result.current.userId).toBeNull();
    expect(result.current.isAuthResolving).toBe(false);
    expect(result.current.isSignedOut).toBe(true);
  });

  it("passes the signed-in user's id to the progress read", () => {
    // No `loading` key: the shape `QualityAssessmentInterface.test.tsx:32` mocks. It reads as resolved.
    useAuthMock.mockReturnValue({user: {id: 'user-1'}});
    const enabled = {...DISABLED, isUnavailable: false, isLoading: true};
    valuesMock.mockReturnValue(enabled);
    const {result} = renderHook(() => useCallerArticleProgress('p1', 't1', 'quality_assessment'));

    expect(valuesMock).toHaveBeenLastCalledWith('p1', 't1', 'user-1', 'quality_assessment');
    // The five progress fields pass through untouched, plus the three auth fields.
    expect(result.current).toEqual({
      ...enabled,
      userId: 'user-1',
      isAuthResolving: false,
      isSignedOut: false,
    });
    expect(result.current.refetch).toBe(refetch);
  });
});

describe('resolveProgressGate', () => { // plan-added coverage, not spec names
  type Flags = {isLoading?: boolean; isError?: boolean; isAuthResolving?: boolean; isSignedOut?: boolean};
  const read = ({isLoading = false, isError = false}: Flags = {}) => ({isLoading, isError, refetch: vi.fn()});
  const caller = ({isAuthResolving = false, isSignedOut = false, ...rest}: Flags = {}) => ({isAuthResolving, isSignedOut, ...read(rest)});
  const state = (progress: Flags, structure: Flags = {}) => resolveProgressGate(caller(progress), read(structure)).state;

  it('orders auth resolving, signed out, a failed read and a pending read before ready', () => {
    // Each case also sets every later step's flags, so only first-match-wins yields its state.
    const both = {isError: true, isLoading: true};
    expect(state({isAuthResolving: true, ...both}, both)).toBe('authResolving');
    expect(state({isSignedOut: true, ...both}, both)).toBe('signedOut');
    expect([state({isLoading: true}, {isError: true}), state({isError: true}, {isLoading: true})]).toEqual(['error', 'error']);
    expect([state({}, {isLoading: true}), state({isLoading: true})]).toEqual(['loading', 'loading']);
    expect(state({})).toBe('ready');
  });

  it('retries only the read that failed', () => {
    // The other read is still pending, so a retry must leave it alone.
    const failed = [caller({isError: true}), read({isError: true})] as const;
    const pending = [caller({isLoading: true}), read({isLoading: true})] as const;
    const gates = [resolveProgressGate(failed[0], pending[1]), resolveProgressGate(pending[0], failed[1])];
    expect(gates.map((gate) => gate.state)).toEqual(['error', 'error']);
    for (const gate of gates) if (gate.state === 'error') gate.retry();
    failed.forEach((r) => expect(r.refetch).toHaveBeenCalledTimes(1));
    pending.forEach((r) => expect(r.refetch).not.toHaveBeenCalled());
  });
});
