/** Consent page: every state the user can land in, and the exact decision the POST carries. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {MemoryRouter, Route, Routes} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {t} from '@/lib/copy';
import {server} from '../mocks/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test-token'}}}))}},
}));
const {leaveAppMock} = vi.hoisted(() => ({leaveAppMock: vi.fn()}));
vi.mock('@/lib/navigation', () => ({leaveApp: leaveAppMock}));

import OAuthConsent from '@/pages/OAuthConsent';

const ID = '11111111-1111-4111-8111-111111111111';
const REQUEST = {
  client_name: 'Claude',
  redirect_host: 'claude.ai:8443',
  offers_write: true,
  offers_ai_run: false,
  requested_scopes: ['read', 'write'],
  expires_at: '2026-10-15T12:10:00Z',
};
const APPROVED_URL = 'https://claude.ai:8443/api/mcp/auth_callback?code=abc&state=xyz';
const DENIED_URL = 'https://claude.ai:8443/api/mcp/auth_callback?error=access_denied&state=xyz';

const ok = <T,>(data: T) => HttpResponse.json({ok: true, data});
const refusal = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: 'refused'}}, {status});
// slowapi's own 429 body: not the ApiResponse envelope.
const rateLimited = () => HttpResponse.json({error: 'Rate limit exceeded: 20 per 1 minute'}, {status: 429});

let gets = 0;
let posts: unknown[] = [];

function renderAt(search: string) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/oauth/consent${search}`]}>
        <Routes>
          <Route path="/oauth/consent" element={<OAuthConsent />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubGet(respond: () => Response) {
  server.use(
    http.get('*/api/v1/oauth/requests/:id', () => {
      gets += 1;
      return respond();
    }),
  );
}

function stubPost(respond: (body: {approve: boolean}) => Response | Promise<Response>) {
  server.use(
    http.post('*/api/v1/oauth/requests/:id/decision', async ({request}) => {
      const body = (await request.json()) as {approve: boolean};
      posts.push(body);
      return respond(body);
    }),
  );
}

const decision = (body: {approve: boolean}) => ok({redirect_url: body.approve ? APPROVED_URL : DENIED_URL});

beforeEach(() => {
  gets = 0;
  posts = [];
  leaveAppMock.mockReset();
  stubGet(() => ok(REQUEST));
  stubPost(decision);
});

describe('OAuthConsent', () => {
  it('shows the loading state first', () => {
    renderAt(`?request=${ID}`);
    expect(screen.getByText(t('oauthConsent', 'loading'))).toBeInTheDocument();
  });

  it('shows who is asking, where it returns and the edit box unchecked', async () => {
    renderAt(`?request=${ID}`);

    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: t('oauthConsent', 'pageTitle')})).toBeInTheDocument();
    expect(screen.getByText('claude.ai:8443')).toBeInTheDocument();
    expect(screen.getByText(t('oauthConsent', 'accessAll'))).toBeInTheDocument();
    expect(screen.getByText(t('oauthConsent', 'readItem'))).toBeInTheDocument();
    expect(screen.getByRole('checkbox', {name: t('oauthConsent', 'editLabel')})).not.toBeChecked();
    expect(screen.getByText(t('oauthConsent', 'editHint'))).toBeInTheDocument();
  });

  it('Allow with the box ticked posts write: true and leaves to the returned URL', async () => {
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    await user.click(await screen.findByRole('checkbox', {name: t('oauthConsent', 'editLabel')}));
    await user.click(screen.getByRole('button', {name: t('oauthConsent', 'allow')}));

    await waitFor(() => expect(leaveAppMock).toHaveBeenCalledWith(APPROVED_URL));
    expect(posts).toEqual([{approve: true, write: true, ai_run: false}]);
    expect(screen.getByText(t('oauthConsent', 'returning'))).toBeInTheDocument();
  });

  it('Allow with the box unticked posts write: false', async () => {
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    await user.click(await screen.findByRole('button', {name: t('oauthConsent', 'allow')}));

    await waitFor(() => expect(leaveAppMock).toHaveBeenCalledWith(APPROVED_URL));
    expect(posts).toEqual([{approve: true, write: false, ai_run: false}]);
  });

  it('Deny posts approve: false, write: false and leaves to the access_denied URL', async () => {
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    // A ticked box must not leak into a deny.
    await user.click(await screen.findByRole('checkbox', {name: t('oauthConsent', 'editLabel')}));
    await user.click(screen.getByRole('button', {name: t('oauthConsent', 'deny')}));

    await waitFor(() => expect(leaveAppMock).toHaveBeenCalledWith(DENIED_URL));
    expect(posts).toEqual([{approve: false, write: false, ai_run: false}]);
  });

  it('a read-only request renders no checkbox and posts write: false', async () => {
    stubGet(() => ok({...REQUEST, offers_write: false, requested_scopes: ['read']}));
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    expect(await screen.findByText(t('oauthConsent', 'readItem'))).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(t('oauthConsent', 'editHint'))).toBeNull();

    await user.click(screen.getByRole('button', {name: t('oauthConsent', 'allow')}));
    await waitFor(() => expect(posts).toEqual([{approve: true, write: false, ai_run: false}]));
  });

  it('renders no AI runs box when the app did not ask for ai_run', async () => {
    renderAt(`?request=${ID}`);

    expect(await screen.findByRole('checkbox', {name: t('oauthConsent', 'editLabel')})).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', {name: t('oauthConsent', 'aiRunLabel')})).toBeNull();
    expect(screen.queryByText(t('oauthConsent', 'aiRunHint'))).toBeNull();
  });

  describe('when the app asks for ai_run', () => {
    const AI_REQUEST = {...REQUEST, offers_ai_run: true, requested_scopes: ['read', 'write', 'ai_run']};

    it('shows a separate AI runs box, unchecked, and Allow posts ai_run: false', async () => {
      stubGet(() => ok(AI_REQUEST));
      const user = userEvent.setup();
      renderAt(`?request=${ID}`);

      const box = await screen.findByRole('checkbox', {name: t('oauthConsent', 'aiRunLabel')});
      expect(box).not.toBeChecked();
      expect(box).toHaveAccessibleDescription(t('oauthConsent', 'aiRunHint'));
      await user.click(screen.getByRole('button', {name: t('oauthConsent', 'allow')}));

      await waitFor(() => expect(posts).toEqual([{approve: true, write: false, ai_run: false}]));
    });

    it('ticking the AI runs box posts ai_run: true without ticking edits', async () => {
      stubGet(() => ok(AI_REQUEST));
      const user = userEvent.setup();
      renderAt(`?request=${ID}`);

      await user.click(await screen.findByRole('checkbox', {name: t('oauthConsent', 'aiRunLabel')}));
      await user.click(screen.getByRole('button', {name: t('oauthConsent', 'allow')}));

      await waitFor(() => expect(posts).toEqual([{approve: true, write: false, ai_run: true}]));
    });

    it('Deny posts ai_run: false even with the box ticked', async () => {
      stubGet(() => ok(AI_REQUEST));
      const user = userEvent.setup();
      renderAt(`?request=${ID}`);

      await user.click(await screen.findByRole('checkbox', {name: t('oauthConsent', 'aiRunLabel')}));
      await user.click(screen.getByRole('button', {name: t('oauthConsent', 'deny')}));

      await waitFor(() => expect(posts).toEqual([{approve: false, write: false, ai_run: false}]));
    });
  });

  it('GET 404 shows the expired state', async () => {
    stubGet(() => refusal(404, 'NOT_FOUND'));
    renderAt(`?request=${ID}`);

    expect(await screen.findByText(t('oauthConsent', 'expiredBody'))).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: t('oauthConsent', 'expiredTitle')})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: t('oauthConsent', 'allow')})).toBeNull();
  });

  it('GET 409 shows the already-decided state', async () => {
    stubGet(() => refusal(409, 'REQUEST_ALREADY_DECIDED'));
    renderAt(`?request=${ID}`);

    expect(await screen.findByText(t('oauthConsent', 'decidedBody'))).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: t('oauthConsent', 'decidedTitle')})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: t('oauthConsent', 'allow')})).toBeNull();
  });

  it.each([
    ['no ?request=', ''],
    ['a malformed ?request=', '?request=abc'],
  ])('%s shows the expired state and sends no request', async (_label, search) => {
    renderAt(search);

    expect(screen.getByText(t('oauthConsent', 'expiredBody'))).toBeInTheDocument();
    // Let any stray query fire before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gets).toBe(0);
  });

  it('POST 404 (expired since load) shows the expired state', async () => {
    stubPost(() => refusal(404, 'NOT_FOUND'));
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    await user.click(await screen.findByRole('button', {name: t('oauthConsent', 'allow')}));

    expect(await screen.findByText(t('oauthConsent', 'expiredBody'))).toBeInTheDocument();
    expect(leaveAppMock).not.toHaveBeenCalled();
  });

  it('POST 409 shows the already-decided state', async () => {
    stubPost(() => refusal(409, 'REQUEST_ALREADY_DECIDED'));
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    await user.click(await screen.findByRole('button', {name: t('oauthConsent', 'allow')}));

    expect(await screen.findByText(t('oauthConsent', 'decidedBody'))).toBeInTheDocument();
    expect(leaveAppMock).not.toHaveBeenCalled();
  });

  it('POST 429 shows the rate-limited copy, and Retry resubmits the same body', async () => {
    let attempt = 0;
    stubPost((body) => {
      attempt += 1;
      return attempt === 1 ? rateLimited() : decision(body);
    });
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    await user.click(await screen.findByRole('checkbox', {name: t('oauthConsent', 'editLabel')}));
    await user.click(screen.getByRole('button', {name: t('oauthConsent', 'allow')}));
    expect(await screen.findByText(t('oauthConsent', 'rateLimited'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: t('oauthConsent', 'retry')}));

    await waitFor(() => expect(leaveAppMock).toHaveBeenCalledWith(APPROVED_URL));
    expect(posts).toEqual([
      {approve: true, write: true, ai_run: false},
      {approve: true, write: true, ai_run: false},
    ]);
  });

  it('POST 500 shows the submit error', async () => {
    stubPost(() => refusal(500, 'INTERNAL_ERROR'));
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    await user.click(await screen.findByRole('button', {name: t('oauthConsent', 'deny')}));

    expect(await screen.findByText(t('oauthConsent', 'submitError'))).toBeInTheDocument();
    expect(screen.getByRole('button', {name: t('oauthConsent', 'retry')})).toBeInTheDocument();
  });

  it('GET 500 shows the load error, and Retry refetches', async () => {
    let attempt = 0;
    stubGet(() => {
      attempt += 1;
      return attempt === 1 ? refusal(500, 'INTERNAL_ERROR') : ok(REQUEST);
    });
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    expect(await screen.findByText(t('oauthConsent', 'loadError'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: t('oauthConsent', 'retry')}));

    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(gets).toBe(2);
  });

  it('GET 429 shows the rate-limited copy', async () => {
    stubGet(rateLimited);
    renderAt(`?request=${ID}`);

    expect(await screen.findByText(t('oauthConsent', 'rateLimited'))).toBeInTheDocument();
  });

  describe('inside a frame', () => {
    afterEach(() => vi.restoreAllMocks());

    async function expectRefusal() {
      expect(screen.getByText(t('oauthConsent', 'framedBody'))).toBeInTheDocument();
      // Give a GET (and anything it would unlock) the chance to land.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByRole('button', {name: t('oauthConsent', 'allow')})).toBeNull();
      expect(screen.queryByRole('button', {name: t('oauthConsent', 'deny')})).toBeNull();
      expect(gets).toBe(0);
      expect(posts).toEqual([]);
    }

    it('refuses to offer Allow or Deny when framed', async () => {
      // window.top is unforgeable in jsdom; a distinct `self` makes top !== self.
      vi.spyOn(window, 'self', 'get').mockReturnValue({} as Window & typeof globalThis);
      renderAt(`?request=${ID}`);
      await expectRefusal();
    });

    it('treats a frame check that throws as framed', async () => {
      vi.spyOn(window, 'self', 'get').mockImplementation(() => {
        throw new DOMException('Blocked a frame', 'SecurityError');
      });
      renderAt(`?request=${ID}`);
      await expectRefusal();
    });
  });

  it('disables both buttons while the POST is pending', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubPost(async (body) => {
      await gate;
      return decision(body);
    });
    const user = userEvent.setup();
    renderAt(`?request=${ID}`);

    await user.click(await screen.findByRole('button', {name: t('oauthConsent', 'allow')}));

    await waitFor(() => expect(screen.getByRole('button', {name: t('oauthConsent', 'allow')})).toBeDisabled());
    expect(screen.getByRole('button', {name: t('oauthConsent', 'deny')})).toBeDisabled();
    expect(screen.getByText(t('oauthConsent', 'submitting'))).toBeInTheDocument();

    release();
    await waitFor(() => expect(leaveAppMock).toHaveBeenCalledWith(APPROVED_URL));
  });
});
