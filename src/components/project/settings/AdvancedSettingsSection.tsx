/**
 * Seção de Configurações Avançadas
 * Blind mode, critérios de elegibilidade, design do estudo
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";

interface Project {
  settings: {
    blind_mode?: boolean;
  } | null;
  eligibility_criteria: {
    inclusion?: string[];
    exclusion?: string[];
    notes?: string;
  } | null;
  study_design: {
    types?: string[];
    notes?: string;
  } | null;
  review_keywords: string[];
}

interface AdvancedSettingsSectionProps {
  project: Project;
  onChange: (updates: Partial<Project>) => void;
}

export function AdvancedSettingsSection({ project, onChange }: AdvancedSettingsSectionProps) {
  const [newKeyword, setNewKeyword] = useState("");
  const [newInclusion, setNewInclusion] = useState("");
  const [newExclusion, setNewExclusion] = useState("");
  const [newStudyType, setNewStudyType] = useState("");

  const settings = project.settings || { blind_mode: false };
  const eligibility = project.eligibility_criteria || { inclusion: [], exclusion: [] };
  const studyDesign = project.study_design || { types: [] };
  const keywords = project.review_keywords || [];

  const handleBlindModeToggle = (checked: boolean) => {
    onChange({
      settings: { ...settings, blind_mode: checked }
    });
  };

  const handleAddKeyword = () => {
    if (newKeyword.trim()) {
      onChange({
        review_keywords: [...keywords, newKeyword.trim()]
      });
      setNewKeyword("");
    }
  };

  const handleRemoveKeyword = (index: number) => {
    onChange({
      review_keywords: keywords.filter((_, i) => i !== index)
    });
  };

  const handleAddInclusion = () => {
    if (newInclusion.trim()) {
      onChange({
        eligibility_criteria: {
          ...eligibility,
          inclusion: [...(eligibility.inclusion || []), newInclusion.trim()]
        }
      });
      setNewInclusion("");
    }
  };

  const handleRemoveInclusion = (index: number) => {
    onChange({
      eligibility_criteria: {
        ...eligibility,
        inclusion: (eligibility.inclusion || []).filter((_, i) => i !== index)
      }
    });
  };

  const handleAddExclusion = () => {
    if (newExclusion.trim()) {
      onChange({
        eligibility_criteria: {
          ...eligibility,
          exclusion: [...(eligibility.exclusion || []), newExclusion.trim()]
        }
      });
      setNewExclusion("");
    }
  };

  const handleRemoveExclusion = (index: number) => {
    onChange({
      eligibility_criteria: {
        ...eligibility,
        exclusion: (eligibility.exclusion || []).filter((_, i) => i !== index)
      }
    });
  };

  const handleAddStudyType = () => {
    if (newStudyType.trim()) {
      onChange({
        study_design: {
          ...studyDesign,
          types: [...(studyDesign.types || []), newStudyType.trim()]
        }
      });
      setNewStudyType("");
    }
  };

  const handleRemoveStudyType = (index: number) => {
    onChange({
      study_design: {
        ...studyDesign,
        types: (studyDesign.types || []).filter((_, i) => i !== index)
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Configurações Avançadas</h2>
        <p className="text-sm text-muted-foreground">
          Defina critérios de elegibilidade, palavras-chave e configurações adicionais.
        </p>
      </div>

      {/* Modo Cego */}
      <Card>
        <CardHeader>
          <CardTitle>Modo de Avaliação Cega</CardTitle>
          <CardDescription>
            Ocultar informações dos autores durante a avaliação para reduzir viés.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="blind-mode" className="text-base">
                Habilitar Modo Cego
              </Label>
              <p className="text-sm text-muted-foreground">
                Quando ativado, nomes de autores e afiliações serão ocultados durante a avaliação.
              </p>
            </div>
            <Switch
              id="blind-mode"
              checked={settings.blind_mode || false}
              onCheckedChange={handleBlindModeToggle}
            />
          </div>
        </CardContent>
      </Card>

      {/* Palavras-chave */}
      <Card>
        <CardHeader>
          <CardTitle>Palavras-chave da Revisão</CardTitle>
          <CardDescription>
            Termos-chave que descrevem o escopo da revisão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Digite uma palavra-chave..."
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddKeyword())}
            />
            <Button onClick={handleAddKeyword} variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              Adicionar
            </Button>
          </div>

          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {keywords.map((keyword, index) => (
                <Badge key={index} variant="secondary" className="pl-3 pr-1.5 py-1">
                  {keyword}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 ml-1.5"
                    onClick={() => handleRemoveKeyword(index)}
                    aria-label="Remover palavra-chave"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Critérios de Elegibilidade */}
      <Card>
        <CardHeader>
          <CardTitle>Critérios de Elegibilidade</CardTitle>
          <CardDescription>
            Defina critérios de inclusão e exclusão para os estudos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Critérios de Inclusão */}
          <div className="space-y-3">
            <Label className="text-base">Critérios de Inclusão</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: Estudos com adultos acima de 18 anos"
                value={newInclusion}
                onChange={(e) => setNewInclusion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddInclusion())}
              />
              <Button onClick={handleAddInclusion} variant="outline" size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            
            {(eligibility.inclusion || []).length > 0 && (
              <ul className="space-y-2">
                {(eligibility.inclusion || []).map((criterion, index) => (
                  <li key={index} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                    <span className="text-sm flex-1">{criterion}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => handleRemoveInclusion(index)}
                      aria-label="Remover critério"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          {/* Critérios de Exclusão */}
          <div className="space-y-3">
            <Label className="text-base">Critérios de Exclusão</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: Estudos pré-clínicos ou in vitro"
                value={newExclusion}
                onChange={(e) => setNewExclusion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddExclusion())}
              />
              <Button onClick={handleAddExclusion} variant="outline" size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            
            {(eligibility.exclusion || []).length > 0 && (
              <ul className="space-y-2">
                {(eligibility.exclusion || []).map((criterion, index) => (
                  <li key={index} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                    <span className="text-sm flex-1">{criterion}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => handleRemoveExclusion(index)}
                      aria-label="Remover critério"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          {/* Notas sobre Elegibilidade */}
          <div className="space-y-2">
            <Label htmlFor="eligibility_notes">Notas Adicionais</Label>
            <Textarea
              id="eligibility_notes"
              value={eligibility.notes || ""}
              onChange={(e) => onChange({
                eligibility_criteria: { ...eligibility, notes: e.target.value }
              })}
              placeholder="Observações ou esclarecimentos sobre os critérios de elegibilidade..."
              rows={3}
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Design dos Estudos */}
      <Card>
        <CardHeader>
          <CardTitle>Tipos de Estudo Incluídos</CardTitle>
          <CardDescription>
            Especifique os designs de estudo aceitos nesta revisão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Ex: Ensaio Clínico Randomizado, Coorte"
              value={newStudyType}
              onChange={(e) => setNewStudyType(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddStudyType())}
            />
            <Button onClick={handleAddStudyType} variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              Adicionar
            </Button>
          </div>

          {(studyDesign.types || []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(studyDesign.types || []).map((type, index) => (
                <Badge key={index} variant="outline" className="pl-3 pr-1.5 py-1">
                  {type}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 ml-1.5"
                    onClick={() => handleRemoveStudyType(index)}
                    aria-label="Remover tipo de estudo"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Label htmlFor="study_design_notes">Notas sobre Design</Label>
            <Textarea
              id="study_design_notes"
              value={studyDesign.notes || ""}
              onChange={(e) => onChange({
                study_design: { ...studyDesign, notes: e.target.value }
              })}
              placeholder="Observações sobre os tipos de estudo aceitos..."
              rows={3}
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

