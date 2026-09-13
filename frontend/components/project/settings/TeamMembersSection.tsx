/**
 * Team members section — add, remove, edit permissions.
 */

import {Fragment, useEffect, useState} from 'react';
import {
  findUserIdByEmail,
  getProjectMembers,
  insertProjectMember,
  removeProjectMember,
  updateMemberRole,
  type ProjectMemberRow,
} from '@/services/projectSettingsService';
import {PgError} from '@/lib/error-utils';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {IconButton} from '@/components/patterns/IconButton';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {Check, Edit2, Trash2, X} from 'lucide-react';
import {SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
import {MEMBER_ROLES, type MemberRole} from '@/types/project';
import {t} from '@/lib/copy';

type ProjectMember = ProjectMemberRow;

/** True when a service error is the DB min-one-manager guard (PM001). */
function isLastManagerGuard(error: Error): boolean {
  return error instanceof PgError && error.code === 'PM001';
}

interface TeamMembersSectionProps {
  projectId: string;
}

export function TeamMembersSection({ projectId }: TeamMembersSectionProps) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<MemberRole>('reviewer');
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<MemberRole | null>(null);

  const loadMembers = async () => {
    const result = await getProjectMembers(projectId);
    if (result.ok) {
      setMembers(result.data);
    } else {
      console.error('Error loading members:', result.error);
      toast.error(t('project', 'teamErrorLoadingMembers'));
    }
  };

  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadMembers());
  }, [projectId]);

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;

    setLoading(true);

    const findResult = await findUserIdByEmail(email, projectId);
    if (!findResult.ok) {
      console.error('Error finding user:', findResult.error);
      if (findResult.error instanceof PgError && findResult.error.code === '42501') {
        toast.error(t('project', 'teamErrorOnlyManagersInvite'));
      } else {
        toast.error(t('project', 'teamErrorFindingUser'));
      }
      setLoading(false);
      return;
    }
    if (!findResult.data.userId) {
      toast.error(t('project', 'teamUserNotFound'));
      setLoading(false);
      return;
    }

    const insertResult = await insertProjectMember(projectId, findResult.data.userId, selectedRole);
    setLoading(false);

    if (!insertResult.ok) {
      console.error('Error inviting member:', insertResult.error);
      toast.error(t('project', 'teamErrorAddingMember'));
      return;
    }
    if (insertResult.data.alreadyMember) {
      toast.error(t('project', 'teamUserAlreadyMember'));
      return;
    }
    toast.success(`${t('project', 'teamMemberAddedAs')} ${MEMBER_ROLES[selectedRole].label}!`);
    setInviteEmail('');
    setSelectedRole('reviewer');
    void loadMembers();
  };

  const handleStartEditRole = (memberId: string, currentRole: MemberRole) => {
    setEditingMemberId(memberId);
    setEditingRole(currentRole);
  };

  const handleCancelEditRole = () => {
    setEditingMemberId(null);
    setEditingRole(null);
  };

  const handleSaveRole = async (memberId: string) => {
    if (!editingRole) return;
    const result = await updateMemberRole(memberId, editingRole);
    if (!result.ok) {
      console.error('Error updating role:', result.error);
      // A concurrent edit / stale UI can still demote the last manager and hit
      // the DB guard; surface the dedicated message instead of the generic one.
      toast.error(
        isLastManagerGuard(result.error)
          ? t('project', 'teamLastManagerGuard')
          : t('project', 'teamErrorUpdatingRole'),
      );
      return;
    }
    toast.success(`${t('project', 'teamRoleChangedTo')} ${MEMBER_ROLES[editingRole].label}`);
    setEditingMemberId(null);
    setEditingRole(null);
    void loadMembers();
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm(t('project', 'teamConfirmRemoveMember'))) return;
    const result = await removeProjectMember(memberId);
    if (!result.ok) {
      console.error('Error removing member:', result.error);
      toast.error(
        isLastManagerGuard(result.error)
          ? t('project', 'teamLastManagerGuard')
          : t('project', 'teamErrorRemovingMember'),
      );
      return;
    }
    toast.success(t('project', 'teamMemberRemoved'));
    void loadMembers();
  };

  // A project must keep >= 1 manager; the sole manager's demote/remove
  // affordances are disabled (the DB PM001 guard is the hard backstop).
  const managerCount = members.filter((m) => m.role === 'manager').length;

  const revealClasses =
    'flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';

  return (
    <SettingsPage>
      <SettingsGroup>
        <form onSubmit={handleInviteMember}>
          <SettingsRow
            label={t('project', 'teamCardAddTitle')}
            htmlFor="team-invite-email"
            hint={t('project', 'teamUserMustBeRegistered')}
          >
            {({describedBy}) => (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="team-invite-email"
                  type="email"
                  variant="quiet"
                  placeholder={t('project', 'teamEmailPlaceholder')}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  aria-describedby={describedBy}
                  className="min-w-[200px] flex-1"
                  required
                />
                <Select value={selectedRole} onValueChange={(v: MemberRole) => setSelectedRole(v)}>
                  <SelectTrigger variant="quiet" className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
                      <SelectItem key={role} value={role}>
                        {MEMBER_ROLES[role].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={loading} size="sm">
                  {loading ? t('project', 'teamAdding') : t('project', 'teamAddButton')}
                </Button>
              </div>
            )}
          </SettingsRow>
        </form>
      </SettingsGroup>

      <SettingsGroup title={t('project', 'teamCardMembersTitle')}>
        {members.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('project', 'teamNoMembersYet')}</p>
        ) : (
          <ul className="space-y-0.5">
            {members.map((member) => {
              const isSoleManager = member.role === 'manager' && managerCount === 1;
              return (
                <li
                  key={member.id}
                  className="group flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                      {member.user_avatar_url ? (
                        <img
                          src={member.user_avatar_url}
                          alt={member.user_full_name ?? t('project', 'teamAvatarFallback')}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[12px] font-medium text-primary">
                          {member.user_full_name?.charAt(0)?.toUpperCase() ??
                            member.user_email?.charAt(0)?.toUpperCase() ??
                            '?'}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium leading-tight">
                        {member.user_full_name ?? t('project', 'teamUserFallback')}
                      </p>
                      <p className="truncate text-[12px] text-muted-foreground">{member.user_email}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {editingMemberId === member.id ? (
                      <>
                        <Select value={editingRole ?? member.role} onValueChange={(v: MemberRole) => setEditingRole(v)}>
                          {isSoleManager ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <SelectTrigger variant="quiet" className="w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                              </TooltipTrigger>
                              <TooltipContent>{t('project', 'teamLastManagerGuard')}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <SelectTrigger variant="quiet" className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                          )}
                          <SelectContent>
                            {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
                              <SelectItem key={role} value={role} disabled={isSoleManager && role !== 'manager'}>
                                {MEMBER_ROLES[role].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <IconButton
                          label={t('project', 'teamAriaSaveChange')}
                          className="text-success"
                          onClick={() => handleSaveRole(member.id)}
                          icon={<Check strokeWidth={1.5} />}
                        />
                        <IconButton
                          label={t('project', 'teamAriaCancel')}
                          onClick={handleCancelEditRole}
                          icon={<X strokeWidth={1.5} />}
                        />
                      </>
                    ) : (
                      <>
                        <Badge variant={MEMBER_ROLES[member.role].variant} className="text-[11px]">
                          {MEMBER_ROLES[member.role].label}
                        </Badge>
                        <div className={revealClasses}>
                          <IconButton
                            label={t('project', 'teamAriaEditRole')}
                            onClick={() => handleStartEditRole(member.id, member.role)}
                            icon={<Edit2 strokeWidth={1.5} />}
                          />
                          {isSoleManager ? (
                            <IconButton
                              label={t('project', 'teamAriaRemoveMember')}
                              disabled
                              tooltip={t('project', 'teamLastManagerGuard')}
                              icon={<Trash2 strokeWidth={1.5} />}
                            />
                          ) : (
                            <IconButton
                              label={t('project', 'teamAriaRemoveMember')}
                              onClick={() => handleRemoveMember(member.id)}
                              icon={<Trash2 strokeWidth={1.5} />}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('project', 'teamCardRolesTitle')} hint={t('project', 'teamCardRolesDesc')}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 px-2 text-[13px]">
          {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
            <Fragment key={role}>
              <dt>
                <Badge variant={MEMBER_ROLES[role].variant} className="text-[11px]">
                  {MEMBER_ROLES[role].label}
                </Badge>
              </dt>
              <dd className="text-muted-foreground">{MEMBER_ROLES[role].description}</dd>
            </Fragment>
          ))}
        </dl>
      </SettingsGroup>
    </SettingsPage>
  );
}
