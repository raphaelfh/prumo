import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {ConfigureTemplateCards} from './ConfigureTemplateCards';

describe('ConfigureTemplateCards', () => {
  it('offers the two ways to get a template and reports each once', async () => {
    const user = userEvent.setup();
    const onCreateTemplate = vi.fn();
    const onImportTemplate = vi.fn();
    render(
      <ConfigureTemplateCards
        onCreateTemplate={onCreateTemplate}
        onImportTemplate={onImportTemplate}
      />,
    );

    await user.click(screen.getByTestId('extraction-open-create'));
    expect(onCreateTemplate).toHaveBeenCalledTimes(1);
    expect(onImportTemplate).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('extraction-open-import'));
    expect(onImportTemplate).toHaveBeenCalledTimes(1);
  });

  it('reaches import without naming a specific template', () => {
    render(<ConfigureTemplateCards onCreateTemplate={vi.fn()} onImportTemplate={vi.fn()} />);

    // The old screen listed the catalogue here, so the only way in was to
    // pick an arbitrary template first. The catalogue now lives solely in
    // the dialog; a per-template entry point must not come back.
    expect(screen.getByTestId('extraction-open-import')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
    expect(screen.queryByText(/CHARMS/i)).not.toBeInTheDocument();
  });
});
