# Próximos Passos: Implementação "Outro (especificar)"

## Status Atual ✅

- [x] Migration criada (`0017_fields_other_option.sql`)
- [x] Tipos TypeScript atualizados
- [x] Componentes UI criados (`SelectWithOther`, `MultiSelectWithOther`)
- [x] Integração no `FieldInput.tsx`
- [x] Atualização do `AddFieldDialog.tsx`
- [x] Helpers de validação (`lib/validations/selectOther.ts`)
- [x] Testes básicos

## Próximos Passos Necessários

### 1. Atualizar `EditFieldDialog.tsx` ⚠️ CRÍTICO

**Arquivo**: `src/components/extraction/dialogs/EditFieldDialog.tsx`

**O que fazer**:
- Adicionar campos `allow_other`, `other_label`, `other_placeholder` no form reset (linha ~98)
- Adicionar seção de UI similar ao `AddFieldDialog` para editar essas propriedades
- Garantir que ao salvar, essas propriedades sejam incluídas no payload

**Código a adicionar** (após linha 107):
```typescript
form.reset({
  label: field.label,
  description: field.description || '',
  field_type: field.field_type,
  is_required: field.is_required,
  unit: field.unit,
  allowed_units: field.allowed_units,
  allowed_values: field.allowed_values,
  llm_description: field.llm_description || '',
  validation_schema: field.validation_schema || {},
  // ✅ ADICIONAR:
  allow_other: field.allow_other || false,
  other_label: field.other_label || null,
  other_placeholder: field.other_placeholder || null,
});
```

**UI a adicionar** (similar ao `AddFieldDialog`, após a seção de `allowed_values`):
- Toggle para `allow_other`
- Inputs condicionais para `other_label` e `other_placeholder`

---

### 2. Corrigir Lógica de Salvamento em `useExtractedValues.ts` ⚠️ CRÍTICO

**Arquivo**: `src/hooks/extraction/useExtractedValues.ts`

**Problema atual**: Linhas 141-143 extraem `valueData.value` se for objeto, mas isso quebra valores com "outro" que são `{ selected: 'other', other_text: '...' }`.

**Solução**: Preservar objetos que representam "outro" e apenas extrair `value` para objetos com `unit`.

**Código a substituir** (linhas 140-147):
```typescript
// ❌ ANTES:
const actualValue = typeof valueData === 'object' && 'value' in valueData
  ? valueData.value
  : valueData;

const unitValue = typeof valueData === 'object' && 'unit' in valueData
  ? valueData.unit
  : null;

// ✅ DEPOIS:
// Detectar se é objeto com "outro" (select/multiselect com allow_other)
const isOtherValue = typeof valueData === 'object' && 
  (('selected' in valueData && valueData.selected === 'other') ||
   ('selected' in valueData && Array.isArray(valueData.selected) && 'other_texts' in valueData));

// Se for valor "outro", preservar objeto completo
// Se for objeto com unit (number field), extrair value e unit
// Caso contrário, usar valor direto
let actualValue: any;
let unitValue: string | null = null;

if (isOtherValue) {
  // Preservar estrutura { selected: 'other', other_text } ou { selected: [], other_texts: [] }
  actualValue = valueData;
} else if (typeof valueData === 'object' && 'value' in valueData) {
  // Objeto com unit (number field)
  actualValue = valueData.value;
  unitValue = 'unit' in valueData ? valueData.unit : null;
} else {
  // Valor simples (string, number, etc.)
  actualValue = valueData;
}
```

**Também atualizar** `useExtractionAutoSave.ts` (mesma lógica, linhas ~103-110).

---

### 3. Corrigir Lógica de Leitura em `useExtractedValues.ts` ⚠️ IMPORTANTE

**Arquivo**: `src/hooks/extraction/useExtractedValues.ts`

**Problema**: Linhas 101-107 podem não preservar corretamente valores com "outro" ao carregar.

**Código atual** (linhas ~101-107):
```typescript
const extractedValue = item.value?.value ?? item.value;
```

**Solução**: Verificar se `item.value` já é um objeto com `selected` e preservar:
```typescript
// Se value já é objeto com "outro", usar direto
// Se value tem propriedade .value (wrapper antigo), extrair
// Caso contrário, usar direto
let extractedValue: any;
if (item.value && typeof item.value === 'object' && 'selected' in item.value) {
  // É valor "outro", preservar
  extractedValue = item.value;
} else if (item.value && typeof item.value === 'object' && 'value' in item.value) {
  // Wrapper antigo { value: ... }, extrair
  extractedValue = item.value.value;
} else {
  // Valor simples
  extractedValue = item.value;
}

// Para number fields, ainda precisa do unit
const finalValue = item.unit && field?.field_type === 'number'
  ? { value: extractedValue, unit: item.unit }
  : extractedValue;
```

---

### 4. Atualizar `AISuggestionService.ts` (Opcional mas Recomendado)

**Arquivo**: `src/services/aiSuggestionService.ts`

**O que fazer**: Garantir que ao aceitar sugestão de IA, valores com "outro" sejam preservados corretamente.

**Linha ~208**: Verificar se `value` já está no formato correto antes de fazer wrap.

---

### 5. Aplicar Migration no Banco ⚠️ CRÍTICO

**Comando**:
```bash
# Se usando Supabase local
supabase migration up

# Ou aplicar manualmente no Supabase Studio
# Abrir: supabase/migrations/0017_fields_other_option.sql
# Executar no SQL Editor
```

**Verificar**:
```sql
-- Verificar se colunas foram criadas
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'extraction_fields'
  AND column_name IN ('allow_other', 'other_label', 'other_placeholder');

-- Verificar se trigger foi criado
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'trg_validate_instance_project';
```

---

### 6. Testar Fluxo Completo 🧪

**Cenários de teste**:

1. **Criar campo select com allow_other**:
   - Abrir `AddFieldDialog`
   - Selecionar tipo "Seleção Única"
   - Adicionar valores permitidos: ["Registro A", "Registro B"]
   - Ativar toggle "Permitir 'Outro (especificar)'"
   - Configurar label e placeholder
   - Salvar

2. **Usar campo com "outro"**:
   - Abrir extração de artigo
   - Selecionar campo criado
   - Escolher "Outro (especificar)" no dropdown
   - Digitar texto no input que aparece
   - Salvar

3. **Verificar persistência**:
   - Recarregar página
   - Verificar se valor "outro" foi preservado
   - Verificar se input de "outro" aparece com texto preenchido

4. **Editar campo existente**:
   - Abrir `EditFieldDialog` para campo com allow_other
   - Modificar label do "outro"
   - Salvar
   - Verificar se mudança foi aplicada

5. **Testar multiselect com "outro"**:
   - Criar campo multiselect com allow_other
   - Selecionar múltiplas opções + adicionar vários "outros"
   - Salvar e recarregar
   - Verificar se todos os valores foram preservados

---

### 7. Validação no Backend (Edge Functions) 🔍

**Arquivos a verificar**:
- `supabase/functions/section-extraction/pipeline.ts`
- `supabase/functions/model-extraction/pipeline.ts`

**O que fazer**: Se edge functions criam `extracted_values`, garantir que preservam estrutura de "outro".

**Buscar por**: `extracted_values` ou `.insert({ value: ... })`

**Padrão esperado**:
```typescript
// ✅ CORRETO: Preservar objeto se for "outro"
const valueToSave = typeof extractedValue === 'object' && 'selected' in extractedValue
  ? extractedValue  // Já está no formato correto
  : { value: extractedValue };  // Wrap simples
```

---

### 8. Atualizar Tipos do Supabase (Opcional) 🔄

**Se usar geração automática de tipos**:
```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

**Verificar se novos campos aparecem**:
```typescript
// Em Database['public']['Tables']['extraction_fields']['Row']
allow_other: boolean;
other_label: string | null;
other_placeholder: string | null;
```

---

## Checklist Final

- [ ] `EditFieldDialog.tsx` atualizado
- [ ] `useExtractedValues.ts` corrigido (salvamento)
- [ ] `useExtractedValues.ts` corrigido (leitura)
- [ ] `useExtractionAutoSave.ts` corrigido
- [ ] Migration aplicada no banco
- [ ] Teste: criar campo com allow_other ✅
- [ ] Teste: usar "outro" e salvar ✅
- [ ] Teste: recarregar e verificar persistência ✅
- [ ] Teste: editar campo existente ✅
- [ ] Teste: multiselect com múltiplos "outros" ✅
- [ ] Edge functions verificadas (se aplicável)
- [ ] Tipos do Supabase atualizados (se aplicável)

---

## Troubleshooting

### Problema: Valores "outro" não são salvos
**Solução**: Verificar se lógica de salvamento em `useExtractedValues.ts` foi atualizada (passo 2).

### Problema: Valores "outro" não aparecem ao recarregar
**Solução**: Verificar se lógica de leitura em `useExtractedValues.ts` foi atualizada (passo 3).

### Problema: Campo não mostra opção "outro"
**Solução**: 
1. Verificar se `allow_other=true` no banco
2. Verificar se `FieldInput.tsx` está usando `SelectWithOther` quando `field.allow_other === true`

### Problema: Erro ao aplicar migration
**Solução**: Verificar se não há dados conflitantes. Se necessário, fazer backup antes.

---

## Notas Importantes

1. **Backward Compatibility**: Valores antigos (sem "outro") continuam funcionando porque são strings simples ou arrays.

2. **Performance**: Estrutura JSONB não adiciona overhead significativo.

3. **Validação**: Helpers em `lib/validations/selectOther.ts` garantem formato correto.

4. **UI/UX**: Componentes `SelectWithOther` e `MultiSelectWithOther` são reutilizáveis e seguem padrões modernos.


