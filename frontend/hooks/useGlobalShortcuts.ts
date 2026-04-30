/**
 * App-wide shortcuts that work on any page: ⌘, (settings), ⌘⇧Q (sign out).
 * ⌘Q is intercepted by browsers on macOS, so we use ⌘⇧Q.
 */
import {useNavigate} from 'react-router-dom';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';
import {useAuth} from '@/contexts/AuthContext';

export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const {signOut} = useAuth();

  const bindings: Binding[] = [
    {type: 'chord', key: ',', mod: true, handler: () => navigate('/settings'), allowInInputs: true},
    {
      type: 'chord',
      key: 'q',
      mod: true,
      shift: true,
      handler: () => {
        void (async () => {
          await signOut();
          navigate('/auth');
        })();
      },
      allowInInputs: true,
    },
  ];

  useKeyboardShortcuts({bindings, enabled: true});
}
