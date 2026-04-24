# 📊 Documentação do Schema do Banco de Dados

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura e Padrões](#arquitetura-e-padrões)
3. [Tabelas Principais (Core)](#tabelas-principais-core)
4. [Tabelas de Artigos](#tabelas-de-artigos)
5. [Sistema de Extração de Dados](#sistema-de-extração-de-dados)
6. [Sistema de Anotações](#sistema-de-anotações)
7. [Sistema de IA e Execuções](#sistema-de-ia-e-execuções)
8. [Tabelas Auxiliares](#tabelas-auxiliares)
9. [Diagramas de Relacionamento](#diagramas-de-relacionamento)
10. [Exemplos Práticos](#exemplos-práticos)

---

## 🎯 Visão Geral

Este banco de dados foi projetado para suportar um sistema de **revisão sistemática de literatura científica** com as seguintes capacidades:

- ✅ Gerenciamento de projetos colaborativos
- ✅ Importação e organização de artigos científicos
- ✅ Extração estruturada de dados usando templates (CHARMS, PICOS, etc.)
- ✅ Anotações e comentários em PDFs
- ✅ Sugestões de IA para extração automática
- ✅ Avaliação de qualidade dos estudos
- ✅ Integração com Zotero

### Tecnologias Utilizadas

- **PostgreSQL** (via Supabase)
- **SQLAlchemy** (ORM Python)
- **Row Level Security (RLS)** para segurança
- **JSONB** para dados flexíveis
- **UUID** como chaves primárias

---

## 🏗️ Arquitetura e Padrões

### Padrão de Nomenclatura

- **Tabelas**: `snake_case` plural (ex: `article_files`)
- **Campos**: `snake_case` (ex: `created_at`)
- **Enums**: `snake_case` (ex: `extraction_source`)
- **Constraints**: `{tabela}_{campo}_fkey` para FKs

### Estrutura Base dos Modelos

Todos os modelos principais herdam de `BaseModel` que inclui:

```python
- id: UUID (chave primária)
- created_at: timestamp
- updated_at: timestamp (atualizado automaticamente)
```

### Tipos de Relacionamento

- **CASCADE**: Quando o pai é deletado, filhos também são (ex: `projects` → `articles`)
- **RESTRICT**: Impede deleção se houver filhos (ex: `project_extraction_templates` → `extraction_runs`)
- **SET NULL**: Define FK como NULL quando pai é deletado (ex: `profiles` → `extracted_values.reviewer_id`)

### Uso de JSONB

Campos JSONB são usados para:
- **Dados flexíveis**: `metadata`, `settings`, `schema`
- **Arrays estruturados**: `evidence`, `keywords`
- **Configurações**: `parameters`, `results`

**Índices GIN** são criados em campos JSONB para busca eficiente.

---

## 👥 Tabelas Principais (Core)

### 1. `profiles` - Perfis de Usuários

**Propósito**: Armazena informações dos usuários do sistema.

**Estrutura**:
```sql
profiles
├── id (UUID, PK, FK → auth.users)
├── email (text)
├── full_name (text)
├── avatar_url (text)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- O `id` é o mesmo do `auth.users` do Supabase (sincronização automática)
- Trigger cria profile automaticamente quando usuário é criado
- RLS: usuários só veem/editam o próprio perfil

**Relacionamentos**:
- ➡️ Um para muitos: `projects` (como criador)
- ➡️ Um para muitos: `project_members` (como membro)

**Exemplo de Uso**:
```python
# Buscar perfil do usuário
profile = await profile_repo.get_by_id(user_id)

# Criar projeto (profile.id será usado em created_by_id)
project = Project(name="Minha Revisão", created_by_id=profile.id)
```

---

### 2. `projects` - Projetos de Revisão

**Propósito**: Representa um projeto de revisão sistemática.

**Estrutura**:
```sql
projects
├── id (UUID, PK)
├── name (varchar)                    # Nome do projeto
├── description (text)                 # Descrição
├── created_by_id (UUID, FK → profiles)
├── settings (jsonb)                   # Configurações (blind_mode, etc.)
├── is_active (boolean)               # Projeto ativo?
├── review_title (text)                # Título da revisão
├── review_type (enum)                 # Tipo: interventional, predictive_model, etc.
├── review_keywords (jsonb)            # Palavras-chave
├── eligibility_criteria (jsonb)       # Critérios de elegibilidade
├── study_design (jsonb)               # Design do estudo
├── picots_config_ai_review (jsonb)    # Configuração PICOTS
├── assessment_scope (varchar)         # 'article' ou 'extraction_instance'
├── assessment_entity_type_id (UUID, FK → extraction_entity_types)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- Projeto pode ter múltiplos membros (`project_members`)
- Projeto contém múltiplos artigos (`articles`)
- Projeto pode ter múltiplos templates de extração (`project_extraction_templates`)
- `assessment_entity_type_id` define qual entidade será avaliada (se `assessment_scope = 'extraction_instance'`)

**Relacionamentos**:
- ➡️ Pertence a: `profiles` (criador)
- ➡️ Um para muitos: `project_members`, `articles`, `project_extraction_templates`
- ➡️ Opcional: `extraction_entity_types` (para assessment)

**Exemplo de Uso**:
```python
# Criar novo projeto
project = Project(
    name="Revisão de Modelos Preditivos",
    review_type="predictive_model",
    created_by_id=user_id,
    settings={"blind_mode": False}
)

# Buscar projetos do usuário
user_projects = await project_repo.get_by_creator(user_id)
```

---

### 3. `project_members` - Membros do Projeto

**Propósito**: Gerencia membros e suas permissões em cada projeto.

**Estrutura**:
```sql
project_members
├── id (UUID, PK)
├── project_id (UUID, FK → projects, CASCADE)
├── user_id (UUID, FK → profiles, CASCADE)
├── role (enum)                        # manager, reviewer, viewer, consensus
├── permissions (jsonb)                # {can_export: true, ...}
├── invitation_email (text)            # Email do convite
├── invitation_token (text)            # Token para aceitar convite
├── invitation_sent_at (timestamptz)
├── invitation_accepted_at (timestamptz)
├── created_by_id (UUID, FK → profiles)
├── created_at (timestamptz)
└── updated_at (timestamptz)

UNIQUE(project_id, user_id)            # Um usuário só pode ser membro uma vez
```

**Características**:
- **Roles**:
  - `manager`: Pode gerenciar projeto e membros
  - `reviewer`: Pode revisar e extrair dados
  - `viewer`: Apenas visualização
  - `consensus`: Responsável por consenso final
- Sistema de convites: permite convidar usuários por email
- Constraint UNIQUE garante que um usuário não pode ser membro duas vezes do mesmo projeto

**Relacionamentos**:
- ➡️ Pertence a: `projects` (CASCADE)
- ➡️ Pertence a: `profiles` (usuário)
- ➡️ Opcional: `profiles` (criador do convite)

**Exemplo de Uso**:
```python
# Adicionar membro ao projeto
member = ProjectMember(
    project_id=project_id,
    user_id=user_id,
    role="reviewer",
    permissions={"can_export": True},
    created_by_id=current_user_id
)

# Verificar se usuário é manager
is_manager = await check_is_project_manager(project_id, user_id)
```

---

## 📄 Tabelas de Artigos

### 4. `articles` - Artigos Científicos

**Propósito**: Armazena metadados bibliográficos completos dos artigos.

**Estrutura**:
```sql
articles
├── id (UUID, PK)
├── project_id (UUID, FK → projects, CASCADE)
├── title (text, NOT NULL)
├── abstract (text)
├── language (varchar)
├── publication_year (integer)
├── publication_month (integer)
├── publication_day (integer)
├── journal_title (text)
├── journal_issn (varchar)
├── journal_eissn (varchar)
├── volume (varchar)
├── issue (varchar)
├── pages (varchar)
├── doi (text)
├── pmid (text)
├── pmcid (text)
├── arxiv_id (text)
├── keywords (text[])                  # Array de palavras-chave
├── authors (text[])                   # Array de autores
├── mesh_terms (text[])                # Termos MeSH
├── url_landing (text)
├── url_pdf (text)
├── study_design (varchar)
├── registration (jsonb)               # Dados de registro
├── funding (jsonb)                    # Informações de financiamento
├── zotero_item_key (text)             # Chave do Zotero
├── zotero_collection_key (text)       # Collection do Zotero
├── zotero_version (integer)            # Versão para sync
├── hash_fingerprint (text)             # Hash para deduplicação
├── row_version (bigint)                # Controle de versão otimista
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- Campos extensos para metadados bibliográficos completos
- Suporte a múltiplos identificadores (DOI, PMID, PMCID, etc.)
- Integração com Zotero via `zotero_item_key`
- `row_version` para controle de concorrência otimista
- Índices GIN para busca full-text em `title`, `keywords`, `mesh_terms`

**Relacionamentos**:
- ➡️ Pertence a: `projects` (CASCADE)
- ➡️ Um para muitos: `article_files`, `extraction_instances`, `extracted_values`, `article_highlights`, `article_boxes`, `article_annotations`

**Exemplo de Uso**:
```python
# Criar artigo
article = Article(
    project_id=project_id,
    title="Machine Learning for Medical Diagnosis",
    doi="10.1234/example",
    publication_year=2024,
    keywords=["machine learning", "diagnosis", "healthcare"]
)

# Buscar artigos por DOI
article = await article_repo.get_by_doi(project_id, "10.1234/example")
```

---

### 5. `article_files` - Arquivos dos Artigos

**Propósito**: Gerencia arquivos PDF e outros documentos associados aos artigos.

**Estrutura**:
```sql
article_files
├── id (UUID, PK)
├── project_id (UUID, FK → projects, CASCADE)
├── article_id (UUID, FK → articles, CASCADE)
├── file_type (varchar, NOT NULL)      # 'pdf', 'docx', etc.
├── storage_key (text, NOT NULL)        # Chave no storage (Supabase)
├── original_filename (text)
├── bytes (bigint)                      # Tamanho do arquivo
├── md5 (text)                          # Hash MD5
├── file_role (enum)                    # MAIN, SUPPLEMENT, PROTOCOL, etc.
├── text_raw (text)                     # Texto extraído (raw)
├── text_html (text)                    # Texto extraído (HTML)
├── extraction_status (varchar)         # pending, completed, failed
├── extraction_error (text)
├── extracted_at (timestamptz)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- **File Roles**:
  - `MAIN`: Artigo principal
  - `SUPPLEMENT`: Material suplementar
  - `PROTOCOL`: Protocolo do estudo
  - `DATASET`: Dataset
  - `APPENDIX`: Apêndice
  - `FIGURE`: Figura
  - `OTHER`: Outro
- Armazena texto extraído do PDF em dois formatos (raw e HTML)
- Rastreia status da extração de texto

**Relacionamentos**:
- ➡️ Pertence a: `projects` e `articles` (CASCADE)
- ➡️ Um para muitos: `article_highlights`, `article_boxes`, `extraction_evidence`

**Exemplo de Uso**:
```python
# Criar arquivo PDF
file = ArticleFile(
    project_id=project_id,
    article_id=article_id,
    file_type="pdf",
    storage_key="articles/abc123.pdf",
    file_role="MAIN",
    extraction_status="pending"
)

# Após extrair texto
file.text_raw = extracted_text
file.text_html = extracted_html
file.extraction_status = "completed"
file.extracted_at = datetime.now()
```

---

## 🔍 Sistema de Extração de Dados

O sistema de extração permite definir templates estruturados (como CHARMS, PICOS) e extrair dados dos artigos de forma padronizada.

### Hierarquia de Templates

```
extraction_templates_global (CHARMS, PICOS, etc.)
    └── project_extraction_templates (clone customizado)
            └── extraction_entity_types (dataset, model, etc.)
                    └── extraction_fields (campos específicos)
```

### 6. `extraction_templates_global` - Templates Globais

**Propósito**: Templates compartilhados entre projetos (CHARMS, PICOS, etc.).

**Estrutura**:
```sql
extraction_templates_global
├── id (UUID, PK)
├── name (varchar, NOT NULL)           # "CHARMS 2.0"
├── description (text)
├── framework (enum)                   # CHARMS, PICOS, CUSTOM
├── version (varchar)                  # "1.0.0" (semver)
├── is_global (boolean)                 # Sempre true
├── schema (jsonb)                      # Schema completo do template
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- Templates são imutáveis (não editados diretamente)
- Projetos clonam templates globais para customização
- `schema` contém estrutura completa em JSONB

**Relacionamentos**:
- ➡️ Um para muitos: `extraction_entity_types` (via `template_id`)
- ➡️ Um para muitos: `project_extraction_templates` (como origem)

---

### 7. `project_extraction_templates` - Templates do Projeto

**Propósito**: Templates clonados e customizados por projeto.

**Estrutura**:
```sql
project_extraction_templates
├── id (UUID, PK)
├── project_id (UUID, FK → projects, CASCADE)
├── global_template_id (UUID, FK → extraction_templates_global, SET NULL)
├── name (varchar, NOT NULL)
├── description (text)
├── framework (enum)                   # CHARMS, PICOS, CUSTOM
├── version (varchar)
├── schema (jsonb)                      # Schema customizado
├── is_active (boolean)                 # Template ativo?
├── created_by (UUID, FK → profiles)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- Pode ser clonado de um template global (`global_template_id`)
- Pode ser totalmente customizado (`global_template_id = NULL`)
- `is_active` permite ter múltiplos templates, mas apenas um ativo
- Um projeto pode ter múltiplos templates

**Relacionamentos**:
- ➡️ Pertence a: `projects` (CASCADE)
- ➡️ Opcional: `extraction_templates_global` (origem)
- ➡️ Um para muitos: `extraction_entity_types`, `extraction_instances`, `extraction_runs`

**Exemplo de Uso**:
```python
# Clonar template global para projeto
template = ProjectExtractionTemplate(
    project_id=project_id,
    global_template_id=charms_template_id,
    name="CHARMS Customizado",
    framework="CHARMS",
    created_by=user_id
)

# Template totalmente customizado
custom_template = ProjectExtractionTemplate(
    project_id=project_id,
    global_template_id=None,
    name="Template Personalizado",
    framework="CUSTOM",
    created_by=user_id
)
```

---

### 8. `extraction_entity_types` - Tipos de Entidades

**Propósito**: Define tipos de entidades no template (ex: "dataset", "model", "outcome").

**Estrutura**:
```sql
extraction_entity_types
├── id (UUID, PK)
├── template_id (UUID, FK → extraction_templates_global, CASCADE)
├── project_template_id (UUID, FK → project_extraction_templates, CASCADE)
├── name (varchar, NOT NULL)           # "dataset", "model" (snake_case)
├── label (varchar, NOT NULL)           # "Dataset", "Model" (display)
├── description (text)
├── parent_entity_type_id (UUID, FK → extraction_entity_types, CASCADE)
├── cardinality (enum)                 # 'one' ou 'many'
├── sort_order (integer)
├── is_required (boolean)
└── created_at (timestamptz)

CONSTRAINT: template_id XOR project_template_id  # Deve pertencer a um ou outro
```

**Características**:
- **Constraint XOR**: Cada entity_type pertence OU a template global OU a template de projeto (nunca ambos)
- **Hierarquia**: `parent_entity_type_id` permite estruturas aninhadas
  - Exemplo: "model" pode ter filhos "training_dataset", "validation_dataset"
- **Cardinality**:
  - `one`: Apenas uma instância por artigo (ex: "study_design")
  - `many`: Múltiplas instâncias (ex: "model", "dataset")
- **Sort Order**: Define ordem de exibição

**Relacionamentos**:
- ➡️ Pertence a: `extraction_templates_global` OU `project_extraction_templates` (XOR)
- ➡️ Self-reference: `parent_entity_type_id` (hierarquia)
- ➡️ Um para muitos: `extraction_fields`

**Exemplo de Hierarquia**:
```
model (cardinality: many)
├── training_dataset (cardinality: one)
├── validation_dataset (cardinality: one)
└── performance_metrics (cardinality: many)
    └── metric_value (cardinality: one)
```

---

### 9. `extraction_fields` - Campos de Extração

**Propósito**: Define campos específicos de cada tipo de entidade.

**Estrutura**:
```sql
extraction_fields
├── id (UUID, PK)
├── entity_type_id (UUID, FK → extraction_entity_types, CASCADE)
├── name (varchar, NOT NULL)           # "sample_size" (snake_case)
├── label (varchar, NOT NULL)           # "Sample Size" (display)
├── description (text)
├── field_type (enum)                  # text, number, date, select, multiselect, boolean
├── is_required (boolean)
├── validation_schema (jsonb)          # Schema JSON para validação
├── allowed_values (jsonb)             # Valores permitidos (select/multiselect)
├── unit (varchar)                     # Unidade padrão (ex: "years")
├── allowed_units (jsonb)              # Unidades permitidas
├── llm_description (text)              # Descrição para IA
└── created_at (timestamptz)
```

**Características**:
- **Field Types**:
  - `text`: Texto livre
  - `number`: Número (pode ter unidade)
  - `date`: Data
  - `select`: Seleção única
  - `multiselect`: Seleção múltipla
  - `boolean`: Verdadeiro/Falso
- `llm_description`: Descrição específica para LLM entender como extrair
- `allowed_values`: Para campos select/multiselect
- `allowed_units`: Lista de unidades válidas para campos numéricos

**Relacionamentos**:
- ➡️ Pertence a: `extraction_entity_types` (CASCADE)
- ➡️ Um para muitos: `extracted_values`, `ai_suggestions`

**Exemplo de Uso**:
```python
# Campo numérico com unidade
field = ExtractionField(
    entity_type_id=model_entity_id,
    name="sample_size",
    label="Sample Size",
    field_type="number",
    unit="participants",
    allowed_units=["participants", "samples", "records"],
    is_required=True
)

# Campo select
field = ExtractionField(
    entity_type_id=model_entity_id,
    name="algorithm",
    label="Algorithm",
    field_type="select",
    allowed_values=["random_forest", "svm", "neural_network"],
    is_required=True
)
```

---

### 10. `extraction_instances` - Instâncias de Entidades

**Propósito**: Representa instâncias específicas de entidades para cada artigo.

**Estrutura**:
```sql
extraction_instances
├── id (UUID, PK)
├── project_id (UUID, FK → projects, CASCADE)
├── article_id (UUID, FK → articles, CASCADE, NULLABLE)
├── template_id (UUID, FK → project_extraction_templates, RESTRICT)
├── entity_type_id (UUID, FK → extraction_entity_types, RESTRICT)
├── parent_instance_id (UUID, FK → extraction_instances, CASCADE, NULLABLE)
├── label (varchar, NOT NULL)          # "Model 1", "Dataset A"
├── sort_order (integer)
├── metadata (jsonb)                    # Metadados adicionais
├── status (varchar)                    # pending, in_progress, completed, etc.
├── is_template (boolean)               # Instância template/padrão?
├── created_by (UUID, FK → profiles)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- **Instâncias por Artigo**: Cada artigo pode ter múltiplas instâncias do mesmo `entity_type` (se `cardinality = 'many'`)
- **Hierarquia**: `parent_instance_id` permite estruturas aninhadas
  - Exemplo: "Model 1" → "Training Dataset", "Validation Dataset"
- **Templates**: `is_template = true` cria instâncias padrão reutilizáveis
- **Status**: Rastreia progresso da extração

**Relacionamentos**:
- ➡️ Pertence a: `projects`, `articles` (opcional), `project_extraction_templates`, `extraction_entity_types`
- ➡️ Self-reference: `parent_instance_id` (hierarquia)
- ➡️ Um para muitos: `extracted_values`

**Exemplo de Uso**:
```python
# Criar instância de modelo para artigo
instance = ExtractionInstance(
    project_id=project_id,
    article_id=article_id,
    template_id=template_id,
    entity_type_id=model_entity_id,
    label="Model 1",
    status="pending",
    created_by=user_id
)

# Criar instância filha (dataset de treino)
child_instance = ExtractionInstance(
    project_id=project_id,
    article_id=article_id,
    template_id=template_id,
    entity_type_id=dataset_entity_id,
    parent_instance_id=instance.id,  # Filho de "Model 1"
    label="Training Dataset",
    created_by=user_id
)
```

---

### 11. `extracted_values` - Valores Extraídos

**Propósito**: Armazena valores extraídos para cada campo de cada instância.

**Estrutura**:
```sql
extracted_values
├── id (UUID, PK)
├── project_id (UUID, FK → projects, CASCADE)
├── article_id (UUID, FK → articles, CASCADE)
├── instance_id (UUID, FK → extraction_instances, CASCADE)
├── field_id (UUID, FK → extraction_fields, RESTRICT)
├── value (jsonb, NOT NULL)            # Valor com metadados
├── source (enum)                      # human, ai, rule
├── confidence_score (numeric)          # 0.0 a 1.0 (apenas para AI)
├── evidence (jsonb)                    # Array de evidências
├── reviewer_id (UUID, FK → profiles, SET NULL)
├── is_consensus (boolean)              # Valor consensual final?
├── ai_suggestion_id (UUID, FK → ai_suggestions, SET NULL)
├── unit (varchar)                      # Unidade do valor
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- **Value (JSONB)**: Estrutura flexível para diferentes tipos
  ```json
  {
    "text": "Random Forest",
    "number": 1000,
    "date": "2024-01-15",
    "boolean": true,
    "array": ["value1", "value2"]
  }
  ```
- **Source**:
  - `human`: Extraído manualmente por revisor
  - `ai`: Sugerido por IA
  - `rule`: Gerado por regra automática
- **Consensus**: `is_consensus = true` marca valor final após revisão
- **Evidence**: Array de referências que suportam o valor
  ```json
  [
    {
      "page": 5,
      "text": "We used Random Forest with 100 trees",
      "position": {"x": 100, "y": 200}
    }
  ]
  ```

**Relacionamentos**:
- ➡️ Pertence a: `projects`, `articles`, `extraction_instances`, `extraction_fields`
- ➡️ Opcional: `profiles` (reviewer), `ai_suggestions`

**Exemplo de Uso**:
```python
# Valor extraído manualmente
value = ExtractedValue(
    project_id=project_id,
    article_id=article_id,
    instance_id=instance_id,
    field_id=field_id,
    value={"text": "Random Forest"},
    source="human",
    reviewer_id=user_id,
    evidence=[{
        "page": 5,
        "text": "We used Random Forest algorithm"
    }]
)

# Valor consensual (após revisão)
value.is_consensus = True
```

---

### 12. `extraction_evidence` - Evidências

**Propósito**: Armazena evidências que suportam valores extraídos ou instâncias.

**Estrutura**:
```sql
extraction_evidence
├── id (UUID, PK)
├── project_id (UUID, FK → projects, CASCADE)
├── article_id (UUID, FK → articles, CASCADE)
├── target_type (varchar)              # 'value' ou 'instance'
├── target_id (UUID)                    # ID do valor ou instância
├── article_file_id (UUID, FK → article_files, SET NULL)
├── page_number (integer)
├── position (jsonb)                    # Posição no documento
├── text_content (text)                 # Texto citado
├── created_by (UUID, FK → profiles)
└── created_at (timestamptz)
```

**Características**:
- **Target Type**: Define se evidência suporta um `value` ou uma `instance`
- **Position**: Coordenadas no documento (JSONB)
  ```json
  {
    "x": 100,
    "y": 200,
    "width": 300,
    "height": 50
  }
  ```
- Pode referenciar arquivo específico (`article_file_id`)

**Relacionamentos**:
- ➡️ Pertence a: `projects`, `articles`
- ➡️ Opcional: `article_files`

**Exemplo de Uso**:
```python
# Evidência para valor extraído
evidence = ExtractionEvidence(
    project_id=project_id,
    article_id=article_id,
    target_type="value",
    target_id=extracted_value_id,
    article_file_id=file_id,
    page_number=5,
    position={"x": 100, "y": 200},
    text_content="We used Random Forest with 100 trees",
    created_by=user_id
)
```

---

## 🤖 Sistema de IA e Execuções

### 13. `extraction_runs` - Execuções de IA

**Propósito**: Rastreia execuções de IA para sugerir valores de extração.

**Estrutura**:
```sql
extraction_runs
├── id (UUID, PK)
├── project_id (UUID, FK → projects, CASCADE)
├── article_id (UUID, FK → articles, CASCADE)
├── template_id (UUID, FK → project_extraction_templates, RESTRICT)
├── stage (enum)                        # data_suggest, parsing, validation, consensus
├── status (enum)                       # pending, running, completed, failed
├── parameters (jsonb)                  # Modelo, temperatura, etc.
├── results (jsonb)                      # Resultados da execução
├── error_message (text)
├── started_at (timestamptz)
├── completed_at (timestamptz)
├── created_by (UUID, FK → profiles)
└── created_at (timestamptz)
```

**Características**:
- **Stages**:
  - `data_suggest`: Sugestão inicial de dados
  - `parsing`: Parsing de resultados
  - `validation`: Validação de valores
  - `consensus`: Geração de consenso
- **Status**: Rastreia ciclo de vida da execução
- **Parameters**: Configuração da IA
  ```json
  {
    "model": "gpt-4",
    "temperature": 0.7,
    "max_tokens": 2000
  }
  ```
- **Results**: Resultados estruturados da execução

**Relacionamentos**:
- ➡️ Pertence a: `projects`, `articles`, `project_extraction_templates`, `profiles`
- ➡️ Um para muitos: `ai_suggestions`

**Exemplo de Uso**:
```python
# Criar execução
run = ExtractionRun(
    project_id=project_id,
    article_id=article_id,
    template_id=template_id,
    stage="data_suggest",
    status="pending",
    parameters={"model": "gpt-4", "temperature": 0.7},
    created_by=user_id
)

# Iniciar execução
run.status = "running"
run.started_at = datetime.now()

# Completar
run.status = "completed"
run.completed_at = datetime.now()
run.results = {"suggestions_count": 10}
```

---

### 14. `ai_suggestions` - Sugestões de IA

**Propósito**: Armazena sugestões específicas geradas pela IA.

**Estrutura**:
```sql
ai_suggestions
├── id (UUID, PK)
├── extraction_run_id (UUID, FK → extraction_runs, CASCADE, NULLABLE)
├── assessment_run_id (UUID, FK → ai_assessment_runs, CASCADE, NULLABLE)
├── instance_id (UUID, FK → extraction_instances, CASCADE, NULLABLE)
├── field_id (UUID, FK → extraction_fields, RESTRICT, NULLABLE)
├── assessment_item_id (UUID, FK → assessment_items, RESTRICT, NULLABLE)
├── project_assessment_item_id (UUID, FK → project_assessment_items, RESTRICT, NULLABLE)
├── suggested_value (jsonb, NOT NULL)   # Valor sugerido
├── confidence_score (numeric)          # 0.0 a 1.0
├── reasoning (text)                    # Explicação da IA
├── status (enum)                       # pending, accepted, rejected
├── reviewed_by (UUID, FK → profiles, SET NULL)
├── reviewed_at (timestamptz)
├── metadata (jsonb)
└── created_at (timestamptz)
```

**Características**:
- **Status**:
  - `pending`: Aguardando revisão
  - `accepted`: Aceita pelo revisor (pode gerar `extracted_value`)
  - `rejected`: Rejeitada
- **Modos suportados**:
  - Sugestão de extração: `extraction_run_id` preenchido.
  - Sugestão de assessment: `assessment_run_id` preenchido.
  - O schema atual aplica constraints de XOR para evitar linhas híbridas inválidas.
- **Reasoning**: Explicação do LLM sobre por que sugeriu esse valor
- Quando aceita, pode criar um `extracted_value` correspondente

**Relacionamentos**:
- ➡️ Pertence a: `extraction_runs` **ou** `ai_assessment_runs` (XOR)
- ➡️ Opcional: `extraction_instances`, `extraction_fields`, `assessment_items`, `project_assessment_items`
- ➡️ Opcional: `profiles` (reviewer)
- ➡️ Um para muitos: `extracted_values` (via `ai_suggestion_id`)

**Exemplo de Uso**:
```python
# Criar sugestão
suggestion = AISuggestion(
    run_id=run_id,
    instance_id=instance_id,
    field_id=field_id,
    suggested_value={"text": "Random Forest"},
    confidence_score=0.95,
    reasoning="The paper mentions 'Random Forest' multiple times in the methods section",
    status="pending"
)

# Aceitar sugestão
suggestion.status = "accepted"
suggestion.reviewed_by = user_id
suggestion.reviewed_at = datetime.now()

# Criar extracted_value a partir da sugestão
value = ExtractedValue(
    ...,
    value=suggestion.suggested_value,
    source="ai",
    ai_suggestion_id=suggestion.id,
    confidence_score=suggestion.confidence_score
)
```

---

## 📝 Sistema de Anotações

### 15. `article_highlights` - Destaques

**Propósito**: Destaques/seleções de texto feitos pelos usuários em PDFs.

**Estrutura**:
```sql
article_highlights
├── id (UUID, PK)
├── article_id (UUID, FK → articles, CASCADE)
├── article_file_id (UUID, FK → article_files, SET NULL)
├── page_number (integer, NOT NULL)
├── selected_text (text, NOT NULL)
├── scaled_position (jsonb, NOT NULL)   # Posição escalada
├── color (jsonb)                       # Cor do highlight
├── dom_target (jsonb)                  # Referência DOM
├── author_id (UUID, FK → profiles, SET NULL)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- `scaled_position`: Posição no documento (independente de zoom)
  ```json
  {
    "x": 100,
    "y": 200,
    "width": 300,
    "height": 50
  }
  ```
- `dom_target`: Referência ao elemento DOM (para sincronização frontend)

**Relacionamentos**:
- ➡️ Pertence a: `articles` (CASCADE)
- ➡️ Opcional: `article_files`, `profiles` (autor)
- ➡️ Um para muitos: `article_annotations` (via `highlight_id`)

---

### 16. `article_boxes` - Caixas

**Propósito**: Caixas/áreas desenhadas pelos usuários em PDFs.

**Estrutura**:
```sql
article_boxes
├── id (UUID, PK)
├── article_id (UUID, FK → articles, CASCADE)
├── article_file_id (UUID, FK → article_files, SET NULL)
├── page_number (integer, NOT NULL)
├── scaled_position (jsonb, NOT NULL)   # Posição da caixa
├── color (jsonb)                       # Cor da caixa
├── author_id (UUID, FK → profiles, SET NULL)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- Similar a `article_highlights`, mas para áreas desenhadas (não texto selecionado)

**Relacionamentos**:
- ➡️ Pertence a: `articles` (CASCADE)
- ➡️ Opcional: `article_files`, `profiles` (autor)
- ➡️ Um para muitos: `article_annotations` (via `box_id`)

---

### 17. `article_annotations` - Anotações

**Propósito**: Comentários/anotações associados a highlights, boxes ou outras anotações (threading).

**Estrutura**:
```sql
article_annotations
├── id (UUID, PK)
├── article_id (UUID, FK → articles, CASCADE)
├── highlight_id (UUID, FK → article_highlights, CASCADE, NULLABLE)
├── box_id (UUID, FK → article_boxes, CASCADE, NULLABLE)
├── parent_id (UUID, FK → article_annotations, CASCADE, NULLABLE)
├── content (text, NOT NULL)
├── is_resolved (boolean)               # Anotação resolvida?
├── author_id (UUID, FK → profiles, SET NULL)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- **Threading**: `parent_id` permite respostas em thread
- Pode estar associada a `highlight_id` OU `box_id` (ou nenhum, se for resposta)
- `is_resolved`: Marca anotação como resolvida

**Relacionamentos**:
- ➡️ Pertence a: `articles` (CASCADE)
- ➡️ Opcional: `article_highlights`, `article_boxes`, `article_annotations` (parent), `profiles` (autor)

**Exemplo de Threading**:
```
Annotation 1 (highlight_id = X)
  └── Annotation 2 (parent_id = 1)  # Resposta
      └── Annotation 3 (parent_id = 2)  # Resposta à resposta
```

---

## 🔧 Tabelas Auxiliares

### 18. `feedback_reports` - Feedback de Usuários

**Propósito**: Armazena feedback de usuários (bugs, sugestões, perguntas).

**Estrutura**:
```sql
feedback_reports
├── id (UUID, PK)
├── user_id (UUID, FK → auth.users, SET NULL)
├── type (text, NOT NULL)               # bug, suggestion, question, other
├── description (text, NOT NULL)        # Mínimo 10 caracteres
├── severity (text)                     # low, medium, high, critical (apenas bugs)
├── url (text, NOT NULL)                # URL onde ocorreu
├── user_agent (text)                   # User agent do navegador
├── viewport_size (jsonb)               # Dimensões da tela
├── project_id (UUID, FK → projects, SET NULL)
├── article_id (UUID, FK → articles, SET NULL)
├── screenshot_url (text)               # URL da screenshot
├── status (text)                       # open, in_progress, resolved, wont_fix, duplicate
├── priority (integer)                  # Prioridade (0 = baixa)
├── admin_notes (text)                  # Notas dos administradores
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Características**:
- Captura contexto técnico automático (user_agent, viewport, URL)
- Pode estar associado a `project_id` ou `article_id` para contexto
- Sistema de priorização e status para gestão

**Relacionamentos**:
- ➡️ Opcional: `auth.users`, `projects`, `articles`

---

## 🔗 Diagramas de Relacionamento

### Diagrama Simplificado - Hierarquia Principal

```
profiles (usuários)
│
├── projects (projetos)
│   │
│   ├── project_members (membros)
│   │   └── profiles (usuário membro)
│   │
│   ├── articles (artigos)
│   │   │
│   │   ├── article_files (PDFs)
│   │   │
│   │   ├── article_highlights (destaques)
│   │   │   └── article_annotations (comentários)
│   │   │
│   │   ├── article_boxes (caixas)
│   │   │   └── article_annotations (comentários)
│   │   │
│   │   └── article_annotations (comentários gerais)
│   │
│   └── project_extraction_templates (templates)
│       │
│       ├── extraction_entity_types (tipos de entidades)
│       │   │
│       │   └── extraction_fields (campos)
│       │       │
│       │       └── extracted_values (valores extraídos)
│       │           │
│       │           └── extraction_evidence (evidências)
│       │
│       ├── extraction_instances (instâncias)
│       │   │
│       │   └── extracted_values (valores)
│       │
│       └── extraction_runs (execuções de IA)
│           │
│           └── ai_suggestions (sugestões)
│               │
│               └── extracted_values (valores aceitos)
```

### Diagrama de Templates

```
extraction_templates_global (CHARMS, PICOS)
    │
    ├── project_extraction_templates (clone customizado)
    │       │
    │       └── extraction_entity_types
    │               │
    │               └── extraction_fields
    │
    └── extraction_entity_types (direto)
            │
            └── extraction_fields
```

### Fluxo de Extração de Dados

```
1. Criar Template
   project_extraction_templates
   └── extraction_entity_types
       └── extraction_fields

2. Para cada Artigo
   extraction_instances (criar instâncias)
   └── extracted_values (extrair valores)

3. Opcional: Usar IA
   extraction_runs
   └── ai_suggestions
       └── extracted_values (se aceito)

4. Adicionar Evidências
   extraction_evidence → extracted_values
```

---

## 💡 Exemplos Práticos

### Exemplo 1: Criar Projeto e Adicionar Artigo

```python
# 1. Criar projeto
project = Project(
    name="Revisão de Modelos Preditivos",
    review_type="predictive_model",
    created_by_id=user_id
)

# 2. Adicionar membro
member = ProjectMember(
    project_id=project.id,
    user_id=colleague_id,
    role="reviewer",
    created_by_id=user_id
)

# 3. Adicionar artigo
article = Article(
    project_id=project.id,
    title="Machine Learning for Medical Diagnosis",
    doi="10.1234/example",
    publication_year=2024
)

# 4. Adicionar arquivo PDF
file = ArticleFile(
    project_id=project.id,
    article_id=article.id,
    file_type="pdf",
    storage_key="articles/abc123.pdf",
    file_role="MAIN"
)
```

### Exemplo 2: Configurar Template de Extração

```python
# 1. Clonar template global CHARMS
template = ProjectExtractionTemplate(
    project_id=project.id,
    global_template_id=charms_template_id,
    name="CHARMS Customizado",
    framework="CHARMS",
    created_by=user_id
)

# 2. Buscar entity_type "model" do template
model_entity = await get_entity_type(template.id, "model")

# 3. Criar campo "sample_size"
field = ExtractionField(
    entity_type_id=model_entity.id,
    name="sample_size",
    label="Sample Size",
    field_type="number",
    unit="participants",
    is_required=True
)
```

### Exemplo 3: Extrair Dados de um Artigo

```python
# 1. Criar instância de modelo
instance = ExtractionInstance(
    project_id=project.id,
    article_id=article.id,
    template_id=template.id,
    entity_type_id=model_entity.id,
    label="Model 1",
    created_by=user_id
)

# 2. Extrair valor manualmente
value = ExtractedValue(
    project_id=project.id,
    article_id=article.id,
    instance_id=instance.id,
    field_id=field.id,
    value={"number": 1000},
    source="human",
    reviewer_id=user_id,
    evidence=[{
        "page": 5,
        "text": "We included 1000 participants"
    }]
)

# 3. Adicionar evidência
evidence = ExtractionEvidence(
    project_id=project.id,
    article_id=article.id,
    target_type="value",
    target_id=value.id,
    article_file_id=file.id,
    page_number=5,
    text_content="We included 1000 participants",
    created_by=user_id
)
```

### Exemplo 4: Usar IA para Sugerir Valores

```python
# 1. Criar execução de IA
run = ExtractionRun(
    project_id=project.id,
    article_id=article.id,
    template_id=template.id,
    stage="data_suggest",
    status="pending",
    parameters={"model": "gpt-4", "temperature": 0.7},
    created_by=user_id
)

# 2. Processar (worker/edge function)
# ... processamento ...

# 3. Criar sugestões
suggestion = AISuggestion(
    run_id=run.id,
    instance_id=instance.id,
    field_id=field.id,
    suggested_value={"number": 1000},
    confidence_score=0.95,
    reasoning="The paper mentions '1000 participants' in the methods section",
    status="pending"
)

# 4. Revisor aceita sugestão
suggestion.status = "accepted"
suggestion.reviewed_by=user_id

# 5. Criar extracted_value a partir da sugestão
value = ExtractedValue(
    project_id=project.id,
    article_id=article.id,
    instance_id=instance.id,
    field_id=field.id,
    value=suggestion.suggested_value,
    source="ai",
    ai_suggestion_id=suggestion.id,
    confidence_score=suggestion.confidence_score,
    reviewer_id=user_id
)
```

### Exemplo 5: Anotar Artigo

```python
# 1. Criar highlight
highlight = ArticleHighlight(
    article_id=article.id,
    article_file_id=file.id,
    page_number=5,
    selected_text="Random Forest algorithm",
    scaled_position={"x": 100, "y": 200, "width": 300, "height": 50},
    author_id=user_id
)

# 2. Adicionar anotação ao highlight
annotation = ArticleAnnotation(
    article_id=article.id,
    highlight_id=highlight.id,
    content="This is the main algorithm used in the study",
    author_id=user_id
)

# 3. Responder anotação (threading)
reply = ArticleAnnotation(
    article_id=article.id,
    parent_id=annotation.id,
    content="I agree, it's clearly stated in the methods",
    author_id=colleague_id
)
```

---

## 🔒 Segurança (RLS)

### Row Level Security

Todas as tabelas principais têm RLS habilitado com políticas que garantem:

1. **Profiles**: Usuários só veem/editam o próprio perfil
2. **Projects**: Usuários só veem projetos onde são membros
3. **Articles**: Usuários só veem artigos de projetos onde são membros
4. **Extraction Data**: Acesso baseado em membership no projeto

### Funções Helper

```sql
-- Verifica se usuário é membro do projeto
is_project_member(project_id, user_id) → boolean

-- Verifica se usuário é manager do projeto
is_project_manager(project_id, user_id) → boolean
```

---

## 📊 Índices e Performance

### Índices Principais

- **Foreign Keys**: Todas as FKs têm índices
- **JSONB**: Índices GIN em campos JSONB para busca
- **Full-Text**: Índices GIN trigram em `title` para busca
- **Compostos**: Índices compostos para queries frequentes

### Exemplos de Índices

```sql
-- Busca por projeto e artigo
CREATE INDEX idx_extracted_values_project_article 
ON extracted_values(project_id, article_id);

-- Busca em JSONB
CREATE INDEX idx_extracted_values_value_gin 
ON extracted_values USING GIN (value);

-- Busca full-text
CREATE INDEX idx_articles_title_trgm 
ON articles USING gin (title gin_trgm_ops);
```

---

## 🎓 Conceitos Importantes

### 1. Hierarquia de Templates

Templates globais são clonados para projetos, permitindo customização sem afetar o original.

### 2. Instâncias vs Entity Types

- **Entity Type**: Definição do tipo (ex: "model")
- **Instance**: Instância específica para um artigo (ex: "Model 1" do artigo X)

### 3. Valores Consensuais

Após revisão, um valor pode ser marcado como `is_consensus = true`, indicando que é o valor final aceito.

### 4. Evidências

Cada valor extraído pode ter múltiplas evidências que suportam o valor, com referências precisas ao documento.

### 5. Threading de Anotações

Anotações podem ter respostas, criando threads de discussão sobre partes específicas do artigo.

---

## 📚 Referências

- **Checklist de Governança de Migrações**
  - Toda invariante crítica de domínio deve existir no banco (`CHECK`, `UNIQUE`, trigger), não apenas no código da aplicação.
  - Toda função `SECURITY DEFINER` deve definir `search_path` explicitamente.
  - Toda mudança em funções RPC deve ser acompanhada de sincronização em `frontend/integrations/supabase/types.ts`.
  - Toda mudança estrutural relevante deve ter teste de integração cobrindo o caso de sucesso e o caso inválido.

- **Migrations**: `supabase/migrations/`
- **Modelos**: `backend/app/models/`
- **Repositories**: `backend/app/repositories/`
- **Schemas**: `backend/app/schemas/`

---

## ❓ FAQ

### Q: Posso ter múltiplos templates ativos em um projeto?

R: Sim, mas apenas um pode ter `is_active = true` por vez.

### Q: Como funciona a hierarquia de entity_types?

R: `parent_entity_type_id` permite estruturas aninhadas. Exemplo: "model" → "training_dataset" → "metric".

### Q: Qual a diferença entre `extraction_runs` e `batch_extraction_jobs`?

R: `extraction_runs` rastreia execuções individuais de IA. `batch_extraction_jobs` (planejado) rastrearia processamento em lote de múltiplos artigos.

### Q: Como marcar um valor como consensual?

R: Defina `is_consensus = true` no `extracted_value` após revisão e aprovação.

### Q: Posso ter múltiplas instâncias do mesmo entity_type?

R: Sim, se `cardinality = 'many'`. Cada instância terá um `label` diferente (ex: "Model 1", "Model 2").

---

**Última atualização**: 2026-04-21  
**Versão do Schema**: Baseado no consolidado Alembic `0001_initial_public_schema.py` + revisões incrementais até `20260421_0007_db_hardening_and_contracts.py`

