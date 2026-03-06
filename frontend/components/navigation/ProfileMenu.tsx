import React from 'react';
import {Folder, LogOut, Settings} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {Button} from '@/components/ui/button';
import {useAuth} from '@/contexts/AuthContext';
import type {UserProfile} from '@/types/navigation';
import {t} from '@/lib/copy';

interface ProfileMenuProps {
  user: UserProfile;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ user }) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
          <Button variant="ghost"
                  className="relative h-9 w-9 rounded-full hover:bg-muted/50 transition-colors duration-75">
          <Avatar className="h-9 w-9">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback>{user.initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
              <p className="text-[13px] font-medium leading-none text-foreground">{user.name}</p>
              <p className="text-[12px] leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/')} className="text-[13px]">
              <Folder className="mr-2 h-4 w-4" strokeWidth={1.5}/>
              <span>{t('layout', 'backToProjects')}</span>
        </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/settings')} className="text-[13px]">
              <Settings className="mr-2 h-4 w-4" strokeWidth={1.5}/>
              <span>{t('layout', 'settings')}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="text-[13px]">
              <LogOut className="mr-2 h-4 w-4" strokeWidth={1.5}/>
              <span>{t('layout', 'signOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
