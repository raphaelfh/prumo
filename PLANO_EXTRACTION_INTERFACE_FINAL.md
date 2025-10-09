# 📋 PLANO FINAL: Interface de Extração + Colaboração + IA

**Data**: 2025-10-08  
**Versão**: 2.0 (Atualizado com decisões de UI)  
**Status**: ✅ **APROVADO E PRONTO PARA IMPLEMENTAR**  
**Estimativa**: 10 dias (60 horas)

---

## 🎯 **OBJETIVOS**

Criar interface intuitiva para extração de dados com:

✅ **Header** consistente + salvamento automático + botão voltar  
✅ **PDF Viewer** ao lado (pode ser ocultado)  
✅ **Formulário** intuitivo para adicionar valores por variável  
✅ **Colaboração Híbrida** - Popover + Grid de comparação  
✅ **Sugestões de IA** - Prefill + Badge minimalista  
✅ **Evidências** vinculadas ao PDF  
✅ **Design** minimalista e moderno

---

## 🎨 **DECISÕES DE UI APROVADAS**

### **1. Outras Extrações (Humanas) = Opção D - HÍBRIDA** ⭐

**Modo Default (Extraction)**:
- Badge 👥 ao lado de cada campo
- Click → Popover com lista de outras extrações
- Minimalista, não polui

**Modo Comparação (Toggle)**:
- Botão no toolbar: "Ver Comparação Completa"
- Abre grid/sheet com tabela comparativa
- Desktop only, para resolver divergências

**Visual**:
```
Normal:
Age: [30_____]  👥 3 ← Click mostra popover

Grid (toggle):
┌────────┬──────┬──────┬───────┬─────────┐
│ Campo  │ Você │ João │ Maria │ Consenso│
├────────┼──────┼──────┼───────┼─────────┤
│ Age    │ 30✓  │ 32   │ 30✓   │ 30(2/3) │
└────────┴──────┴──────┴───────┴─────────┘
```

---

### **2. Sugestões de IA = Opção C - PREFILL + BADGE** ⭐

**Implementação**:
- Input prefilled com valor da IA
- Borda roxa/azul quando IA suggestion pending
- Badge ⚡ com confidence score
- Botões inline: ✓ (aceitar) ✗ (rejeitar)
- Tooltip com reasoning on hover

**Visual**:
```
Age: [30__________] ⚡95%  ✓  ✗
     ↑ prefilled    ↑badges
     borda roxa

Hover:
┌─────────────────────────────────┐
│ 💡 Sugestão da IA               │
│ Encontrado: "median age 30..."  │
│ Página 3, seção Methods         │
│ Confiança: 95%                  │
│ ✓ Aceitar • ✗ Rejeitar • Editar│
└─────────────────────────────────┘
```

---

## 🗄️ **ESTRUTURA DE BANCO DE DADOS**

### **Tabelas Existentes** ✅ **JÁ PREPARADAS**

#### **1. extracted_values** (valores extraídos)
```sql
✅ source: 'human' | 'ai' | 'rule' | 'consensus'
✅ confidence_score: numeric (0-1)
✅ reviewer_id: uuid (quem extraiu)
✅ is_consensus: boolean
✅ value: jsonb
✅ evidence: jsonb array
```

#### **2. ai_suggestions** (sugestões pendentes)
```sql
✅ field_id, instance_id: uuid
✅ suggested_value: jsonb
✅ confidence_score: numeric
✅ reasoning: text (justificativa)
✅ status: 'pending' | 'accepted' | 'rejected'
✅ reviewed_by, reviewed_at: tracking
```

#### **3. extraction_runs** (execuções de IA)
```sql
✅ stage: 'data_suggest' | 'parsing' | ...
✅ status: 'pending' | 'running' | 'completed' | 'failed'
✅ parameters, results: jsonb
✅ error_message: text
```

### **Migrações Necessárias** (2)

#### **Migration 1: Adicionar ai_suggestion_id em extracted_values**
```sql
-- Para trackear qual suggestion originou o valor

ALTER TABLE extracted_values
ADD COLUMN IF NOT EXISTS ai_suggestion_id uuid REFERENCES ai_suggestions(id);

CREATE INDEX IF NOT EXISTS idx_extracted_values_ai_suggestion
ON extracted_values(ai_suggestion_id);

COMMENT ON COLUMN extracted_values.ai_suggestion_id IS
'ID da sugestão de IA que originou este valor (se aplicável)';
```

#### **Migration 2: Adicionar índices de performance**
```sql
-- Índices já planejados anteriormente
CREATE INDEX IF NOT EXISTS idx_extracted_values_article 
ON extracted_values(article_id);

CREATE INDEX IF NOT EXISTS idx_extracted_values_reviewer 
ON extracted_values(reviewer_id, article_id);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_instance_field
ON ai_suggestions(instance_id, field_id, status);
```

---

## 🧩 **COMPONENTES ATUALIZADOS**

### **Novos Componentes (15)**

```
src/components/extraction/
├── ExtractionFullScreen.tsx              (principal - 400 linhas)
├── ExtractionHeader.tsx                  (breadcrumb + auto-save)
├── ExtractionToolbar.tsx                 (controles + view toggle)
├── SectionAccordion.tsx                  (accordion de seções)
├── InstanceCard.tsx                      (para cardinality many)
├── FieldInput.tsx                        (input universal)
│
├── colaboracao/
│   ├── OtherExtractionsPopover.tsx       🆕 (popover com lista)
│   ├── OtherExtractionsButton.tsx        🆕 (badge + trigger)
│   ├── ComparisonGridView.tsx            🆕 (grid completo)
│   └── ComparisonDialog.tsx              🆕 (dialog wrapper)
│
├── ai/
│   ├── AISuggestionInput.tsx             🆕 (input com IA)
│   ├── AISuggestionBadge.tsx             🆕 (badge ⚡)
│   ├── AIReasoningTooltip.tsx            🆕 (tooltip detalhes)
│   ├── AIBatchReviewDialog.tsx           🆕 (review em lote)
│   └── AIAcceptRejectButtons.tsx         🆕 (botões ✓ ✗)
│
└── shared/
    ├── EvidenceSelector.tsx              (evidências PDF)
    ├── FieldValidation.tsx               (validação)
    └── CompletionSummary.tsx             (resumo final)
```

---

## 🪝 **HOOKS ATUALIZADOS**

### **Novos Hooks (8)**

```typescript
src/hooks/extraction/
├── useExtractedValues.ts                 (gerencia valores)
├── useExtractionAutoSave.ts              (auto-save debounced)
├── useExtractionProgress.ts              (cálculo progresso)
│
├── colaboracao/
│   ├── useOtherExtractions.ts            🆕 (busca outras)
│   ├── useComparisonView.ts              🆕 (state do grid)
│   └── useConsensusDetection.ts          🆕 (detecta consenso)
│
└── ai/
    ├── useAISuggestions.ts                🆕 (busca sugestões)
    ├── useAIAcceptReject.ts               🆕 (workflow aceitar)
    └── useAIBatchReview.ts                🆕 (review em lote)
```

---

## 📝 **IMPLEMENTAÇÃO DETALHADA**

### **1. FieldInput com IA e Colaboração** (componente central)

```typescript
// src/components/extraction/FieldInput.tsx

interface FieldInputProps {
  field: ExtractionField;
  instanceId: string;
  value: any;
  onChange: (value: any) => void;
  
  // IA features
  aiSuggestion?: AISuggestion;
  onAcceptAI?: () => void;
  onRejectAI?: () => void;
  
  // Colaboração features
  otherExtractions?: OtherExtraction[];
  
  disabled?: boolean;
}

export function FieldInput(props: FieldInputProps) {
  const { field, value, aiSuggestion, otherExtractions } = props;
  
  // Estados
  const [showReasoningTooltip, setShowReasoningTooltip] = useState(false);
  const hasAIPending = aiSuggestion?.status === 'pending';
  const hasOthers = otherExtractions && otherExtractions.length > 0;
  const consensus = useConsensusDetection(value, otherExtractions);
  
  return (
    <div className="space-y-2">
      {/* Label */}
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          {field.label}
          {field.is_required && (
            <Badge variant="destructive" className="text-xs">
              Obrigatório
            </Badge>
          )}
        </Label>
        
        <div className="flex items-center gap-2">
          {/* Evidências */}
          <EvidenceButton fieldId={field.id} count={evidenceCount} />
          
          {/* Badge de outras extrações */}
          {hasOthers && (
            <OtherExtractionsPopover
              extractions={otherExtractions}
              myValue={value}
              onViewComparison={() => openComparisonGrid(field.id)}
            >
              <OtherExtractionsButton count={otherExtractions.length} />
            </OtherExtractionsPopover>
          )}
          
          {/* Consenso indicator */}
          {consensus.hasConsensus && (
            <Badge variant="secondary" className="gap-1">
              <Check className="h-3 w-3" />
              Consenso {consensus.count}/{consensus.total}
            </Badge>
          )}
          
          {consensus.hasDivergence && (
            <Badge variant="outline" className="gap-1 text-orange-600">
              <AlertTriangle className="h-3 w-3" />
              Divergência
            </Badge>
          )}
        </div>
      </div>
      
      {/* Input com IA */}
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => props.onChange(e.target.value)}
          className={cn(
            // Borda roxa se IA pending
            hasAIPending && 
            "border-purple-500 bg-purple-50 dark:bg-purple-950/10 pr-32",
            // Borda verde se consenso
            consensus.hasConsensus &&
            "border-green-500 bg-green-50 dark:bg-green-950/10"
          )}
          placeholder={field.label}
          disabled={props.disabled}
        />
        
        {/* IA Badge + Buttons (inline no input) */}
        {hasAIPending && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <Tooltip open={showReasoningTooltip} onOpenChange={setShowReasoningTooltip}>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="gap-1 cursor-pointer bg-purple-100 dark:bg-purple-900/20"
                >
                  <Sparkles className="h-3 w-3 text-purple-600" />
                  {Math.round(aiSuggestion.confidence * 100)}%
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm">
                <AIReasoningTooltip suggestion={aiSuggestion} />
              </TooltipContent>
            </Tooltip>
            
            <AIAcceptRejectButtons
              onAccept={props.onAcceptAI}
              onReject={props.onRejectAI}
            />
          </div>
        )}
      </div>
      
      {/* Description */}
      {field.description && (
        <p className="text-xs text-muted-foreground">
          {field.description}
        </p>
      )}
      
      {/* Validation errors */}
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}
```

---

### **2. OtherExtractionsPopover** (colaboração)

```typescript
// src/components/extraction/colaboracao/OtherExtractionsPopover.tsx

interface OtherExtraction {
  userId: string;
  userName: string;
  userAvatar?: string;
  value: any;
  timestamp: Date;
  confidence?: number;
}

interface Props {
  extractions: OtherExtraction[];
  myValue: any;
  onViewComparison: () => void;
  children: React.ReactNode;
}

export function OtherExtractionsPopover(props: Props) {
  const { extractions, myValue } = props;
  
  // Agrupar por valor para detectar consenso
  const grouped = groupBy(extractions, 'value');
  const mostCommon = maxBy(Object.entries(grouped), ([, items]) => items.length);
  const consensusValue = mostCommon?.[0];
  const consensusCount = mostCommon?.[1].length;
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        {props.children}
      </PopoverTrigger>
      
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Outras Extrações ({extractions.length})
            </h4>
          </div>
          
          <Separator />
          
          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-3">
              {extractions.map((ext) => {
                const matchesMe = ext.value === myValue;
                const isConsensus = ext.value === consensusValue;
                
                return (
                  <div
                    key={ext.userId}
                    className={cn(
                      "p-3 rounded-lg border",
                      matchesMe && "bg-green-50 dark:bg-green-950/20 border-green-200",
                      isConsensus && "bg-blue-50 dark:bg-blue-950/20"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={ext.userAvatar} />
                        <AvatarFallback>
                          {ext.userName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{ext.userName}</p>
                          {matchesMe && (
                            <Badge variant="secondary" className="text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              Igual
                            </Badge>
                          )}
                        </div>
                        
                        <p className="text-sm font-mono mt-1">
                          {formatValue(ext.value)}
                        </p>
                        
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(ext.timestamp, {
                            locale: ptBR,
                            addSuffix: true
                          })}
                        </p>
                        
                        {ext.confidence && (
                          <Badge variant="outline" className="text-xs mt-1">
                            Confiança: {Math.round(ext.confidence * 100)}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          
          {/* Consenso summary */}
          {consensusValue && consensusCount > 1 && (
            <>
              <Separator />
              <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  <span className="font-medium">Consenso:</span>
                  <span className="font-mono">{formatValue(consensusValue)}</span>
                  <Badge variant="secondary">
                    {consensusCount}/{extractions.length + 1}
                  </Badge>
                </div>
              </div>
            </>
          )}
          
          <Separator />
          
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={props.onViewComparison}
          >
            <Table className="mr-2 h-4 w-4" />
            Ver Comparação Completa
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

---

### **3. ComparisonGridView** (modo comparação)

```typescript
// src/components/extraction/colaboracao/ComparisonGridView.tsx

interface Props {
  fields: ExtractionField[];
  myExtractions: Record<string, any>;
  otherExtractions: {
    userId: string;
    userName: string;
    values: Record<string, any>;
  }[];
  aiSuggestions?: Record<string, AISuggestion>;
}

export function ComparisonGridView(props: Props) {
  const { fields, myExtractions, otherExtractions, aiSuggestions } = props;
  
  return (
    <div className="border rounded-lg overflow-hidden">
      <ScrollArea className="h-[600px]">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[200px]">Campo</TableHead>
              <TableHead className="w-[150px] bg-blue-50 dark:bg-blue-950/20">
                Você
              </TableHead>
              {aiSuggestions && (
                <TableHead className="w-[150px] bg-purple-50 dark:bg-purple-950/20">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    IA
                  </div>
                </TableHead>
              )}
              {otherExtractions.map(user => (
                <TableHead key={user.userId} className="w-[150px]">
                  {user.userName}
                </TableHead>
              ))}
              <TableHead className="w-[120px]">Consenso</TableHead>
            </TableRow>
          </TableHeader>
          
          <TableBody>
            {fields.map(field => {
              const myValue = myExtractions[field.id];
              const aiValue = aiSuggestions?.[field.id];
              const allValues = [
                myValue,
                ...otherExtractions.map(u => u.values[field.id])
              ];
              const consensus = detectConsensus(allValues);
              
              return (
                <TableRow key={field.id}>
                  <TableCell className="font-medium">
                    {field.label}
                    {field.is_required && (
                      <Badge variant="destructive" className="ml-2 text-xs">
                        Obrigatório
                      </Badge>
                    )}
                  </TableCell>
                  
                  <TableCell className="bg-blue-50/50 dark:bg-blue-950/10">
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{formatValue(myValue)}</span>
                      {consensus.value === myValue && consensus.count > 1 && (
                        <Check className="h-4 w-4 text-green-600" />
                      )}
                    </div>
                  </TableCell>
                  
                  {aiSuggestions && (
                    <TableCell className="bg-purple-50/50 dark:bg-purple-950/10">
                      {aiValue && (
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{formatValue(aiValue.value)}</span>
                          <Badge variant="outline" className="text-xs">
                            {Math.round(aiValue.confidence * 100)}%
                          </Badge>
                        </div>
                      )}
                    </TableCell>
                  )}
                  
                  {otherExtractions.map(user => {
                    const userValue = user.values[field.id];
                    const matches = userValue === myValue;
                    
                    return (
                      <TableCell
                        key={user.userId}
                        className={cn(
                          matches && "bg-green-50 dark:bg-green-950/20"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{formatValue(userValue)}</span>
                          {matches && (
                            <Check className="h-4 w-4 text-green-600" />
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                  
                  <TableCell>
                    {consensus.count > 1 ? (
                      <Badge variant="secondary" className="gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {formatValue(consensus.value)}
                        <span className="text-xs ml-1">
                          ({consensus.count}/{allValues.length})
                        </span>
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-orange-600">
                        <AlertTriangle className="h-3 w-3" />
                        Sem consenso
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
```

---

### **4. AIAcceptRejectButtons** (botões inline)

```typescript
// src/components/extraction/ai/AIAcceptRejectButtons.tsx

interface Props {
  onAccept?: () => void;
  onReject?: () => void;
  size?: 'sm' | 'default';
  loading?: boolean;
}

export function AIAcceptRejectButtons(props: Props) {
  const { size = 'default', loading } = props;
  
  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            onClick={props.onAccept}
            disabled={loading}
            className={cn(
              "text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20",
              size === 'sm' ? "h-6 w-6" : "h-7 w-7"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Aceitar sugestão da IA</p>
        </TooltipContent>
      </Tooltip>
      
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            onClick={props.onReject}
            disabled={loading}
            className={cn(
              "text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20",
              size === 'sm' ? "h-6 w-6" : "h-7 w-7"
            )}
          >
            <X className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Rejeitar sugestão</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
```

---

### **5. useAISuggestions Hook**

```typescript
// src/hooks/extraction/ai/useAISuggestions.ts

interface UseAISuggestionsProps {
  articleId: string;
  templateId: string;
  enabled?: boolean;
}

interface UseAISuggestionsReturn {
  suggestions: Record<string, AISuggestion>; // key: `${instanceId}_${fieldId}`
  loading: boolean;
  acceptSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  rejectSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  batchAccept: (keys: string[], threshold?: number) => Promise<void>;
}

export function useAISuggestions(props: UseAISuggestionsProps): UseAISuggestionsReturn {
  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion>>({});
  const [loading, setLoading] = useState(false);
  
  // Load AI suggestions
  useEffect(() => {
    if (!props.enabled) return;
    loadSuggestions();
  }, [props.articleId, props.templateId, props.enabled]);
  
  const loadSuggestions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select(`
          *,
          field:field_id(id, name, label, field_type),
          instance:instance_id(id, label)
        `)
        .eq('status', 'pending')
        .in('instance_id', (
          // Subquery: instances deste artigo
          supabase
            .from('extraction_instances')
            .select('id')
            .eq('article_id', props.articleId)
        ));
      
      if (error) throw error;
      
      // Mapear para formato { instanceId_fieldId: suggestion }
      const suggestionsMap: Record<string, AISuggestion> = {};
      data?.forEach(item => {
        const key = `${item.instance_id}_${item.field_id}`;
        suggestionsMap[key] = {
          id: item.id,
          value: item.suggested_value,
          confidence: item.confidence_score || 0,
          reasoning: item.reasoning || '',
          status: item.status,
          timestamp: new Date(item.created_at)
        };
      });
      
      setSuggestions(suggestionsMap);
      console.log('✅ Loaded AI suggestions:', Object.keys(suggestionsMap).length);
      
    } catch (err: any) {
      console.error('Erro ao carregar sugestões:', err);
      toast.error('Erro ao carregar sugestões da IA');
    } finally {
      setLoading(false);
    }
  };
  
  const acceptSuggestion = async (instanceId: string, fieldId: string) => {
    const key = `${instanceId}_${fieldId}`;
    const suggestion = suggestions[key];
    if (!suggestion) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      // 1. Criar extracted_value com source='ai'
      const { error: insertError } = await supabase
        .from('extracted_values')
        .upsert({
          project_id: props.projectId,
          article_id: props.articleId,
          instance_id: instanceId,
          field_id: fieldId,
          value: suggestion.value,
          source: 'ai',
          confidence_score: suggestion.confidence,
          reviewer_id: user.id,
          is_consensus: false,
          ai_suggestion_id: suggestion.id
        });
      
      if (insertError) throw insertError;
      
      // 2. Atualizar status da suggestion para 'accepted'
      const { error: updateError } = await supabase
        .from('ai_suggestions')
        .update({
          status: 'accepted',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', suggestion.id);
      
      if (updateError) throw updateError;
      
      // 3. Remover do estado local
      setSuggestions(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      
      toast.success('Sugestão aceita com sucesso');
      
    } catch (err: any) {
      console.error('Erro ao aceitar sugestão:', err);
      toast.error('Erro ao aceitar sugestão');
    }
  };
  
  const rejectSuggestion = async (instanceId: string, fieldId: string) => {
    const key = `${instanceId}_${fieldId}`;
    const suggestion = suggestions[key];
    if (!suggestion) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      // Atualizar status para 'rejected'
      const { error } = await supabase
        .from('ai_suggestions')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', suggestion.id);
      
      if (error) throw error;
      
      // Remover do estado local
      setSuggestions(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      
      toast.success('Sugestão rejeitada');
      
    } catch (err: any) {
      console.error('Erro ao rejeitar sugestão:', err);
      toast.error('Erro ao rejeitar sugestão');
    }
  };
  
  const batchAccept = async (keys: string[], threshold = 0.8) => {
    try {
      const filtered = keys.filter(key => {
        const suggestion = suggestions[key];
        return suggestion && suggestion.confidence >= threshold;
      });
      
      await Promise.all(
        filtered.map(key => {
          const [instanceId, fieldId] = key.split('_');
          return acceptSuggestion(instanceId, fieldId);
        })
      );
      
      toast.success(`${filtered.length} sugestões aceitas em lote`);
      
    } catch (err: any) {
      console.error('Erro no batch accept:', err);
      toast.error('Erro ao aceitar sugestões em lote');
    }
  };
  
  return {
    suggestions,
    loading,
    acceptSuggestion,
    rejectSuggestion,
    batchAccept
  };
}
```

---

## ⏱️ **CRONOGRAMA ATUALIZADO**

### **FASE 1: Fundação** 🔴 **CRÍTICO** (3 dias - 18h)

**Componentes Base**:
- [x] ExtractionFullScreen.tsx (4h)
- [x] ExtractionHeader.tsx (2h)
- [x] ExtractionToolbar.tsx (2h)
- [x] SectionAccordion.tsx (4h)
- [x] FieldInput.tsx base (4h)
- [x] useExtractedValues.ts (2h)

**Entregável**: Interface básica funcionando

---

### **FASE 2: Auto-Save + Instâncias** 🔴 **CRÍTICO** (2 dias - 12h)

**Features**:
- [x] useExtractionAutoSave.ts (3h)
- [x] InstanceCard.tsx (3h)
- [x] Cardinality many support (3h)
- [x] useExtractionProgress.ts (1h)
- [x] ExtractionFooter.tsx (1h)
- [x] Testes integração (1h)

**Entregável**: Auto-save + múltiplas instâncias

---

### **FASE 3: Colaboração (Híbrida)** 🟡 **IMPORTANTE** (2 dias - 12h)

**Modo Popover** (Dia 1 - 6h):
- [ ] OtherExtractionsButton.tsx (1h)
- [ ] OtherExtractionsPopover.tsx (2h)
- [ ] useOtherExtractions.ts (2h)
- [ ] useConsensusDetection.ts (1h)

**Modo Grid** (Dia 2 - 6h):
- [ ] ComparisonGridView.tsx (3h)
- [ ] ComparisonDialog.tsx (1h)
- [ ] useComparisonView.ts (1h)
- [ ] Toggle no toolbar (1h)

**Entregável**: Colaboração completa (Popover + Grid)

---

### **FASE 4: Sugestões de IA** 🟡 **IMPORTANTE** (2 dias - 12h)

**Componentes IA** (Dia 1 - 6h):
- [ ] AISuggestionInput.tsx (2h)
- [ ] AISuggestionBadge.tsx (1h)
- [ ] AIReasoningTooltip.tsx (1h)
- [ ] AIAcceptRejectButtons.tsx (1h)
- [ ] useAISuggestions.ts (1h)

**Batch Review** (Dia 2 - 6h):
- [ ] AIBatchReviewDialog.tsx (3h)
- [ ] useAIBatchReview.ts (2h)
- [ ] Integração toolbar (1h)

**Entregável**: IA ready com prefill + badge

---

### **FASE 5: Evidências + Polish** 🟢 **DESEJÁVEL** (2 dias - 12h)

**Evidências** (Dia 1 - 6h):
- [ ] EvidenceSelector.tsx (4h)
- [ ] Link evidências ↔ PDF (2h)

**Polish** (Dia 2 - 6h):
- [ ] FieldValidation.tsx (2h)
- [ ] CompletionSummary.tsx (2h)
- [ ] Animations e transitions (1h)
- [ ] Keyboard shortcuts (1h)

**Entregável**: Sistema completo e polido

---

### **RESUMO CRONOGRAMA**

| Fase | Prioridade | Dias | Horas | Features |
|------|-----------|------|-------|----------|
| 1. Fundação | 🔴 CRÍTICO | 3 | 18h | Interface base |
| 2. Auto-Save | 🔴 CRÍTICO | 2 | 12h | Salvamento automático |
| 3. Colaboração | 🟡 IMPORTANTE | 2 | 12h | Popover + Grid híbrido |
| 4. IA | 🟡 IMPORTANTE | 2 | 12h | Prefill + Badge + Batch |
| 5. Polish | 🟢 DESEJÁVEL | 2 | 12h | Evidências + refinamentos |
| **TOTAL** | | **11 dias** | **66h** | Sistema completo |

---

## 🎯 **OPÇÕES DE IMPLEMENTAÇÃO**

### **Opção A: MVP Rápido** ⭐ **RECOMENDADO**
```
Implementar: Fase 1 + Fase 2
Tempo: 5 dias (30h)
Resultado: Interface funcional para extração básica
```

### **Opção B: Com Colaboração**
```
Implementar: Fase 1 + 2 + 3
Tempo: 7 dias (42h)
Resultado: + Comparação multi-usuário
```

### **Opção C: Completo com IA** ⭐⭐
```
Implementar: Fase 1 + 2 + 3 + 4
Tempo: 9 dias (54h)
Resultado: Production-ready com IA
```

### **Opção D: Tudo**
```
Implementar: Todas as fases
Tempo: 11 dias (66h)
Resultado: Sistema 100% completo
```

---

## ✅ **ESTRUTURA DE DB VALIDADA**

### **Tabelas Existentes** ✅

```
extracted_values: PRONTO
├─ source, confidence_score ✓
├─ reviewer_id, is_consensus ✓
└─ ADICIONAR: ai_suggestion_id (migration)

ai_suggestions: PRONTO
├─ suggested_value, confidence ✓
├─ reasoning, status ✓
└─ reviewed_by, reviewed_at ✓

extraction_runs: PRONTO
└─ Para batch AI processing ✓
```

### **Novas Migrations** (2)
1. ✅ Adicionar `ai_suggestion_id` em `extracted_values`
2. ✅ Adicionar índices de performance

---

## 📊 **ESTRUTURA DE ARQUIVOS FINAL**

```
src/
├── pages/
│   └── ExtractionFullScreen.tsx              (400 linhas)
│
├── components/extraction/
│   ├── ExtractionHeader.tsx                  (150 linhas)
│   ├── ExtractionToolbar.tsx                 (120 linhas)
│   ├── SectionAccordion.tsx                  (250 linhas)
│   ├── InstanceCard.tsx                      (200 linhas)
│   ├── FieldInput.tsx                        (350 linhas) ⬆️ expandido
│   ├── ExtractionFooter.tsx                  (80 linhas)
│   │
│   ├── colaboracao/
│   │   ├── OtherExtractionsButton.tsx        (80 linhas) 🆕
│   │   ├── OtherExtractionsPopover.tsx       (250 linhas) 🆕
│   │   ├── ComparisonGridView.tsx            (350 linhas) 🆕
│   │   └── ComparisonDialog.tsx              (150 linhas) 🆕
│   │
│   ├── ai/
│   │   ├── AISuggestionInput.tsx             (200 linhas) 🆕
│   │   ├── AISuggestionBadge.tsx             (80 linhas) 🆕
│   │   ├── AIReasoningTooltip.tsx            (120 linhas) 🆕
│   │   ├── AIAcceptRejectButtons.tsx         (100 linhas) 🆕
│   │   └── AIBatchReviewDialog.tsx           (300 linhas) 🆕
│   │
│   └── shared/
│       ├── EvidenceSelector.tsx              (150 linhas)
│       ├── FieldValidation.tsx               (100 linhas)
│       └── CompletionSummary.tsx             (150 linhas)
│
├── hooks/extraction/
│   ├── useExtractedValues.ts                 (200 linhas)
│   ├── useExtractionAutoSave.ts              (150 linhas)
│   ├── useExtractionProgress.ts              (100 linhas)
│   │
│   ├── colaboracao/
│   │   ├── useOtherExtractions.ts            (180 linhas) 🆕
│   │   ├── useComparisonView.ts              (120 linhas) 🆕
│   │   └── useConsensusDetection.ts          (100 linhas) 🆕
│   │
│   └── ai/
│       ├── useAISuggestions.ts               (250 linhas) 🆕
│       ├── useAIAcceptReject.ts              (150 linhas) 🆕
│       └── useAIBatchReview.ts               (180 linhas) 🆕
│
└── supabase/migrations/
    ├── add_ai_suggestion_id.sql              🆕
    └── add_extraction_performance_indexes.sql 🆕

Total: ~4.800 linhas de código
```

---

## 🎉 **RESULTADO ESPERADO**

### **Interface Minimalista e Elegante**:
```
┌─────────────────────────────────────────────┐
│ Age: [30_________] ⚡95% ✓ ✗  👥3         │
│      ↑ IA prefill  ↑AI   ↑popover         │
│      borda roxa                            │
│                                            │
│ Sample: [100______] ⚡89% ✓ ✗  👥2 ✅     │
│         ↑ IA       ↑     ↑consenso        │
│                                            │
│ Follow-up: [6 months____]    👥3 ⚠️      │
│            ↑ manual          ↑divergência │
└─────────────────────────────────────────────┘
```

### **Features Completas**:
✅ Extração manual intuitiva  
✅ Auto-save automático (3s debounce)  
✅ **Colaboração híbrida**: Popover minimalista + Grid completo  
✅ **Sugestões de IA**: Prefill elegante + Badge + Aceitar/Rejeitar  
✅ Detecção de consenso  
✅ Highlight de divergências  
✅ Evidências vinculadas ao PDF  
✅ Progress tracking  
✅ Validações inline  
✅ Mobile + Desktop responsive  

---

## 🚀 **PRÓXIMOS PASSOS**

1. ✅ **Plano atualizado** (FEITO!)
2. ⏭️ **Aplicar migrations SQL** (2 novas)
3. ⏭️ **Escolher opção** (A, B, C ou D)
4. ⏭️ **Começar Fase 1** (Fundação)
5. ⏭️ **Implementar incrementalmente**

---

**Preparado por**: AI Assistant  
**Versão**: 2.0 Final  
**Status**: ✅ **APROVADO E PRONTO PARA IMPLEMENTAR**

🎊 **PLANO COMPLETO COM COLABORAÇÃO HÍBRIDA + IA READY!** 🎊
