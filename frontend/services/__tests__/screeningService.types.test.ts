/**
 * Type-level: the backend types every enum-like screening field as a
 * `Literal`, so the generated fields are unions the UI can switch on without
 * casts. Vitest never typechecks — `npm run typecheck` runs these assertions.
 */
import {describe, expectTypeOf, it} from 'vitest';

import type {components} from '@/types/api/schema';

type S = components['schemas'];

describe('screening API types', () => {
  it('reads the API enums as unions, not strings', () => {
    expectTypeOf<S['ImportRunRead']['status']>().toEqualTypeOf<'pending' | 'running' | 'completed' | 'failed'>();
    expectTypeOf<S['ScreeningAssignmentRead']['status']>().toEqualTypeOf<
      'awaiting_me' | 'awaiting_others' | 'conflict' | 'decided'
    >();
    expectTypeOf<S['ScreeningOutcomeRead']['kind']>().toEqualTypeOf<'solo' | 'consensus' | 'arbitrated'>();
    expectTypeOf<S['ScreeningDecisionRead']['decision']>().toEqualTypeOf<'include' | 'exclude' | 'maybe'>();
  });
});
