/**
 * Componente Editor de Item PICOTS
 * Permite editar descrição, critérios de inclusão e exclusão
 * Info é apenas um tooltip explicativo (não editável)
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, X, HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PICOTSItemData {
  description?: string;
  inclusion?: string[];
  exclusion?: string[];
}

interface PICOTSItemEditorProps {
  label: string;
  fieldKey: string;
  data: PICOTSItemData;
  infoTooltip: string;  // Texto fixo do tooltip (não editável)
  descriptionPlaceholder: string;
  onUpdate: (field: string, subField: string, value: any) => void;
  onAddItem: (field: string, arrayField: 'inclusion' | 'exclusion', value: string) => void;
  onRemoveItem: (field: string, arrayField: 'inclusion' | 'exclusion', index: number) => void;
}

export function PICOTSItemEditor({
  label,
  fieldKey,
  data,
  infoTooltip,
  descriptionPlaceholder,
  onUpdate,
  onAddItem,
  onRemoveItem
}: PICOTSItemEditorProps) {
  const [newInclusion, setNewInclusion] = useState("");
  const [newExclusion, setNewExclusion] = useState("");

  const handleAddInclusion = () => {
    if (newInclusion.trim()) {
      onAddItem(fieldKey, 'inclusion', newInclusion);
      setNewInclusion("");
    }
  };

  const handleAddExclusion = () => {
    if (newExclusion.trim()) {
      onAddItem(fieldKey, 'exclusion', newExclusion);
      setNewExclusion("");
    }
  };

  return (
    <div className="space-y-4">
      {/* Descrição/Conteúdo com Tooltip de Ajuda */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${fieldKey}_description`}>
            {label}
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-full"
                  type="button"
                >
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="text-sm">{infoTooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Textarea
          id={`${fieldKey}_description`}
          value={data.description || ""}
          onChange={(e) => onUpdate(fieldKey, 'description', e.target.value)}
          placeholder={descriptionPlaceholder}
          rows={3}
          className="resize-none"
        />
      </div>

      <Separator />

      {/* Critérios de Inclusão */}
      <div className="space-y-3">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
            Critérios de Inclusão
          </Badge>
        </Label>
        
        <div className="flex gap-2">
          <Input
            placeholder="Adicionar critério de inclusão..."
            value={newInclusion}
            onChange={(e) => setNewInclusion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddInclusion())}
            className="text-sm"
          />
          <Button onClick={handleAddInclusion} variant="outline" size="sm">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {(data.inclusion || []).length > 0 && (
          <ul className="space-y-2">
            {(data.inclusion || []).map((criterion, index) => (
              <li 
                key={index} 
                className="flex items-start gap-2 p-2 rounded-md bg-green-500/5 border border-green-500/20"
              >
                <span className="text-sm flex-1 text-muted-foreground">{criterion}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => onRemoveItem(fieldKey, 'inclusion', index)}
                  aria-label="Remover critério de inclusão"
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Critérios de Exclusão */}
      <div className="space-y-3">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">
            Critérios de Exclusão
          </Badge>
        </Label>
        
        <div className="flex gap-2">
          <Input
            placeholder="Adicionar critério de exclusão..."
            value={newExclusion}
            onChange={(e) => setNewExclusion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddExclusion())}
            className="text-sm"
          />
          <Button onClick={handleAddExclusion} variant="outline" size="sm">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {(data.exclusion || []).length > 0 && (
          <ul className="space-y-2">
            {(data.exclusion || []).map((criterion, index) => (
              <li 
                key={index} 
                className="flex items-start gap-2 p-2 rounded-md bg-red-500/5 border border-red-500/20"
              >
                <span className="text-sm flex-1 text-muted-foreground">{criterion}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => onRemoveItem(fieldKey, 'exclusion', index)}
                  aria-label="Remover critério de exclusão"
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

