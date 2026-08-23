// frontend/components/extraction/template-config/TemplateExportButton.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

const statusState = {data: {has_pending_changes: false}};
vi.mock('@/hooks/extraction/useTemplateConfigStatus', () => ({useTemplateConfigStatus: () => statusState}));
// The REAL service runs (filename + unwrap are what we test); only the api
// client is stubbed.
const apiClient = vi.fn();
vi.mock('@/integrations/api/client', () => ({
  apiClient: (...a: unknown[]) => apiClient(...a),
  ApiError: class ApiError extends Error {},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), info: vi.fn()}}));

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
