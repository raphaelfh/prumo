import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

const triggerDownload = vi.fn();
vi.mock('@/lib/download', () => ({triggerDownload: (...a: unknown[]) => triggerDownload(...a)}));

import {templateConfig} from '@/lib/copy';
import {AI_TEMPLATE_PROMPT, EXAMPLE_TEMPLATE_JSON} from '@/lib/templateImport/aiPrompt';

import {ImportTemplateJsonGuidance} from './ImportTemplateJsonGuidance';

describe('ImportTemplateJsonGuidance', () => {
  it('copies the AI prompt and confirms it', async () => {
    // userEvent.setup() installs the clipboard stub jsdom does not provide.
    const user = userEvent.setup();
    render(<ImportTemplateJsonGuidance />);

    await user.click(screen.getByTestId('import-template-copy-prompt'));

    await expect(navigator.clipboard.readText()).resolves.toBe(AI_TEMPLATE_PROMPT);
    expect(screen.getByTestId('import-template-copy-prompt')).toHaveTextContent(
      templateConfig.importCopyPromptDone,
    );
  });

  it('downloads the example as a JSON file', async () => {
    const user = userEvent.setup();
    render(<ImportTemplateJsonGuidance />);

    await user.click(screen.getByTestId('import-template-download-example'));

    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob, filename] = triggerDownload.mock.calls[0] as [Blob, string];
    expect(filename).toBe(templateConfig.importExampleFilename);
    expect(blob.type).toBe('application/json');
    await expect(blob.text()).resolves.toBe(EXAMPLE_TEMPLATE_JSON);
  });

  it('keeps the format rules collapsed until asked, then shows all of them', async () => {
    const user = userEvent.setup();
    render(<ImportTemplateJsonGuidance />);

    const firstRule = templateConfig.importGuidanceRules[0];
    expect(screen.queryByText(firstRule)).not.toBeInTheDocument();

    await user.click(screen.getByTestId('import-template-guidance-trigger'));

    for (const rule of templateConfig.importGuidanceRules) {
      expect(screen.getByText(rule)).toBeInTheDocument();
    }
  });
});
