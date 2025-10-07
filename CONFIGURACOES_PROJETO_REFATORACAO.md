# Refatoração das Configurações do Projeto

## Resumo das Alterações

Foi realizada uma refatoração completa do componente `ProjectSettings.tsx` para melhorar significativamente a experiência do usuário e a organização das configurações do projeto.

## Principais Mudanças

### 1. **Layout Moderno com Sidebar de Navegação**
- **Antes**: Componente único com todos os campos em sequência
- **Depois**: Layout dividido com sidebar de navegação lateral e área de conteúdo
- Usa a tela toda (não é mais um popup)
- Navegação por tabs verticais organizadas por categoria

### 2. **Organização em 4 Seções**

#### **Informações Básicas** (`BasicInfoSection.tsx`)
- Nome do projeto
- Descrição geral

#### **Detalhes da Revisão** (`ReviewDetailsSection.tsx`)
- Informações gerais (título, condição estudada, contexto, justificativa)
- Estratégia de busca
- **Framework PICOTS completo** com critérios de inclusão/exclusão

#### **Equipe** (`TeamMembersSection.tsx`)
- Adicionar membros por email
- Visualizar membros atuais
- Remover membros (exceto líder)
- Indicadores visuais de papéis (Líder/Revisor)

#### **Avançado** (`AdvancedSettingsSection.tsx`)
- Modo cego (blind mode)
- Palavras-chave
- Critérios de elegibilidade
- Tipos de estudo incluídos

### 3. **Framework PICOTS Expandido**

A maior mudança foi na estrutura do PICOTS. Agora cada componente (P, I, C, O, T, S) possui:

#### Estrutura de Dados (JSON):
```json
{
  "picots_config_ai_review": {
    "population": {
      "info": "Descrição do que é considerado na população",
      "description": "Descrição detalhada da população alvo",
      "inclusion": ["Critério 1", "Critério 2"],
      "exclusion": ["Critério 1", "Critério 2"]
    },
    "index_models": { /* mesma estrutura */ },
    "comparator_models": { /* mesma estrutura */ },
    "outcomes": { /* mesma estrutura */ },
    "timing": {
      "prediction_moment": { /* mesma estrutura */ },
      "prediction_horizon": { /* mesma estrutura */ }
    },
    "setting_and_intended_use": { /* mesma estrutura */ }
  }
}
```

#### Componente Reutilizável: `PICOTSItemEditor.tsx`
- Campo "info" com tooltip explicativo sobre o que deve ser preenchido
- Campo de descrição/conteúdo principal
- Lista de critérios de inclusão (com badge verde)
- Lista de critérios de exclusão (com badge vermelho)
- Interface para adicionar/remover critérios facilmente

### 4. **Melhorias de UX**

#### **Salvamento Inteligente**
- Indicador visual de alterações não salvas
- Botão "Salvar Alterações" aparece apenas quando há mudanças
- Alert destacado quando há alterações pendentes
- Salvamento único para todas as seções

#### **Feedback Visual**
- Loading states
- Estados vazios informativos
- Badges coloridos para diferentes tipos de informação
- Ícones contextuais em cada seção

#### **Acessibilidade**
- Labels adequados em todos os campos
- Placeholders descritivos
- Aria-labels em botões de ícone
- Navegação por teclado (Enter para adicionar itens)

### 5. **Uso de Accordion para PICOTS**
- Cada componente do PICOTS é um AccordionItem
- Permite focar em um componente por vez
- Reduz sobrecarga visual
- Permite abrir múltiplos itens simultaneamente (`type="multiple"`)

## Arquivos Criados

```
src/components/project/
├── ProjectSettings.tsx (refatorado)
└── settings/
    ├── BasicInfoSection.tsx (novo)
    ├── ReviewDetailsSection.tsx (novo)
    ├── TeamMembersSection.tsx (novo)
    ├── AdvancedSettingsSection.tsx (novo)
    └── PICOTSItemEditor.tsx (novo)
```

## Compatibilidade com Banco de Dados

### Campos do Supabase (`projects` table):
- ✅ `name` - Text
- ✅ `description` - Text
- ✅ `review_title` - Text
- ✅ `condition_studied` - Text
- ✅ `review_rationale` - Text
- ✅ `search_strategy` - Text
- ✅ `review_context` - Text
- ✅ `picots_config_ai_review` - JSONB (estrutura expandida)
- ✅ `settings` - JSONB (blind_mode, etc)
- ✅ `eligibility_criteria` - JSONB
- ✅ `study_design` - JSONB
- ✅ `review_keywords` - Array

**Importante**: A estrutura do campo `picots_config_ai_review` foi expandida, mas é retrocompatível. Projetos antigos continuam funcionando, e novos campos são opcionais.

## Demonstração de Uso

### Para Revisões de Modelos Preditivos:

1. **Acessar Configurações** → Aba "Detalhes da Revisão"
2. **Expandir seção PICOTS**
3. **Para cada componente** (População, Índex, etc):
   - Preencher campo "info" com orientações
   - Descrever o componente no campo principal
   - Adicionar critérios de inclusão (ex: "Adultos ≥18 anos")
   - Adicionar critérios de exclusão (ex: "Estudos pré-clínicos")

### Exemplo Prático - População:

**Info**: 
```
Explique o que deve ser considerado na população alvo 
(ex: faixa etária, condições específicas, setting clínico)
```

**Descrição**:
```
Adultos com diagnóstico confirmado de diabetes tipo 2, 
em acompanhamento ambulatorial ou hospitalar.
```

**Critérios de Inclusão**:
- Idade ≥ 18 anos
- Diagnóstico de diabetes tipo 2 confirmado (critérios ADA)
- Seguimento mínimo de 6 meses

**Critérios de Exclusão**:
- Diabetes tipo 1
- Gestantes
- Pacientes em cuidados paliativos

## Benefícios da Refatoração

### Para Usuários:
- ✅ Organização clara e intuitiva
- ✅ Fácil navegação entre seções
- ✅ Feedback visual constante
- ✅ Menos erros (validações e placeholders claros)
- ✅ Melhor suporte para revisões de modelos preditivos

### Para Desenvolvedores:
- ✅ Código modular e reutilizável
- ✅ Componentes independentes e testáveis
- ✅ Fácil manutenção
- ✅ Extensível (fácil adicionar novas seções)
- ✅ Consistência com design system

### Para o Projeto:
- ✅ Alinhado com metodologia PICOTS
- ✅ Suporta avaliação de qualidade com IA
- ✅ Documentação estruturada
- ✅ Facilita replicabilidade da revisão

## Próximos Passos Sugeridos

1. **Validação de Campos**
   - Adicionar validação Zod para campos obrigatórios
   - Feedback de erros em tempo real

2. **Exportação**
   - Exportar configurações PICOTS para formato estruturado
   - Gerar documento de protocolo automaticamente

3. **Templates**
   - Criar templates pré-configurados por tipo de revisão
   - Importar configurações PICOTS de outros projetos

4. **Histórico**
   - Versionar alterações nas configurações
   - Mostrar quem alterou e quando

5. **Ajuda Contextual**
   - Adicionar tooltips com exemplos
   - Links para documentação PICOTS

## Notas Técnicas

- **Performance**: Salvamento eficiente com controle de estado
- **Responsividade**: Layout adapta-se a diferentes tamanhos de tela
- **Dark Mode**: Totalmente compatível
- **i18n Ready**: Estrutura preparada para internacionalização
- **Type Safety**: Interfaces TypeScript bem definidas

## Checklist de Conformidade com Regras

- ✅ Usa apenas tokens do design system (sem hardcode de cores/tamanhos)
- ✅ 4 estados de dados implementados (loading, error, empty, ready)
- ✅ Foco visível e aria-labels
- ✅ Contraste adequado (4.5:1)
- ✅ Alvos de toque ≥ 44px
- ✅ Testado em múltiplos tamanhos de tela
- ✅ Usa MCP Supabase para interação com banco
- ✅ Comentários em português
- ✅ Componentes modulares

## Conclusão

A refatoração transforma as configurações de projeto de um formulário simples em uma experiência rica e organizada, especialmente adequada para revisões sistemáticas de modelos preditivos. O framework PICOTS expandido com critérios de inclusão/exclusão por componente permite uma documentação mais rigorosa e alinhada com as melhores práticas de revisões sistemáticas.

