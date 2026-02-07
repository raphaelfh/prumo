# Assessment Configuration Implementation Plan

**Date**: 2026-01-29
**Author**: Senior Software Engineer
**Status**: Implementation Complete (Phase 1-4)
**Priority**: High

---

## Implementation Status

| Phase | Status | Details |
|-------|--------|---------|
| 1. Database | COMPLETE | Migration `0034_project_assessment_instruments.sql` |
| 2. Backend | COMPLETE | Models, Schemas, Repository, Service, Endpoints |
| 3. Frontend Services | COMPLETE | Types, Service, Hooks |
| 4. Frontend Components | COMPLETE | InstrumentManager, ConfigureInstrumentFirst |
| 5. Integration | COMPLETE | Connected to AssessmentInterface |

### Files Created/Modified

**Database:**
- `supabase/migrations/0034_project_assessment_instruments.sql`

**Backend:**
- `backend/app/models/assessment.py` - Added ProjectAssessmentInstrument, ProjectAssessmentItem
- `backend/app/models/project.py` - Added assessment_instruments relationship
- `backend/app/schemas/assessment.py` - Added project instrument schemas
- `backend/app/repositories/assessment_repository.py` - Added project instrument repositories
- `backend/app/services/project_assessment_instrument_service.py` - NEW
- `backend/app/api/v1/endpoints/project_assessment_instruments.py` - NEW
- `backend/app/api/v1/router.py` - Registered new routes

**Frontend:**
- `src/types/assessment.ts` - Added project instrument types
- `src/services/projectAssessmentInstrumentService.ts` - NEW
- `src/hooks/assessment/useProjectAssessmentInstruments.ts` - NEW
- `src/hooks/assessment/index.ts` - Exported new hooks
- `src/components/assessment/config/InstrumentManager.tsx` - NEW
- `src/components/assessment/config/ConfigureInstrumentFirst.tsx` - NEW
- `src/components/assessment/config/index.ts` - NEW
- `src/components/assessment/AssessmentInterface.tsx` - Integrated new components

---

## Executive Summary

This document provides a comprehensive analysis and implementation plan to bring the **Assessment (Quality Evaluation)** configuration flow to parity with the **Extraction** flow.

### Problem Statement

Currently:
- **Extraction**: User must configure template before starting → Can import CHARMS or create custom sections/fields
- **Assessment**: Goes directly to PROBAST → No instrument selection or customization

### Expected Behavior

Both flows should follow the same pattern:
1. "Configure o instrumento primeiro" (Configure the instrument first)
2. Options: "Importar PROBAST" or other instrument configured (it should come from a database configured database such as the probast and be versionated) or "Criar instrumento personalizado"
3. It is important that the intrument can come with a description for each field and the llm query for sending to the ai run 
3. Customization: Add/edit domains, items, allowed levels

---

## 1. Architecture Comparison

### Current Database Schema Mapping

| Extraction (Template) | Assessment (Instrument) | Purpose |
|----------------------|------------------------|---------|
| `extraction_templates_global` | `assessment_instruments` | Global templates/instruments |
| `project_extraction_templates` | **MISSING: `project_assessment_instruments`** | Project-specific customization |
| `extraction_entity_types` | `assessment_items` (partial) | Sections/Domains |
| `extraction_fields` | `assessment_items.allowed_levels` (embedded) | Fields/Levels |

### Key Architectural Differences

#### Extraction Flow
```
extraction_templates_global (CHARMS)
          ↓ clone
project_extraction_templates (per project)
          ↓ has many
extraction_entity_types (sections: Model, Dataset)
          ↓ has many
extraction_fields (fields: name, sample_size, etc.)
```

#### Assessment Flow (Current - MISSING MIDDLE LAYER)
```
assessment_instruments (PROBAST - global only)
          ↓ directly references
assessment_items (items: D1.1, D1.2, etc.)
```

**The Missing Piece**: There's no `project_assessment_instruments` table to allow per-project customization of instruments.

---

## 2. What Needs to Be Built

### 2.1 Database Layer (Migrations)

#### New Table: `project_assessment_instruments`
```sql
CREATE TABLE project_assessment_instruments (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  global_instrument_id uuid REFERENCES assessment_instruments(id) ON DELETE SET NULL,
  name varchar NOT NULL,
  description text,
  tool_type varchar NOT NULL,  -- PROBAST, ROBIS, etc.
  version varchar NOT NULL DEFAULT '1.0.0',
  mode varchar NOT NULL DEFAULT 'human',  -- human, ai, hybrid
  is_active boolean NOT NULL DEFAULT true,
  aggregation_rules jsonb,
  schema jsonb,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

#### New Table: `project_assessment_items`
```sql
CREATE TABLE project_assessment_items (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_instrument_id uuid NOT NULL REFERENCES project_assessment_instruments(id) ON DELETE CASCADE,
  global_item_id uuid REFERENCES assessment_items(id) ON DELETE SET NULL,  -- if cloned
  domain varchar NOT NULL,
  item_code varchar NOT NULL,
  question text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,
  allowed_levels jsonb NOT NULL,  -- ["Low", "High", "Unclear"]
  allowed_levels_override jsonb,  -- project-specific override
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_item_code UNIQUE (project_instrument_id, item_code)
);
```

#### Update `assessment_instances`
```sql
-- Add FK to project-specific instrument
ALTER TABLE assessment_instances
  ADD COLUMN project_instrument_id uuid REFERENCES project_assessment_instruments(id);

-- Make instrument_id nullable (can use global or project)
ALTER TABLE assessment_instances
  ALTER COLUMN instrument_id DROP NOT NULL;

-- Add constraint: must have one or the other
ALTER TABLE assessment_instances
  ADD CONSTRAINT chk_instrument_xor CHECK (
    (instrument_id IS NOT NULL AND project_instrument_id IS NULL) OR
    (instrument_id IS NULL AND project_instrument_id IS NOT NULL)
  );
```

### 2.2 Backend Layer (FastAPI)

#### New Endpoints

```python
# app/api/v1/endpoints/assessment_instruments.py

# Project instruments
POST   /api/v1/projects/{project_id}/assessment/instruments           # Create/import instrument
GET    /api/v1/projects/{project_id}/assessment/instruments           # List project instruments
GET    /api/v1/projects/{project_id}/assessment/instruments/{id}      # Get instrument details
PATCH  /api/v1/projects/{project_id}/assessment/instruments/{id}      # Update instrument
DELETE /api/v1/projects/{project_id}/assessment/instruments/{id}      # Delete instrument

# Project items (within instrument)
POST   /api/v1/projects/{project_id}/assessment/instruments/{id}/items      # Add item
GET    /api/v1/projects/{project_id}/assessment/instruments/{id}/items      # List items
PATCH  /api/v1/projects/{project_id}/assessment/instruments/{id}/items/{item_id}  # Update item
DELETE /api/v1/projects/{project_id}/assessment/instruments/{id}/items/{item_id}  # Delete item

# Global instruments (read-only for import)
GET    /api/v1/assessment/instruments/global                          # List global instruments
POST   /api/v1/assessment/instruments/import                          # Import global to project
```

#### New Services

```python
# app/services/assessment_instrument_service.py

class AssessmentInstrumentService:
    """Service for project-level assessment instrument management."""

    async def import_global_instrument(
        self,
        project_id: UUID,
        global_instrument_id: UUID,
        custom_name: str | None = None
    ) -> ProjectAssessmentInstrument:
        """Clone global instrument to project with all items."""

    async def create_custom_instrument(
        self,
        project_id: UUID,
        name: str,
        tool_type: str,  # CUSTOM, PROBAST, etc.
        description: str | None = None
    ) -> ProjectAssessmentInstrument:
        """Create empty custom instrument."""

    async def add_domain(
        self,
        instrument_id: UUID,
        domain_name: str,
        items: list[ItemCreate]
    ) -> list[ProjectAssessmentItem]:
        """Add domain with items to instrument."""

    async def add_item(
        self,
        instrument_id: UUID,
        item: ItemCreate
    ) -> ProjectAssessmentItem:
        """Add single item to instrument."""
```

#### New Schemas

```python
# app/schemas/assessment_instrument.py

class ProjectInstrumentCreate(BaseModel):
    """Create project-specific assessment instrument."""
    name: str
    description: str | None = None
    tool_type: str  # PROBAST, ROBIS, CUSTOM
    mode: Literal["human", "ai", "hybrid"] = "human"

class ProjectInstrumentSchema(BaseModel):
    """Project assessment instrument response."""
    id: UUID
    project_id: UUID
    global_instrument_id: UUID | None
    name: str
    tool_type: str
    version: str
    mode: str
    is_active: bool
    items: list[ProjectItemSchema] = []

class ProjectItemCreate(BaseModel):
    """Create assessment item."""
    domain: str
    item_code: str
    question: str
    sort_order: int = 0
    required: bool = True
    allowed_levels: list[str]  # ["Low", "High", "Unclear"]

class ProjectItemSchema(BaseModel):
    """Assessment item response."""
    id: UUID
    domain: str
    item_code: str
    question: str
    sort_order: int
    required: bool
    allowed_levels: list[str]
```

### 2.3 Frontend Layer (React)

#### New Components

```
src/components/assessment/
├── config/
│   ├── AssessmentConfigEditor.tsx       # Main config editor (like TemplateConfigEditor)
│   ├── InstrumentManager.tsx            # List/manage project instruments
│   ├── DomainAccordion.tsx              # Expandable domain with items
│   ├── ItemsManager.tsx                 # Manage items within domain
│   └── dialogs/
│       ├── ImportInstrumentDialog.tsx   # Import PROBAST, ROBIS, etc.
│       ├── CreateCustomInstrumentDialog.tsx
│       ├── AddDomainDialog.tsx
│       ├── AddItemDialog.tsx
│       └── EditItemDialog.tsx
```

#### New Hooks

```typescript
// src/hooks/assessment/useAssessmentInstruments.ts (refactored)

export function useProjectAssessmentInstruments(projectId: string) {
  return {
    instruments: ProjectAssessmentInstrument[],
    loading: boolean,
    error: string | null,

    // Actions
    importGlobalInstrument: (globalId: string, customName?: string) => Promise<ProjectAssessmentInstrument>,
    createCustomInstrument: (data: InstrumentCreate) => Promise<ProjectAssessmentInstrument>,
    toggleInstrumentActive: (id: string, isActive: boolean) => Promise<void>,
    deleteInstrument: (id: string) => Promise<void>,

    // Global instruments for import
    globalInstruments: GlobalAssessmentInstrument[],
    loadingGlobal: boolean,
  };
}

// src/hooks/assessment/useInstrumentItems.ts

export function useInstrumentItems(instrumentId: string) {
  return {
    items: ProjectAssessmentItem[],
    domains: string[],  // Unique domains
    loading: boolean,

    // Actions
    addItem: (item: ItemCreate) => Promise<ProjectAssessmentItem>,
    updateItem: (itemId: string, data: ItemUpdate) => Promise<ProjectAssessmentItem>,
    deleteItem: (itemId: string) => Promise<void>,
    reorderItems: (itemIds: string[]) => Promise<void>,
  };
}
```

#### New Services

```typescript
// src/services/assessmentInstrumentService.ts

export const assessmentInstrumentService = {
  // Global instruments
  listGlobalInstruments: async (): Promise<GlobalInstrument[]>,

  // Project instruments
  listProjectInstruments: async (projectId: string): Promise<ProjectInstrument[]>,
  createProjectInstrument: async (projectId: string, data: InstrumentCreate): Promise<ProjectInstrument>,
  importGlobalInstrument: async (projectId: string, globalId: string, customName?: string): Promise<ProjectInstrument>,
  updateProjectInstrument: async (instrumentId: string, data: InstrumentUpdate): Promise<ProjectInstrument>,
  deleteProjectInstrument: async (instrumentId: string): Promise<void>,

  // Items
  listItems: async (instrumentId: string): Promise<ProjectItem[]>,
  addItem: async (instrumentId: string, data: ItemCreate): Promise<ProjectItem>,
  updateItem: async (itemId: string, data: ItemUpdate): Promise<ProjectItem>,
  deleteItem: async (itemId: string): Promise<void>,
};
```

### 2.4 UI Flow Changes

#### AssessmentInterface.tsx - Configuration Tab

**Before (Current)**:
```tsx
case 'configuration':
  return (
    <Card>
      <p>A configuração de instrumentos será implementada em breve</p>
    </Card>
  );
```

**After (New)**:
```tsx
case 'configuration':
  return hasActiveInstrument ? (
    <AssessmentConfigEditor
      projectId={projectId}
      instrumentId={activeInstrument.id}
      onInstrumentChange={setActiveInstrument}
    />
  ) : (
    <ConfigureInstrumentFirst
      projectId={projectId}
      onInstrumentCreated={setActiveInstrument}
    />
  );
```

#### New Component: ConfigureInstrumentFirst

```tsx
// Similar to extraction's "Configure o template primeiro"
export function ConfigureInstrumentFirst({ projectId, onInstrumentCreated }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configure o instrumento primeiro</CardTitle>
        <CardDescription>
          Você precisa configurar o instrumento de avaliação que será usado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p>Vá para a aba Configuração e escolha:</p>

        <div className="space-y-4 mt-4">
          <ImportOption
            icon={Download}
            title="Importar PROBAST"
            description="Use o checklist oficial para avaliação de modelos preditivos"
            onClick={() => openImportDialog('PROBAST')}
          />

          <ImportOption
            icon={Download}
            title="Importar ROBIS"
            description="Use o checklist para avaliação de revisões sistemáticas"
            onClick={() => openImportDialog('ROBIS')}
          />

          <ImportOption
            icon={Plus}
            title="Criar instrumento personalizado"
            description="Defina seus próprios domínios e itens de avaliação"
            onClick={openCreateDialog}
          />
        </div>

        <Button onClick={goToConfiguration}>
          Ir para Configuração
        </Button>
      </CardContent>
    </Card>
  );
}
```

---

## 3. Implementation Phases

### Phase 1: Database Migration (Priority: High)
**Estimated Time**: 1 day

1. Create migration `0034_project_assessment_instruments.sql`:
   - `project_assessment_instruments` table
   - `project_assessment_items` table
   - Update `assessment_instances` with new FK
   - RLS policies
   - Indexes

2. Seed data for global instruments (if not exists):
   - PROBAST with all domains and items
   - ROBIS with all domains and items

### Phase 2: Backend Services (Priority: High)
**Estimated Time**: 2 days

1. Create `assessment_instrument_service.py`:
   - Import logic (clone with 2-pass for hierarchy)
   - CRUD operations
   - Validation

2. Create endpoints in `assessment_instruments.py`

3. Create schemas in `assessment_instrument.py`

4. Add to router

5. Write unit tests

### Phase 3: Frontend Components (Priority: High)
**Estimated Time**: 3 days

1. Create hook `useProjectAssessmentInstruments.ts`
2. Create hook `useInstrumentItems.ts`
3. Create service `assessmentInstrumentService.ts`
4. Create components:
   - `AssessmentConfigEditor.tsx`
   - `InstrumentManager.tsx`
   - `DomainAccordion.tsx`
   - `ItemsManager.tsx`
   - Dialog components

### Phase 4: UI Integration (Priority: Medium)
**Estimated Time**: 2 days

1. Update `AssessmentInterface.tsx`:
   - Add "Configure o instrumento primeiro" state
   - Integrate config editor in Configuration tab
   - Update instrument selection

2. Update `ArticleAssessmentTable.tsx`:
   - Use project instrument instead of global
   - Handle case when no instrument configured

3. Update `AssessmentFullScreen.tsx`:
   - Load from project instrument
   - Pass project_instrument_id to hooks

### Phase 5: Testing & Polish (Priority: Medium)
**Estimated Time**: 2 days

1. Integration tests for full flow
2. UI polish and edge cases
3. Error handling
4. Loading states
5. Documentation updates

---

## 4. Data Migration Considerations

### Existing Projects

For projects that already have assessments using global instruments:

```sql
-- Migration script to create project instruments from existing usage
INSERT INTO project_assessment_instruments (
  project_id,
  global_instrument_id,
  name,
  tool_type,
  version,
  mode,
  is_active,
  created_by
)
SELECT DISTINCT
  ai.project_id,
  ai.instrument_id,
  i.name,
  i.tool_type,
  i.version,
  i.mode,
  true,
  (SELECT id FROM profiles WHERE id = auth.uid())
FROM assessment_instances ai
JOIN assessment_instruments i ON i.id = ai.instrument_id
WHERE ai.project_instrument_id IS NULL;

-- Then clone items
INSERT INTO project_assessment_items (...)
SELECT ...;

-- Update instances to point to project instrument
UPDATE assessment_instances ai
SET project_instrument_id = (
  SELECT pai.id
  FROM project_assessment_instruments pai
  WHERE pai.project_id = ai.project_id
    AND pai.global_instrument_id = ai.instrument_id
)
WHERE ai.project_instrument_id IS NULL;
```

---

## 5. API Contract Examples

### Import Global Instrument

**Request**:
```http
POST /api/v1/projects/{project_id}/assessment/instruments/import
Content-Type: application/json

{
  "globalInstrumentId": "uuid-of-probast",
  "customName": "PROBAST - Cardiac Models"  // optional
}
```

**Response**:
```json
{
  "ok": true,
  "data": {
    "id": "new-uuid",
    "projectId": "project-uuid",
    "globalInstrumentId": "uuid-of-probast",
    "name": "PROBAST - Cardiac Models",
    "toolType": "PROBAST",
    "version": "1.0.0",
    "mode": "human",
    "isActive": true,
    "items": [
      {
        "id": "item-uuid",
        "domain": "Participants",
        "itemCode": "D1.1",
        "question": "Were appropriate data sources used?",
        "sortOrder": 1,
        "required": true,
        "allowedLevels": ["Low", "High", "Unclear"]
      }
      // ... more items
    ],
    "createdAt": "2026-01-29T..."
  }
}
```

### Create Custom Instrument

**Request**:
```http
POST /api/v1/projects/{project_id}/assessment/instruments
Content-Type: application/json

{
  "name": "Custom Quality Checklist",
  "description": "Internal quality assessment tool",
  "toolType": "CUSTOM",
  "mode": "hybrid"
}
```

### Add Item to Instrument

**Request**:
```http
POST /api/v1/projects/{project_id}/assessment/instruments/{id}/items
Content-Type: application/json

{
  "domain": "Data Quality",
  "itemCode": "DQ.1",
  "question": "Is the data source reliable?",
  "sortOrder": 1,
  "required": true,
  "allowedLevels": ["Yes", "No", "Partial", "N/A"]
}
```

---

## 6. Success Criteria

### Functional Requirements
- [ ] User can import PROBAST/ROBIS from global instruments
- [ ] User can create custom assessment instrument
- [ ] User can add/edit/delete domains
- [ ] User can add/edit/delete items within domains
- [ ] User can customize allowed levels per item
- [ ] User sees "Configure instrument first" when no instrument selected
- [ ] Configuration tab shows instrument editor when instrument exists
- [ ] Assessment uses project-level instrument (not global directly)

### Non-Functional Requirements
- [ ] API response time < 500ms
- [ ] Clone operation handles 100+ items efficiently
- [ ] UI shows loading states during operations
- [ ] Proper error handling with user-friendly messages
- [ ] Consistent with extraction configuration UX

### Quality Checklist
- [ ] Unit tests for services
- [ ] Integration tests for API endpoints
- [ ] E2E test for full configuration flow
- [ ] Documentation updated (CLAUDE.md, API docs)
- [ ] Code follows existing patterns (DRY, KISS)

---

## 7. Files to Create/Modify

### New Files

**Backend**:
```
backend/app/
├── api/v1/endpoints/assessment_instruments.py  (NEW)
├── services/assessment_instrument_service.py   (NEW)
├── schemas/assessment_instrument.py            (NEW)
├── models/assessment.py                        (MODIFY - add models)
└── repositories/assessment_instrument_repository.py (NEW)
```

**Frontend**:
```
src/
├── components/assessment/config/
│   ├── AssessmentConfigEditor.tsx              (NEW)
│   ├── InstrumentManager.tsx                   (NEW)
│   ├── DomainAccordion.tsx                     (NEW)
│   ├── ItemsManager.tsx                        (NEW)
│   ├── ConfigureInstrumentFirst.tsx            (NEW)
│   └── dialogs/
│       ├── ImportInstrumentDialog.tsx          (NEW)
│       ├── CreateCustomInstrumentDialog.tsx    (NEW)
│       ├── AddDomainDialog.tsx                 (NEW)
│       ├── AddItemDialog.tsx                   (NEW)
│       └── EditItemDialog.tsx                  (NEW)
├── hooks/assessment/
│   ├── useProjectAssessmentInstruments.ts      (NEW)
│   └── useInstrumentItems.ts                   (NEW)
├── services/
│   └── assessmentInstrumentService.ts          (NEW)
└── types/
    └── assessment.ts                           (MODIFY - add types)
```

**Database**:
```
supabase/migrations/
└── 0034_project_assessment_instruments.sql     (NEW)
```

### Files to Modify

```
backend/app/api/v1/router.py                    (add new routes)
backend/app/models/__init__.py                  (export new models)
backend/app/schemas/__init__.py                 (export new schemas)
src/components/assessment/AssessmentInterface.tsx (update config tab)
src/components/assessment/ArticleAssessmentTable.tsx (use project instrument)
src/pages/AssessmentFullScreen.tsx              (use project instrument)
CLAUDE.md                                       (update documentation)
```

---

## 8. Estimated Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Database | 1 day | None |
| Phase 2: Backend | 2 days | Phase 1 |
| Phase 3: Frontend Components | 3 days | Phase 2 |
| Phase 4: UI Integration | 2 days | Phase 3 |
| Phase 5: Testing | 2 days | Phase 4 |
| **Total** | **10 days** | |

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing assessments break | High | Migration script to create project instruments |
| Performance with many items | Medium | Pagination, lazy loading |
| Complex hierarchy (domains) | Medium | Follow extraction pattern exactly |
| RLS policies complexity | Medium | Use existing RLS patterns |

---

## 10. Next Steps

1. **Approval**: Review this plan with team
2. **Database Migration**: Start with Phase 1
3. **Parallel Development**: Backend (Phase 2) and Frontend (Phase 3) can start in parallel after Phase 1
4. **Integration**: Phase 4 brings everything together
5. **QA**: Phase 5 ensures quality

---

**Document Version**: 1.0
**Last Updated**: 2026-01-29
**Related Documents**:
- [ASSESSMENT_SCHEMA_REFACTORING.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/ASSESSMENT_SCHEMA_REFACTORING.md?type=file&root=%252F)
- [BACKEND_RUN_ID_MIGRATION.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/BACKEND_RUN_ID_MIGRATION.md?type=file&root=%252F)
- [CLAUDE.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/CLAUDE.md?type=file&root=%252F)
