# Correções no Sistema PICOTS

## Alterações Implementadas

### 1. ✅ Campo "Info" Agora é Apenas Tooltip

**Antes:**
- Campo "info" era editável pelo usuário
- Aparecia como um textarea cinza dentro de um Alert
- Usuário tinha que escrever a explicação do campo

**Depois:**
- Campo "info" removido da interface editável
- Substituído por um tooltip fixo com ícone ℹ️ (HelpCircle)
- Texto explicativo definido no código, não editável
- Aparece ao passar o mouse sobre o ícone ao lado do label

**Exemplo de uso:**
```tsx
<PICOTSItemEditor
  label="População"
  fieldKey="population"
  data={data}
  infoTooltip="Defina as características demográficas e clínicas da população alvo. Considere idade, condições de saúde, setting de cuidado e estágio da doença."
  // ...
/>
```

### 2. ✅ Campo "review_type" Adicionado ao Banco

**Migração aplicada:**
- Criado ENUM `review_type` com valores:
  - `interventional` (padrão) - Revisões de intervenções
  - `predictive_model` - Revisões de modelos preditivos (PICOTS)
  - `diagnostic` - Revisões de testes diagnósticos
  - `prognostic` - Revisões de fatores prognósticos
  - `qualitative` - Revisões qualitativas
  - `other` - Outros tipos

- Adicionado campo `review_type` na tabela `projects`
- Default: `'interventional'`
- Índice criado para performance

### 3. ✅ Seletor de Tipo de Revisão

**Localização:** Seção "Informações Básicas" → Card "Tipo de Revisão"

**Funcionalidade:**
- Select dropdown com todos os tipos de revisão
- Descrição automática baseada no tipo selecionado
- Badge "PICOTS" aparece na opção "Modelos Preditivos"
- Alert informativo quando "Modelos Preditivos" é selecionado

**Opções disponíveis:**
- 🔹 **Intervenções** - Revisão de efetividade de intervenções (PICO clássico)
- 🔹 **Modelos Preditivos** [PICOTS] - Revisão de modelos preditivos e prognósticos
- 🔹 **Testes Diagnósticos** - Revisão de acurácia de testes diagnósticos
- 🔹 **Fatores Prognósticos** - Revisão de fatores associados a prognóstico
- 🔹 **Estudos Qualitativos** - Síntese de evidências qualitativas
- 🔹 **Outro** - Outros tipos de revisão sistemática

### 4. ✅ PICOTS Condicional

**Comportamento:**
- Seção PICOTS **só aparece** quando `review_type === 'predictive_model'`
- Para outros tipos de revisão, a seção não é exibida
- Reduz complexidade visual para revisões que não precisam do framework PICOTS

**Lógica implementada:**
```tsx
const isPredictiveModel = project.review_type === 'predictive_model';

{isPredictiveModel && (
  <Card>
    {/* Seção PICOTS completa */}
  </Card>
)}
```

## Estrutura de Dados Atualizada

### Interface PICOTSItem (Simplificada)

```typescript
interface PICOTSItem {
  // Campo "info" REMOVIDO - agora é apenas tooltip
  description?: string;        // Editável pelo usuário
  inclusion?: string[];        // Critérios de inclusão
  exclusion?: string[];        // Critérios de exclusão
}
```

### Tabela projects

```sql
CREATE TYPE review_type AS ENUM (
  'interventional',
  'predictive_model',
  'diagnostic',
  'prognostic',
  'qualitative',
  'other'
);

ALTER TABLE projects
ADD COLUMN review_type review_type DEFAULT 'interventional'::review_type;
```

## Tooltips Fixos por Componente PICOTS

Cada componente tem seu tooltip explicativo pré-definido:

### 📍 População (P)
> "Defina as características demográficas e clínicas da população alvo. Considere idade, condições de saúde, setting de cuidado e estágio da doença."

### 📍 Modelos Índice (I)
> "Especifique os tipos de modelos preditivos, algoritmos ou ferramentas diagnósticas que serão incluídos. Considere a técnica estatística, tipo de algoritmo e complexidade do modelo."

### 📍 Comparadores (C)
> "Defina quais modelos de referência, escores clínicos tradicionais ou padrões-ouro serão aceitos como comparadores válidos para avaliar a performance relativa."

### 📍 Desfechos (O)
> "Liste os desfechos de interesse, incluindo métricas de performance do modelo (acurácia, discriminação, calibração) e desfechos clínicos relevantes quando disponíveis."

### 📍 Tempo - Momento (T)
> "Especifique em que momento do curso da doença ou cuidado a predição é realizada. Considere o contexto clínico e o objetivo da predição (ex: ao diagnóstico, na admissão hospitalar, durante o seguimento)."

### 📍 Tempo - Horizonte (T)
> "Defina o período futuro que está sendo predito. Considere a relevância clínica do horizonte temporal para a tomada de decisão (ex: 30 dias, 1 ano, 5 anos)."

### 📍 Setting (S)
> "Descreva onde e como o modelo será usado na prática clínica. Considere o setting de cuidado (atenção primária, especializada, UTI), recursos disponíveis e objetivo da aplicação do modelo."

## Arquivos Modificados

```
✏️  src/components/project/ProjectSettings.tsx
    - Adicionado tipo ReviewType
    - Adicionado campo review_type ao salvamento

✏️  src/components/project/settings/BasicInfoSection.tsx
    - Adicionado select de tipo de revisão
    - Adicionado alert informativo para modelos preditivos
    - Definido mapa de tipos com labels e descrições

✏️  src/components/project/settings/ReviewDetailsSection.tsx
    - Removido campo "info" da interface PICOTSItem
    - Adicionado condicional isPredictiveModel
    - Mudado prop de infoPlaceholder para infoTooltip
    - PICOTS só renderiza se review_type === 'predictive_model'

✏️  src/components/project/settings/PICOTSItemEditor.tsx
    - Removido textarea editável do campo "info"
    - Adicionado Tooltip com HelpCircle icon
    - Prop renomeado: infoPlaceholder → infoTooltip
    - Interface simplificada (sem campo info em PICOTSItemData)

🆕  Migração Supabase
    - 20251007_add_review_type_to_projects.sql
    - CREATE TYPE review_type
    - ALTER TABLE projects ADD COLUMN review_type
    - CREATE INDEX idx_projects_review_type
```

## Fluxo de Uso Atualizado

### Para o Usuário:

1. **Criar/Editar Projeto**
   - Ir para Configurações → Informações Básicas
   - Selecionar "Tipo de Revisão" → "Modelos Preditivos"
   - Alert informa que PICOTS será habilitado

2. **Configurar PICOTS** (só se tipo = Modelos Preditivos)
   - Ir para Configurações → Detalhes da Revisão
   - Seção "Configuração PICOTS" aparece automaticamente
   - Expandir cada componente (P, I, C, O, T, S)

3. **Preencher Componente**
   - Ver ícone ℹ️ ao lado do label
   - Passar mouse para ler explicação (tooltip)
   - Preencher descrição
   - Adicionar critérios de inclusão
   - Adicionar critérios de exclusão

4. **Salvar**
   - Clicar em "Salvar Alterações" no topo
   - Todas as alterações (incluindo review_type) são salvas

## Benefícios das Correções

### ✅ UX Melhorada
- Menos confusão: usuário não precisa preencher campo "info"
- Tooltips fixos garantem consistência nas explicações
- Interface mais limpa e focada

### ✅ Flexibilidade
- Suporte a múltiplos tipos de revisão
- PICOTS só aparece quando relevante
- Fácil adicionar novos tipos no futuro

### ✅ Dados Estruturados
- Tipo de revisão armazenado no banco
- Permite filtros e análises por tipo
- Validações específicas por tipo (futuro)

### ✅ Consistência
- Explicações padronizadas
- Não depende do usuário escrever corretamente
- Facilita onboarding de novos revisores

## Testes Realizados

✅ Compilação TypeScript (0 erros)
✅ Build Vite (sucesso)
✅ Linting (0 erros)
✅ Migração Supabase (aplicada com sucesso)

## Próximos Passos Sugeridos

1. **Validação Condicional**
   - PICOTS obrigatório apenas para modelos preditivos
   - Campos diferentes obrigatórios por tipo

2. **Templates por Tipo**
   - Pré-preencher PICOTS com exemplos ao selecionar tipo
   - Guias específicos por tipo de revisão

3. **Exportação Diferenciada**
   - Formato de relatório baseado no tipo
   - Tabelas PICOTS para modelos preditivos
   - Tabelas PICO para intervenções

4. **AI Configurável**
   - Instruções de IA adaptadas ao tipo de revisão
   - Prompts diferentes para cada tipo

## Comandos para Testar

```bash
# Iniciar servidor de desenvolvimento
npm run dev

# Acessar
http://localhost:5173

# Navegar para:
1. Projeto → Configurações → Informações Básicas
2. Selecionar "Modelos Preditivos"
3. Ir para "Detalhes da Revisão"
4. Ver seção PICOTS aparecer
5. Passar mouse sobre ícones ℹ️ para ver tooltips
```

## Conclusão

As correções implementadas tornam o sistema PICOTS mais intuitivo, focado e flexível:

- ✅ **Tooltips fixos** eliminam confusão sobre o que preencher
- ✅ **Seletor de tipo** permite adaptar interface ao tipo de revisão
- ✅ **PICOTS condicional** reduz complexidade visual
- ✅ **Estrutura extensível** facilita adicionar novos tipos

O sistema agora está pronto para suportar diferentes tipos de revisões sistemáticas mantendo a experiência otimizada para cada caso.

