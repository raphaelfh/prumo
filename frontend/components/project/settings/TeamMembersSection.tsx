/**
 * Team members section — add, remove, edit permissions.
 */

import {useEffect, useState} from 'react';
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
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {Separator} from '@/components/ui/separator';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Check, Edit2, Mail, Shield, Trash2, UserPlus, Users as UsersIcon, X} from 'lucide-react';
import {SettingsSection, SettingsCard} from '@/components/settings';
import {MEMBER_ROLES, type MemberRole} from '@/types/project';
import {t} from '@/lib/copy';

type ProjectMember = ProjectMemberRow;

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
      toast.error(t('project', 'teamErrorUpdatingRole'));
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
      toast.error(t('project', 'teamErrorRemovingMember'));
      return;
    }
    toast.success(t('project', 'teamMemberRemoved'));
    void loadMembers();
  };

  return (
      <SettingsSection
          title={t('project', 'teamSectionTitle')}
          description={t('project', 'teamSectionDesc')}
      >
          <SettingsCard
              title={t('project', 'teamCardAddTitle')}
              description={t('project', 'teamCardAddDesc')}
              icon={UserPlus}
          >
              <form onSubmit={handleInviteMember} className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                      <div className="flex-1 min-w-[200px] relative">
                          <Mail
                              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                              strokeWidth={1.5}
                          />
                          <Input
                              type="email"
                              placeholder={t('project', 'teamEmailPlaceholder')}
                              value={inviteEmail}
                              onChange={(e) => setInviteEmail(e.target.value)}
                              className="pl-8 h-9 text-[13px]"
                              required
                          />
                      </div>
                      <Select value={selectedRole} onValueChange={(v: MemberRole) => setSelectedRole(v)}>
                          <SelectTrigger className="w-[140px] h-9 text-[13px]">
                              <SelectValue/>
                          </SelectTrigger>
                          <SelectContent>
                              {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
                                  <SelectItem key={role} value={role}>
                                      {MEMBER_ROLES[role].label}
                                  </SelectItem>
                              ))}
                          </SelectContent>
                      </Select>
                      <Button type="submit" disabled={loading} size="sm" className="text-[13px] h-9">
                          {loading ? t('project', 'teamAdding') : t('project', 'teamAddButton')}
                      </Button>
                  </div>
                  <p className="text-[12px] text-muted-foreground/70">
                      {MEMBER_ROLES[selectedRole].description}
                  </p>
                  <p className="text-[12px] text-muted-foreground/70">
                      {t('project', 'teamUserMustBeRegistered')}
          </p>
              </form>
          </SettingsCard>

          <SettingsCard
              title={t('project', 'teamCardMembersTitle')}
              description={t('project', 'teamCardMembersDesc')}
              icon={UsersIcon}
          >
              {members.length === 0 ? (
                  <Alert className="py-3">
                      <Shield className="h-4 w-4" strokeWidth={1.5}/>
                      <AlertDescription className="text-[13px]">
                          {t('project', 'teamNoMembersYet')}
                      </AlertDescription>
                  </Alert>
              ) : (
                  <div className="space-y-0">
                      {members.map((member, index) => (
                          <div key={member.id}>
                              {index > 0 && <Separator className="my-2"/>}
                              <div className="flex items-center justify-between py-1.5">
                                  <div className="flex items-center gap-3 min-w-0">
                                      <div
                                          className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                                          {member.user_avatar_url ? (
                                              <img
                                                  src={member.user_avatar_url}
                                                  alt={member.user_full_name ?? t('project', 'teamAvatarFallback')}
                                                  className="h-full w-full object-cover"
                                              />
                                          ) : (
                                              <span className="text-[13px] font-medium text-primary">
                          {member.user_full_name?.charAt(0)?.toUpperCase() ??
                              member.user_email?.charAt(0)?.toUpperCase() ??
                              '?'}
                        </span>
                                          )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                          <p className="text-[13px] font-medium leading-none truncate">
                                              {member.user_full_name ?? t('project', 'teamUserFallback')}
                                          </p>
                                          <p className="text-[12px] text-muted-foreground truncate">
                                              {member.user_email}
                                          </p>
                                      </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                      {editingMemberId === member.id ? (
                                          <>
                                              <Select
                                                  value={editingRole ?? member.role}
                                                  onValueChange={(v: MemberRole) => setEditingRole(v)}
                                              >
                                                  <SelectTrigger className="w-[120px] h-8 text-[13px]">
                                                      <SelectValue/>
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                      {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
                                                          <SelectItem key={role} value={role}>
                                                              {MEMBER_ROLES[role].label}
                                                          </SelectItem>
                                                      ))}
                                                  </SelectContent>
                                              </Select>
                                              <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-8 w-8"
                                                  onClick={() => handleSaveRole(member.id)}
                                                  aria-label={t('project', 'teamAriaSaveChange')}
                                              >
                                                  <Check className="h-4 w-4 text-success" strokeWidth={1.5}/>
                                              </Button>
                                              <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-8 w-8"
                                                  onClick={handleCancelEditRole}
                                                  aria-label={t('project', 'teamAriaCancel')}
                                              >
                                                  <X className="h-4 w-4 text-muted-foreground" strokeWidth={1.5}/>
                                              </Button>
                                          </>
                                      ) : (
                                          <>
                                              <Badge variant={MEMBER_ROLES[member.role].variant}
                                                     className="text-[11px]">
                                                  {MEMBER_ROLES[member.role].label}
                                              </Badge>
                                              <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-8 w-8 hover:bg-muted/50"
                                                  onClick={() => handleStartEditRole(member.id, member.role)}
                                                  aria-label={t('project', 'teamAriaEditRole')}
                                              >
                                                  <Edit2 className="h-4 w-4" strokeWidth={1.5}/>
                                              </Button>
                                              <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-8 w-8 hover:bg-muted/50"
                                                  onClick={() => handleRemoveMember(member.id)}
                                                  aria-label={t('project', 'teamAriaRemoveMember')}
                                              >
                                                  <Trash2 className="h-4 w-4" strokeWidth={1.5}/>
                                              </Button>
                                          </>
                                      )}
                                  </div>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
          </SettingsCard>

          <SettingsCard
              title={t('project', 'teamCardRolesTitle')}
              description={t('project', 'teamCardRolesDesc')}
          >
              <div className="space-y-2">
          {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
              <div key={role} className="flex items-start gap-2">
                  <Badge variant={MEMBER_ROLES[role].variant} className="text-[11px] mt-0.5">
                {MEMBER_ROLES[role].label}
              </Badge>
                  <p className="text-[12px] text-muted-foreground/70 flex-1">
                {MEMBER_ROLES[role].description}
              </p>
            </div>
          ))}
              </div>
          </SettingsCard>
      </SettingsSection>
  );
}
