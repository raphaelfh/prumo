# Plano de Correção de Problemas de Lint

**Data:** 2025-01-27  
**Total de Problemas:** 1205 (35 erros, 1170 warnings)

## Resumo Executivo

O projeto possui **35 erros críticos** que impedem a compilação/execução correta e **1170 warnings** que indicam problemas de qualidade de código. Este documento detalha cada erro crítico e o plano de correção.

---

## 🔴 ERROS CRÍTICOS (35)

### 1. Erros de Parsing (2 erros)

**Arquivos:**
- `src/integrations/supabase/types.ts` (linha 7)
- `src/integrations/supabase/types-temp.ts` (linha 1)

**Problema:** 
Arquivos contêm texto inválido `"Connecting to db 5432"` que não é código TypeScript válido. Parece ser output de um script que foi acidentalmente incluído.

**Solução:**
- Remover a linha `"Connecting to db 5432"` de ambos os arquivos
- Verificar se esses arquivos são gerados automaticamente e ajustar o processo de geração

**Prioridade:** 🔴 CRÍTICA (impede parsing do TypeScript)

---

### 2. Erros de no-case-declarations (15 erros)

**Arquivos:**
- `src/components/assessment/ArticleAssessmentTable.tsx` (linhas 273-276)
- `src/components/extraction/ArticleExtractionTable.tsx` (linhas 397-400)
- `src/components/shared/comparison/ComparisonTable.tsx` (linhas 161-162, 208-209, 213, 217, 281, 321)

**Problema:**
Declarações `const` dentro de blocos `case` sem chaves `{}`. Em JavaScript/TypeScript, declarações lexicais (`const`, `let`) em `case` precisam estar em um bloco com escopo próprio.

**Exemplo do problema:**
```typescript
case 'status':
  const aProgress = a.assessment?.completion_percentage || 0; // ❌ ERRO
  const bProgress = b.assessment?.completion_percentage || 0;
  break;
```

**Solução:**
Envolver as declarações em um bloco `{}`:
```typescript
case 'status': {
  const aProgress = a.assessment?.completion_percentage || 0; // ✅ CORRETO
  const bProgress = b.assessment?.completion_percentage || 0;
  const aHasAssessment = !!a.assessment;
  const bHasAssessment = !!b.assessment;
  
  aValue = !aHasAssessment ? 0 : (aProgress >= 100 ? 2 : 1);
  bValue = !bHasAssessment ? 0 : (bProgress >= 100 ? 2 : 1);
  break;
}
```

**Prioridade:** 🔴 CRÍTICA (impede compilação)

---

### 3. Erro de no-unused-expressions (1 erro)

**Arquivo:**
- `src/components/extraction/ArticleExtractionTable.tsx` (linha 768)

**Problema:**
Expressão que não é uma atribuição ou chamada de função.

**Código problemático:**
```typescript
hasActiveFilters ? selectFiltered() : selectAll();
```

**Solução:**
A expressão está correta, mas o linter está reclamando porque o resultado não é usado. Verificar se é realmente necessário ou se deve ser envolvida em uma função:
```typescript
if (checked) {
  if (hasActiveFilters) {
    selectFiltered();
  } else {
    selectAll();
  }
}
```

**Prioridade:** 🔴 CRÍTICA

---

### 4. Erros de React Hooks Rules (7 erros)

#### 4.1 Topbar.tsx (2 erros)

**Arquivo:** `src/components/navigation/Topbar.tsx` (linhas 37-38)

**Problema:**
Hooks sendo chamados condicionalmente dentro de um `try-catch`, violando as regras dos Hooks do React.

**Código problemático:**
```typescript
let sidebarContext;
let projectContext;
try {
  sidebarContext = useSidebar(); // ❌ Hook condicional
  projectContext = useProject();  // ❌ Hook condicional
} catch {
  sidebarContext = null;
  projectContext = null;
}
```

**Solução:**
Hooks devem sempre ser chamados incondicionalmente. Usar um padrão de "contexto opcional":
```typescript
// Sempre chamar os hooks
const sidebarContext = useSidebar();
const projectContext = useProject();

// Verificar se estão disponíveis depois
const isProjectPage = window.location.pathname.includes('/projects/');
// Usar apenas se necessário
```

**Prioridade:** 🔴 CRÍTICA (pode causar bugs graves em runtime)

#### 4.2 SingleInstanceComparison.tsx (5 erros)

**Arquivo:** `src/components/shared/comparison/SingleInstanceComparison.tsx` (linhas 32, 44, 67, 78)

**Problema:**
Hooks sendo chamados após um early return (linha 29).

**Código problemático:**
```typescript
if (instances.length === 0) {
  return <div>...</div>; // Early return
}

// Hooks chamados DEPOIS do early return ❌
const columns = useMemo(...);
const comparisonData = useMemo(...);
```

**Solução:**
Mover todos os hooks para ANTES do early return:
```typescript
// ✅ Hooks primeiro
const columns = useMemo(...);
const comparisonData = useMemo(...);
const otherUsers = useMemo(...);
const handleValueChange = useCallback(...);

// Depois o early return
if (instances.length === 0) {
  return <div>...</div>;
}
```

**Prioridade:** 🔴 CRÍTICA (pode causar bugs graves em runtime)

---

### 5. Erro de ban-ts-comment (1 erro)

**Arquivo:**
- `src/components/extraction/ArticleExtractionTable.tsx` (linha 554)

**Problema:**
Uso de `@ts-ignore` ao invés de `@ts-expect-error`.

**Solução:**
Substituir `@ts-ignore` por `@ts-expect-error` (mais seguro, falha se o erro não existir mais).

**Prioridade:** 🟠 ALTA

---

### 6. Erro de no-require-imports (1 erro)

**Arquivo:**
- `tailwind.config.ts` (linha 103)

**Problema:**
Uso de `require()` ao invés de `import`.

**Código problemático:**
```typescript
plugins: [require("tailwindcss-animate")],
```

**Solução:**
Converter para import ES6:
```typescript
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  // ...
  plugins: [tailwindcssAnimate],
} satisfies Config;
```

**Prioridade:** 🟠 ALTA

---

### 7. Erros de no-empty-object-type (3 erros)

**Arquivos:**
- `src/components/ui/textarea.tsx` (linha 5)
- `src/components/ui/command.tsx` (linha 24)
- `src/services/errorTracking.ts` (linha 99)

**Problema:**
Interfaces que apenas estendem outras sem adicionar membros próprios.

**Exemplo:**
```typescript
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
```

**Solução:**
Usar type alias ao invés de interface vazia:
```typescript
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
```

**Prioridade:** 🟡 MÉDIA

---

### 8. Erro de no-namespace (1 erro)

**Arquivo:**
- `src/services/errorTracking.ts` (linha 11)

**Problema:**
Uso de namespace TypeScript (preferir ES modules).

**Solução:**
Converter namespace para exports nomeados ou classe.

**Prioridade:** 🟡 MÉDIA

---

### 9. Erros de no-control-regex (3 erros)

**Arquivo:**
- `supabase/functions/_shared/core/error-handler.ts` (linhas 127, 133-134)

**Problema:**
Caracteres de controle em expressões regulares que podem causar problemas.

**Solução:**
Escapar adequadamente ou usar alternativas mais seguras.

**Prioridade:** 🟡 MÉDIA

---

## 🟡 WARNINGS PRINCIPAIS (1170)

### Categorias de Warnings:

1. **no-console** (~400+ warnings)
   - Uso de `console.log()` ao invés de `console.warn()` ou `console.error()`
   - **Ação:** Substituir por logger apropriado ou remover

2. **@typescript-eslint/no-explicit-any** (~200+ warnings)
   - Uso de `any` explícito
   - **Ação:** Criar tipos apropriados ou usar `unknown`

3. **@typescript-eslint/no-unused-vars** (~300+ warnings)
   - Variáveis/imports não utilizados
   - **Ação:** Remover ou prefixar com `_` se intencional

4. **react-hooks/exhaustive-deps** (~100+ warnings)
   - Dependências faltando em hooks
   - **Ação:** Adicionar dependências ou usar `eslint-disable-next-line` com justificativa

5. **Outros warnings diversos** (~170 warnings)

---

## 📋 PLANO DE EXECUÇÃO

### Fase 1: Erros Críticos (Prioridade Máxima)
1. ✅ Corrigir erros de parsing (types.ts)
2. ✅ Corrigir no-case-declarations
3. ✅ Corrigir no-unused-expressions
4. ✅ Corrigir React Hooks rules
5. ✅ Corrigir ban-ts-comment
6. ✅ Corrigir no-require-imports

### Fase 2: Erros de Qualidade (Prioridade Alta)
7. ✅ Corrigir no-empty-object-type
8. ✅ Corrigir no-namespace
9. ✅ Corrigir no-control-regex

### Fase 3: Warnings (Prioridade Média/Baixa)
10. ⏳ Revisar e corrigir warnings críticos (console.log em produção, etc.)
11. ⏳ Criar tipos apropriados para substituir `any`
12. ⏳ Limpar imports/variáveis não utilizados
13. ⏳ Revisar dependências de hooks

---

## ⚠️ CONSIDERAÇÕES IMPORTANTES

1. **Arquivos Gerados:** `types.ts` e `types-temp.ts` podem ser regenerados. Verificar processo de geração.

2. **Testes:** Após correções, executar testes para garantir que nada quebrou:
   ```bash
   npm test
   npm run lint
   ```

3. **Commits:** Fazer commits incrementais por tipo de correção para facilitar rollback se necessário.

4. **Review:** Algumas correções (especialmente React Hooks) podem afetar comportamento. Testar manualmente.

---

## 📊 MÉTRICAS

- **Erros antes:** 35
- **Erros após (estimado):** 0
- **Warnings antes:** 1170
- **Warnings após (estimado):** ~800-900 (muitos são legítimos ou requerem refatoração maior)

---

**Status:** ⏳ Aguardando aprovação para execução

