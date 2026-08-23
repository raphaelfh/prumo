// frontend/components/extraction/template-config/TemplateExportButton.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

const statusState = {data: {has_pending_changes: false}};
vi.mock('@/hooks/extraction/useTemplateConfigStatus', () => ({useTemplateConfigStatus: () => statusState}));
// The REAL service runs (filename + unwrap are what we test); only the api
// client is stubbed.
const {apiClient, ApiError, toast} = vi.hoisted(() => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public traceId?: string,
      public details?: Record<string, unknown>,
    ) {
      super(message);
    }
  },
  toast: {success: vi.fn(), error: vi.fn(), info: vi.fn()},
}));
vi.mock('@/integrations/api/client', () => ({
  apiClient: (...a: unknown[]) => apiClient(...a),
  ApiError,
}));
vi.mock('sonner', () => ({toast}));

import {TemplateExportButton} from './TemplateExportButton';

const DOC = {prumo_template: 1, kind: 'extraction', name: 'My CHARMS', sections: [{name: 'sec', label: 'S'}]};

function renderButton() {
  render(
    <TooltipProvider>
      <TemplateExportButton projectId="p" templateId="t" />
    </TooltipProvider>,
  );
}

describe('TemplateExportButton', () => {
  let captured: {blob: Blob; filename: string} | null;
  beforeEach(() => {
    captured = null;
    apiClient.mockReset();
    statusState.data = {has_pending_changes: false};
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured = {
        blob: (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob,
        filename: this.download,
      };
    });
  });

  it('downloads the UNWRAPPED document under the slug filename', async () => {
    apiClient.mockResolvedValueOnce(DOC);
    renderButton();
    fireEvent.click(screen.getByTestId('template-config-export'));
    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.filename).toBe('my-charms.prumo-template.json');
    const parsed = JSON.parse(await captured!.blob.text());
    expect(parsed).toEqual(DOC);
    expect(parsed).not.toHaveProperty('data');
    expect(parsed).not.toHaveProperty('ok');
  });

  it('a server refusal toasts and downloads nothing', async () => {
    apiClient.mockRejectedValueOnce(
      new ApiError('TEMPLATE_EXPORT_INVALID', 'This template cannot be exported', 422, undefined, {
        errors: [{path: 'sections[3].fields[0].allowed_values', message: 'too short'}],
        error_count: 1,
      }),
    );
    renderButton();
    fireEvent.click(screen.getByTestId('template-config-export'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain('This template cannot be exported');
    expect(captured).toBeNull();
  });

  it('confirms first when a draft is pending', async () => {
    statusState.data = {has_pending_changes: true};
    apiClient.mockResolvedValueOnce(DOC);
    renderButton();
    fireEvent.click(screen.getByTestId('template-config-export'));
    expect(apiClient).not.toHaveBeenCalled();
    expect(await screen.findByText('This file includes unpublished changes.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('template-config-export-confirm'));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/api/v1/projects/p/templates/t/export', {method: 'GET'}),
    );
  });
});
