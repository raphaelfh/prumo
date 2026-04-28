# Roadmap - Prumo

> Status snapshot post 2026-04-28 cleanup wave. Items marked ✅ shipped.
> See [`docs/architecture/extraction-hitl-architecture.md`](../architecture/extraction-hitl-architecture.md)
> for the canonical state of the extraction + HITL stack.

## 🗄️ Database & Infraestrutura

### Limpeza e Otimização
- ✅ **Limpar database com tabelas não utilizadas (2026-04-27/28)**
  - 008 evaluation skeleton dropado (`evaluation_*`, `proposal_records`,
    `reviewer_*`, `consensus_*`, `published_states`, `evidence_records` +
    9 enums) na migration 0016.
  - Legacy `extraction_evidence.target_type/target_id` dropados (0017).
  - `ai_suggestions` e `extracted_values` permanecem como shim de
    transição até a UI extraction migrar para `/v1/runs/{id}` —
    documentado como dívida explícita em `extraction-hitl-architecture.md`.

---

## 📊 Extração e Processamento de Dados

### Melhorias na Extração
- [ ] **Melhorar prompt de extração de modelos do artigo**
  - Refinar prompts para maior precisão
  - Reduzir falsos positivos/negativos
  - **Prioridade:** Alta
  - **Impacto:** Qualidade dos dados extraídos

- [ ] **Definir melhor uso do extraction evidence para citações**
  - Ver qual o melhor jeito de usar o extraction evidence para fazer as citações do que foi extraído
  - Garantir rastreabilidade das informações
  - **Prioridade:** Alta
  - **Impacto:** Confiabilidade e verificação dos dados

---

## Multi-Provedor


### Integração com LangChain e LlamaIndex
- [ ] **Criar arquivo de extração alternativo usando LangChain**
  - Implementar `langchain_extraction_service.py`
  - Abstrair diferentes modelos através de LangChain
  - Suportar OpenAI, Anthropic, Google Gemini, etc.
  - **Prioridade:** Média
  - **Impacto:** Flexibilidade de modelos e padronização

- [ ] **Criar arquivo de extração usando LlamaIndex**
  - Implementar `llamaindex_extraction_service.py`
  - Aproveitar capacidades de RAG do LlamaIndex
  - Integrar com sistema de evidências do PDF
  - **Prioridade:** Média
  - **Impacto:** Melhor rastreabilidade e contexto nas extrações

- [ ] **Implementar factory pattern para escolha de serviço de extração**
  - Criar `ExtractionServiceFactory` que escolhe entre:
    - Serviço atual (OpenAI direto)
    - LangChain-based
    - LlamaIndex-based
  - Permitir usuário escolher qual usar por projeto/extração
  - **Prioridade:** Média
  - **Impacto:** Flexibilidade e experimentação

- [ ] **Adicionar suporte a modelos locais (Ollama, LM Studio)**
  - Integrar com Ollama para modelos locais
  - Suportar LM Studio para desenvolvimento/testes
  - Configurar via BYOK (URL + modelo)
  - **Prioridade:** Baixa
  - **Impacto:** Redução de custos e privacidade

### Tarefas de BYOK - futuro
- [ ] **Implementar auditoria de uso de API keys**
  - Log de qual key foi usada em cada extração
  - Métricas de custo por usuário/projeto
  - Dashboard de uso de tokens
  - **Prioridade:** Média
  - **Impacto:** Transparência e controle de custos

- [ ] **Criar sistema de rate limiting por usuário**
  - Limitar requisições baseado na key do usuário
  - Diferentes limites para diferentes provedores
  - Feedback quando limite é atingido
  - **Prioridade:** Média
  - **Impacto:** Prevenção de abuso e controle de custos

- [ ] **Documentar processo de BYOK**
  - Guia de como adicionar keys de diferentes provedores
  - Exemplos de configuração
  - Troubleshooting comum
  - **Prioridade:** Baixa
  - **Impacto:** Facilita adoção pelos usuários

---

## 📄 PDF e Rastreabilidade de Evidências

### Melhorias no Processamento de PDF
- [ ] **Melhorar e definir o que será usado do PDF**
  - Localizar no PDF as evidências para ficar fácil de checar a origem
  - Implementar referência de página/posição no PDF
  - Melhorar extração de contexto visual
  - **Prioridade:** Alta
  - **Impacto:** Auditabilidade e verificação manual

---

## 👥 Multi-usuário e Permissões

### Correções de Bugs
- [ ] **Ajustar e corrigir bugs de inserção de outros usuários no projeto**
  - Verificar permissões de acesso
  - Validar regras de negócio para colaboração
  - **Prioridade:** Alta
  - **Impacto:** Funcionalidade crítica de colaboração

- [ ] **Corrigir bugs de multi usuários fazendo avaliação da extração do artigo**
  - Resolver conflitos de concorrência
  - Garantir isolamento de dados por usuário
  - **Prioridade:** Alta
  - **Impacto:** Integridade dos dados e experiência do usuário

- [ ] **Ajustar o usuário que fará a revisão final**
  - Definir workflow de aprovação
  - Implementar controle de permissões para revisão
  - **Prioridade:** Média
  - **Impacto:** Processo de qualidade e validação

---

## 🎨 UI/UX e Avaliação

### Redesign de Componentes
- ✅ **Redesenhar a seção de risk of bias assessment (2026-04-27/28)**
  - QA agora reusa o stack de extraction via `kind=quality_assessment`.
  - PROBAST + QUADAS-2 seedados como global templates.
  - `QualityAssessmentFullScreen` persiste valores via
    `/api/v1/hitl/sessions` (kind=quality_assessment) → ProposalRecord →
    manual_override consensus → PublishedState. Botão "Publish assessment"
    finaliza o Run.

---

## 📝 Legenda de Prioridades

- **Alta:** Funcionalidade crítica ou bug que impacta o uso do sistema
- **Média:** Melhoria importante mas não bloqueante
- **Baixa:** Nice-to-have ou otimização

---

---

## Fazer uma secão de escrita de artigo

- Aplicação para usar: https://github.com/ether/etherpad
- Objetivo: fazer um esquema de anotação robusta para o artigo onde é possível conectar com diversos canais para a escrita compartilhada


## 🔗 Documentos Relacionados

- [Estrutura do Projeto Macro](../estrutura_database/ESTRUTURA_PROJETO_MACRO.md)
- [Arquitetura Backend](../guias/ARQUITETURA_BACKEND.md)
- [Planos de Correção](../planos/)
