import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HighQualityParsingToggle } from '@/components/project/settings/HighQualityParsingToggle';

vi.mock('@/services/parserSettingsService', () => ({
  setParserType: vi.fn().mockResolvedValue({ type: 'llamaparse' }),
}));

describe('HighQualityParsingToggle', () => {
  it('disables the switch when no llama_cloud key is configured', () => {
    render(
      <HighQualityParsingToggle
        projectId="p1"
        currentType="standard"
        hasLlamaCloudKey={false}
        disabled={false}
      />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('enables the switch when a key is present and the user is a manager', () => {
    render(
      <HighQualityParsingToggle
        projectId="p1"
        currentType="standard"
        hasLlamaCloudKey={true}
        disabled={false}
      />,
    );
    expect(screen.getByRole('switch')).not.toBeDisabled();
  });
});
