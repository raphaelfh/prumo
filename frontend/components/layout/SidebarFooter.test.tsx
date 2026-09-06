import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {TooltipProvider} from '@/components/ui/tooltip';
import {SidebarFooter} from './SidebarFooter';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({signOut: vi.fn().mockResolvedValue(undefined), user: {id: 'u1'}}),
}));
vi.mock('@/hooks/useNavigation', () => ({
  useUserProfile: () => ({user: {name: 'Raphael', email: 'r@x.dev', avatar: '', initials: 'R'}}),
}));
vi.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({submitFeedback: vi.fn(), submitting: false, error: null}),
}));
// FeedbackDialog imports FeedbackService, which reaches the supabase client at
// module load; that client throws without VITE_SUPABASE_URL, which CI has not
// got. Stub the service boundary — the real FeedbackButton/FeedbackDialog still
// render, so the footer's mount behaviour is what is under test.
vi.mock('@/services/feedbackService', () => ({
  FeedbackService: {uploadAttachment: vi.fn()},
}));

function renderFooter() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarFooter />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('SidebarFooter', () => {
  it('puts the bug report next to the user name, not in the topbar', () => {
    renderFooter();
    expect(screen.getByRole('button', {name: /Raphael/i})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /send feedback/i})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /toggle theme/i})).toBeInTheDocument();
  });

  it('opens the feedback dialog, which is not mounted until then', async () => {
    const user = userEvent.setup();
    renderFooter();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: /send feedback/i}));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
