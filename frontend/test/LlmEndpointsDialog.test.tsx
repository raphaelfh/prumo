/**
 * LlmEndpointsDialog — the manager-only custom-endpoint surface (C2 C2).
 *
 * The data hooks are mocked in the house style (every data hook mocked —
 * the MSW gate would fail loudly on an unmocked GET). Contracts under
 * test:
 * - the list renders label + host + validation badge + models count;
 * - create fires the POST with the EXACT field set (nothing smuggled,
 *   nothing dropped);
 * - Verify swaps the badge from the probe response and chips the
 *   output_mode; a prompted-only endpoint carries the Verified-mode
 *   warning;
 * - a delete refused with the typed 409 surfaces that message inline —
 *   never a generic failure;
 * - the Zod layer blocks a submit client-side (empty label, >80 chars,
 *   non-URL base URL), so a body that cannot succeed is never sent;
 * - the api_key tri-state: an untouched edit field sends `null` (KEEP
 *   the stored key), the explicit clear control sends `""`.
 * - a typed-but-uncommitted model id still reaches the wire (the tag
 *   input is not a trap door);
 * - a probe verdict never outlives the write that invalidated it.
 */
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/extraction/useLlmEndpoints', () => ({
  useLlmEndpoints: vi.fn(),
  useCreateLlmEndpoint: vi.fn(),
  useUpdateLlmEndpoint: vi.fn(),
  useDeleteLlmEndpoint: vi.fn(),
  useVerifyLlmEndpoint: vi.fn(),
}));
// Callable-with-methods shape — a namespace-only mock swallows `toast(...)`
// calls and reports green for feedback that never fired.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import {LlmEndpointsDialog} from '@/components/extraction/LlmEndpointsDialog';
import {
  useCreateLlmEndpoint,
  useDeleteLlmEndpoint,
  useLlmEndpoints,
  useUpdateLlmEndpoint,
  useVerifyLlmEndpoint,
} from '@/hooks/extraction/useLlmEndpoints';
import {llmEngine as copy} from '@/lib/copy';
import type {LlmEndpointRead} from '@/services/llmEndpointService';

import {makeEndpointRead} from './mocks/llmEndpointRead';

const useLlmEndpointsMock = vi.mocked(useLlmEndpoints);
const useCreateMock = vi.mocked(useCreateLlmEndpoint);
const useUpdateMock = vi.mocked(useUpdateLlmEndpoint);
const useDeleteMock = vi.mocked(useDeleteLlmEndpoint);
const useVerifyMock = vi.mocked(useVerifyLlmEndpoint);

const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const verifyMutate = vi.fn();

const ENDPOINT = makeEndpointRead();
const ENDPOINT_ID = ENDPOINT.id;

function mockList(endpoints: LlmEndpointRead[] = [ENDPOINT]) {
  useLlmEndpointsMock.mockReturnValue({
    data: endpoints,
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useLlmEndpoints>);
}

function renderDialog(endpoints: LlmEndpointRead[] = [ENDPOINT]) {
  mockList(endpoints);
  return render(
    <LlmEndpointsDialog projectId="p1" open onOpenChange={vi.fn()} />,
  );
}

/** Opens the add form and fills the three text fields + one model chip. */
async function fillCreateForm(overrides: {
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
} = {}) {
  const {
    label = 'Lab vLLM',
    baseUrl = 'https://llm.lab.example.org/v1',
    apiKey = 'sk-secret',
    model = 'qwen3-30b',
  } = overrides;

  await userEvent.click(screen.getByRole('button', {name: copy.endpointAddLabel}));
  if (label) {
    await userEvent.type(screen.getByLabelText(copy.endpointLabelLabel), label);
  }
  if (baseUrl) {
    await userEvent.type(
      screen.getByLabelText(copy.endpointBaseUrlLabel),
      baseUrl,
    );
  }
  if (apiKey) {
    await userEvent.type(screen.getByLabelText(copy.endpointKeyLabel), apiKey);
  }
  if (model) {
    await userEvent.type(
      screen.getByLabelText(copy.endpointModelsLabel),
      `${model}{Enter}`,
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  useCreateMock.mockReturnValue({
    mutate: createMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateLlmEndpoint>);
  useUpdateMock.mockReturnValue({
    mutate: updateMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateLlmEndpoint>);
  useDeleteMock.mockReturnValue({
    mutate: deleteMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteLlmEndpoint>);
  useVerifyMock.mockReturnValue({
    mutate: verifyMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useVerifyLlmEndpoint>);
});

describe('list', () => {
  it('renders label, host, unverified badge and the models count', () => {
    renderDialog();

    const row = screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);
    expect(within(row).getByText('Lab vLLM')).toBeInTheDocument();
    // Host only — the full base URL would push the row past the density
    // the popover family keeps.
    expect(within(row).getByText('llm.lab.example.org')).toBeInTheDocument();
    expect(
      within(row).getByText(copy.endpointStatusUnverified),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(
        copy.endpointModelsCount.replace('{{count}}', '1'),
      ),
    ).toBeInTheDocument();
  });

  it('renders the empty state when the project has no endpoints', () => {
    renderDialog([]);

    expect(screen.getByText(copy.endpointsEmpty)).toBeInTheDocument();
  });

  // A failed read and an empty project are DIFFERENT facts: collapsing
  // them into "No custom endpoints yet." tells a manager their endpoints
  // are gone, and flashes that same lie on every open.
  it('renders the loading state, never the empty copy, while the read is pending', () => {
    useLlmEndpointsMock.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
    } as unknown as ReturnType<typeof useLlmEndpoints>);
    render(<LlmEndpointsDialog projectId="p1" open onOpenChange={vi.fn()} />);

    expect(
      screen.getByRole('status', {name: copy.endpointsLoading}),
    ).toBeInTheDocument();
    expect(screen.queryByText(copy.endpointsEmpty)).not.toBeInTheDocument();
  });

  it('renders a distinct error line on a failed read', () => {
    useLlmEndpointsMock.mockReturnValue({
      data: undefined,
      isError: true,
      isPending: false,
    } as unknown as ReturnType<typeof useLlmEndpoints>);
    render(<LlmEndpointsDialog projectId="p1" open onOpenChange={vi.fn()} />);

    expect(screen.getByText(copy.endpointsLoadError)).toBeInTheDocument();
    expect(screen.queryByText(copy.endpointsEmpty)).not.toBeInTheDocument();
  });

  it('renders an ok endpoint with the success badge and a failed one destructive', () => {
    renderDialog([
      makeEndpointRead({id: 'e-ok', label: 'OK', validation_status: 'ok'}),
      makeEndpointRead({
        id: 'e-bad',
        label: 'Bad',
        validation_status: 'failed',
      }),
    ]);

    const okBadge = within(screen.getByTestId('llm-endpoint-row-e-ok')).getByText(
      copy.endpointStatusOk,
    );
    const failedBadge = within(
      screen.getByTestId('llm-endpoint-row-e-bad'),
    ).getByText(copy.endpointStatusFailed);
    expect(okBadge.className).toContain('success');
    expect(failedBadge.className).toContain('destructive');
  });
});

describe('create', () => {
  it('fires the POST with the exact field set', async () => {
    renderDialog([]);

    await fillCreateForm();
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toEqual({
      label: 'Lab vLLM',
      base_url: 'https://llm.lab.example.org/v1',
      allowed_models: ['qwen3-30b'],
      api_key: 'sk-secret',
    });
  });

  it('sends api_key null for a keyless endpoint (blank key on create)', async () => {
    renderDialog([]);

    await fillCreateForm({apiKey: ''});
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(createMutate.mock.calls[0][0]).toEqual({
      label: 'Lab vLLM',
      base_url: 'https://llm.lab.example.org/v1',
      allowed_models: ['qwen3-30b'],
      // Explicit null, not "": an empty string is the CLEAR signal and
      // the backend rejects it on create.
      api_key: null,
    });
  });

  // The tag input is the only way models reach the wire, so anything
  // sitting in it at submit time is data the manager typed — dropping it
  // ships an endpoint with zero models: a heading with no rows in the
  // picker and nothing for the probe to probe.
  it('carries a typed-but-uncommitted model id into the POST', async () => {
    renderDialog([]);

    await fillCreateForm({model: ''});
    await userEvent.type(
      screen.getByLabelText(copy.endpointModelsLabel),
      'qwen3-30b',
    );
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(createMutate.mock.calls[0][0].allowed_models).toEqual(['qwen3-30b']);
  });

  it('commits the draft on blur, without Enter', async () => {
    renderDialog([]);

    await fillCreateForm({model: ''});
    await userEvent.type(
      screen.getByLabelText(copy.endpointModelsLabel),
      'qwen3-30b',
    );
    await userEvent.tab();

    expect(
      screen.getByRole('button', {
        name: copy.endpointModelRemoveAria.replace('{{model}}', 'qwen3-30b'),
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(copy.endpointModelsLabel)).toHaveValue('');
  });

  it('does not duplicate a draft that is already a chip', async () => {
    renderDialog([]);

    await fillCreateForm();
    await userEvent.type(
      screen.getByLabelText(copy.endpointModelsLabel),
      'qwen3-30b',
    );
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(createMutate.mock.calls[0][0].allowed_models).toEqual(['qwen3-30b']);
  });

  it('surfaces a refused save inline, sanitized', async () => {
    createMutate.mockImplementation(
      (_body: unknown, opts?: {onError?: (e: Error) => void}) =>
        opts?.onError?.(new Error('endpoint address is not reachable')),
    );
    renderDialog([]);

    await fillCreateForm();
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'endpoint address is not reachable',
    );
  });
});

describe('Zod layer (a body that cannot succeed is never sent)', () => {
  // The resolver runs async, so the message is awaited (findByText) — the
  // no-mutation assertion is the load-bearing half either way.
  it('blocks submit on an empty label', async () => {
    renderDialog([]);

    await fillCreateForm({label: ''});
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(
      await screen.findByText(copy.endpointValidationLabelRequired),
    ).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('blocks submit on a label over 80 characters', async () => {
    renderDialog([]);

    await fillCreateForm({label: 'x'.repeat(81)});
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(
      await screen.findByText(copy.endpointValidationLabelMax),
    ).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('blocks submit on a base URL that is not a URL', async () => {
    renderDialog([]);

    await fillCreateForm({baseUrl: 'not a url'});
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(
      await screen.findByText(copy.endpointValidationBaseUrl),
    ).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('blocks submit on an http:// base URL (the field already says HTTPS only)', async () => {
    renderDialog([]);

    await fillCreateForm({baseUrl: 'http://llm.lab.example.org/v1'});
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    // Two occurrences once the field rejects it: the standing description
    // plus the inline error message, which reuses the same sentence.
    await vi.waitFor(() =>
      expect(screen.getAllByText(copy.endpointBaseUrlHint)).toHaveLength(2),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });
});

describe('edit (api_key tri-state)', () => {
  async function openEditForm() {
    renderDialog();
    const row = screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);
    await userEvent.click(
      within(row).getByRole('button', {name: copy.endpointEditAria}),
    );
  }

  it('prefills the form and shows the key-kept placeholder', async () => {
    await openEditForm();

    expect(screen.getByLabelText(copy.endpointLabelLabel)).toHaveValue(
      'Lab vLLM',
    );
    expect(screen.getByLabelText(copy.endpointBaseUrlLabel)).toHaveValue(
      'https://llm.lab.example.org/v1',
    );
    const keyInput = screen.getByLabelText(copy.endpointKeyLabel);
    // The stored secret NEVER round-trips to the client: the field is
    // empty and the placeholder explains what blank means.
    expect(keyInput).toHaveValue('');
    expect(keyInput).toHaveAttribute('type', 'password');
    expect(keyInput).toHaveAttribute(
      'placeholder',
      copy.endpointKeyKeptPlaceholder,
    );
  });

  it('an untouched key field sends api_key null (keep the stored key)', async () => {
    await openEditForm();

    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({
      endpointId: ENDPOINT_ID,
      body: {
        label: 'Lab vLLM',
        base_url: 'https://llm.lab.example.org/v1',
        allowed_models: ['qwen3-30b'],
        api_key: null,
      },
    });
  });

  it('the explicit clear control sends api_key "" (clear the stored key)', async () => {
    await openEditForm();

    await userEvent.click(
      screen.getByRole('checkbox', {name: copy.endpointKeyClearLabel}),
    );
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(updateMutate.mock.calls[0][0].body.api_key).toBe('');
  });

  it('a typed key replaces the stored one', async () => {
    await openEditForm();

    await userEvent.type(
      screen.getByLabelText(copy.endpointKeyLabel),
      'sk-new',
    );
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(updateMutate.mock.calls[0][0].body.api_key).toBe('sk-new');
  });

  it('drops an allowed model from the tag input', async () => {
    await openEditForm();

    await userEvent.click(
      screen.getByRole('button', {
        name: copy.endpointModelRemoveAria.replace('{{model}}', 'qwen3-30b'),
      }),
    );
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(updateMutate.mock.calls[0][0].body.allowed_models).toEqual([]);
  });

  // The removed chip takes the focused element with it; without a landing
  // spot focus falls to <body> and the keyboard user restarts the form.
  it('moves focus to the model input after removing a chip', async () => {
    await openEditForm();

    await userEvent.click(
      screen.getByRole('button', {
        name: copy.endpointModelRemoveAria.replace('{{model}}', 'qwen3-30b'),
      }),
    );

    expect(screen.getByLabelText(copy.endpointModelsLabel)).toHaveFocus();
  });
});

describe('verify', () => {
  it('swaps the badge and chips the output_mode from the probe response', async () => {
    verifyMutate.mockImplementation(
      (
        _id: string,
        opts?: {onSuccess?: (r: Record<string, unknown>) => void},
      ) =>
        opts?.onSuccess?.({
          validation_status: 'ok',
          output_mode: 'tool',
          models_seen: ['qwen3-30b'],
          error: null,
        }),
    );
    renderDialog();

    const row = screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);
    await userEvent.click(
      within(row).getByRole('button', {name: copy.endpointVerifyAria}),
    );

    expect(verifyMutate.mock.calls[0][0]).toBe(ENDPOINT_ID);
    expect(within(row).getByText(copy.endpointStatusOk)).toBeInTheDocument();
    expect(within(row).getByText(copy.endpointModeTool)).toBeInTheDocument();
  });

  it('a prompted-only probe warns about Verified mode', async () => {
    verifyMutate.mockImplementation(
      (
        _id: string,
        opts?: {onSuccess?: (r: Record<string, unknown>) => void},
      ) =>
        opts?.onSuccess?.({
          validation_status: 'ok',
          output_mode: 'prompted',
          models_seen: [],
          error: null,
        }),
    );
    renderDialog();

    const row = screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);
    await userEvent.click(
      within(row).getByRole('button', {name: copy.endpointVerifyAria}),
    );

    expect(screen.getByText(copy.endpointPromptedWarn)).toBeInTheDocument();
  });

  it('a failed probe shows the destructive badge with the sanitized reason', async () => {
    verifyMutate.mockImplementation(
      (
        _id: string,
        opts?: {onSuccess?: (r: Record<string, unknown>) => void},
      ) =>
        opts?.onSuccess?.({
          validation_status: 'failed',
          output_mode: null,
          models_seen: [],
          error: 'connection refused',
        }),
    );
    renderDialog();

    const row = screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);
    await userEvent.click(
      within(row).getByRole('button', {name: copy.endpointVerifyAria}),
    );

    expect(
      within(row).getByText(copy.endpointStatusFailed),
    ).toBeInTheDocument();
    expect(within(row).getByText('connection refused')).toBeInTheDocument();
  });

  // The backend resets validation_status → unverified and clears
  // capabilities whenever base_url or allowed_models changes. A probe
  // verdict that survives that write asserts "Verified" over a row the
  // picker has already dropped.
  it('drops the probe verdict when the edited row is saved', async () => {
    verifyMutate.mockImplementation(
      (
        _id: string,
        opts?: {onSuccess?: (r: Record<string, unknown>) => void},
      ) =>
        opts?.onSuccess?.({
          validation_status: 'ok',
          output_mode: 'tool',
          models_seen: ['qwen3-30b'],
          error: null,
        }),
    );
    updateMutate.mockImplementation(
      (_vars: unknown, opts?: {onSuccess?: () => void}) => {
        // The PUT changed base_url, so the refetched row comes back reset.
        mockList([
          makeEndpointRead({
            base_url: 'https://new.lab.example.org/v1',
            validation_status: 'unverified',
            capabilities: {output_mode: null, models_seen: []},
          }),
        ]);
        opts?.onSuccess?.();
      },
    );
    renderDialog();
    const row = () => screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);

    await userEvent.click(
      within(row()).getByRole('button', {name: copy.endpointVerifyAria}),
    );
    expect(within(row()).getByText(copy.endpointStatusOk)).toBeInTheDocument();

    await userEvent.click(
      within(row()).getByRole('button', {name: copy.endpointEditAria}),
    );
    const baseUrl = screen.getByLabelText(copy.endpointBaseUrlLabel);
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, 'https://new.lab.example.org/v1');
    await userEvent.click(screen.getByRole('button', {name: copy.endpointSaveLabel}));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(
      within(row()).getByText(copy.endpointStatusUnverified),
    ).toBeInTheDocument();
    expect(
      within(row()).queryByText(copy.endpointModeTool),
    ).not.toBeInTheDocument();
  });

  // Dismissing leaves the component MOUNTED (open=false), so local state
  // outlives the surface that produced it unless it is cleared.
  it('clears the probe verdict and the delete error when the dialog is dismissed', async () => {
    verifyMutate.mockImplementation(
      (
        _id: string,
        opts?: {onSuccess?: (r: Record<string, unknown>) => void},
      ) =>
        opts?.onSuccess?.({
          validation_status: 'ok',
          output_mode: 'tool',
          models_seen: [],
          error: null,
        }),
    );
    deleteMutate.mockImplementation(
      (_id: string, opts?: {onError?: (e: Error) => void}) =>
        opts?.onError?.(new Error('The project engine runs on this endpoint.')),
    );
    const onOpenChange = vi.fn();
    mockList();
    render(
      <LlmEndpointsDialog projectId="p1" open onOpenChange={onOpenChange} />,
    );
    const row = () => screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);

    await userEvent.click(
      within(row()).getByRole('button', {name: copy.endpointVerifyAria}),
    );
    await userEvent.click(
      within(row()).getByRole('button', {name: copy.endpointDeleteAria}),
    );
    await userEvent.click(
      screen.getByRole('button', {name: copy.endpointDeleteConfirm}),
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', {name: 'Close'}));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      within(row()).getByText(copy.endpointStatusUnverified),
    ).toBeInTheDocument();
  });

  it('disables only the row whose probe is in flight', () => {
    useVerifyMock.mockReturnValue({
      mutate: verifyMutate,
      isPending: true,
      variables: 'e-busy',
    } as unknown as ReturnType<typeof useVerifyLlmEndpoint>);
    renderDialog([
      makeEndpointRead({id: 'e-busy', label: 'Busy'}),
      makeEndpointRead({id: 'e-idle', label: 'Idle'}),
    ]);

    expect(
      within(screen.getByTestId('llm-endpoint-row-e-busy')).getByRole('button', {
        name: copy.endpointVerifyAria,
      }),
    ).toBeDisabled();
    expect(
      within(screen.getByTestId('llm-endpoint-row-e-idle')).getByRole('button', {
        name: copy.endpointVerifyAria,
      }),
    ).toBeEnabled();
  });

  it('renders the stored prompted capability without re-probing', () => {
    renderDialog([
      makeEndpointRead({
        validation_status: 'ok',
        capabilities: {output_mode: 'prompted', models_seen: []},
      }),
    ]);

    expect(screen.getByText(copy.endpointPromptedWarn)).toBeInTheDocument();
    expect(screen.getByText(copy.endpointModePrompted)).toBeInTheDocument();
  });
});

describe('delete', () => {
  it('confirms first, then fires the delete', async () => {
    renderDialog();

    const row = screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);
    await userEvent.click(
      within(row).getByRole('button', {name: copy.endpointDeleteAria}),
    );
    // Destructive actions never fire straight off the icon click.
    expect(deleteMutate).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', {name: copy.endpointDeleteConfirm}),
    );

    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0][0]).toBe(ENDPOINT_ID);
  });

  it('surfaces the typed 409 (the project engine points here)', async () => {
    deleteMutate.mockImplementation(
      (_id: string, opts?: {onError?: (e: Error) => void}) =>
        opts?.onError?.(
          new Error('The project engine runs on this endpoint.'),
        ),
    );
    renderDialog();

    const row = screen.getByTestId(`llm-endpoint-row-${ENDPOINT_ID}`);
    await userEvent.click(
      within(row).getByRole('button', {name: copy.endpointDeleteAria}),
    );
    await userEvent.click(
      screen.getByRole('button', {name: copy.endpointDeleteConfirm}),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The project engine runs on this endpoint.',
    );
  });
});
