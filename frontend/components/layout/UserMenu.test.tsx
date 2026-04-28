import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {UserMenu} from './UserMenu';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({signOut: vi.fn().mockResolvedValue(undefined)}),
}));
vi.mock('@/hooks/useNavigation', () => ({
  useUserProfile: () => ({user: {name: 'Raphael', email: 'r@x.dev', avatar: '', initials: 'R'}}),
}));

describe('UserMenu', () => {
  it('renders user name and opens menu with Profile/Settings/Sign out', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', {name: /Raphael/i}));
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Invite members')).toBeInTheDocument();
    expect(screen.getByText('Help & support')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });
});
