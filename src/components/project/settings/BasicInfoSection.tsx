/**
 * Seção de Informações Básicas do Projeto
 * Nome, descrição e tipo de revisão
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type ReviewType = 'interventional' | 'predictive_model' | 'diagnostic' | 'prognostic' | 'qualitative' | 'other';

interface Project {
  name: string;
  description: string | null;
  review_type?: ReviewType;
}

interface BasicInfoSectionProps {
  project: Project;
  onChange: (updates: Partial<Project>) => void;
}

const REVIEW_TYPES: Record<ReviewType, { label: string; description: string; badge?: string }> = {
  interventional: {
    label: 'Intervenções',
    description: 'Revisão de efetividade de intervenções (PICO clássico)',
  },
  predictive_model: {
    label: 'Modelos Preditivos',
    description: 'Revisão de modelos preditivos e prognósticos (PICOTS)',
    badge: 'PICOTS'
  },
  diagnostic: {
    label: 'Testes Diagnósticos',
    description: 'Revisão de acurácia de testes diagnósticos',
  },
  prognostic: {
    label: 'Fatores Prognósticos',
    description: 'Revisão de fatores associados a prognóstico',
  },
  qualitative: {
    label: 'Estudos Qualitativos',
    description: 'Síntese de evidências qualitativas',
  },
  other: {
    label: 'Outro',
    description: 'Outros tipos de revisão sistemática',
  },
};

export function BasicInfoSection({ project, onChange }: BasicInfoSectionProps) {
  const currentReviewType = project.review_type || 'interventional';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Informações Básicas</h2>
        <p className="text-sm text-muted-foreground">
          Identifique seu projeto com um nome claro e defina o tipo de revisão.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identificação do Projeto</CardTitle>
          <CardDescription>
            Estas informações ajudam você e sua equipe a identificar o projeto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">
              Nome do Projeto <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={project.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Ex: Revisão Sistemática - Diabetes Tipo 2"
              required
              className="max-w-2xl"
            />
            <p className="text-xs text-muted-foreground">
              Um nome curto e descritivo para identificar seu projeto.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={project.description || ""}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Descreva brevemente os objetivos e escopo desta revisão sistemática..."
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Uma visão geral opcional do que este projeto abrange.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tipo de Revisão */}
      <Card>
        <CardHeader>
          <CardTitle>Tipo de Revisão</CardTitle>
          <CardDescription>
            Selecione o tipo de revisão sistemática para habilitar recursos específicos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="review_type">Tipo de Revisão <span className="text-destructive">*</span></Label>
            <Select
              value={currentReviewType}
              onValueChange={(value: ReviewType) => onChange({ review_type: value })}
            >
              <SelectTrigger id="review_type" className="max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REVIEW_TYPES) as ReviewType[]).map((type) => (
                  <SelectItem key={type} value={type}>
                    <div className="flex items-center gap-2">
                      <span>{REVIEW_TYPES[type].label}</span>
                      {REVIEW_TYPES[type].badge && (
                        <Badge variant="secondary" className="text-xs">
                          {REVIEW_TYPES[type].badge}
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {REVIEW_TYPES[currentReviewType].description}
            </p>
          </div>

          {currentReviewType === 'predictive_model' && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <Badge variant="default">PICOTS</Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium mb-1">Framework PICOTS Habilitado</p>
                  <p className="text-xs text-muted-foreground">
                    A seção de Detalhes da Revisão incluirá o framework PICOTS completo com 
                    critérios de inclusão/exclusão para cada componente (População, Índice, 
                    Comparador, Outcomes, Timing, Setting).
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

