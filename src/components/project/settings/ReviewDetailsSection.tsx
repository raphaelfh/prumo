/**
 * Seção de Detalhes da Revisão
 * PICOTS com critérios de inclusão/exclusão, estratégia de busca, justificativa e contexto
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PICOTSItemEditor } from "./PICOTSItemEditor";

interface PICOTSItem {
  description?: string;
  inclusion?: string[];
  exclusion?: string[];
}

interface PICOTSTiming {
  prediction_moment?: PICOTSItem;
  prediction_horizon?: PICOTSItem;
}

type ReviewType = 'interventional' | 'predictive_model' | 'diagnostic' | 'prognostic' | 'qualitative' | 'other';

interface Project {
  review_title: string | null;
  condition_studied: string | null;
  review_rationale: string | null;
  search_strategy: string | null;
  review_context: string | null;
  review_type?: ReviewType | null;
  picots_config_ai_review: {
    population?: PICOTSItem;
    index_models?: PICOTSItem;
    comparator_models?: PICOTSItem;
    outcomes?: PICOTSItem;
    timing?: PICOTSTiming;
    setting_and_intended_use?: PICOTSItem;
  } | null;
}

interface ReviewDetailsSectionProps {
  project: Project;
  onChange: (updates: Partial<Project>) => void;
}

export function ReviewDetailsSection({ project, onChange }: ReviewDetailsSectionProps) {
  const picots = project.picots_config_ai_review || {};
  const isPredictiveModel = project.review_type === 'predictive_model';

  // Helper para atualizar campos do PICOTS
  const updatePICOTSField = (
    mainField: string,
    subField: string,
    value: any
  ) => {
    const newPicots = { ...picots };
    
    if (mainField.includes('.')) {
      // Para timing que é nested
      const [parent, child] = mainField.split('.');
      newPicots[parent as keyof typeof picots] = {
        ...(newPicots[parent as keyof typeof picots] as any),
        [child]: {
          ...(((newPicots[parent as keyof typeof picots] as any)?.[child]) || {}),
          [subField]: value
        }
      };
    } else {
      // Para campos normais (population, index_models, etc)
      newPicots[mainField as keyof typeof picots] = {
        ...(newPicots[mainField as keyof typeof picots] as PICOTSItem),
        [subField]: value
      };
    }
    
    onChange({ picots_config_ai_review: newPicots });
  };

  // Helper para adicionar item a array (inclusion/exclusion)
  const addArrayItem = (mainField: string, arrayField: 'inclusion' | 'exclusion', value: string) => {
    if (!value.trim()) return;
    
    const current = picots[mainField as keyof typeof picots] as PICOTSItem || {};
    const currentArray = current[arrayField] || [];
    
    updatePICOTSField(mainField, arrayField, [...currentArray, value.trim()]);
  };

  // Helper para remover item de array
  const removeArrayItem = (mainField: string, arrayField: 'inclusion' | 'exclusion', index: number) => {
    const current = picots[mainField as keyof typeof picots] as PICOTSItem || {};
    const currentArray = current[arrayField] || [];
    
    updatePICOTSField(mainField, arrayField, currentArray.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Detalhes da Revisão</h2>
        <p className="text-sm text-muted-foreground">
          Configure os aspectos metodológicos da sua revisão sistemática.
        </p>
      </div>

      {/* Informações Gerais da Revisão */}
      <Card>
        <CardHeader>
          <CardTitle>Informações Gerais</CardTitle>
          <CardDescription>
            Título, condição estudada e justificativa da revisão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="review_title">Título da Revisão</Label>
            <Input
              id="review_title"
              value={project.review_title || ""}
              onChange={(e) => onChange({ review_title: e.target.value })}
              placeholder="Título completo e formal da revisão sistemática"
            />
            <p className="text-xs text-muted-foreground">
              O título oficial que aparecerá em publicações e relatórios.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="condition_studied">Condição Estudada</Label>
            <Input
              id="condition_studied"
              value={project.condition_studied || ""}
              onChange={(e) => onChange({ condition_studied: e.target.value })}
              placeholder="Ex: Diabetes tipo 2, Câncer de mama, Hipertensão"
            />
            <p className="text-xs text-muted-foreground">
              A condição de saúde ou fenômeno clínico sendo investigado.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="review_context">Contexto da Revisão</Label>
            <Textarea
              id="review_context"
              value={project.review_context || ""}
              onChange={(e) => onChange({ review_context: e.target.value })}
              placeholder="Descreva o contexto clínico, epidemiológico ou social relevante..."
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Informações sobre o cenário e relevância da condição estudada.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="review_rationale">Justificativa da Revisão</Label>
            <Textarea
              id="review_rationale"
              value={project.review_rationale || ""}
              onChange={(e) => onChange({ review_rationale: e.target.value })}
              placeholder="Por que esta revisão é necessária? Qual lacuna do conhecimento ela pretende preencher?"
              rows={5}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Explique a importância e necessidade desta revisão sistemática.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Estratégia de Busca */}
      <Card>
        <CardHeader>
          <CardTitle>Estratégia de Busca</CardTitle>
          <CardDescription>
            Bases de dados, termos de busca e período de coleta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="search_strategy">Descrição da Estratégia</Label>
          <Textarea
            id="search_strategy"
            value={project.search_strategy || ""}
            onChange={(e) => onChange({ search_strategy: e.target.value })}
            placeholder="Exemplo:&#10;&#10;Bases de dados: PubMed, Scopus, Web of Science&#10;Período: Janeiro 2010 - Dezembro 2023&#10;&#10;Termos de busca:&#10;(diabetes OR &quot;metabolic syndrome&quot;) AND (treatment OR therapy) AND (effectiveness OR efficacy)"
            rows={8}
            className="font-mono text-sm resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Documente suas bases de dados, termos de busca e filtros aplicados.
          </p>
        </CardContent>
      </Card>

      {/* PICOTS para AI Review - Só aparece para modelos preditivos */}
      {isPredictiveModel && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Configuração PICOTS</CardTitle>
              <Badge variant="secondary">Modelos Preditivos</Badge>
            </div>
            <CardDescription>
              Framework PICOTS para modelos preditivos - defina critérios de inclusão e exclusão para cada componente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
            {/* Population */}
            <AccordionItem value="population">
              <AccordionTrigger className="text-base font-semibold">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">P</Badge>
                  População
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <PICOTSItemEditor
                  label="População"
                  fieldKey="population"
                  data={(picots.population as PICOTSItem) || {}}
                  infoTooltip="Defina as características demográficas e clínicas da população alvo. Considere idade, condições de saúde, setting de cuidado e estágio da doença."
                  descriptionPlaceholder="Descreva a população alvo, características demográficas e clínicas relevantes..."
                  onUpdate={updatePICOTSField}
                  onAddItem={addArrayItem}
                  onRemoveItem={removeArrayItem}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Index Models */}
            <AccordionItem value="index_models">
              <AccordionTrigger className="text-base font-semibold">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">I</Badge>
                  Modelos/Intervenções Índice
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <PICOTSItemEditor
                  label="Modelos Índice"
                  fieldKey="index_models"
                  data={(picots.index_models as PICOTSItem) || {}}
                  infoTooltip="Especifique os tipos de modelos preditivos, algoritmos ou ferramentas diagnósticas que serão incluídos. Considere a técnica estatística, tipo de algoritmo e complexidade do modelo."
                  descriptionPlaceholder="Modelos preditivos, algoritmos de IA, ferramentas de diagnóstico ou intervenções sendo avaliados..."
                  onUpdate={updatePICOTSField}
                  onAddItem={addArrayItem}
                  onRemoveItem={removeArrayItem}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Comparator */}
            <AccordionItem value="comparator_models">
              <AccordionTrigger className="text-base font-semibold">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">C</Badge>
                  Comparadores
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <PICOTSItemEditor
                  label="Comparadores"
                  fieldKey="comparator_models"
                  data={(picots.comparator_models as PICOTSItem) || {}}
                  infoTooltip="Defina quais modelos de referência, escores clínicos tradicionais ou padrões-ouro serão aceitos como comparadores válidos para avaliar a performance relativa."
                  descriptionPlaceholder="Modelos de referência, padrão-ouro, cuidado usual ou controles usados para comparação..."
                  onUpdate={updatePICOTSField}
                  onAddItem={addArrayItem}
                  onRemoveItem={removeArrayItem}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Outcomes */}
            <AccordionItem value="outcomes">
              <AccordionTrigger className="text-base font-semibold">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">O</Badge>
                  Desfechos
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <PICOTSItemEditor
                  label="Desfechos"
                  fieldKey="outcomes"
                  data={(picots.outcomes as PICOTSItem) || {}}
                  infoTooltip="Liste os desfechos de interesse, incluindo métricas de performance do modelo (acurácia, discriminação, calibração) e desfechos clínicos relevantes quando disponíveis."
                  descriptionPlaceholder="Desfechos primários e secundários de interesse (performance do modelo, impacto clínico, etc)..."
                  onUpdate={updatePICOTSField}
                  onAddItem={addArrayItem}
                  onRemoveItem={removeArrayItem}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Timing - Nested structure */}
            <AccordionItem value="timing">
              <AccordionTrigger className="text-base font-semibold">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">T</Badge>
                  Tempo (Timing)
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-6">
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold">Momento da Predição</h4>
                  <PICOTSItemEditor
                    label="Momento da Predição"
                    fieldKey="timing.prediction_moment"
                    data={(picots.timing?.prediction_moment as PICOTSItem) || {}}
                    infoTooltip="Especifique em que momento do curso da doença ou cuidado a predição é realizada. Considere o contexto clínico e o objetivo da predição (ex: ao diagnóstico, na admissão hospitalar, durante o seguimento)."
                    descriptionPlaceholder="Descreva em que momento do curso da doença/tratamento a predição ocorre..."
                    onUpdate={updatePICOTSField}
                    onAddItem={addArrayItem}
                    onRemoveItem={removeArrayItem}
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <h4 className="text-sm font-semibold">Horizonte de Predição</h4>
                  <PICOTSItemEditor
                    label="Horizonte de Predição"
                    fieldKey="timing.prediction_horizon"
                    data={(picots.timing?.prediction_horizon as PICOTSItem) || {}}
                    infoTooltip="Defina o período futuro que está sendo predito. Considere a relevância clínica do horizonte temporal para a tomada de decisão (ex: 30 dias, 1 ano, 5 anos)."
                    descriptionPlaceholder="Descreva o horizonte temporal da predição (ex: mortalidade em 1 ano, recorrência em 5 anos)..."
                    onUpdate={updatePICOTSField}
                    onAddItem={addArrayItem}
                    onRemoveItem={removeArrayItem}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Setting */}
            <AccordionItem value="setting">
              <AccordionTrigger className="text-base font-semibold">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">S</Badge>
                  Contexto e Uso Pretendido
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <PICOTSItemEditor
                  label="Contexto e Uso Pretendido"
                  fieldKey="setting_and_intended_use"
                  data={(picots.setting_and_intended_use as PICOTSItem) || {}}
                  infoTooltip="Descreva onde e como o modelo será usado na prática clínica. Considere o setting de cuidado (atenção primária, especializada, UTI), recursos disponíveis e objetivo da aplicação do modelo."
                  descriptionPlaceholder="Descreva o setting clínico, contexto de aplicação e uso pretendido do modelo..."
                  onUpdate={updatePICOTSField}
                  onAddItem={addArrayItem}
                  onRemoveItem={removeArrayItem}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
      )}
    </div>
  );
}

