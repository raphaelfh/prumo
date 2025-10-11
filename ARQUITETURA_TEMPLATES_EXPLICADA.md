# 📐 ARQUITETURA DE TEMPLATES - Documentação Completa

**Sistema**: Templates Opcionais  
**Filosofia**: User pode importar CHARMS OU criar do zero  

---

## 🏗️ ARQUITETURA COMPLETA

### Camadas do Sistema

```
1. TEMPLATES MASTER (Globais)
   └─ extraction_templates_global
       └─ CHARMS v2.0.0, PICOS (futuro), etc.

2. DEFINIÇÕES (Por Template)
   └─ extraction_entity_types
       ├─ template_id (se global)
       ├─ project_template_id (se projeto)
       └─ parent_entity_type_id (hierarquia)
   
   └─ extraction_fields
       └─ Campos de cada entity_type

3. PROJETOS (User importa OU cria)
   └─ project_extraction_templates
       └─ Clone do template global OU custom

4. DADOS (Por Artigo)
   └─ extraction_instances
       ├─ article_id (qual artigo)
       ├─ entity_type_id (qual seção)
       └─ parent_instance_id (hierarquia)
   
   └─ extracted_values
       ├─ instance_id
       ├─ field_id
       └─ value (dado extraído)
```

---

## 🔄 FLUXO COMPLETO

### Opção A: Importar Template (Ex: CHARMS)

```
1. extraction_templates_global
   └─ CHARMS v2.0.0 (ID: xxx)
       └─ extraction_entity_types (template_id = xxx)
           ├─ participants (11 entity_types)
           ├─ prediction_models
           └─ ...
               └─ extraction_fields (45 fields)

2. User: Importar CHARMS para projeto
   ↓
   System clona:
   └─ project_extraction_templates (ID: yyy)
       ├─ global_template_id = xxx
       ├─ project_id = projeto
       └─ Cria cópias:
           └─ extraction_entity_types (project_template_id = yyy)
               └─ extraction_fields (cópia dos 45 fields)

3. User: Adiciona artigo > Extraction
   ↓
   System cria:
   └─ extraction_instances
       ├─ article_id = artigo A
       ├─ template_id = yyy (project_template)
       ├─ entity_type_id = participants
       └─ Depois user preenche:
           └─ extracted_values
               ├─ instance_id
               ├─ field_id
               └─ value = "Adults 18-65 years"
```

### Opção B: Criar do Zero (Custom)

```
1. User: Extraction > Configuração > Adicionar Seção
   ↓
   System cria:
   └─ extraction_entity_types
       ├─ project_template_id = algum template custom
       ├─ name = "my_custom_section"
       └─ label = "My Custom Section"

2. User: Adiciona campos
   ↓
   System cria:
   └─ extraction_fields
       └─ entity_type_id = seção criada

3. User: Extraction de artigo
   ↓
   Mesmo fluxo: extraction_instances + extracted_values
```

---

## 💡 POR QUE CADA TABELA EXISTE

### extraction_templates_global
**Propósito**: Biblioteca de templates padronizados (CHARMS, PICOS, PRISMA)  
**Benefício**: User não precisa configurar tudo do zero  
**Opcional**: ✅ User pode criar custom sem usar  
**Mantido por**: Admins (pré-configurados)  

### project_extraction_templates
**Propósito**: Templates clonados/customizados por projeto  
**Benefício**: Cada projeto pode customizar sem afetar outros  
**Exemplo**: Projeto A clona CHARMS e adiciona campos extras  
**Permite**: Customização por projeto  

### extraction_entity_types
**Propósito**: Define seções de extraction (Participants, Models, etc.)  
**CORE**: ✅ Obrigatório  
**Hierarquia**: parent_entity_type_id permite Study → Models  

### extraction_fields
**Propósito**: Define campos de cada seção  
**CORE**: ✅ Obrigatório  
**Exemplo**: "Age", "Gender", "Sample Size"  

### extraction_instances
**Propósito**: Dados REAIS extraídos de cada artigo  
**CORE**: ✅ Obrigatório  
**Exemplo**: "Model A do artigo X"  
**Hierarquia**: parent_instance_id permite Model A > Predictors  

### extracted_values
**Propósito**: Valores específicos extraídos  
**CORE**: ✅ Obrigatório  
**Exemplo**: field="c_statistic", value=0.78  

---

## 🎯 BENEFÍCIOS DA ARQUITETURA

### Flexibilidade

**Templates Prontos**:
- Importar CHARMS → 11 seções, 45 campos prontos
- Começar a extrair imediatamente

**Custom Total**:
- Criar seções do zero
- Controle total sobre campos
- Sem limitações

**Híbrido**:
- Importar CHARMS
- Adicionar seções custom extras
- Best of both worlds

### Escalabilidade

**Novos Templates**:
- Admin adiciona PICOS, PRISMA, etc. em extraction_templates_global
- Todos os projetos podem importar
- Zero código para adicionar novo template

**Customização por Projeto**:
- Projeto A: CHARMS padrão
- Projeto B: CHARMS + 3 seções custom
- Projeto C: 100% custom
- Todos coexistem perfeitamente

### Hierarquia

**Study → Models**:
- entity_types: parent_entity_type_id
- instances: parent_instance_id
- Funciona com qualquer template (CHARMS, custom, etc.)

---

## 📊 COMPARAÇÃO: Com vs Sem Templates

### SEM Templates (Tudo Manual)

```
PRO:
✅ Mais simples (menos tabelas)
✅ Mais flexível

CON:
❌ User configura tudo do zero (trabalhoso)
❌ Sem padrões (CHARMS, PICOS)
❌ Reinventa roda a cada projeto
❌ Sem compartilhamento entre projetos
```

### COM Templates (Atual - Opcionais)

```
PRO:
✅ Templates prontos (CHARMS)
✅ User pode importar OU criar custom
✅ Reutilização de configurações
✅ Padronização facilitada
✅ Flexibilidade total

CON:
⚠️ 2 tabelas extras (templates)
⚠️ Clonagem na importação (overhead)
```

**Decisão**: Templates opcionais valem a pena! ✅

---

## 🔍 TABELAS DELETADAS (Justificativa)

### extraction_templates (VIEW) - DELETADA

**Era**: VIEW → extraction_templates_global  
**Propósito**: Compatibilidade com código antigo  
**Uso**: ZERO arquivos usam  
**Motivo**: Código já usa extraction_templates_global diretamente  
**Seguro**: ✅ 100%  

### audit_log - DELETADA

**Era**: Tabela de auditoria de ações  
**Propósito**: Log de mudanças  
**Uso**: ZERO (nunca implementada)  
**Triggers**: Nenhum  
**UI**: Não existe  
**Seguro**: ✅ 100%  

### article_pdf_versions - DELETADA

**Era**: Versionamento de PDFs  
**Propósito**: Histórico de versões  
**Uso**: ZERO (feature não existe)  
**Dados**: 0 registros  
**Seguro**: ✅ 100%  

### extraction_forms, extractions - JÁ DELETADAS

**Status**: Removidas em migration anterior ✓

---

## 🎊 SCHEMA FINAL (Limpo e Justificado)

**Core (26 tabelas)**:
- profiles, projects, project_members
- articles, article_files, article_highlights, article_boxes, article_annotations
- extraction_templates_global ← Master templates
- project_extraction_templates ← Templates por projeto
- extraction_entity_types ← Seções (hierárquicas)
- extraction_fields ← Campos
- extraction_instances ← Dados por artigo
- extracted_values ← Valores extraídos
- extraction_evidence, extraction_runs, ai_suggestions
- assessment_instruments, assessment_items, assessments
- ai_assessments, ai_assessment_prompts, ai_assessment_configs
- zotero_integrations, feedback_reports

**Deletadas (5 tabelas)**:
- extraction_templates (VIEW)
- audit_log
- article_pdf_versions
- extraction_forms
- extractions

**Resultado**: Schema limpo, cada tabela justificada e usada!

---

**Arquitetura de templates opcionais: JUSTIFICADA!** ✅  
**Schema final: LIMPO E PROFISSIONAL!** 💎

