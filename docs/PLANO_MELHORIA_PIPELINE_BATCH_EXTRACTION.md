# Plano de Melhoria: Pipeline de Extração em Batch

## 📊 Análise do Problema

### Problema Identificado
- **Timeout**: Pipeline de extração de todas as seções falha com timeout de 145s
- **Causa raiz**: Processamento sequencial de múltiplas seções em uma única Edge Function (limite 150s)
- **Impacto**: Usuário não consegue extrair todas as seções de uma vez

### Limitações Técnicas
1. **Supabase Edge Functions**: Timeout rígido de 150s (não configurável)
2. **Processamento sequencial**: Cada seção leva ~30-60s (com retries)
3. **Sem feedback**: Usuário não vê progresso durante extração longa
4. **Sem resiliência**: Falha parcial não permite retomar de onde parou

---

## 🎯 Objetivos

1. **Escalabilidade**: Suportar modelos com 5+ seções sem timeout
2. **UX**: Feedback de progresso em tempo real
3. **Resiliência**: Recuperação de falhas parciais
4. **Performance**: Otimizar tempo total de extração
5. **Manutenibilidade**: Código DRY, KISS e Clean

---

## 🏗️ Arquitetura Proposta

### Opção A: Chunking com Múltiplas Chamadas (RECOMENDADA)
**Estratégia**: Dividir seções em grupos menores (2-3 por chamada) e processar sequencialmente no frontend.

**Vantagens**:
- ✅ Respeita limite de 150s do Supabase
- ✅ Feedback de progresso por chunk
- ✅ Recuperação parcial (chunks que falharam podem ser retentados)
- ✅ Implementação simples (reutiliza código existente)
- ✅ KISS: Solução direta sem complexidade desnecessária

**Desvantagens**:
- ⚠️ Múltiplas chamadas HTTP (overhead de rede)
- ⚠️ PDF processado múltiplas vezes (pode ser otimizado com cache)

**Implementação**:
```
Frontend:
  1. Buscar lista de seções do modelo
  2. Dividir em chunks de 2-3 seções
  3. Para cada chunk:
     - Chamar edge function com extractAllSections=true + sectionIds[]
     - Mostrar progresso (chunk X de Y)
     - Aguardar conclusão
     - Se falhar, permitir retry do chunk
  4. Consolidar resultados
```

### Opção B: Queue System com Background Jobs
**Estratégia**: Usar fila (Supabase Queue ou pg_cron) para processar seções de forma assíncrona.

**Vantagens**:
- ✅ Processamento verdadeiramente assíncrono
- ✅ Escalável para muitos modelos
- ✅ Retry automático de jobs falhados

**Desvantagens**:
- ❌ Complexidade alta (infraestrutura de fila)
- ❌ Overhead de setup e manutenção
- ❌ Não é KISS para o caso de uso atual

**Decisão**: **NÃO RECOMENDADO** para MVP (complexidade > benefício)

### Opção C: Processamento Paralelo Controlado
**Estratégia**: Processar 2-3 seções em paralelo dentro da mesma Edge Function.

**Vantagens**:
- ✅ Reduz tempo total
- ✅ Mantém memória compartilhada

**Desvantagens**:
- ❌ Complexidade de sincronização
- ❌ Risco de timeout se paralelismo for alto
- ❌ Dificulta debugging

**Decisão**: **CONSIDERAR** como otimização futura após Opção A

---

## 📋 Plano de Implementação (Opção A)

### Fase 1: Refatoração do Backend (DRY)

#### 1.1 Extrair Lógica de Processamento de Seção Única
**Objetivo**: Criar método reutilizável `processSingleSection()` que pode ser usado tanto para extração única quanto batch.

**Arquivos**:
- `supabase/functions/section-extraction/pipeline.ts`

**Mudanças**:
```typescript
// Método privado reutilizável
private async processSingleSection(
  pdfText: string,
  entityType: EntityType,
  options: BatchSectionOptions,
  memoryHistory: Array<{ entityTypeName: string; summary: string }>,
  sharedModel: ChatOpenAI,
  llmExtractor: UnifiedExtractor,
  templateBuilder: SectionTemplateBuilder,
  dbWriter: SectionDBWriter,
): Promise<SectionResult> {
  // Lógica extraída do loop atual
  // Retorna SectionResult com sucesso/erro
}

// Método público para batch com chunking
async runAllSectionsWithMemoryChunked(
  pdfBuffer: Uint8Array,
  options: BatchSectionOptions & { sectionIds?: string[] }, // Novo: filtrar seções específicas
): Promise<BatchSectionResult> {
  // 1. Processar PDF uma vez
  // 2. Buscar seções (filtrar por sectionIds se fornecido)
  // 3. Loop: processSingleSection() para cada seção
  // 4. Retornar resultados agregados
}
```

**Benefícios**:
- ✅ DRY: Lógica de processamento única reutilizada
- ✅ Testável: `processSingleSection()` pode ser testado isoladamente
- ✅ Flexível: Suporta batch completo ou chunk específico

#### 1.2 Adicionar Suporte a Filtro de Seções
**Objetivo**: Permitir processar apenas um subconjunto de seções (para chunking).

**Mudanças**:
```typescript
// Em getChildEntityTypes(), adicionar filtro opcional
private async getChildEntityTypes(
  parentEntityTypeId: string,
  templateId: string,
  sectionIds?: string[], // NOVO: filtrar seções específicas
): Promise<Array<{ id: string; name: string; label: string; sort_order: number }>> {
  let query = this.supabase
    .from("extraction_entity_types")
    .select("id, name, label, sort_order")
    .eq("parent_entity_type_id", parentEntityTypeId)
    .order("sort_order", { ascending: true });

  if (sectionIds && sectionIds.length > 0) {
    query = query.in("id", sectionIds); // Filtrar por IDs específicos
  }

  // ... resto da lógica
}
```

**Benefícios**:
- ✅ Permite processar chunks específicos
- ✅ Mantém ordem (sort_order) mesmo com filtro

#### 1.3 Otimizar Processamento de PDF (Cache)
**Objetivo**: Evitar reprocessar PDF em múltiplas chamadas de chunk.

**Estratégia**: 
- **Opção 1**: Cachear PDF processado no frontend (localStorage/sessionStorage) e enviar texto já extraído
- **Opção 2**: Cachear no backend usando Supabase Storage (mais complexo)

**Decisão**: **Opção 1** (mais simples, KISS)

**Mudanças**:
```typescript
// No schema de request, adicionar campo opcional
interface BatchSectionExtractionRequest {
  // ... campos existentes
  pdfText?: string; // NOVO: texto do PDF já extraído (evita reprocessar)
}
```

**Benefícios**:
- ✅ Reduz tempo de processamento em chunks subsequentes
- ✅ KISS: Solução simples sem infraestrutura adicional

---

### Fase 2: Refatoração do Frontend (Clean Code)

#### 2.1 Criar Hook de Chunking
**Objetivo**: Abstrair lógica de chunking e progresso.

**Arquivo**: `src/hooks/extraction/useBatchSectionExtractionChunked.ts`

**Interface**:
```typescript
export interface UseBatchSectionExtractionChunkedReturn {
  extractAllSections: (request: BatchSectionExtractionRequest) => Promise<void>;
  loading: boolean;
  error: string | null;
  progress: {
    currentChunk: number;
    totalChunks: number;
    currentSection: string | null;
    completedSections: number;
    totalSections: number;
  } | null;
}

export function useBatchSectionExtractionChunked(options?: {
  onProgress?: (progress: Progress) => void;
  onSuccess?: (result: BatchResult) => void;
  chunkSize?: number; // Padrão: 2
}): UseBatchSectionExtractionChunkedReturn
```

**Lógica**:
```typescript
// 1. Buscar lista de seções do modelo (via API ou cache)
// 2. Dividir em chunks de tamanho configurável (padrão: 2)
// 3. Processar PDF uma vez e cachear texto
// 4. Para cada chunk:
//    - Atualizar progresso
//    - Chamar service com sectionIds do chunk + pdfText
//    - Aguardar conclusão
//    - Se falhar, permitir retry
// 5. Consolidar resultados de todos os chunks
```

**Benefícios**:
- ✅ Clean: Separação de responsabilidades
- ✅ Reutilizável: Pode ser usado em outros contextos
- ✅ Testável: Lógica isolada em hook

#### 2.2 Adicionar UI de Progresso
**Objetivo**: Mostrar progresso visual durante extração.

**Componente**: `src/components/extraction/BatchExtractionProgress.tsx`

**Features**:
- Barra de progresso (chunks e seções)
- Lista de seções sendo processadas
- Tempo estimado restante
- Botão de cancelar (opcional)

**Integração**:
```tsx
// Em ExtractionFormView.tsx
const { extractAllSections, loading, progress } = useBatchSectionExtractionChunked({
  onProgress: (p) => setExtractionProgress(p),
  onSuccess: handleSuccess,
});

{loading && progress && (
  <BatchExtractionProgress progress={progress} />
)}
```

**Benefícios**:
- ✅ UX melhorada: Usuário vê o que está acontecendo
- ✅ Reduz ansiedade: Feedback constante

#### 2.3 Adicionar Cache de PDF no Frontend
**Objetivo**: Evitar reprocessar PDF em múltiplas chamadas.

**Implementação**:
```typescript
// Em useBatchSectionExtractionChunked.ts
const [pdfTextCache, setPdfTextCache] = useState<string | null>(null);

// Na primeira chamada, processar PDF e cachear
if (!pdfTextCache) {
  const pdfText = await extractPDFText(articleId); // Helper para extrair texto
  setPdfTextCache(pdfText);
}

// Em chamadas subsequentes, usar cache
const request = {
  ...baseRequest,
  pdfText: pdfTextCache, // Enviar texto já extraído
};
```

**Benefícios**:
- ✅ Performance: Reduz tempo de processamento
- ✅ KISS: Cache simples no frontend

---

### Fase 3: Melhorias de Resiliência

#### 3.1 Retry Inteligente de Chunks
**Objetivo**: Permitir retry de chunks que falharam sem reprocessar chunks bem-sucedidos.

**Implementação**:
```typescript
// Em useBatchSectionExtractionChunked.ts
interface ChunkResult {
  chunkIndex: number;
  sectionIds: string[];
  success: boolean;
  result?: BatchSectionResult;
  error?: string;
}

const [chunkResults, setChunkResults] = useState<ChunkResult[]>([]);

// Após processar chunk, salvar resultado
// Se falhar, permitir retry apenas desse chunk
const retryChunk = async (chunkIndex: number) => {
  const chunk = chunks[chunkIndex];
  // Retry apenas desse chunk específico
};
```

**Benefícios**:
- ✅ Resiliência: Falhas parciais não invalidam trabalho completo
- ✅ Eficiência: Não reprocessa chunks bem-sucedidos

#### 3.2 Salvamento de Estado (Checkpoint)
**Objetivo**: Permitir retomar extração interrompida.

**Estratégia**: Salvar progresso no localStorage e permitir retomar.

**Implementação**:
```typescript
// Salvar estado após cada chunk
localStorage.setItem(
  `batch-extraction-${articleId}-${parentInstanceId}`,
  JSON.stringify({
    chunks: chunkResults,
    completedChunks: completedChunks.length,
    timestamp: Date.now(),
  })
);

// Ao iniciar, verificar se há estado salvo
const savedState = localStorage.getItem(...);
if (savedState) {
  // Perguntar ao usuário se deseja retomar
  // Se sim, processar apenas chunks não completados
}
```

**Benefícios**:
- ✅ Resiliência: Recuperação de interrupções
- ✅ UX: Não perde progresso

---

### Fase 4: Otimizações de Performance

#### 4.1 Reduzir Tamanho de Memória Resumida
**Objetivo**: Limitar crescimento do histórico de memória.

**Mudanças**:
```typescript
// Em generateExtractionSummary(), limitar tamanho mais agressivamente
private generateExtractionSummary(
  entityType: EntityType,
  extractedData: Record<string, any>
): string {
  // Limitar a 150 chars (reduzido de 200)
  // Manter apenas campos mais importantes
  const summary = JSON.stringify(extractedData, null, 0);
  return summary.substring(0, 150) + (summary.length > 150 ? '...' : '');
}

// Limitar histórico a últimas 5 seções (FIFO)
if (memoryHistory.length > 5) {
  memoryHistory.shift(); // Remover mais antiga
}
```

**Benefícios**:
- ✅ Performance: Reduz tokens enviados ao LLM
- ✅ KISS: Solução simples

#### 4.2 Processamento Paralelo Controlado (Futuro)
**Objetivo**: Processar 2 seções em paralelo quando possível.

**Implementação** (Fase 2, após validar Opção A):
```typescript
// Processar chunks de 2 seções em paralelo
const chunkPromises = chunks.map(chunk => 
  processChunk(chunk)
);

// Limitar a 2 chunks em paralelo
const results = await Promise.allSettled(
  chunkPromises.slice(0, 2)
);
```

**Benefícios**:
- ✅ Performance: Reduz tempo total
- ⚠️ Complexidade: Adiciona sincronização

---

## 📐 Estrutura de Arquivos

```
supabase/functions/section-extraction/
├── pipeline.ts (refatorado)
│   ├── processSingleSection() [NOVO - método privado]
│   ├── runAllSectionsWithMemoryChunked() [NOVO - suporta filtro]
│   └── runAllSectionsWithMemory() [DEPRECATED - manter para compatibilidade]
│
src/hooks/extraction/
├── useBatchSectionExtraction.ts (existente - manter)
└── useBatchSectionExtractionChunked.ts [NOVO]
│
src/components/extraction/
└── BatchExtractionProgress.tsx [NOVO]
│
src/services/sectionExtractionService.ts
└── extractAllSections() [MODIFICADO - suporta sectionIds e pdfText]
```

---

## 🧪 Estratégia de Testes

### Testes Unitários
1. **`processSingleSection()`**: Testar processamento de seção única isoladamente
2. **Chunking logic**: Testar divisão de seções em chunks
3. **Cache de PDF**: Testar cache e reutilização

### Testes de Integração
1. **Chunking end-to-end**: Processar modelo com 5+ seções em chunks
2. **Retry de chunk**: Simular falha e retry
3. **Progress tracking**: Verificar atualização de progresso

### Testes de Performance
1. **Tempo total**: Comparar tempo de batch único vs chunked
2. **Uso de tokens**: Verificar redução com memória limitada
3. **Timeout**: Garantir que nenhum chunk ultrapassa 150s

---

## 📊 Métricas de Sucesso

1. **Taxa de sucesso**: >95% de extrações completas
2. **Tempo médio**: <5min para modelo com 5 seções
3. **Feedback**: Progresso visível a cada 10-15s
4. **Resiliência**: Recuperação de 80%+ de falhas parciais

---

## 🚀 Roadmap de Implementação

### Sprint 1: Fundação (Semana 1)
- [ ] Refatorar `processSingleSection()` no backend
- [ ] Adicionar suporte a `sectionIds` e `pdfText` no schema
- [ ] Implementar `runAllSectionsWithMemoryChunked()`
- [ ] Testes unitários de `processSingleSection()`

### Sprint 2: Frontend Chunking (Semana 2)
- [ ] Criar hook `useBatchSectionExtractionChunked`
- [ ] Implementar cache de PDF no frontend
- [ ] Adicionar UI de progresso (`BatchExtractionProgress`)
- [ ] Testes de integração chunking

### Sprint 3: Resiliência (Semana 3)
- [ ] Implementar retry inteligente de chunks
- [ ] Adicionar salvamento de estado (checkpoint)
- [ ] UI para retomar extração interrompida
- [ ] Testes de resiliência

### Sprint 4: Otimizações (Semana 4)
- [ ] Reduzir tamanho de memória resumida
- [ ] Otimizar processamento de PDF
- [ ] Considerar processamento paralelo controlado
- [ ] Testes de performance

---

## 🔍 Considerações de Design

### DRY (Don't Repeat Yourself)
- ✅ Extrair `processSingleSection()` reutilizável
- ✅ Reutilizar lógica de extração única para batch
- ✅ Compartilhar tipos e interfaces

### KISS (Keep It Simple, Stupid)
- ✅ Chunking simples no frontend (sem fila complexa)
- ✅ Cache de PDF no frontend (sem infraestrutura adicional)
- ✅ Progress tracking básico (sem WebSocket)

### Clean Code
- ✅ Separação de responsabilidades (hook de chunking isolado)
- ✅ Nomes descritivos (`processSingleSection`, `runAllSectionsWithMemoryChunked`)
- ✅ Documentação clara (JSDoc)

---

## ⚠️ Riscos e Mitigações

### Risco 1: Overhead de Múltiplas Chamadas
**Mitigação**: 
- Cache de PDF reduz tempo de processamento
- Chunks pequenos (2 seções) mantêm overhead baixo
- Monitorar tempo total vs batch único

### Risco 2: Complexidade de Estado
**Mitigação**:
- Usar hook dedicado para gerenciar estado
- Testes abrangentes de chunking
- Documentação clara

### Risco 3: Falhas Parciais Confusas
**Mitigação**:
- UI clara mostrando quais chunks falharam
- Retry fácil de chunks específicos
- Mensagens de erro descritivas

---

## 📝 Notas Finais

- **Prioridade**: Implementar Opção A (Chunking) primeiro
- **Futuro**: Considerar Opção C (Paralelismo) após validar Opção A
- **Métricas**: Monitorar tempo total, taxa de sucesso e feedback de usuários
- **Iteração**: Ajustar tamanho de chunk baseado em métricas reais

---

**Autor**: AI Assistant  
**Data**: 2025-01-XX  
**Status**: Plano de Implementação

