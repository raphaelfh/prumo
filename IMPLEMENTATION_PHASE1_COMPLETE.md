# AI Assessment Module Refactoring - FASE 1 COMPLETA ✅

## Data: 2026-01-26

## Resumo Executivo

Implementei com sucesso a **Fase 1: Foundation Layer** da refatoração do módulo AI Assessment, seguindo os padrões de excelência do módulo de Extraction.

---

## 🎯 Objetivos da Fase 1

✅ Criar infraestrutura de run tracking (audit trail completo)
✅ Estender `ai_suggestions` para suportar assessments (DRY principle)
✅ Seed PROBAST instrument completo (20 itens, 4 domínios)
✅ Criar repositories seguindo padrões existentes
✅ Preparar models e exports

---

## 📝 Mudanças Implementadas

### 1. Migrations (3 arquivos)

#### **0027_ai_assessment_runs.sql**
- Nova tabela `ai_assessment_runs` para rastreamento completo de execuções
- Suporte hierárquico: `extraction_instance_id` (PROBAST por modelo)
- Lifecycle tracking: `pending` → `running` → `completed`/`failed`
- Métricas: `parameters` (input), `results` (output), tokens, duração
- 7 indexes estratégicos (status, project, article, instance, GIN para JSONB)
- RLS policies completas (project members)

**Campos principais**:
```sql
- stage: 'assess_single' | 'assess_batch' | 'assess_hierarchical'
- status: 'pending' | 'running' | 'completed' | 'failed'
- parameters: jsonb (model, temperature, item_ids, etc.)
- results: jsonb (tokens_total, duration_ms, suggestions_created, etc.)
- extraction_instance_id: UUID (para PROBAST por modelo específico)
```

#### **0028_extend_ai_suggestions_for_assessments.sql**
- Adiciona `assessment_item_id` a `ai_suggestions`
- Torna `instance_id` e `field_id` opcionais (nullable)
- Constraint XOR: OU extraction OU assessment (nunca ambos)
- 2 novos indexes para queries de assessment

**Benefício DRY**: Reusa toda infraestrutura de suggestions (status, review, etc.)

#### **0029_seed_probast_instrument.sql**
- Insere PROBAST v1.0 completo (instrument + 20 items)
- 4 domínios: participants, predictors, outcome, analysis
- Allowed levels: `["yes", "probably yes", "probably no", "no", "no information"]`
- Aggregation rules para risk of bias
- Fixed UUID para referência: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

**PROBAST domains**:
1. **Participants** (2 items): Data sources, inclusions/exclusions
2. **Predictors** (3 items): Definition, blinding, availability
3. **Outcome** (6 items): Definition, blinding, timing
4. **Analysis** (9 items): Sample size, handling, validation

### 2. Models

#### **AIAssessmentRun** (novo)
```python
class AIAssessmentRun(BaseModel):
    project_id, article_id, instrument_id, extraction_instance_id
    stage, status, parameters, results, error_message
    started_at, completed_at, created_by
```

#### **AISuggestion** (atualizado)
```python
# Antes (apenas extraction):
instance_id: Mapped[UUID]
field_id: Mapped[UUID]

# Depois (extraction OU assessment):
instance_id: Mapped[UUID | None]  # Extraction
field_id: Mapped[UUID | None]     # Extraction
assessment_item_id: Mapped[UUID | None]  # Assessment (novo)
```

### 3. Repositories (3 novos)

#### **AIAssessmentRunRepository**
```python
async def create_run(...) -> AIAssessmentRun
async def start_run(run_id: UUID) -> None
async def complete_run(run_id: UUID, results: dict) -> None
async def fail_run(run_id: UUID, error: str) -> None
async def get_by_project(project_id, status=None) -> list[AIAssessmentRun]
```

#### **AIAssessmentConfigRepository**
```python
async def get_active(project_id, instrument_id=None) -> AIAssessmentConfig | None
```

#### **AIAssessmentPromptRepository**
```python
async def get_by_item(assessment_item_id) -> AIAssessmentPrompt | None
async def get_or_create_default(assessment_item_id) -> AIAssessmentPrompt
```

### 4. Exports Atualizados

- `backend/app/models/__init__.py`: Adiciona `AIAssessmentRun`
- `backend/app/repositories/__init__.py`: Adiciona 3 novos repositories

---

## 🏗️ Arquitetura Implementada

```
┌─────────────────────────────────────┐
│   API Layer (Endpoints)             │  ← HTTP (ainda não refatorado)
├─────────────────────────────────────┤
│   Service Layer (Business Logic)    │  ← Próxima fase
├─────────────────────────────────────┤
│   Repository Layer ✅               │  ← IMPLEMENTADO
│   - AIAssessmentRunRepository       │
│   - AIAssessmentConfigRepository    │
│   - AIAssessmentPromptRepository    │
├─────────────────────────────────────┤
│   Model Layer ✅                    │  ← IMPLEMENTADO
│   - AIAssessmentRun                 │
│   - AISuggestion (estendido)        │
└─────────────────────────────────────┘
         ↓
    ┌─────────────────────────┐
    │  Database ✅            │
    │  - ai_assessment_runs   │
    │  - ai_suggestions       │
    │  - assessment_items     │
    │  - PROBAST seeded       │
    └─────────────────────────┘
```

---

## 🎓 Padrões Seguidos

### ✅ DRY (Don't Repeat Yourself)
- Reusa `ai_suggestions` para extraction E assessment
- Reusa pattern de ExtractionRunRepository
- Constraint XOR no banco evita duplicação de lógica

### ✅ KISS (Keep It Simple, Stupid)
- Repositories simples, focados
- Sem over-engineering (não criamos BaseRunRepository)
- Métodos com responsabilidade única

### ✅ Clean Architecture
- Separação clara de camadas
- Repositories não conhecem HTTP
- Models independentes de business logic
- Dependency injection via constructor

### ✅ Extraction Parity
- Mesma estrutura de run tracking
- Mesmos patterns de lifecycle (pending → running → completed/failed)
- Mesmos índices JSONB (GIN)
- Mesma granularidade de audit trail

---

## 📊 Estatísticas

| Métrica | Valor |
|---------|-------|
| **Migrations** | 3 |
| **Tabelas criadas** | 1 (`ai_assessment_runs`) |
| **Tabelas alteradas** | 1 (`ai_suggestions`) |
| **Instruments seeded** | 1 (PROBAST) |
| **Assessment items** | 20 (4 domínios) |
| **Models criados/atualizados** | 2 |
| **Repositories criados** | 3 |
| **Indexes criados** | 9 |
| **RLS policies** | 3 |
| **Linhas de código** | ~400 |

---

## 🚀 Próximos Passos (Fase 2)

### Fase 2: Config Activation & Service Refactoring (1-2 dias)

**Tarefas**:
1. ✏️ Refatorar `AIAssessmentService`:
   - Adicionar run tracking
   - Usar `AIAssessmentConfigRepository` (ler DB em vez de hardcode)
   - Usar `AIAssessmentPromptRepository` (prompts customizados)
   - Criar suggestions em vez de assessments finais
   - Adicionar BYOK support (`openai_api_key` parameter)

2. 📝 Criar novos schemas:
   - `AssessmentSuggestionResponse`
   - `ReviewSuggestionRequest`
   - `BatchAssessmentRequest`

3. 🔧 Atualizar endpoint:
   - `/api/v1/ai-assessment/assess` → usa novo service
   - Retorna suggestion_id em vez de assessment_id

### Fase 3: Suggestion Workflow (2 dias)

**Tarefas**:
1. Criar endpoint `/api/v1/ai-assessment-suggestions/`
2. Implementar review workflow (accept/reject)
3. Batch review support
4. Frontend integration

### Fase 4: Batch Optimization (1-2 dias)

**Tarefas**:
1. Implementar batch com memory context
2. Hierarchical assessment (PROBAST todos modelos)
3. PDF reuse optimization

---

## ✅ Checklist de Validação

Antes de aplicar migrations, verificar:

- [x] Migrations estão em ordem correta (0027, 0028, 0029)
- [x] Models importados corretamente em `__init__.py`
- [x] Repositories exportados em `__init__.py`
- [x] Constraint XOR em `ai_suggestions` está correto
- [x] PROBAST seed tem UUID fixo
- [x] Indexes GIN para JSONB criados
- [x] RLS policies implementadas

---

## 🔍 Como Testar (Manual)

### 1. Aplicar Migrations
```bash
cd supabase
supabase migration up
```

### 2. Verificar PROBAST Seed
```sql
SELECT
  ai.tool_type,
  ai.name,
  ai.version,
  COUNT(aitm.id) as total_items,
  COUNT(DISTINCT aitm.domain) as total_domains
FROM assessment_instruments ai
LEFT JOIN assessment_items aitm ON aitm.instrument_id = ai.id
WHERE ai.tool_type = 'PROBAST'
GROUP BY ai.id, ai.tool_type, ai.name, ai.version;

-- Expected: 1 instrument, 20 items, 4 domains
```

### 3. Testar Repository (Python)
```python
from app.repositories import AIAssessmentRunRepository

# Create run
run = await repo.create_run(
    project_id=UUID(...),
    article_id=UUID(...),
    instrument_id=UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890"),  # PROBAST
    created_by=UUID(...),
    stage="assess_single",
    parameters={"model": "gpt-4o-mini"},
)

# Start run
await repo.start_run(run.id)

# Complete run
await repo.complete_run(run.id, {"tokens_total": 1500})

# Query
runs = await repo.get_by_project(project_id, status="completed")
```

---

## 📚 Referências

- [PROBAST Official](https://www.probast.org/)
- [Extraction Module Analysis](./docs/templates/CHARMS_2.0_COMPLETE_TEMPLATE.md)
- [Architecture Guide](./docs/guias/ARQUITETURA_BACKEND.md)
- [Plan Document](./IMPLEMENTATION_PLAN.md)

---

## 👥 Autoria

**Implementado por**: Claude Code (Anthropic) + Usuário
**Data**: 2026-01-26
**Branch**: `dev`
**Commit Message Sugerido**:
```
feat(assessment): implement Phase 1 - foundation layer with run tracking

- Add ai_assessment_runs table for audit trail
- Extend ai_suggestions to support assessment suggestions (DRY)
- Seed PROBAST instrument (20 items, 4 domains)
- Create repositories: AIAssessmentRunRepository, Config, Prompt
- Update models to support hierarchical assessments (PROBAST by model)

BREAKING CHANGE: ai_suggestions.field_id is now nullable (XOR with assessment_item_id)

Refs: #assessment-refactor
```

---

**Status**: ✅ **FASE 1 COMPLETA E PRONTA PARA COMMIT**
**Next**: Fase 2 - Service Refactoring
**ETA Fase 2**: 1-2 dias
