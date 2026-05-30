import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({ submitFeedback: vi.fn().mockResolvedValue(true), submitting: false, error: null }),
}));
vi.mock('@/hooks/useScreenCapture', () => ({
  useScreenCapture: () => ({
    isSupported: true, capturing: false,
    captureStill: vi.fn(), recordClip: vi.fn(),
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }),
    },
  },
}));

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';

describe('FeedbackDialog', () => {
  it('renders capture controls and the Linear-sharing notice', () => {
    render(<FeedbackDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: /attach screenshot/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record clip/i })).toBeInTheDocument();
    expect(screen.getByText(/shared with the Prumo team in Linear/i)).toBeInTheDocument();
  });
});
