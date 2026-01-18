# 🚀 Guia Rápido - Referência de Tabelas

## 📋 Tabelas por Categoria

### 👥 Usuários e Projetos
| Tabela | Propósito | Chave Principal |
|--------|-----------|-----------------|
| `profiles` | Perfis de usuários | `id` (FK → auth.users) |
| `projects` | Projetos de revisão | `id` |
| `project_members` | Membros e permissões | `id`, UNIQUE(project_id, user_id) |

### 📄 Artigos
| Tabela | Propósito | Chave Principal |
|--------|-----------|-----------------|
| `articles` | Metadados bibliográficos | `id` |
| `article_files` | PDFs e documentos | `id` |
| `article_highlights` | Destaques de texto | `id` |
| `article_boxes` | Caixas desenhadas | `id` |
| `article_annotations` | Comentários/anotações | `id` |

### 🔍 Extração de Dados
| Tabela | Propósito | Chave Principal |
|--------|-----------|-----------------|
| `extraction_templates_global` | Templates globais (CHARMS, PICOS) | `id` |
| `project_extraction_templates` | Templates do projeto | `id` |
| `extraction_entity_types` | Tipos de entidades (model, dataset) | `id` |
| `extraction_fields` | Campos de extração | `id` |
| `extraction_instances` | Instâncias por artigo | `id` |
| `extracted_values` | Valores extraídos | `id` |
| `extraction_evidence` | Evidências dos valores | `id` |

### 🤖 IA e Execuções
| Tabela | Propósito | Chave Principal |
|--------|-----------|-----------------|
| `extraction_runs` | Execuções de IA | `id` |
| `ai_suggestions` | Sugestões de IA | `id` |

### 🔧 Auxiliares
| Tabela | Propósito | Chave Principal |
|--------|-----------|-----------------|
| `feedback_reports` | Feedback de usuários | `id` |

---

## 🔗 Relacionamentos Principais

### Hierarquia de Projeto
```
projects
├── project_members → profiles
├── articles
│   ├── article_files
│   ├── article_highlights → article_annotations
│   ├── article_boxes → article_annotations
│   └── article_annotations (threading)
└── project_extraction_templates
    ├── extraction_entity_types → extraction_fields
    ├── extraction_instances → extracted_values
    └── extraction_runs → ai_suggestions
```

### Fluxo de Extração
```
1. Template
   project_extraction_templates
   └── extraction_entity_types
       └── extraction_fields

2. Instâncias
   extraction_instances (por artigo)
   └── extracted_values (valores)

3. IA (opcional)
   extraction_runs
   └── ai_suggestions → extracted_values
```

---

## 📊 Enums Importantes

### `review_type`
- `interventional`
- `predictive_model`
- `diagnostic`
- `prognostic`
- `qualitative`
- `other`

### `project_member_role`
- `manager`
- `reviewer`
- `viewer`
- `consensus`

### `file_role`
- `MAIN`
- `SUPPLEMENT`
- `PROTOCOL`
- `DATASET`
- `APPENDIX`
- `FIGURE`
- `OTHER`

### `extraction_framework`
- `CHARMS`
- `PICOS`
- `CUSTOM`

### `extraction_field_type`
- `text`
- `number`
- `date`
- `select`
- `multiselect`
- `boolean`

### `extraction_source`
- `human`
- `ai`
- `rule`

### `extraction_run_stage`
- `data_suggest`
- `parsing`
- `validation`
- `consensus`

### `extraction_run_status`
- `pending`
- `running`
- `completed`
- `failed`

---

## 🎯 Queries Comuns

### Buscar artigos de um projeto
```python
articles = await article_repo.get_by_project(project_id)
```

### Buscar valores extraídos de um artigo
```python
values = await extraction_repo.get_values_by_article(article_id)
```

### Buscar instâncias de um artigo
```python
instances = await extraction_repo.get_instances_by_article(article_id)
```

### Verificar se usuário é membro
```python
is_member = await project_repo.is_member(project_id, user_id)
```

### Buscar template ativo do projeto
```python
template = await extraction_repo.get_active_template(project_id)
```

---

## 🔑 Chaves Estrangeiras Importantes

### CASCADE (deleta filhos)
- `projects` → `articles`
- `articles` → `article_files`
- `extraction_instances` → `extracted_values`

### RESTRICT (impede deleção)
- `project_extraction_templates` → `extraction_runs`
- `extraction_fields` → `extracted_values`

### SET NULL (define NULL)
- `profiles` → `extracted_values.reviewer_id`
- `extraction_templates_global` → `project_extraction_templates.global_template_id`

---

## 📝 Campos JSONB Importantes

### `projects.settings`
```json
{
  "blind_mode": false,
  "other_settings": "..."
}
```

### `extracted_values.value`
```json
{
  "text": "Random Forest",
  "number": 1000,
  "date": "2024-01-15",
  "boolean": true
}
```

### `extracted_values.evidence`
```json
[
  {
    "page": 5,
    "text": "We used Random Forest",
    "position": {"x": 100, "y": 200}
  }
]
```

### `extraction_runs.parameters`
```json
{
  "model": "gpt-4",
  "temperature": 0.7,
  "max_tokens": 2000
}
```

---

## ⚡ Dicas de Performance

1. **Use índices**: Campos com FK, JSONB (GIN), e campos de busca têm índices
2. **JSONB queries**: Use operadores JSONB para buscar em campos estruturados
3. **Paginação**: Sempre use `skip` e `limit` em listagens
4. **Eager loading**: Use `relationship()` do SQLAlchemy para evitar N+1 queries

---

## 🛠️ Padrões de Código

### Criar entidade
```python
entity = Model(
    field1=value1,
    field2=value2
)
entity = await repo.create(entity)
```

### Buscar por ID
```python
entity = await repo.get_by_id(entity_id)
```

### Atualizar
```python
entity = await repo.update(entity, {"field": "new_value"})
```

### Deletar
```python
await repo.delete(entity)
# ou
await repo.delete_by_id(entity_id)
```

---

## 🔍 Busca e Filtros

### Buscar por projeto
```python
articles = await article_repo.get_by_project(project_id)
```

### Buscar por template
```python
instances = await extraction_repo.get_by_template(template_id)
```

### Buscar valores consensuais
```python
consensus_values = await extraction_repo.get_consensus_values(instance_id)
```

### Buscar sugestões pendentes
```python
pending = await ai_repo.get_pending_suggestions(article_id)
```

---

## 📚 Referências Rápidas

- **Documentação completa**: `DATABASE_SCHEMA.md`
- **Modelos**: `backend/app/models/`
- **Repositories**: `backend/app/repositories/`
- **Migrations**: `supabase/migrations/`

---

**Última atualização**: 2025-01-XX

