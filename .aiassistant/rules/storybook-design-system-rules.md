---
description: Storybook e documentação visual focada na experiência do pesquisador acadêmico.
alwaysApply: false
priority: medium
globs:
  - "src/**/*.stories.{tsx,ts}"
  - "**/*.stories.{tsx,ts}"
---

## Persona

Atue como um **Senior Software Engineer** com foco em:
- Documentação visual clara e útil
- Experiência do pesquisador acadêmico
- Minimalismo e clareza cognitiva
- Acessibilidade e consistência visual

## Quando Aplicar Esta Regra

Esta regra se aplica quando trabalhar com:
- **Stories do Storybook** (`.stories.tsx`)
- **Documentação visual** de componentes
- **Demonstração de estados** (loading, error, empty, ready)
- **Padrões de UI** e fluxos de usuário

## Prioridade

**Média** - Aplicar quando criar ou atualizar stories do Storybook.

## Princípios Fundamentais

### Minimalismo Acadêmico

- **Clareza cognitiva**: Reduzir carga mental do pesquisador
- **Hierarquia visual**: Informação mais importante sempre em destaque
- **Consistência**: Padrões previsíveis em todo o sistema
- **Acessibilidade**: WCAG 2.1 AA como padrão mínimo

## Filosofia: Minimalismo Acadêmico

### Princípios de Design
- **Clareza cognitiva**: reduzir carga mental do pesquisador
- **Hierarquia visual**: informação mais importante sempre em destaque
- **Consistência**: padrões previsíveis em todo o sistema
- **Acessibilidade**: WCAG 2.1 AA como padrão mínimo

### Paleta Acadêmica Focada
```css
/* Cores primárias - azul confiável e profissional */
--primary: 217 91% 40%;        /* Azul acadêmico - ações principais */
--primary-hover: 217 91% 35%;  /* Estado hover sutil */

/* Estados semânticos - claros e diretos */
--success: 142 71% 45%;        /* Verde - progresso/conclusão */
--warning: 38 92% 50%;         /* Amarelo - atenção necessária */
--destructive: 0 84% 60%;      /* Vermelho - ações críticas */

/* Neutrals - máxima legibilidade */
--foreground: 217 33% 17%;     /* Texto principal - contraste alto */
--muted-foreground: 215 16% 47%; /* Texto secundário - hierarquia */
```

## Componentes Storybook

### 1. Componentes Base (UI Primitivos)
```tsx
// ✅ CORRETO: Foco em variações essenciais apenas
export default {
  title: 'Base/Button',
  component: Button,
  parameters: { 
    docs: { description: { component: 'Botão principal - use com parcimônia para ações críticas.' } }
  }
};

// Mostrar apenas variações que o pesquisador realmente usa
export const Primary: Story = { args: { children: 'Avaliar Artigo' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Cancelar' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Excluir Projeto' } };
```

### 2. Componentes de Contexto (Features)
```tsx
// ✅ CORRETO: Foco em fluxos reais do pesquisador
export default {
  title: 'Pesquisa/AssessmentCard',
  component: AssessmentCard,
  parameters: { layout: 'padded' }
};

export const EmptyState: Story = {
  render: () => (
    <AssessmentCard>
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="mx-auto h-12 w-12 mb-4" />
        <p>Nenhum artigo selecionado</p>
        <p className="text-sm">Faça upload de um PDF para começar</p>
      </div>
    </AssessmentCard>
  )
};

export const InProgress: Story = {
  render: () => (
    <AssessmentCard>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Avaliação em Andamento</h3>
          <Badge variant="secondary">3/5 domínios</Badge>
        </div>
        <Progress value={60} className="h-2" />
        <p className="text-sm text-muted-foreground">
          Continue avaliando os critérios restantes
        </p>
      </div>
    </AssessmentCard>
  )
};
```

### 3. Patterns de Pesquisa
```tsx
// ✅ CORRETO: Layouts específicos para fluxos acadêmicos
export default { title: 'Patterns/ResearchWorkflow' };

export const ArticleReview: Story = {
  render: () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-screen">
      {/* PDF Viewer - área principal */}
      <div className="lg:col-span-2 border rounded-lg">
        <div className="bg-muted/30 p-4 border-b">
          <h2 className="font-medium">Artigo: Machine Learning in Healthcare</h2>
        </div>
        <div className="p-4 h-96 bg-gray-50 flex items-center justify-center">
          <p className="text-muted-foreground">Visualizador PDF</p>
        </div>
      </div>
      
      {/* Assessment Panel - sidebar focado */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Avaliação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Metodologia</Label>
              <Textarea placeholder="Avalie a metodologia utilizada..." className="min-h-[80px]" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Qualidade dos Dados</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma nota" />
                </SelectTrigger>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
};
```

## Design Tokens Visuais

### Hierarquia Tipográfica
```tsx
export const Typography: Story = {
  render: () => (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold mb-2">Título Principal</h1>
        <p className="text-muted-foreground">Para títulos de página e seções principais</p>
      </div>
      
      <div>
        <h2 className="text-xl font-semibold mb-2">Título de Seção</h2>
        <p className="text-muted-foreground">Para organizar conteúdo em blocos</p>
      </div>
      
      <div>
        <p className="text-base mb-2">Texto de corpo regular</p>
        <p className="text-muted-foreground">Para conteúdo principal e descrições</p>
      </div>
      
      <div>
        <p className="text-sm text-muted-foreground mb-2">Texto auxiliar</p>
        <p className="text-muted-foreground">Para metadados e informações secundárias</p>
      </div>
    </div>
  )
};
```

### Estados de Interface
```tsx
export const InterfaceStates: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-6">
      {/* Loading State */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando Artigo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
      
      {/* Success State */}
      <Card className="border-success/20 bg-success/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-success">
            <CheckCircle className="h-4 w-4" />
            Avaliação Concluída
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">Artigo avaliado com sucesso. Relatório disponível para download.</p>
        </CardContent>
      </Card>
    </div>
  )
};
```

## Quando Criar Nova Story

### Árvore de Decisão

```
Novo componente criado?
├─ É componente UI primitivo (Button, Input, Card)?
│  └─ → Criar story em Base/
│
├─ É componente de feature (ArticleCard, AssessmentForm)?
│  └─ → Criar story em Pesquisa/
│
├─ É padrão de layout/fluxo completo?
│  └─ → Criar story em Patterns/
│
└─ É documentação de tokens (cores, tipografia)?
   └─ → Criar story em Tokens/

Story já existe?
├─ Componente mudou significativamente?
│  └─ → Atualizar story existente
│
└─ Novo estado/caso de uso importante?
   └─ → Adicionar nova variação à story existente
```

### Quando NÃO Criar Story

- Componente interno/privado (não usado diretamente)
- Componente muito simples sem variações relevantes
- Duplicação de story existente (atualizar ao invés de criar nova)

## Exemplos Positivos ✅

### Story Completa e Bem Estruturada

```tsx
// ✅ CORRETO: Story completa com todos os estados
export default {
  title: 'Pesquisa/ArticleCard',
  component: ArticleCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Card para exibir informações de artigo. Usado em listagens e grids.'
      }
    }
  }
};

export const Default: Story = {
  args: {
    article: {
      id: '1',
      title: 'Machine Learning in Healthcare',
      description: 'A comprehensive review of ML applications...',
      createdAt: '2024-01-15',
    }
  }
};

export const Loading: Story = {
  render: () => <ArticleCardSkeleton />
};

export const Empty: Story = {
  render: () => (
    <ArticleCard>
      <EmptyState title="Nenhum artigo" />
    </ArticleCard>
  )
};

export const WithLongTitle: Story = {
  args: {
    article: {
      id: '2',
      title: 'A Very Long Article Title That Should Be Truncated Properly With Line Clamp',
      description: 'Description...',
    }
  }
};
```

## Exemplos Negativos ❌

### Story Sem Estados

```tsx
// ❌ ERRADO: Apenas estado padrão, sem loading/error/empty
export default {
  title: 'Pesquisa/ArticleCard',
  component: ArticleCard,
};

export const Default: Story = {
  args: {
    article: mockArticle
  }
};
// Falta: Loading, Empty, Error states

// ✅ CORRETO: Todos os estados (ver exemplo positivo acima)
```

### Story Com Dados Irreais

```tsx
// ❌ ERRADO: Dados que não representam uso real
export const Example: Story = {
  args: {
    article: {
      title: 'Test',
      description: 'Test description',
      // Dados genéricos que não ajudam a entender o componente
    }
  }
};

// ✅ CORRETO: Dados realistas que mostram uso real
export const Example: Story = {
  args: {
    article: {
      title: 'Machine Learning in Healthcare: A Systematic Review',
      description: 'This systematic review examines the application of machine learning algorithms in healthcare settings...',
      // Dados que representam uso real pelo pesquisador
    }
  }
};
```

### Story Sem Descrição

```tsx
// ❌ ERRADO: Sem documentação
export default {
  title: 'Base/Button',
  component: Button,
  // Falta: parameters.docs.description
};

// ✅ CORRETO: Com documentação
export default {
  title: 'Base/Button',
  component: Button,
  parameters: {
    docs: {
      description: {
        component: 'Botão principal - use com parcimônia para ações críticas.'
      }
    }
  }
};
```

### Story Sem Dark Mode

```tsx
// ❌ ERRADO: Não testa dark mode
export const Default: Story = {
  args: { /* ... */ }
};
// Falta: Toggle dark/light mode

// ✅ CORRETO: Inclui toggle dark/light
export default {
  title: 'Base/Button',
  component: Button,
  parameters: {
    backgrounds: {
      default: 'light',
    },
  },
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
};
```

## Regras de Implementação

### Para o AI ao criar componentes:
1. **Sempre priorize legibilidade** - contraste mínimo 4.5:1
2. **Estados claros** - loading, empty, error sempre visíveis
3. **Ações óbvias** - botões primários apenas para ações críticas
4. **Hierarquia visual** - informação mais importante em destaque
5. **Feedback imediato** - toda ação deve ter resposta visual

### Estrutura de Stories:
```tsx
// ✅ Template padrão para novos componentes
export default {
  title: 'Categoria/ComponentName',
  component: Component,
  parameters: {
    docs: { 
      description: { 
        component: 'Descrição focada no uso pelo pesquisador.' 
      }
    }
  }
};

// Estados essenciais apenas
export const Default: Story = { /* estado padrão */ };
export const WithData: Story = { /* com dados reais */ };
export const Loading: Story = { /* carregando */ };
export const Empty: Story = { /* estado vazio */ };
```

### Categorias Storybook:
- **Base/** - Componentes UI primitivos
- **Pesquisa/** - Componentes específicos de research
- **Patterns/** - Layouts e fluxos completos
- **Tokens/** - Design system documentation

### Foco na Experiência:
- **Reduzir cliques** - ações comuns em 1-2 cliques máximo
- **Contexto claro** - usuário sempre sabe onde está
- **Progresso visível** - em tarefas longas como avaliação
- **Recuperação de erro** - sempre oferecer próximo passo
- **Consistência** - mesmo padrão em situações similares

## Checklist de Validação

Antes de considerar story completa, verificar:

### Estrutura
- [ ] **Título correto**: Segue padrão `Categoria/ComponentName`
- [ ] **Descrição presente**: `parameters.docs.description` preenchido
- [ ] **Categoria correta**: Base/Pesquisa/Patterns/Tokens

### Estados
- [ ] **Estado padrão**: `Default` com dados realistas
- [ ] **Loading state**: Se componente carrega dados
- [ ] **Empty state**: Se componente pode estar vazio
- [ ] **Error state**: Se componente pode ter erro
- [ ] **Variações relevantes**: Estados que o pesquisador realmente encontra

### Visual
- [ ] **Dark mode**: Toggle dark/light funciona
- [ ] **Contraste**: Texto legível (4.5:1 mínimo)
- [ ] **Responsividade**: Testado em diferentes tamanhos
- [ ] **Acessibilidade**: ARIA labels, foco visível

### Documentação
- [ ] **Descrição clara**: Explica uso pelo pesquisador
- [ ] **Args documentados**: Props importantes documentadas
- [ ] **Exemplos realistas**: Dados que representam uso real

## Referências

- `design-system.mdc` - Regras de UI/UX e acessibilidade
- `frontend-react-rule.mdc` - Regras específicas para React
- `core-rules-saas-app.mdc` - Princípios gerais
