/**
 * PubMedImportDialog — input blocking, the dry-run counts, the start and its
 * errors, progress polling and the terminal states (spec-gate #33).
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {PubMedImportDialog} from '@/components/screening/PubMedImportDialog';
import {MAX_CSV_BYTES, MAX_PMIDS} from '@/lib/screening/pmidInput';
import {usePubmedImportRuns} from '@/stores/pubmedImportRuns';
import {server} from '@/test/mocks/server';
import type {components} from '@/types/api/schema';

type ImportRun = components['schemas']['ImportRunRead'];

const IMPORT_URL = '*/api/v1/projects/:projectId/imports/pubmed';
const RUN_URL = '*/api/v1/projects/:projectId/imports/:syncRunId';

const ok = (data: unknown, status = 200) => HttpResponse.json({ok: true, data}, {status});
const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

const DRY_RUN = {kind: 'dry_run', received: 4, distinct: 3, already_in_project: 1, new: 2, duplicate_in_request: 1};
const STARTED = {kind: 'started', status: 'pending', sync_run_id: 's1'};

function run(overrides: Partial<ImportRun> = {}): ImportRun {
  return {
    completed_at: null,
    error_code: null,
    failed: 0,
    fetch_failed: 0,
    not_found: 0,
    persisted: 0,
    skipped: 0,
    source: 'pubmed',
    started_at: '2026-10-23T00:00:00Z',
    status: 'running',
    sync_run_id: 's1',
    total_received: 4,
    unchanged: 0,
    updated: 0,
    ...overrides,
  };
}

const onOpenChange = vi.fn();

function renderDialog(canManage = true) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return render(
    <QueryClientProvider client={client}>
      <PubMedImportDialog
        open
        onOpenChange={onOpenChange}
        projectId="p1"
        canManage={canManage}
      />
    </QueryClientProvider>,
  );
}

async function paste(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('tab', {name: 'Paste PMIDs'}));
  await user.click(screen.getByRole('textbox'));
  await user.paste(text);
}

/** Pastes a list, checks it against `server`'s dry-run handler and confirms the import. */
async function pasteCheckAndImport(user: ReturnType<typeof userEvent.setup>) {
  await paste(user, '1 2 2 3');
  await user.click(screen.getByRole('button', {name: 'Check'}));
  await user.click(await screen.findByRole('button', {name: 'Import 3 PMIDs'}));
}

/** Serves the dry run, the start (202) and a sequence of run reads (the last repeats). */
function serveImport(runs: ImportRun[]) {
  let reads = 0;
  server.use(
    http.post(IMPORT_URL, async ({request}) => {
      const body = (await request.json()) as {dry_run: boolean};
      return body.dry_run ? ok(DRY_RUN) : ok(STARTED, 202);
    }),
    http.get(RUN_URL, () => {
      const next = runs[Math.min(reads, runs.length - 1)];
      reads += 1;
      return ok(next);
    }),
  );
}

beforeEach(() => {
  onOpenChange.mockClear();
  usePubmedImportRuns.setState({runs: {}});
});

describe('PubMedImportDialog input', () => {
  it('blocks invalid PMIDs before any request', async () => {
    const user = userEvent.setup();
    renderDialog();
    await paste(user, '12 abc');
    expect(await screen.findByText('These are not PMIDs: abc')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{list\}\}/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Check'})).toBeDisabled();
  });

  it('blocks an empty paste', async () => {
    const user = userEvent.setup();
    renderDialog();
    await paste(user, '  \n ');
    expect(await screen.findByText('No PMIDs found.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Check'})).toBeDisabled();
  });

  it('blocks more than 10,000 PMIDs', async () => {
    const user = userEvent.setup();
    renderDialog();
    await paste(user, '1 '.repeat(MAX_PMIDS + 1));
    expect(await screen.findByText('Up to 10,000 PMIDs per import.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Check'})).toBeDisabled();
  });

  it('blocks a CSV without a PMID column', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.upload(
      screen.getByLabelText('Drop the PubMed CSV here, or choose a file'),
      new File(['Title,DOI\nA,10.1/x\n'], 'x.csv'),
    );
    expect(await screen.findByText('This CSV has no PMID column.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Check'})).toBeDisabled();
  });

  it('blocks a CSV over 25 MB', async () => {
    const user = userEvent.setup();
    renderDialog();
    const big = new File(['PMID\n1\n'], 'big.csv');
    Object.defineProperty(big, 'size', {value: MAX_CSV_BYTES + 1});
    await user.upload(screen.getByLabelText('Drop the PubMed CSV here, or choose a file'), big);
    expect(await screen.findByText('Files up to 25 MB.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Check'})).toBeDisabled();
  });

  it('blocks a CSV with zero PMIDs', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.upload(
      screen.getByLabelText('Drop the PubMed CSV here, or choose a file'),
      new File(['PMID\n\n'], 'x.csv'),
    );
    expect(await screen.findByText('No PMIDs found.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Check'})).toBeDisabled();
  });

  it('checks the PMIDs of an uploaded CSV', async () => {
    let body: unknown = null;
    server.use(
      http.post(IMPORT_URL, async ({request}) => {
        body = await request.json();
        return ok(DRY_RUN);
      }),
    );
    const user = userEvent.setup();
    renderDialog();
    await user.upload(
      screen.getByLabelText('Drop the PubMed CSV here, or choose a file'),
      new File(['"PMID","Title"\n"11","A"\n"22","B"\n'], 'pubmed.csv'),
    );
    await user.click(await screen.findByRole('button', {name: 'Check'}));
    await waitFor(() => expect(body).toEqual({pmids: ['11', '22'], dry_run: true}));
  });
});

describe('PubMedImportDialog dry run', () => {
  it('shows dry-run counts before importing', async () => {
    let body: unknown = null;
    server.use(
      http.post(IMPORT_URL, async ({request}) => {
        body = await request.json();
        return ok(DRY_RUN);
      }),
    );
    const user = userEvent.setup();
    renderDialog();
    await paste(user, '1 2 2 3');
    await user.click(screen.getByRole('button', {name: 'Check'}));

    expect(await screen.findByText('4 PMIDs')).toBeInTheDocument();
    expect(screen.getByText('1 already in this project')).toBeInTheDocument();
    expect(screen.getByText('2 not in this project by PMID')).toBeInTheDocument();
    expect(
      screen.getByText('Some of these may match an existing article by DOI; those are updated instead of added.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 repeated in the list')).toBeInTheDocument();
    expect(body).toEqual({pmids: ['1', '2', '2', '3'], dry_run: true});
    expect(screen.getByRole('button', {name: 'Import 3 PMIDs'})).toBeEnabled();
  });

  it('says when nothing is new', async () => {
    server.use(http.post(IMPORT_URL, () => ok({...DRY_RUN, new: 0, already_in_project: 3, duplicate_in_request: 0})));
    const user = userEvent.setup();
    renderDialog();
    await paste(user, '1 2 3');
    await user.click(screen.getByRole('button', {name: 'Check'}));
    expect(
      await screen.findByText('All of these PMIDs are already in this project. Importing again only fills missing fields.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Import 3 PMIDs'})).toBeEnabled();
  });

  it('shows a dry-run error', async () => {
    server.use(http.post(IMPORT_URL, () => fail(500, 'INTERNAL_ERROR')));
    const user = userEvent.setup();
    renderDialog();
    await paste(user, '1');
    await user.click(screen.getByRole('button', {name: 'Check'}));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('explains a server 422 without a placeholder', async () => {
    server.use(http.post(IMPORT_URL, () => fail(422, 'VALIDATION_ERROR')));
    const user = userEvent.setup();
    renderDialog();
    await paste(user, '1');
    await user.click(screen.getByRole('button', {name: 'Check'}));
    expect(
      await screen.findByText('PubMed import refused this list. Check that every entry is a PMID and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\{\{list\}\}/)).not.toBeInTheDocument();
  });

  it('drops the counts when the list changes', async () => {
    server.use(http.post(IMPORT_URL, () => ok(DRY_RUN)));
    const user = userEvent.setup();
    renderDialog();
    await paste(user, '1 2 2 3');
    await user.click(screen.getByRole('button', {name: 'Check'}));
    expect(await screen.findByText('4 PMIDs')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), ' 9');
    expect(screen.queryByText('4 PMIDs')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Check'})).toBeEnabled();
  });
});

describe('PubMedImportDialog import', () => {
  it('imports, shows progress, then the result', async () => {
    let startBody: unknown = null;
    serveImport([run({status: 'running', persisted: 1, total_received: 4}), run({status: 'completed', persisted: 2, skipped: 1, failed: 1, not_found: 1})]);
    server.use(
      http.post(IMPORT_URL, async ({request}) => {
        const body = (await request.json()) as {dry_run: boolean};
        if (body.dry_run) return ok(DRY_RUN);
        startBody = body;
        return ok(STARTED, 202);
      }),
    );
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);

    expect(await screen.findByText('Importing… 1 of 4')).toBeInTheDocument();
    expect(startBody).toEqual({pmids: ['1', '2', '2', '3'], dry_run: false});
    expect(await screen.findByText('Imported: 2 new, 0 updated', {}, {timeout: 4000})).toBeInTheDocument();
    expect(screen.getByText('1 not found in PubMed')).toBeInTheDocument();
    // The footer button and the dialog's corner X share the name.
    expect(screen.getAllByRole('button', {name: 'Close'})).toHaveLength(2);
  }, 10_000);

  it('counts records already up to date as progress', async () => {
    serveImport([run({status: 'running', persisted: 1, unchanged: 2, total_received: 4})]);
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    expect(await screen.findByText('Importing… 3 of 4')).toBeInTheDocument();
  });

  it('separates not found, could not fetch and already up to date', async () => {
    serveImport([
      run({status: 'completed', persisted: 1, updated: 1, failed: 3, not_found: 1, fetch_failed: 2, unchanged: 4}),
    ]);
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    expect(await screen.findByText('Imported: 1 new, 1 updated')).toBeInTheDocument();
    expect(screen.getByText('1 not found in PubMed')).toBeInTheDocument();
    expect(
      screen.getByText('2 could not be fetched from PubMed. Import the same file again to retry them.'),
    ).toBeInTheDocument();
    expect(screen.getByText('4 already up to date')).toBeInTheDocument();
  });

  it.each([
    [
      'NCBI_UNAVAILABLE',
      'PubMed did not respond, so the import stopped. Records imported so far are kept; import the same file again to retry the rest.',
    ],
    [
      'IMPORT_STALE',
      'The import stopped responding and was ended. Records imported so far are kept; import the same file again to retry the rest.',
    ],
    [
      'IMPORT_TIME_LIMIT',
      'The import ran out of time. Records imported so far are kept; import the same file again to retry the rest.',
    ],
  ] as const)('explains a run that failed with %s', async (code, message) => {
    serveImport([run({status: 'failed', persisted: 1, error_code: code})]);
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('shows the active run when reopened', async () => {
    serveImport([run({status: 'running', persisted: 1, total_received: 4})]);
    usePubmedImportRuns.setState({runs: {p1: {runId: 's1', settled: false}}});
    renderDialog();
    expect(await screen.findByText('Importing… 1 of 4')).toBeInTheDocument();
    expect(screen.queryByRole('tab', {name: 'Paste PMIDs'})).not.toBeInTheDocument();
  });

  it('records the started run for the project', async () => {
    serveImport([run({status: 'running'})]);
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    await waitFor(() => expect(usePubmedImportRuns.getState().runs.p1?.runId).toBe('s1'));
  });

  it('explains a missing NCBI email', async () => {
    server.use(
      http.post(IMPORT_URL, async ({request}) => {
        const body = (await request.json()) as {dry_run: boolean};
        return body.dry_run ? ok(DRY_RUN) : fail(503, 'NCBI_EMAIL_NOT_CONFIGURED');
      }),
    );
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    expect(
      await screen.findByText('PubMed import is not configured on this server. Ask an administrator.'),
    ).toBeInTheDocument();
  });

  it('explains an unavailable queue', async () => {
    server.use(
      http.post(IMPORT_URL, async ({request}) => {
        const body = (await request.json()) as {dry_run: boolean};
        return body.dry_run ? ok(DRY_RUN) : fail(503, 'SERVICE_UNAVAILABLE');
      }),
    );
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    expect(
      await screen.findByText('The import queue is unavailable. The import may not have started. Try again later.'),
    ).toBeInTheDocument();
  });

  it('explains a refused start', async () => {
    server.use(
      http.post(IMPORT_URL, async ({request}) => {
        const body = (await request.json()) as {dry_run: boolean};
        return body.dry_run ? ok(DRY_RUN) : fail(403, 'FORBIDDEN');
      }),
    );
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
  });

  it('reports a failed run', async () => {
    serveImport([run({status: 'failed', persisted: 1, failed: 2})]);
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    expect(
      await screen.findByText(
        'The import stopped. Articles imported so far are kept; you can import the same list again.',
      ),
    ).toBeInTheDocument();
  });

  it('reports a run that disappeared', async () => {
    server.use(
      http.post(IMPORT_URL, async ({request}) => {
        const body = (await request.json()) as {dry_run: boolean};
        return body.dry_run ? ok(DRY_RUN) : ok(STARTED, 202);
      }),
      http.get(RUN_URL, () => fail(404, 'NOT_FOUND')),
    );
    const user = userEvent.setup();
    renderDialog();
    await pasteCheckAndImport(user);
    expect(await screen.findByText('This import is no longer available.')).toBeInTheDocument();
  });

  it('points a manager to enrollment and a member to the manager', async () => {
    serveImport([run({status: 'completed', persisted: 2, total_received: 4})]);
    const user = userEvent.setup();
    const manager = renderDialog(true);
    await pasteCheckAndImport(user);
    expect(await screen.findByText('Enroll the new articles to screen them.')).toBeInTheDocument();
    manager.unmount();
    // A new session: the tracked run belongs to the first dialog.
    usePubmedImportRuns.setState({runs: {}});

    const memberUser = userEvent.setup();
    renderDialog(false);
    await pasteCheckAndImport(memberUser);
    expect(await screen.findByText('A project manager enrolls them for screening.')).toBeInTheDocument();
    expect(screen.queryByText('Enroll the new articles to screen them.')).not.toBeInTheDocument();
  });
});
