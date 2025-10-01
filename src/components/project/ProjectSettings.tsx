import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Mail, Trash2, UserPlus } from "lucide-react";

interface Project {
  id: string;
  name: string;
  description: string | null;
  review_title: string | null;
  condition_studied: string | null;
  review_rationale: string | null;
  search_strategy: string | null;
}

interface ProjectMember {
  id: string;
  user_id: string;
  role: string;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

interface ProjectSettingsProps {
  projectId: string;
}

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => {
    loadProject();
    loadMembers();
  }, [projectId]);

  const loadProject = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;
      setProject(data);
    } catch (error: any) {
      console.error("Error loading project:", error);
      toast.error("Erro ao carregar projeto");
    }
  };

  const loadMembers = async () => {
    try {
      const { data, error } = await supabase
        .from("project_members")
        .select("id, user_id, role, profiles!project_members_user_id_fkey(full_name, email)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setMembers(data as ProjectMember[] || []);
    } catch (error: any) {
      console.error("Error loading members:", error);
    }
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          name: project.name,
          description: project.description,
          review_title: project.review_title,
          condition_studied: project.condition_studied,
          review_rationale: project.review_rationale,
          search_strategy: project.search_strategy,
        })
        .eq("id", projectId);

      if (error) throw error;
      toast.success("Projeto atualizado com sucesso!");
    } catch (error: any) {
      console.error("Error updating project:", error);
      toast.error("Erro ao atualizar projeto");
    } finally {
      setLoading(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setLoading(true);
    try {
      // Check if user exists
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", inviteEmail.trim())
        .single();

      if (!profileData) {
        toast.error("Usuário não encontrado");
        return;
      }

      // Add member
      const { error } = await supabase.from("project_members").insert([{
        project_id: projectId,
        user_id: profileData.id,
        role: "reviewer",
      }]);

      if (error) {
        if (error.code === "23505") {
          toast.error("Usuário já é membro do projeto");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Membro adicionado com sucesso!");
      setInviteEmail("");
      loadMembers();
    } catch (error: any) {
      console.error("Error inviting member:", error);
      toast.error("Erro ao adicionar membro");
    } finally {
      setLoading(false);
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

  if (!project) return null;

  return (
    <div className="space-y-6">
      {/* Project Information */}
      <Card>
        <CardHeader>
          <CardTitle>Informações do Projeto</CardTitle>
          <CardDescription>
            Configure as informações básicas da sua revisão sistemática
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateProject} className="space-y-4">
            <div>
              <Label htmlFor="name">Nome do Projeto *</Label>
              <Input
                id="name"
                value={project.name}
                onChange={(e) => setProject({ ...project, name: e.target.value })}
                required
              />
            </div>

            <div>
              <Label htmlFor="review_title">Título da Revisão</Label>
              <Input
                id="review_title"
                value={project.review_title || ""}
                onChange={(e) => setProject({ ...project, review_title: e.target.value })}
                placeholder="Título completo da revisão sistemática"
              />
            </div>

            <div>
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={project.description || ""}
                onChange={(e) => setProject({ ...project, description: e.target.value })}
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="condition_studied">Condição Estudada</Label>
              <Input
                id="condition_studied"
                value={project.condition_studied || ""}
                onChange={(e) => setProject({ ...project, condition_studied: e.target.value })}
                placeholder="Ex: Diabetes tipo 2, Câncer de mama"
              />
            </div>

            <div>
              <Label htmlFor="review_rationale">Justificativa da Revisão</Label>
              <Textarea
                id="review_rationale"
                value={project.review_rationale || ""}
                onChange={(e) => setProject({ ...project, review_rationale: e.target.value })}
                rows={4}
                placeholder="Por que esta revisão é necessária?"
              />
            </div>

            <div>
              <Label htmlFor="search_strategy">Estratégia de Busca</Label>
              <Textarea
                id="search_strategy"
                value={project.search_strategy || ""}
                onChange={(e) => setProject({ ...project, search_strategy: e.target.value })}
                rows={6}
                placeholder="Descreva as bases de dados e termos de busca utilizados"
              />
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Team Members */}
      <Card>
        <CardHeader>
          <CardTitle>Membros da Equipe</CardTitle>
          <CardDescription>
            Gerencie os membros que têm acesso a este projeto
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Invite Form */}
          <form onSubmit={handleInviteMember} className="flex gap-2">
            <Input
              type="email"
              placeholder="Email do membro"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={loading}>
              <UserPlus className="mr-2 h-4 w-4" />
              Adicionar
            </Button>
          </form>

          <Separator />

          {/* Members List */}
          <div className="space-y-3">
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum membro ainda
              </p>
            ) : (
              members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-medium text-primary">
                        {member.profiles?.full_name?.charAt(0) || member.profiles?.email?.charAt(0) || "?"}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {member.profiles?.full_name || "Usuário"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.profiles?.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Badge variant={member.role === "lead" ? "default" : "secondary"}>
                      {member.role}
                    </Badge>
                    {member.role !== "lead" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveMember(member.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}