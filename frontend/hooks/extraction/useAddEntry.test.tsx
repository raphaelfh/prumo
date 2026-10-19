import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';

import {AddEntryDialog} from '@/components/extraction/AddEntryDialog';
import {t} from '@/lib/copy';
import {server} from '@/test/mocks/server';
import type {ExtractionEntityTypeWithFields} from '@/types/extraction';

import {useAddEntry} from './useAddEntry';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test-token'}}}))}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

const entityTypes = [
  {
    id: 'et-validation',
    parent_entity_type_id: null,
    entry_label: 'validation',
    fields: [{id: 'f-key', label: 'Validation type', is_entity_key: true}],
  },
] as unknown as ExtractionEntityTypeWithFields[];

/** Opens the dialog the way `EntrySection` does, then renders it with the
 * hook's own props: the real hook -> dialog path. */
function Harness() {
  const {open, dialogProps} = useAddEntry({
    projectId: 'p1',
    articleId: 'a1',
    templateId: 't1',
    entityTypes,
    instances: [],
    onCreated: vi.fn().mockResolvedValue(undefined),
  });
  return (
    <>
      <button type="button" onClick={() => open('et-validation', null)}>
        open
      </button>
      <AddEntryDialog {...dialogProps} />
    </>
  );
}

describe('useAddEntry', () => {
  it('add dialog shows the duplicate-key message from a server 409', async () => {
    let posts = 0;
    server.use(
      http.post('*/api/v1/extraction/instances', () => {
        posts += 1;
        return HttpResponse.json(
          {ok: false, error: {code: 'ENTRY_KEY_DUPLICATE', message: 'raw server text'}},
          {status: 409},
        );
      }),
    );
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', {name: 'open'}));
    await user.type(await screen.findByLabelText(/Validation type/), 'external');
    await user.click(screen.getByRole('button', {name: /Create validation/}));

    expect(
      await screen.findByText(t('pages', 'extractionScreenEntryKeyDuplicate')),
    ).toBeInTheDocument();
    expect(screen.queryByText('raw server text')).toBeNull();
    expect(screen.getByRole('heading', {name: /Add new validation/})).toBeInTheDocument();
    expect(posts).toBe(1);
  });
});
