/**
 * Seção de Gestão de Membros da Equipe
 * Adicionar, remover e editar permissões/roles
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Trash2, Mail, Shield, Users as UsersIcon, Edit2, Check, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type MemberRole = 'manager' | 'reviewer' | 'viewer' | 'consensus';

interface ProjectMember {
  id: string;
  user_id: string;
  role: MemberRole;
  user_email: string | null;
  user_full_name: string | null;
  user_avatar_url: string | null;
}

interface TeamMembersSectionProps {
  projectId: string;
}

const MEMBER_ROLES: Record<MemberRole, { label: string; description: string; variant: any }> = {
  manager: {
    label: 'Gerente',
    description: 'Gerencia configurações, membros e tem acesso completo',
    variant: 'default'
  },
  reviewer: {
    label: 'Revisor',
    description: 'Avalia artigos e participa da revisão',
    variant: 'secondary'
  },
  viewer: {
    label: 'Visualizador',
    description: 'Apenas visualização, sem permissão de edição',
    variant: 'outline'
  },
  consensus: {
    label: 'Consenso',
    description: 'Resolve conflitos entre revisores',
    variant: 'secondary'
  }
};

export function TeamMembersSection({ projectId }: TeamMembersSectionProps) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState<MemberRole>('reviewer');
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<MemberRole | null>(null);

  useEffect(() => {
    loadMembers();
  }, [projectId]);

  const loadMembers = async () => {
    try {
      // Usa RPC para buscar membros com dados do perfil
      // (necessário porque RLS restringe leitura de profiles de outros usuários)
      const { data, error } = await supabase
        .rpc('get_project_members', { p_project_id: projectId });

      if (error) throw error;
      setMembers((data as ProjectMember[]) || []);
    } catch (error: unknown) {
      console.error("Error loading members:", error);
      toast.error("Erro ao carregar membros");
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;

    setLoading(true);
    try {
      // Buscar ID do usuário por email usando função RPC segura
      // (necessário porque RLS restringe leitura de profiles de outros usuários)
      const { data: userId, error: rpcError } = await supabase
        .rpc('find_user_id_by_email', { search_email: email });

      if (rpcError) {
        console.error("Error finding user:", rpcError);
        toast.error("Erro ao buscar usuário");
        return;
      }

      if (!userId) {
        toast.error("Usuário não encontrado com este email");
        return;
      }

      // Adicionar membro com role selecionado
      const { error } = await supabase.from("project_members").insert([{
        project_id: projectId,
        user_id: userId,
        role: selectedRole,
      }]);

      if (error) {
        if (error.code === "23505") {
          toast.error("Usuário já é membro do projeto");
        } else {
          throw error;
        }
        return;
      }

      toast.success(`Membro adicionado como ${MEMBER_ROLES[selectedRole].label}!`);
      setInviteEmail("");
      setSelectedRole('reviewer');
      loadMembers();
    } catch (error: unknown) {
      console.error("Error inviting member:", error);
      toast.error("Erro ao adicionar membro");
    } finally {
      setLoading(false);
    }
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

    try {
      const { error } = await supabase
        .from("project_members")
        .update({ role: editingRole })
        .eq("id", memberId);

      if (error) throw error;

      toast.success(`Papel alterado para ${MEMBER_ROLES[editingRole].label}`);
      setEditingMemberId(null);
      setEditingRole(null);
      loadMembers();
    } catch (error: any) {
      console.error("Error updating role:", error);
      toast.error("Erro ao alterar papel do membro");
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("Tem certeza que deseja remover este membro?")) return;

    try {
      const { error } = await supabase
        .from("project_members")
        .delete()
        .eq("id", memberId);

      if (error) throw error;
      toast.success("Membro removido");
      loadMembers();
    } catch (error: any) {
      console.error("Error removing member:", error);
      toast.error("Erro ao remover membro");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Gestão da Equipe</h2>
        <p className="text-sm text-muted-foreground">
          Adicione colaboradores e gerencie permissões de acesso ao projeto.
        </p>
      </div>

      {/* Adicionar Membro */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Adicionar Membro
          </CardTitle>
          <CardDescription>
            Convide um usuário existente para participar deste projeto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleInviteMember} className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="email@exemplo.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
              <Select value={selectedRole} onValueChange={(value: MemberRole) => setSelectedRole(value)}>
                <SelectTrigger className="w-[160px]">
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
              <Button type="submit" disabled={loading}>
                {loading ? "Adicionando..." : "Adicionar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {MEMBER_ROLES[selectedRole].description}
            </p>
          </form>
          <p className="text-xs text-muted-foreground">
            O usuário deve estar cadastrado na plataforma antes de ser adicionado.
          </p>
        </CardContent>
      </Card>

      {/* Lista de Membros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="h-5 w-5" />
            Membros Atuais
            <Badge variant="secondary" className="ml-2">
              {members.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            Todos os membros com acesso a este projeto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>
                Nenhum membro adicionado ainda. Use o formulário acima para convidar colaboradores.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {members.map((member, index) => (
                <div key={member.id}>
                  {index > 0 && <Separator className="my-3" />}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {/* Avatar */}
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {member.user_avatar_url ? (
                          <img
                            src={member.user_avatar_url}
                            alt={member.user_full_name || "Avatar"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-base font-semibold text-primary">
                            {member.user_full_name?.charAt(0)?.toUpperCase() ||
                             member.user_email?.charAt(0)?.toUpperCase() || "?"}
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-none mb-1">
                          {member.user_full_name || "Usuário"}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {member.user_email}
                        </p>
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {editingMemberId === member.id ? (
                        // Modo de edição de role
                        <>
                          <Select 
                            value={editingRole || member.role} 
                            onValueChange={(value: MemberRole) => setEditingRole(value)}
                          >
                            <SelectTrigger className="w-[130px] h-8">
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
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleSaveRole(member.id)}
                            aria-label="Salvar alteração"
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={handleCancelEditRole}
                            aria-label="Cancelar"
                          >
                            <X className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </>
                      ) : (
                        // Modo de visualização
                        <>
                          <Badge variant={MEMBER_ROLES[member.role].variant}>
                            {MEMBER_ROLES[member.role].label}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleStartEditRole(member.id, member.role)}
                            aria-label="Editar papel"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleRemoveMember(member.id)}
                            aria-label="Remover membro"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Informações sobre Papéis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Papéis e Permissões</CardTitle>
          <CardDescription>
            Cada papel tem diferentes níveis de acesso ao projeto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
            <div key={role} className="flex items-start gap-3">
              <Badge variant={MEMBER_ROLES[role].variant} className="mt-0.5">
                {MEMBER_ROLES[role].label}
              </Badge>
              <p className="text-sm text-muted-foreground flex-1">
                {MEMBER_ROLES[role].description}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

