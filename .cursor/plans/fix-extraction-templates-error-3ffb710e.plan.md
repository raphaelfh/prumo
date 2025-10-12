<!-- 3ffb710e-06d6-4946-b7b9-487ca60be807 0e1b2c7c-98a8-45b6-b1a5-32a01d957ad7 -->
# Adicionar Unidades de Medida na Comparação

Lembrando que voce é um senior software engineer, deve manter as melhroes praticas, codigo modular e limpo e refatorar se necessario apra manter o projeto consistente

## Problema Identificado

Atualmente, a visualização de comparação **não exibe nem permite editar unidades** em campos numéricos. O modo de extração já tem suporte completo para unidades (`FieldInput.tsx`), mas isso não foi replicado na comparação.

**Exemplo atual:**

- Extração: `100 years` (com seletor de unidade)
- Comparação: `100` (sem unidade visível)

**Resultado esperado:**

- Comparação: `100 years` (com possibilidade de editar valor + unidade)

---

## Análise Técnica

### Como funciona no modo de extração (`FieldInput.tsx`)

1. **Estrutura de dados:**

                                                                                                                                                                                                - Valor simples: `"100"`
                                                                                                                                                                                                - Valor com unidade: `{ value: "100", unit: "years" }`

2. **Lógica de unidades:**

                                                                                                                                                                                                - `field.allowed_units`: Unidades configuradas pelo manager (primeira é padrão)
                                                                                                                                                                                                - `field.unit`: Unidade padrão do campo
                                                                                                                                                                                                - `getRelatedUnits(unit)`: Dicionário automático de unidades relacionadas

3. **UI:**

                                                                                                                                                                                                - Input numérico + Select de unidade (se múltiplas disponíveis)
                                                                                                                                                                                                - Input numérico + Badge fixo (se apenas 1 unidade)
                                                                                                                                                                                                - Input numérico sem badge (se nenhuma unidade definida)

### Estado atual da comparação

1. **`formatComparisonValue` (formatters.ts):**

                                                                                                                                                                                                - Linha 34: `if ('value' in value) return formatComparisonValue(value.value);`
                                                                                                                                                                                                - **Problema:** Descarta a unidade, retorna apenas o valor

2. **`ComparisonCell.tsx`:**

                                                                                                                                                                                                - Edição inline com `Input` simples (linha 101-108)
                                                                                                                                                                                                - **Problema:** Não permite editar unidade, apenas valor

3. **`ComparisonTable.tsx`:**

                                                                                                                                                                                                - Não passa informações de `field` para `ComparisonCell`
                                                                                                                                                                                                - **Problema:** Célula não sabe o tipo do campo ou unidades disponíveis

---

## Solução: 4 Fases

### Fase 1: Atualizar `formatters.ts`

**Arquivo:** `src/lib/comparison/formatters.ts`

**Objetivo:** Formatar valores numéricos com unidade visível

**Mudanças:**

```typescript
/**
 * Formata valor para exibição na comparação
 * Suporta valores com unidade: { value: 100, unit: "years" } → "100 years"
 */
export function formatComparisonValue(value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.join(', ');
  }
  
  if (typeof value === 'object') {
    // ✅ NOVO: Tratar valores numéricos com unidade
    if ('value' in value && 'unit' in value) {
      const numVal = value.value !== null && value.value !== undefined && value.value !== '' 
        ? String(value.value) 
        : '—';
      const unit = value.unit || '';
      return unit ? `${numVal} ${unit}` : numVal;
    }
    
    // Tratar JSONBs especiais que encapsulam valor
    if ('value' in value) return formatComparisonValue(value.value);
    
    // Objetos genéricos: JSON stringified (mas limitado)
    const str = JSON.stringify(value);
    return str.length > 100 ? str.substring(0, 97) + '...' : str;
  }
  
  return String(value);
}
```

**Resultado:** `{ value: 100, unit: "years" }` → exibe `"100 years"`

---

### Fase 2: Criar `NumberFieldEditor` para edição inline

**Arquivo:** `src/components/shared/comparison/NumberFieldEditor.tsx` (NOVO)

**Objetivo:** Componente especializado para editar campos numéricos com unidade

**Melhorias de UX:**

- Layout 50/50 entre input e select
- Navegação por Tab entre campos
- Controle de estado do Select para prevenir fechamento
- StopPropagation para evitar conflitos com TableCell
- Blur inteligente (não fecha ao clicar no Select)

**Implementação:**

```typescript
/**
 * Editor inline para campos numéricos com suporte a unidades
 * 
 * Features:
 * - Layout 50/50 entre input e select (melhor visibilidade)
 * - Navegação por Tab: Input → Select → Shift+Tab volta
 * - Estado controlado do Select (previne fechamento indevido)
 * - StopPropagation para evitar conflitos de clique
 * - Blur inteligente (não fecha ao navegar para Select)
 */

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { getRelatedUnits } from '@/lib/unitConversions';
import type { ExtractionField } from '@/types/extraction';

interface NumberFieldEditorProps {
  value: any; // Pode ser "100" ou { value: "100", unit: "years" }
  field: ExtractionField;
  onChange: (newValue: any) => void;
  onSave: () => void;
  onCancel: () => void;
  onSelectOpenChange?: (open: boolean) => void; // ✅ NOVO: callback para estado do Select
  autoFocus?: boolean;
}

export function NumberFieldEditor(props: NumberFieldEditorProps) {
  const { value, field, onChange, onSave, onCancel, onSelectOpenChange, autoFocus } = props;

  // Parse valor inicial
  const initialNumValue = typeof value === 'object' && value !== null && 'value' in value
    ? value.value
    : value;
  
  const initialUnit = typeof value === 'object' && value !== null && 'unit' in value
    ? value.unit
    : (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit);

  const [numValue, setNumValue] = useState(initialNumValue || '');
  const [currentUnit, setCurrentUnit] = useState(initialUnit || '');
  const selectTriggerRef = useRef<HTMLButtonElement>(null);

  // Determinar unidades disponíveis
  const availableUnits = field.allowed_units && field.allowed_units.length > 0
    ? field.allowed_units
    : (field.unit ? getRelatedUnits(field.unit) : []);

  const hasMultipleUnits = availableUnits.length > 1;
  const hasSingleUnit = availableUnits.length === 1;

  // Atualizar valor no onChange
  useEffect(() => {
    if (availableUnits.length > 0) {
      onChange({ value: numValue, unit: currentUnit });
    } else {
      onChange(numValue);
    }
  }, [numValue, currentUnit]);

  // ✅ NOVO: Handler de teclado com suporte a Tab
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && !e.shiftKey && hasMultipleUnits) {
      e.preventDefault();
      // Focar no Select
      selectTriggerRef.current?.focus();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  // ✅ NOVO: Blur inteligente (não fecha ao navegar para Select)
  const handleInputBlur = (e: React.FocusEvent) => {
    // Só salvar se o foco não foi para o Select
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !relatedTarget.closest('[role="combobox"]')) {
      onSave();
    }
  };

  // ✅ NOVO: Callback para estado do Select
  const handleSelectOpenChange = (open: boolean) => {
    onSelectOpenChange?.(open);
  };

  return (
    <div 
      className="flex gap-2 items-center w-full min-w-[200px]"
      onClick={(e) => e.stopPropagation()} // ✅ NOVO: prevenir fechamento ao clicar
    >
      <Input
        type="number"
        value={numValue}
        onChange={(e) => setNumValue(e.target.value)}
        onBlur={handleInputBlur}
        onKeyDown={handleInputKeyDown}
        autoFocus={autoFocus}
        className="h-8 text-sm w-1/2 min-w-[80px]" // ✅ NOVO: 50% width
        placeholder="0"
      />
      
      {/* Seletor de unidade (se múltiplas disponíveis) */}
      {hasMultipleUnits && (
        <Select
          value={currentUnit}
          onValueChange={setCurrentUnit}
          onOpenChange={handleSelectOpenChange} // ✅ NOVO: controle de estado
        >
          <SelectTrigger 
            ref={selectTriggerRef}
            className="w-1/2 h-8 text-sm min-w-[100px]" // ✅ NOVO: 50% width
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onCancel();
              }
            }}
          >
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            {availableUnits.map((unit, index) => (
              <SelectItem key={unit} value={unit}>
                {unit}
                {index === 0 && field.allowed_units && field.allowed_units.length > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">(padrão)</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      
      {/* Badge fixo (se apenas 1 unidade) */}
      {hasSingleUnit && (
        <Badge variant="outline" className="w-1/2 text-xs text-center min-w-[100px]">
          {availableUnits[0]}
        </Badge>
      )}
    </div>
  );
}
```

**Principais melhorias:**

1. **Layout 50/50**: Input e Select dividem espaço igualmente
2. **Tab navigation**: Tab vai do Input para Select, Shift+Tab volta
3. **Estado do Select**: `onSelectOpenChange` comunica quando Select está aberto
4. **StopPropagation**: Previne cliques de fechar a edição
5. **Blur inteligente**: Não fecha ao navegar entre Input e Select

---

### Fase 3: Atualizar `ComparisonCell` para suportar edição de campos numéricos

**Arquivo:** `src/components/shared/comparison/ComparisonCell.tsx`

**Mudanças:**

1. Adicionar props:
```typescript
interface ComparisonCellProps {
  value: any;
  isCurrentUser: boolean;
  matches: boolean;
  consensus: ConsensusResult | null;
  onClick?: () => void;
  onValueChange?: (newValue: any) => void;
  formatValue?: (value: any) => string;
  editable?: boolean;
  className?: string;
  field?: ExtractionField; // ✅ NOVO: informações do campo para edição especializada
}
```

2. Atualizar lógica de edição:
```typescript
import { NumberFieldEditor } from './NumberFieldEditor';
import type { ExtractionField } from '@/types/extraction';

export function ComparisonCell({ ... }: ComparisonCellProps) {
  // ... estado existente ...

  // ✅ NOVO: Detectar se é campo numérico
  const isNumberField = field?.field_type === 'number';

  return (
    <TableCell ...>
      <div className="flex items-center gap-2">
        {/* Modo edição */}
        {isEditing ? (
          isNumberField && field ? (
            // ✅ NOVO: Editor especializado para números com unidade
            <NumberFieldEditor
              value={editValue}
              field={field}
              onChange={setEditValue}
              onSave={handleSave}
              onCancel={handleCancel}
              autoFocus
            />
          ) : (
            // Editor padrão (text, select, etc)
            <Input
              value={editValue || ''}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              autoFocus
              className="h-8 text-sm"
            />
          )
        ) : (
          // ... resto do código (exibição) ...
        )}
      </div>
    </TableCell>
  );
}
```


---

### Fase 4: Passar informações de `field` através da cadeia de componentes

**Arquivos afetados:**

- `ComparisonTable.tsx`
- `SingleInstanceComparison.tsx`
- `EntitySelectorComparison.tsx`

**Objetivo:** Propagar informações de campo até `ComparisonCell`

#### 4.1. `ComparisonTable.tsx`

**Mudanças:**

```typescript
export interface ComparisonColumn<T = any> {
  id: string;
  label: string;
  getValue: (rowId: string, userData: Record<string, T>) => any;
  isRequired?: boolean;
  width?: string;
  formatValue?: (value: any) => string;
  field?: ExtractionField; // ✅ NOVO: metadados do campo
}

// ... no render da ComparisonCell ...
<ComparisonCell
  value={cellValue}
  isCurrentUser={user.isCurrentUser || false}
  matches={matchesCurrentUser}
  consensus={showConsensus ? consensus : null}
  onClick={onCellClick ? () => onCellClick(row, user.userId, cellValue) : undefined}
  onValueChange={isCurrentUser && editable && onValueChange ? (newVal) => onValueChange(row, newVal) : undefined}
  formatValue={col.formatValue}
  editable={editable}
  field={col.field} // ✅ NOVO: passar field
/>
```

#### 4.2. `SingleInstanceComparison.tsx`

**Mudanças:**

```typescript
// Preparar colunas (cada field é uma coluna)
const columns = useMemo<ComparisonColumn[]>(
  () =>
    fields.map((field) => ({
      id: field.id,
      label: field.label,
      getValue: (fieldId: string, userData: Record<string, any>) => {
        return userData[fieldId];
      },
      isRequired: field.is_required,
      field: field, // ✅ NOVO: passar field para a coluna
    })),
  [fields]
);
```

#### 4.3. `EntitySelectorComparison.tsx`

**Mudanças:** (idêntico ao anterior)

```typescript
const columns = useMemo<ComparisonColumn[]>(
  () =>
    fields.map((field) => ({
      id: field.id,
      label: field.label,
      getValue: (fieldId: string, userData: Record<string, any>) => {
        return userData[fieldId];
      },
      isRequired: field.is_required,
      field: field, // ✅ NOVO: passar field para a coluna
    })),
  [fields]
);
```

---

## Resultado Esperado

### ANTES:

```
Campo: sample_size
Rapha: 100
João: 200
```

### DEPOIS:

```
Campo: sample_size  
Rapha: 100 participants ✏️ (ao clicar, abre editor com valor + dropdown de unidade)
João: 200 participants
```

### Edição inline:

- Clica na célula → abre `NumberFieldEditor`
- Input de número + Select de unidade (ou Badge se única)
- Enter/blur → salva
- Escape → cancela

---

## Validação

- [ ] Campos numéricos sem unidade: editam apenas o número
- [ ] Campos numéricos com 1 unidade: editam número + mostram badge fixo
- [ ] Campos numéricos com múltiplas unidades: editam número + seletor de unidade
- [ ] Unidades aparecem na exibição: "100 years"
- [ ] Unidades são salvas corretamente: `{ value: 100, unit: "years" }`
- [ ] Campos não-numéricos (text, select, etc): mantêm comportamento atual
- [ ] Consenso detecta corretamente valores com unidades diferentes

---

## Arquivos Criados/Modificados

### Novos:

1. `src/components/shared/comparison/NumberFieldEditor.tsx`

### Modificados:

1. `src/lib/comparison/formatters.ts`
2. `src/components/shared/comparison/ComparisonCell.tsx`
3. `src/components/shared/comparison/ComparisonTable.tsx`
4. `src/components/shared/comparison/SingleInstanceComparison.tsx`
5. `src/components/shared/comparison/EntitySelectorComparison.tsx`

### To-dos

- [ ] Criar migration para adicionar coluna llm_description em extraction_fields
- [ ] Atualizar types TypeScript (extraction.ts) com campo llm_description
- [ ] Adicionar textarea llm_description no AddFieldDialog
- [ ] Atualizar EditFieldDialog para permitir edição completa de todos os campos
- [ ] Adicionar campo llm_description no EditFieldDialog
- [ ] Adicionar validações de segurança para mudanças críticas (field_type)
- [ ] Gerar types do Supabase após aplicar migration
- [ ] Atualizar ExtractionInterface para remover botão 'Em breve' e habilitar criação custom