# 🎨 OPÇÕES DE UI: Colaboração + IA

**Data**: 2025-10-08  
**Análise**: Comparação de abordagens para visualizar outras extrações e sugestões de IA  
**Status**: Aguardando seleção

---

## 📋 **DUAS QUESTÕES CRÍTICAS**

### **1. Como visualizar extrações de outros membros?**
- Comparar valores facilmente
- Não poluir interface
- Identificar consenso/divergências

### **2. Como mostrar sugestões de IA?**
- Indicar claramente que é IA
- Workflow aceitar/rejeitar elegante
- Mostrar confidence score
- Mobile-friendly

---

## 🔍 **QUESTÃO 1: VISUALIZAÇÃO DE OUTRAS EXTRAÇÕES**

### **OPÇÃO 1A: Grid com Colunas** 📊

**Layout**:
```
┌──────────────┬───────────┬──────────┬──────────┬──────────┐
│ Campo        │ Meu Valor │ João     │ Maria    │ Pedro    │
├──────────────┼───────────┼──────────┼──────────┼──────────┤
│ Age          │ 30        │ 32       │ 30 ✅    │ 31       │
│ Sample Size  │ 100       │ 100 ✅   │ 98       │ 100 ✅   │
│ Follow-up    │ 6 months  │ 6 months │ 6 months │ 6 months │
└──────────────┴───────────┴──────────┴──────────┴──────────┘
```

**Visual**:
```
Campo por linha, valor por coluna
✅ = Indica concordância com seu valor
Highlight em valores iguais
```

#### **Prós**:
✅ **Comparação visual imediata** - Ver todos de uma vez  
✅ **Identificar consenso fácil** - Valores iguais destacados  
✅ **Ótimo para review** - Resolver divergências  
✅ **Familiar** - Similar a Google Sheets  
✅ **Exportável** - Pode gerar relatório assim  

#### **Contras**:
❌ **Muito largo** - Difícil com 4+ membros  
❌ **Mobile impossível** - Não cabe em tela pequena  
❌ **Ocupa muito espaço** - Formulário fica apertado  
❌ **Foco dividido** - Entre editar e comparar  
❌ **Não escala** - 10 membros = inviável  

#### **Quando usar**:
- ✅ Modo "Consensus" (resolver divergências)
- ✅ Desktop com tela grande
- ✅ Poucos membros (2-4)
- ✅ Review final

#### **Implementação**:
```typescript
// Toggle no toolbar
<Button onClick={() => setViewMode('grid')}>
  <Table className="mr-2 h-4 w-4" />
  Ver Grid de Comparação
</Button>

// Render grid
{viewMode === 'grid' ? (
  <ComparisonGrid fields={fields} extractions={allExtractions} />
) : (
  <StandardForm />
)}
```

**Score**: 7/10  
**Complexidade**: Média  
**Mobile**: ❌ Não

---

### **OPÇÃO 1B: Popover/Tooltip** 💬 ⭐ **RECOMENDADO**

**Layout**:
```
┌─────────────────────────────┐
│ Age: [30____]  👥 3         │ ← Badge clicável
└─────────────────────────────┘
        ↓ Click no badge
┌─────────────────────────────┐
│ 👥 Outras Extrações (3)     │
│ ─────────────────────────   │
│ ✅ João Silva               │
│    Valor: 32                │
│    Quando: ontem 14:30      │
│                             │
│ ✅ Maria Santos             │
│    Valor: 30 (igual a você) │
│    Quando: hoje 10:15       │
│                             │
│ ⚠️ Pedro Costa              │
│    Valor: 31                │
│    Quando: hoje 09:00       │
│                             │
│ 📊 Consenso: 30 (2/3)       │
│ [Ver Comparação Completa]   │
└─────────────────────────────┘
```

**Visual**:
```
Badge com número de extrações
Click → Popover elegante
Mostra nome + valor + timestamp
Highlight se valor igual ao seu
Link para comparação completa (grid)
```

#### **Prós**:
✅ **Minimalista** - Não polui interface principal  
✅ **On-demand** - Mostra apenas quando necessário  
✅ **Mobile-friendly** - Funciona em qualquer tela  
✅ **Escalável** - Funciona com 10+ membros  
✅ **Foco mantido** - User continua editando  
✅ **Contextual** - Informação junto ao campo  
✅ **Pode expandir** - Link para grid se necessário  

#### **Contras**:
❌ **Requer click** - Não é imediato  
❌ **Um campo por vez** - Não vê múltiplos simultaneamente  

#### **Quando usar**:
- ✅ Modo "Extraction" (foco em extrair)
- ✅ Desktop + Mobile
- ✅ Qualquer número de membros
- ✅ Workflow principal

#### **Implementação**:
```typescript
<div className="flex items-center gap-2">
  <Input value={value} onChange={onChange} />
  
  {otherExtractions.length > 0 && (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Users className="h-4 w-4" />
          <Badge className="absolute -top-1 -right-1">
            {otherExtractions.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <OtherExtractionsPopover
          extractions={otherExtractions}
          myValue={value}
          onViewGrid={() => openGridView(fieldId)}
        />
      </PopoverContent>
    </Popover>
  )}
</div>
```

**Score**: 9/10 ⭐  
**Complexidade**: Baixa  
**Mobile**: ✅ Sim

---

### **OPÇÃO 1C: Drawer Lateral** 📱

**Layout**:
```
┌──────────────┬─────────────────────────┐
│              │ 📊 Comparação           │
│  Formulário  │ [X] Fechar              │
│  Principal   │ ───────────────────     │
│              │                         │
│  Age:        │ 🔍 Age                  │
│  [30____]    │ • Você: 30              │
│              │ • João: 32              │
│  Sample:     │ • Maria: 30 ✅          │
│  [100___]    │                         │
│              │ 🔍 Sample Size          │
│  Follow-up:  │ • Você: 100             │
│  [______]    │ • João: 100 ✅          │
│              │ • Maria: 98             │
└──────────────┴─────────────────────────┘
```

**Visual**:
```
Drawer que abre do lado direito
Scroll sincronizado com formulário
Destaca campo que está sendo editado
Pode fechar para mais espaço
```

#### **Prós**:
✅ **Sempre visível** - Se drawer aberto  
✅ **Múltiplos campos** - Vê vários ao mesmo tempo  
✅ **Não interfere** - Formulário continua acessível  
✅ **Contexto contínuo** - Acompanha scroll  

#### **Contras**:
❌ **Ocupa espaço permanente** - Metade da tela  
❌ **Sincronizar scroll** - Complexo tecnicamente  
❌ **Mobile** - Perde espaço crítico  
❌ **Drawer open/close** - Mais um controle  

#### **Quando usar**:
- ✅ Desktop com tela grande
- ✅ Modo "Review contínuo"
- ✅ Quando comparação é constante

**Score**: 6/10  
**Complexidade**: Alta  
**Mobile**: ⚠️ Limitado

---

### **OPÇÃO 1D: HÍBRIDA** 🎯 ⭐⭐ **MELHOR ESCOLHA**

**Combinação Inteligente**:

**Modo Extraction (default)**:
- Popover por campo (Opção B)
- Badge 👥 discreto
- Click → Ver lista

**Modo Consensus (toggle)**:
- Grid completo (Opção A)
- Botão no toolbar: "Ver Comparação Completa"
- Abre dialog/sheet com tabela

**Layout Normal**:
```
┌─────────────────────────────┐
│ Age: [30____]  👥 3         │ ← Popover on click
└─────────────────────────────┘
```

**Layout Consensus** (ativado por botão):
```
┌────────────┬─────────┬──────┬───────┬─────────┐
│ Campo      │ Você    │ João │ Maria │ Consenso│
├────────────┼─────────┼──────┼───────┼─────────┤
│ Age        │ 30 ✓    │ 32   │ 30 ✓  │ 30 (2/3)│
│ Sample     │ 100 ✓   │ 100✓ │ 98    │ 100(2/3)│
└────────────┴─────────┴──────┴───────┴─────────┘
```

#### **Prós**:
✅ **Melhor dos dois mundos**  
✅ **Adaptável ao contexto**  
✅ **Workflow progressivo** - Simples → Complexo  
✅ **Mobile + Desktop**  
✅ **Escalável**  

#### **Implementação**:
```typescript
// Toolbar
<Tabs value={viewMode} onValueChange={setViewMode}>
  <TabsList>
    <TabsTrigger value="extract">Extração</TabsTrigger>
    <TabsTrigger value="compare">Comparação</TabsTrigger>
  </TabsList>
</Tabs>

// Render condicional
{viewMode === 'extract' ? (
  <FormWithPopovers />
) : (
  <ComparisonGrid />
)}
```

**Score**: 10/10 ⭐⭐  
**Complexidade**: Média  
**Mobile**: ✅ Sim

---

## 🤖 **QUESTÃO 2: SUGESTÕES DE IA**

### **OPÇÃO 2A: Coluna "IA"** 🤖

**Layout**:
```
┌───────┬───────────┬──────────────────┬──────┬───────┐
│ Campo │ Meu Valor │ IA Sugestão      │ João │ Maria │
├───────┼───────────┼──────────────────┼──────┼───────┤
│ Age   │ [_____]   │ 30 ⚡ 95%  ✓ ✗  │ 32   │ 30    │
│ Size  │ [_____]   │ 100 ⚡ 89% ✓ ✗  │ 100  │ 98    │
└───────┴───────────┴──────────────────┴──────┴───────┘
```

**Visual**:
```
Coluna dedicada para IA
⚡ = Indica IA
95% = Confidence score
✓ = Aceitar
✗ = Rejeitar
```

#### **Prós**:
✅ **Separação clara** - IA vs Humano  
✅ **Comparação direta** - IA + Outros membros  
✅ **Confidence visível** - Sempre mostrado  
✅ **Aceitar/rejeitar inline**  

#### **Contras**:
❌ **Muito largo** - 5+ colunas  
❌ **Mobile impossível**  
❌ **Foco excessivamente dividido**  
❌ **Não escala** - Muitos membros + IA  

**Score**: 6/10  
**Complexidade**: Média  
**Mobile**: ❌ Não

---

### **OPÇÃO 2B: Inline Suggestion (Abaixo)** 📝

**Layout**:
```
┌────────────────────────────────────────────┐
│ Age: [______________________]              │
│                                            │
│ ⚡ IA sugere: 30 (Confiança: 95%)         │
│ Justificativa: "Encontrado na página 3,   │
│ seção Methods: median age 30 years"       │
│                                            │
│ [✓ Aceitar] [✗ Rejeitar] [✏️ Editar]       │
└────────────────────────────────────────────┘
```

**Visual**:
```
Card/Alert abaixo do campo
Mostra valor sugerido
Justificativa (reasoning)
3 ações claras
```

#### **Prós**:
✅ **Contextual** - Junto ao campo  
✅ **Pode mostrar reasoning** - Transparência IA  
✅ **Workflow claro** - 3 opções visíveis  
✅ **Mobile-friendly**  
✅ **Espaço para detalhes**  

#### **Contras**:
❌ **Ocupa espaço vertical** - Pode ficar longo  
❌ **Repetitivo** - Se muitos campos com IA  
❌ **Não vê overview** - Campo por campo  

**Score**: 7/10  
**Complexidade**: Baixa  
**Mobile**: ✅ Sim

---

### **OPÇÃO 2C: Prefill + Badge Inline** ✨ ⭐ **RECOMENDADO**

**Layout**:
```
┌────────────────────────────────────────────┐
│ Age: [30______________] ⚡95%  ✓  ✗        │
│      ↑ prefilled       ↑badges             │
│      borda roxa                            │
└────────────────────────────────────────────┘

Hover/Focus:
┌────────────────────────────────────────────┐
│ Age: [30______________] ⚡95%  ✓  ✗        │
│                                            │
│ 💡 Sugestão da IA                          │
│ Encontrado: "median age 30 years" (p.3)   │
│ ✓ Aceitar • ✗ Rejeitar • ou edite         │
└────────────────────────────────────────────┘
```

**Visual**:
```
Input prefilled com valor da IA
Borda roxa/azul diferenciada
Badge ⚡ com confidence
Botões ✓ ✗ inline e discretos
Tooltip com detalhes on hover
```

#### **Prós**:
✅ **Minimalista** - Uma linha apenas ⭐  
✅ **Elegante** - Auto-complete style  
✅ **Preview imediato** - Vê o valor  
✅ **Mobile-friendly**  
✅ **Pode editar** - Antes de aceitar  
✅ **Workflow rápido** - 1 click ✓  
✅ **Não intrusivo** - Badges pequenos  

#### **Contras**:
❌ **Pode não notar** - Precisa indicador claro  
❌ **Aceitar acidentalmente** - Se não atentar  

#### **Melhorias**:
- Borda colorida (roxa/azul) quando IA
- Ícone ⚡ sempre visível
- Tooltip explicativo no hover
- Animation sutil no prefill
- Confirmation toast ao aceitar

#### **Estados**:
```typescript
interface AIFieldState {
  status: 'pending' | 'accepted' | 'rejected';
  value: any;
  confidence: number;
  reasoning?: string;
  evidences?: Evidence[];
}

// Visual states
- pending: Borda roxa + ⚡ badge + botões
- accepted: Input normal + badge "✅ Aceito"
- rejected: Input vazio + badge "Rejeitado"
```

#### **Implementação**:
```typescript
<div className="relative">
  <Input
    value={value}
    onChange={onChange}
    className={cn(
      aiSuggestion?.status === 'pending' && 
      "border-purple-500 bg-purple-50 dark:bg-purple-950/10"
    )}
  />
  
  {aiSuggestion?.status === 'pending' && (
    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1">
            <Sparkles className="h-3 w-3" />
            {aiSuggestion.confidence}%
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <AIReasoningTooltip {...aiSuggestion} />
        </TooltipContent>
      </Tooltip>
      
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 text-green-600"
        onClick={() => acceptAISuggestion(fieldId)}
      >
        <Check className="h-4 w-4" />
      </Button>
      
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 text-red-600"
        onClick={() => rejectAISuggestion(fieldId)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )}
</div>
```

**Score**: 10/10 ⭐⭐  
**Complexidade**: Baixa  
**Mobile**: ✅ Sim

---

### **OPÇÃO 2D: Batch Review Mode** 📋

**Layout**:
```
┌────────────────────────────────────────────┐
│ 🤖 IA gerou 15 sugestões                  │
│ [Revisar Todas] [Aceitar Todas >80%]     │
└────────────────────────────────────────────┘

Modal de Review:
┌────────────────────────────────────────────┐
│ Revisar Sugestões de IA (15)              │
├────────────────────────────────────────────┤
│ ✅ Age: 30 (95%) - ACEITO                 │
│ ✅ Sample: 100 (89%) - ACEITO             │
│ ⚠️ Follow-up: 6 months (65%) - PENDENTE   │
│    [✓ Aceitar] [✗ Rejeitar] [✏️ Editar]   │
│ ...                                        │
├────────────────────────────────────────────┤
│ [Aceitar Todas >80%] [Salvar e Fechar]    │
└────────────────────────────────────────────┘
```

**Visual**:
```
Banner no topo quando IA rodou
Modal para revisar em batch
Lista de sugestões
Ações em lote
```

#### **Prós**:
✅ **Batch processing** - Revisar muitas de uma vez  
✅ **Overview completo** - Ver todas sugestões  
✅ **Ações em lote** - "Aceitar todas >80%"  
✅ **Workflow estruturado**  

#### **Contras**:
❌ **Extra step** - Abrir modal  
❌ **Desconectado** - Do contexto do formulário  
❌ **Menos contextual** - Lista vs campo  

#### **Quando usar**:
- ✅ Após IA processar artigo inteiro
- ✅ Review final antes de submeter
- ✅ Quando muitas sugestões (20+)

**Score**: 8/10  
**Complexidade**: Média  
**Mobile**: ✅ Sim

---

## 🎯 **RECOMENDAÇÃO FINAL**

### **Combinação Ótima** ⭐⭐⭐

#### **Para Outras Extrações (Humanas)**:
```
OPÇÃO 1D - HÍBRIDA
├─ Default: Popover + Badge 👥
└─ Toggle: Grid de Comparação
```

**Justificativa**:
- ✅ Minimalista no dia-a-dia
- ✅ Grid para consensus quando necessário
- ✅ Funciona em mobile e desktop
- ✅ Escalável

---

#### **Para Sugestões de IA**:
```
OPÇÃO 2C - Prefill + Badge Inline
├─ Input prefilled com borda roxa
├─ Badge ⚡ com confidence
├─ Botões ✓ ✗ inline
└─ Tooltip com reasoning
```

**Justificativa**:
- ✅ Mais minimalista e elegante
- ✅ Workflow rápido (1 click)
- ✅ Pode editar antes de aceitar
- ✅ Mobile-friendly
- ✅ Não polui interface

---

### **Arquitetura de Dados**

```typescript
// Estado de cada campo
interface FieldExtractionState {
  // Valor atual
  value: any;
  source: 'empty' | 'human' | 'ai' | 'consensus';
  
  // Sugestão de IA (se houver)
  aiSuggestion?: {
    value: any;
    confidence: number;
    reasoning: string;
    evidences: Evidence[];
    status: 'pending' | 'accepted' | 'rejected';
    timestamp: Date;
  };
  
  // Extrações de outros membros
  otherExtractions?: {
    userId: string;
    userName: string;
    value: any;
    confidence?: number;
    timestamp: Date;
  }[];
  
  // Metadata
  lastModified: Date;
  modifiedBy: string;
}
```

---

### **UI Adaptativa**

```typescript
function renderField(field: ExtractionField, state: FieldExtractionState) {
  return (
    <div className="field-container">
      {/* Input principal */}
      <Input
        value={state.value}
        onChange={handleChange}
        className={cn(
          // Borda roxa se IA pending
          state.aiSuggestion?.status === 'pending' && 
          "border-purple-500 bg-purple-50",
          // Borda verde se consensus
          state.source === 'consensus' &&
          "border-green-500"
        )}
      />
      
      <div className="field-badges">
        {/* Badge de IA */}
        {state.aiSuggestion?.status === 'pending' && (
          <AIBadge
            confidence={state.aiSuggestion.confidence}
            onAccept={() => acceptAI(field.id)}
            onReject={() => rejectAI(field.id)}
          />
        )}
        
        {/* Badge de outras extrações */}
        {state.otherExtractions && state.otherExtractions.length > 0 && (
          <OtherExtractionsPopover
            extractions={state.otherExtractions}
            myValue={state.value}
          />
        )}
      </div>
    </div>
  );
}
```

---

## 📊 **COMPARAÇÃO FINAL**

| Critério | Opção 1D Híbrida | Opção 2C Prefill | Alternativas |
|----------|------------------|------------------|--------------|
| **Minimalismo** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Mobile** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **Comparação** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Workflow IA** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Escalabilidade** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Implementação** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 🎨 **MOCKUP VISUAL FINAL**

### **Tela Normal (Extraction Mode)**:
```
┌─────────────────────────────────────────────────────┐
│ Header + Toolbar                                    │
├──────────────────┬──────────────────────────────────┤
│                  │ ▼ Population                     │
│   PDF VIEWER     │                                  │
│                  │ Age:                             │
│   [Documento]    │ [30_________] ⚡95% ✓ ✗  👥3     │
│                  │ ↑ IA prefill  ↑AI    ↑outros    │
│                  │                                  │
│                  │ Sample Size:                     │
│                  │ [100________] ⚡89% ✓ ✗  👥2 ✅  │
│                  │                                  │
│                  │ Follow-up Duration:              │
│                  │ [6 months___]          👥3 ⚠️   │
│                  │ ↑ manual                         │
│                  │                                  │
│                  │ ▼ Index Models (múltipla)        │
│                  │ ...                              │
└──────────────────┴──────────────────────────────────┘
```

### **Grid de Comparação (Toggle)**:
```
┌─────────────────────────────────────────────────────┐
│ [< Voltar] Modo Comparação                          │
├──────────┬─────────┬────────┬────────┬──────┬───────┤
│ Campo    │ Você    │ IA     │ João   │Maria │Consenso│
├──────────┼─────────┼────────┼────────┼──────┼───────┤
│ Age      │ 30 ✓    │ 30⚡95%│ 32     │ 30✓  │30(3/4)│
│ Sample   │ 100 ✓   │ 100⚡  │ 100✓   │ 98   │100(3/4│
│ Follow-up│ 6m ✓    │ 6m⚡   │ 6m✓    │ 6m✓  │6m(4/4)│
└──────────┴─────────┴────────┴────────┴──────┴───────┘
```

---

## 🚀 **PRÓXIMAS AÇÕES**

1. ✅ **Opções analisadas** (FEITO!)
2. ⏭️ **Selecionar preferência** (você decide)
3. ⏭️ **Incorporar no plano** principal
4. ⏭️ **Implementar**

---

**Preparado por**: AI Assistant  
**Metodologia**: Análise comparativa + UX best practices  
**Status**: ⏸️ Aguardando sua escolha

## 📝 **DECISÃO**

**Qual opção você prefere?**

### **Para Outras Extrações**:
- [ ] A - Grid com colunas
- [ ] B - Popover + Badge
- [ ] C - Drawer lateral
- [ ] D - Híbrida (Popover + Grid toggle) ⭐ RECOMENDADO

### **Para Sugestões de IA**:
- [ ] A - Coluna IA
- [ ] B - Inline suggestion (abaixo)
- [ ] C - Prefill + Badge inline ⭐ RECOMENDADO
- [ ] D - Batch review mode

---

🎨 **AGUARDANDO SUA DECISÃO PARA ATUALIZAR O PLANO!**
