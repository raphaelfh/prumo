/**
 * Sidebar footer user menu: avatar + dropdown with Profile/Settings/Invite/Help/Sign out.
 * Placeholder items show a toast until backed by real flows.
 */
import React from 'react';
import {ChevronDown, HelpCircle, LogOut, Settings, UserPlus, User as UserIcon} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useAuth} from '@/contexts/AuthContext';
import {useUserProfile} from '@/hooks/useNavigation';
import {t} from '@/lib/copy';

interface UserMenuProps {
  collapsed?: boolean;
}

export const UserMenu: React.FC<UserMenuProps> = ({collapsed}) => {
  const {signOut} = useAuth();
  const {user} = useUserProfile();
  const navigate = useNavigate();

  if (!user) return null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const showPlaceholder = (label: string) => toast.info(`${label}: ${t('layout', 'comingSoonTitle').toLowerCase()}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-haspopup="menu"
          className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors duration-75"
        >
          <Avatar className="h-6 w-6 flex-shrink-0 border border-border/40">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="text-[9px] bg-muted">{user.initials}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <span className="text-[13px] truncate flex-1 min-w-0">{user.name}</span>
              <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground/50 flex-shrink-0" strokeWidth={1.5} />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64 p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border/50">
        <DropdownMenuLabel className="font-normal px-2 py-1.5 flex items-center gap-2">
          <Avatar className="h-7 w-7 border border-border/40">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="text-[10px] bg-muted">{user.initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-tight text-foreground truncate">{user.name}</p>
            <p className="text-[12px] leading-tight text-muted-foreground truncate">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border/30" />
        <DropdownMenuItem onClick={() => showPlaceholder(t('layout', 'profile'))} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <UserIcon className="mr-2 h-4 w-4" strokeWidth={1.5} />
          {t('layout', 'profile')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/settings')} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <Settings className="mr-2 h-4 w-4" strokeWidth={1.5} />
          <span className="flex-1">{t('layout', 'settings')}</span>
          <KbdBadge keys={['mod', ',']} />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => showPlaceholder(t('layout', 'inviteMembers'))} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <UserPlus className="mr-2 h-4 w-4" strokeWidth={1.5} />
          {t('layout', 'inviteMembers')}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border/30" />
        <DropdownMenuItem onClick={() => showPlaceholder(t('layout', 'helpAndSupport'))} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <HelpCircle className="mr-2 h-4 w-4" strokeWidth={1.5} />
          {t('layout', 'helpAndSupport')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <LogOut className="mr-2 h-4 w-4" strokeWidth={1.5} />
          <span className="flex-1">{t('layout', 'signOut')}</span>
          <KbdBadge keys={['mod', '⇧', 'Q']} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;
