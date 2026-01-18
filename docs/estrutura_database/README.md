# 📚 Documentação do Banco de Dados

Bem-vindo à documentação completa do schema do banco de dados do Review Hub!

## 📖 Documentos Disponíveis

### 1. [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Documentação Completa
**Recomendado para**: Desenvolvedores novos no projeto, análise detalhada

Documentação didática e completa que cobre:
- ✅ Visão geral da arquitetura
- ✅ Todas as tabelas com estrutura detalhada
- ✅ Relacionamentos entre tabelas
- ✅ Padrões de design utilizados
- ✅ Exemplos práticos de uso
- ✅ Diagramas de relacionamento
- ✅ Conceitos importantes
- ✅ FAQ

**Tempo estimado de leitura**: 30-45 minutos

---

### 2. [GUIA_RAPIDO.md](./GUIA_RAPIDO.md) - Referência Rápida
**Recomendado para**: Consulta rápida, desenvolvedores experientes

Guia de referência rápida com:
- ✅ Tabelas organizadas por categoria
- ✅ Relacionamentos principais
- ✅ Enums e constantes
- ✅ Queries comuns
- ✅ Padrões de código
- ✅ Dicas de performance

**Tempo estimado de leitura**: 10-15 minutos

---

### 3. [ESTRUTURA_PROJETO_MACRO.md](./ESTRUTURA_PROJETO_MACRO.md) - Configuração Local
Informações sobre como rodar o projeto localmente (Supabase, Backend, Frontend).

---

## 🎯 Por Onde Começar?

### Se você é novo no projeto:
1. **Leia primeiro**: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
   - Comece pela seção "Visão Geral"
   - Entenda a arquitetura e padrões
   - Explore as tabelas na ordem apresentada

2. **Depois**: Use [GUIA_RAPIDO.md](./GUIA_RAPIDO.md) como referência
   - Consulte quando precisar de informações rápidas
   - Use como cheatsheet durante desenvolvimento

### Se você já conhece o projeto:
- Use [GUIA_RAPIDO.md](./GUIA_RAPIDO.md) para consulta rápida
- Consulte [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) quando precisar de detalhes

---

## 🗂️ Estrutura do Banco de Dados

### Tabelas Principais (Core)
- `profiles` - Usuários
- `projects` - Projetos de revisão
- `project_members` - Membros e permissões

### Tabelas de Artigos
- `articles` - Metadados bibliográficos
- `article_files` - PDFs e documentos
- `article_highlights` - Destaques
- `article_boxes` - Caixas
- `article_annotations` - Anotações

### Sistema de Extração
- `extraction_templates_global` - Templates globais
- `project_extraction_templates` - Templates do projeto
- `extraction_entity_types` - Tipos de entidades
- `extraction_fields` - Campos
- `extraction_instances` - Instâncias
- `extracted_values` - Valores extraídos
- `extraction_evidence` - Evidências

### Sistema de IA
- `extraction_runs` - Execuções de IA
- `ai_suggestions` - Sugestões

### Auxiliares
- `feedback_reports` - Feedback de usuários

---

## 🔗 Links Úteis

- **Código dos Modelos**: `backend/app/models/`
- **Repositories**: `backend/app/repositories/`
- **Migrations**: `supabase/migrations/`
- **Schemas Pydantic**: `backend/app/schemas/`

---

## 📝 Convenções

### Nomenclatura
- Tabelas: `snake_case` plural
- Campos: `snake_case`
- Enums: `snake_case`

### Relacionamentos
- **CASCADE**: Deleta filhos quando pai é deletado
- **RESTRICT**: Impede deleção se houver filhos
- **SET NULL**: Define FK como NULL quando pai é deletado

### JSONB
- Campos flexíveis usam JSONB
- Índices GIN para busca eficiente
- Estrutura documentada em cada tabela

---

## ❓ Dúvidas?

Consulte a seção **FAQ** em [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) ou abra uma issue no repositório.

---

**Última atualização**: 2025-01-XX

