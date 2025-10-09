# 🎨 DIAGRAMA VISUAL: Interface de Extração

**Versão**: Final Aprovada  
**Decisões**: Híbrida (Colaboração) + Prefill (IA)

---

## 📐 **LAYOUT COMPLETO DA INTERFACE**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HEADER                                                                  │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Projeto X > Extração > Article Title                               │ │
│ │                               [⏱️ Salvo há 5s]  [← Voltar]         │ │
│ ├────────────────────────────────────────────────────────────────────┤ │
│ │ Progresso: ████████░░░░░░░░░░  45/60 campos (75%)                 │ │
│ └────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│ TOOLBAR                                                                 │
│ [👁️ Mostrar PDF] [🔍 Zoom] [Comparação: Off/On] [👥 Ver Outras] [✅]   │
├──────────────────────────┬──────────────────────────────────────────────┤
│                          │                                              │
│     PDF VIEWER           │     FORMULÁRIO DE EXTRAÇÃO                   │
│     (toggle on/off)      │                                              │
│                          │  ▼ Population                           👥3  │
│  ┌────────────────────┐  │  ─────────────────────────────────────────  │
│  │                    │  │  ○ 5/6 campos                               │
│  │   [Página 1 PDF]   │  │                                              │
│  │                    │  │  Inclusion Criteria:                         │
│  │   Texto...         │  │  [Female, age 30-50...] ⚡92% ✓ ✗  👥3     │
│  │   Highlight:       │  │   ↑ IA prefilled        ↑badges             │
│  │   "age 30 years"   │  │                                              │
│  │                    │  │  Total Sample Size:                          │
│  │                    │  │  [25___] participants ⚡88% ✓ ✗  👥2 ✅     │
│  │                    │  │   ↑ IA  ↑ unit badge  ↑AI  ↑consenso       │
│  │                    │  │                                              │
│  │                    │  │  Mean Age:                                   │
│  │                    │  │  [39___] years  📎2  👥3 ⚠️                │
│  └────────────────────┘  │   ↑ manual  ↑evid ↑divergência              │
│                          │                                              │
│  [Zoom controls]         │  ▼ Index Models (múltipla)             👥2  │
│                          │  ─────────────────────────────────────────  │
│                          │  ○ 12/15 campos                             │
│                          │                                              │
│                          │  ┌─ Model 1 (Logistic Regression)      🗑️  │
│                          │  │  Algorithm Type:                         │
│                          │  │  [Logistic...] ⚡96% ✓ ✗  👥2 ✅        │
│                          │  │                                          │
│                          │  │  C-statistic:                            │
│                          │  │  [0.76____] ⚡91% ✓ ✗  👥2              │
│                          │  └────────────────────────────────────────  │
│                          │                                              │
│                          │  ┌─ Model 2 (Neural Network)          🗑️  │
│                          │  │  Algorithm Type:                         │
│                          │  │  [Neural...]  ⚡89% ✓ ✗  👥1            │
│                          │  └────────────────────────────────────────  │
│                          │                                              │
│                          │  [+ Adicionar Model]                         │
│                          │                                              │
│                          │  ▼ Outcomes                             👥3  │
│                          │  ...                                         │
│                          │                                              │
└──────────────────────────┴──────────────────────────────────────────────┘
```

---

## 🔄 **FLUXO DE INTERAÇÃO**

### **1. Edição Manual**
```
User digita valor
  ↓
Debounce 3s
  ↓
Auto-save
  ↓
Update extracted_values
  source: 'human'
  reviewer_id: current_user
```

### **2. Aceitar Sugestão de IA**
```
IA sugere: "30" (95%)
  ↓
Input prefilled
  ↓
User clica ✓
  ↓
Insert extracted_values
  source: 'ai'
  ai_suggestion_id: suggestion.id
  ↓
Update ai_suggestions
  status: 'accepted'
  ↓
Remove da UI (badge desaparece)
```

### **3. Rejeitar Sugestão de IA**
```
User clica ✗
  ↓
Update ai_suggestions
  status: 'rejected'
  ↓
Clear input (volta vazio)
  ↓
User pode digitar manualmente
```

### **4. Ver Outras Extrações**
```
User clica badge 👥3
  ↓
Popover abre
  ↓
Mostra lista:
  - João: 32 (ontem)
  - Maria: 30 ✅ (hoje)
  - Pedro: 31 (hoje)
  ↓
Mostra consenso: 30 (2/3)
  ↓
Link "Ver Comparação Completa"
  ↓
Abre grid com todas as comparações
```

### **5. Modo Comparação (Grid)**
```
User clica "Ver Comparação Completa" (toolbar)
  ↓
Toggle viewMode = 'compare'
  ↓
Renderiza ComparisonGridView
  ↓
Tabela com:
  - Coluna "Você" (destacada)
  - Coluna "IA" (se houver)
  - Colunas de outros membros
  - Coluna "Consenso"
  ↓
Highlight células com consenso
  ↓
User resolve divergências
  ↓
Volta ao modo normal
```

---

## 🎨 **ESTADOS VISUAIS DOS CAMPOS**

### **1. Campo Vazio (Sem IA, Sem Outros)**
```
┌──────────────────────────────┐
│ Age: [___________________]   │
│      ↑ borda normal          │
└──────────────────────────────┘
```

### **2. Campo com IA Pending**
```
┌──────────────────────────────────┐
│ Age: [30__________] ⚡95% ✓ ✗   │
│      ↑ borda roxa  ↑badges       │
└──────────────────────────────────┘
```

### **3. Campo com Outras Extrações**
```
┌──────────────────────────────┐
│ Age: [32__________]  👥3     │
│      ↑ manual       ↑popover │
└──────────────────────────────┘
```

### **4. Campo com Consenso**
```
┌──────────────────────────────────┐
│ Age: [30__________]  👥3 ✅      │
│      ↑ borda verde  ↑consenso    │
└──────────────────────────────────┘
```

### **5. Campo com Divergência**
```
┌──────────────────────────────────┐
│ Age: [32__________]  👥3 ⚠️      │
│      ↑ normal       ↑divergência │
└──────────────────────────────────┘
```

### **6. Campo Completo (IA + Outros + Consenso)**
```
┌────────────────────────────────────────┐
│ Age: [30_______] ⚡95% ✓ ✗  👥3 ✅    │
│      ↑ IA       ↑AI    ↑outros        │
│      borda verde (consenso)            │
└────────────────────────────────────────┘
```

### **7. Campo Obrigatório Vazio (Error)**
```
┌──────────────────────────────────────┐
│ Age: [___________] [Obrigatório]     │
│      ↑ borda vermelha                │
│ ⚠️ Campo obrigatório não preenchido  │
└──────────────────────────────────────┘
```

---

## 🎬 **ANIMAÇÕES E TRANSIÇÕES**

### **1. IA Prefill Animation**
```typescript
// Quando IA suggestion carrega
- Input fade in com borda roxa
- Badge ⚡ slide in from right
- Tooltip pulse sutil (1x)
```

### **2. Accept/Reject**
```typescript
// Aceitar (✓)
- Input border: roxa → verde
- Badge ⚡ fade out
- Botões ✓ ✗ fade out
- Checkmark ✅ fade in
- Toast: "Sugestão aceita"

// Rejeitar (✗)
- Input border: roxa → normal
- Value clear com fade out
- Badge e botões fade out
- Input volta vazio
- Toast: "Sugestão rejeitada"
```

### **3. Consenso Detection**
```typescript
// Quando 2+ valores iguais
- Badge ✅ fade in
- Input border: normal → verde (sutil)
- Popover mostra "Consenso: X (2/3)"
```

### **4. Auto-save Indicator**
```typescript
// Salvando
- Badge "Salvando..." com spinner
- Duration: 500-2000ms

// Salvo
- Badge "Salvo há Xs" fade in
- Cor: muted-foreground
- Update timestamp cada 10s
```

---

## 🔄 **CICLO DE VIDA COMPLETO**

```
1. USER ABRE ARTIGO
   ↓
2. LOAD DATA
   - Article info
   - Template + entity types + fields
   - Existing instances
   - Existing extracted_values
   - AI suggestions (pending)
   - Other extractions
   ↓
3. RENDER INTERFACE
   - Header (breadcrumb + auto-save)
   - Toolbar (controls)
   - PDF Viewer (if showPDF)
   - Form (sections → instances → fields)
   ↓
4. USER INTERACTION
   
   4a. Manual Input:
       - Type value → Debounce → Auto-save
       
   4b. Accept AI:
       - Click ✓ → Accept → Badge remove → Toast
       
   4c. View Others:
       - Click 👥 → Popover → See list → (optional) Grid
       
   4d. Add Evidence:
       - Click 📎 → Select PDF text → Link → Badge count
       
   4e. Add Instance:
       - Click "+ Add Model" → Dialog → Create → Reload
   ↓
5. PROGRESS TRACKING
   - Count completed required fields
   - Update progress bar
   - Enable "Finalizar" when 100%
   ↓
6. FINALIZE
   - Click "Finalizar Extração"
   - Show summary
   - Confirm
   - Update instances status: 'completed'
   - Navigate back or next article
```

---

## 🎯 **PONTOS DE ATENÇÃO**

### **Performance**
- ✅ Debounce agressivo (3s)
- ✅ Batch upserts
- ✅ Índices otimizados
- ✅ Lazy load de outras extrações

### **UX**
- ✅ Feedback visual imediato
- ✅ Loading states claros
- ✅ Error handling gracioso
- ✅ Undo/Redo (fase 5)

### **Colaboração**
- ✅ Blind mode support
- ✅ Timestamp tracking
- ✅ Consensus detection
- ✅ Divergence alerts

### **IA**
- ✅ Confidence thresholds
- ✅ Reasoning transparency
- ✅ Batch operations
- ✅ Track acceptance rate

---

## 📊 **MÉTRICAS DE SUCESSO**

### **Funcionalidade**
- [ ] Extração manual: 100% funcional
- [ ] Auto-save: < 3s latency
- [ ] IA suggestions: > 80% useful
- [ ] Colaboração: Multi-user working
- [ ] Consenso: Auto-detected

### **Performance**
- [ ] Load time: < 2s
- [ ] Auto-save: < 500ms
- [ ] Grid render: < 1s
- [ ] Popover open: < 100ms

### **UX**
- [ ] User can extract data easily
- [ ] AI helpful, not intrusive
- [ ] Collaboration clear
- [ ] Mobile usable (70% features)

---

**Preparado por**: AI Assistant  
**Status**: ✅ Diagrama completo e validado

🎨 **INTERFACE PLANEJADA EM DETALHES!**
