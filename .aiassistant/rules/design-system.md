---
rule_type: always
description: Regras do Design System Review Hub para UI/UX consistente e acessível
priority: high
globs:
  - "src/components/**/*.{tsx,ts}"
  - "src/pages/**/*.{tsx,ts}"
---

## Persona

Atue como um **Senior Software Engineer** com foco em:
- UI/UX consistente e acessível (WCAG 2.1 AA)
- Design system unificado (tokens, não hardcode)
- Experiência do usuário polida (estados, feedback, responsividade)
- Acessibilidade como requisito, não opção

## Quando Aplicar Esta Regra

Esta regra se aplica quando trabalhar com:
- **Componentes UI** (botões, inputs, cards, modals)
- **Layouts e páginas**
- **Estados de interface** (loading, error, empty, ready)
- **Acessibilidade** (ARIA, contraste, navegação)
- **Responsividade** (mobile, tablet, desktop)
- **Design tokens** (cores, espaçamento, tipografia)

## Prioridade

**Alta** - Aplicar sempre que trabalhar com UI/UX.

# Design System Review Hub

## Tokens (OBRIGATÓRIO)

### Regra de Ouro
**NUNCA hardcode valores: `#1E40AF`, `16px`, `12rem` → Use APENAS tokens**

### Cores
```tsx
// ✅ CORRETO
className="bg-primary text-primary-foreground"
className="bg-destructive hover:bg-destructive/90"
style={{ background: "hsl(var(--primary))" }}

// ❌ ERRADO
className="bg-blue-600 text-white"
style={{ backgroundColor: "#1E40AF" }}
```

### Espaçamento
```tsx
// ✅ CORRETO - Escala Tailwind
className="p-4 gap-3 mt-6"

// ❌ ERRADO
style={{ padding: "15px", gap: "13px" }}
```

## Estrutura de Pastas

```
src/components/
├── ui/          → shadcn primitivos (NÃO modificar)
├── patterns/    → Padrões compostos (AppDialog, PageHeader, etc)
├── layout/      → Layouts principais
└── navigation/  → Navegação global

src/features/<domain>/  → Telas por domínio
```

## Componentes

### Button
```tsx
// Hierarquia de ações
<Button variant="default">Primária</Button>
<Button variant="outline">Secundária</Button>
<Button variant="ghost">Terciária</Button>
<Button variant="destructive">Destrutiva</Button>

// Icon-only SEMPRE com aria-label
<Button size="icon" aria-label="Editar">
  <PencilIcon />
</Button>
```

### Dialog vs Sheet

**Árvore de Decisão:**
```
Precisa de modal/overlay?
├─ Formulário curto ou confirmação?
│  └─ → Dialog (focado, ação rápida)
│
├─ Detalhes de item ou contexto da lista?
│  └─ → Sheet (lateral, mais espaço)
│
└─ Multi-etapa ou formulário longo?
   └─ → Sheet (melhor para scroll)
```

**Dialog**: Formulários curtos, confirmações, ações focadas
**Sheet**: Detalhes de item, contexto da lista, multi-etapa

```tsx
// Dialog com tamanho fixo
<DialogContent className="max-w-md">

// Sheet com largura fixa
<SheetContent className="w-[400px] sm:w-[540px]">
```

### Tabs com Altura Estável

```tsx
// ⚠️ SEMPRE definir min-h para evitar layout shift
<TabsContent value="tab1" className="min-h-[400px]">
```

### Dropdown/Popover

```tsx
// Largura fixa, max 8 itens (se mais → scroll)
<DropdownMenuContent className="min-w-[180px] max-w-[220px]">
  {/* Max 8 itens, depois scroll interno */}
</DropdownMenuContent>
```

## Estados de Dados (OBRIGATÓRIO)

**TODA lista/tabela/card DEVE ter 4 estados:**

```tsx
function DataComponent() {
  // 1. Loading
  if (isLoading) return <Skeleton />;
  
  // 2. Error
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  
  // 3. Empty
  if (data.length === 0) return <EmptyState title="Sem dados" />;
  
  // 4. Ready
  return <div>{data.map(...)}</div>;
}
```

## Acessibilidade (NON-NEGOTIABLE)

### Foco Visível
```tsx
// Já vem por padrão no shadcn, mas se criar custom:
className="focus-visible:ring-2 focus-visible:ring-ring"
```

### Labels
```tsx
// ✅ Icon-only com aria-label
<Button size="icon" aria-label="Editar artigo">
  <PencilIcon />
</Button>

// ✅ Inputs com labels
<Label htmlFor="email">E-mail</Label>
<Input id="email" />

// ❌ ERRADO: Input sem label
<Input placeholder="E-mail" /> // Sem label associado
```

### Contraste
- Texto normal: **4.5:1**
- Texto grande: **3:1**
- Nossos tokens já garantem isso

### Dark Mode
- **Sempre testar** componentes em light e dark mode.
- Tokens HSL suportam ambos modos automaticamente via `next-themes`.
- **Storybook**: adicionar toggle dark/light em todas as stories.
- **Contraste**: verificar com axe DevTools em ambos modos.

```tsx
// ✅ Funciona em ambos modos (tokens HSL)
<div className="bg-background text-foreground">
  <p className="text-muted-foreground">Texto secundário</p>
</div>

// ❌ Hardcode não funciona em dark mode
<div style={{ backgroundColor: '#ffffff', color: '#000000' }}>
```

### Alvos de Toque
- Mínimo **44x44px** para mobile

## Responsividade

### Breakpoints
```tsx
sm: 640px   → Mobile landscape
md: 768px   → Tablet
lg: 1024px  → Desktop
xl: 1280px  → Large desktop
```

### Padrões
```tsx
// Sidebar: Desktop fixa, Mobile sheet
<div className="hidden lg:block"><Sidebar /></div>
<div className="lg:hidden"><MobileSidebar /></div>

// Grid responsivo
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

// Toolbar wrap
<div className="flex flex-wrap gap-2 lg:flex-nowrap">
```

## Árvore de Decisão

1. **Há token?** → Use-o (não hardcode)
2. **Há primitivo shadcn?** → Use-o (não crie custom)
3. **É layout recorrente?** → Crie em `/patterns/`
4. **Modal ou Sheet?** → Contexto lista = Sheet, Ação curta = Dialog
5. **Muitas ações?** → Use DropdownMenu
6. **Ajuda complexa?** → Dialog/Sheet (Tooltip só 1-2 linhas)

## Exemplos Positivos ✅

### Uso Correto de Tokens

```tsx
// ✅ CORRETO: Usando tokens do design system
function ArticleCard() {
  return (
    <Card className="bg-card text-card-foreground">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold text-foreground">
          Título
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">
          Descrição
        </p>
      </CardContent>
    </Card>
  );
}
```

### Estados Completos

```tsx
// ✅ CORRETO: Todos os 4 estados implementados
function ArticlesList() {
  const { data, isLoading, error, refetch } = useArticles();
  
  if (isLoading) return <ArticlesListSkeleton />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;
  if (data.length === 0) return <EmptyState title="Nenhum artigo" />;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.map(article => <ArticleCard key={article.id} article={article} />)}
    </div>
  );
}
```

### Acessibilidade Completa

```tsx
// ✅ CORRETO: Acessível e semântico
function SearchForm() {
  return (
    <form>
      <Label htmlFor="search">Buscar artigos</Label>
      <Input 
        id="search"
        type="search"
        aria-label="Buscar artigos"
        aria-describedby="search-help"
      />
      <p id="search-help" className="text-sm text-muted-foreground">
        Digite palavras-chave para buscar
      </p>
      <Button type="submit" aria-label="Executar busca">
        <SearchIcon className="h-4 w-4" />
      </Button>
    </form>
  );
}
```

## Exemplos Negativos ❌

### Hardcode de Valores

```tsx
// ❌ ERRADO: Hardcode de cores
<div style={{ backgroundColor: '#1E40AF', color: '#ffffff' }}>
  <p style={{ fontSize: '16px', padding: '12px' }}>Conteúdo</p>
</div>

// ✅ CORRETO: Usar tokens
<div className="bg-primary text-primary-foreground">
  <p className="text-base p-3">Conteúdo</p>
</div>
```

### Estados Faltando

```tsx
// ❌ ERRADO: Apenas estado ready, sem loading/error/empty
function ArticlesList() {
  const { data } = useArticles();
  return (
    <div>
      {data.map(article => <ArticleCard key={article.id} article={article} />)}
    </div>
  );
}

// ✅ CORRETO: Todos os estados (ver exemplo positivo acima)
```

### Acessibilidade Ruim

```tsx
// ❌ ERRADO: Sem labels, sem foco visível, sem contraste adequado
<button onClick={handleClick}>
  <Icon />
</button>
<input placeholder="Email" />

// ✅ CORRETO: Acessível
<Button onClick={handleClick} aria-label="Editar artigo">
  <Icon />
</Button>
<Label htmlFor="email">E-mail</Label>
<Input id="email" />
```

### Componente Custom Desnecessário

```tsx
// ❌ ERRADO: Criar componente custom quando shadcn já tem
function CustomButton({ children, onClick }) {
  return (
    <button 
      onClick={onClick}
      className="px-4 py-2 bg-blue-600 text-white rounded"
    >
      {children}
    </button>
  );
}

// ✅ CORRETO: Usar componente do design system
<Button variant="default" onClick={onClick}>
  {children}
</Button>
```

### Dark Mode Quebrado

```tsx
// ❌ ERRADO: Hardcode que não funciona em dark mode
<div style={{ backgroundColor: '#ffffff', color: '#000000' }}>
  <p>Conteúdo</p>
</div>

// ✅ CORRETO: Tokens que funcionam em ambos modos
<div className="bg-background text-foreground">
  <p>Conteúdo</p>
</div>
```

### Alvos de Toque Pequenos

```tsx
// ❌ ERRADO: Botão muito pequeno para mobile
<Button size="sm" className="h-6 w-6"> {/* < 44px */}

// ✅ CORRETO: Tamanho mínimo de 44x44px
<Button size="icon" className="h-11 w-11"> {/* >= 44px */}
```

## Validação Visual

### Checklist de Validação Visual

Antes de considerar componente UI completo, verificar visualmente:

- [ ] **Light mode**: Componente renderiza corretamente
- [ ] **Dark mode**: Componente renderiza corretamente (toggle e verificar)
- [ ] **Contraste**: Texto legível (4.5:1 normal, 3:1 grande)
- [ ] **Estados visuais**: Hover, focus, active, disabled visíveis
- [ ] **Layout estável**: Sem layout shift (especialmente em Tabs/Modals)
- [ ] **Responsividade**: Testado em mobile (375px), tablet (768px), desktop (1440px)
- [ ] **Alvos de toque**: Botões/interativos >= 44x44px em mobile
- [ ] **Espaçamento consistente**: Usa tokens de espaçamento (p-4, gap-3, etc.)

### Ferramentas de Validação

- **axe DevTools**: Verificar acessibilidade e contraste
- **React DevTools**: Verificar props e estado
- **Browser DevTools**: Verificar responsividade (device toolbar)
- **Storybook**: Visualizar componente isoladamente

## Checklist de Acessibilidade Detalhado

Antes de considerar componente acessível, verificar:

### Semântica
- [ ] **HTML semântico**: Usar elementos corretos (`<button>`, `<nav>`, `<main>`, etc.)
- [ ] **ARIA labels**: Icon-only buttons têm `aria-label`
- [ ] **ARIA describedby**: Inputs complexos têm descrição associada
- [ ] **Landmarks**: Páginas têm estrutura semântica (`<header>`, `<main>`, `<footer>`)

### Navegação
- [ ] **Foco visível**: Todos os elementos interativos têm foco visível
- [ ] **Navegação por teclado**: Componente é navegável apenas com teclado
- [ ] **Ordem de foco**: Ordem lógica (Tab order)
- [ ] **Skip links**: Para conteúdo repetitivo (header, sidebar)

### Contraste e Legibilidade
- [ ] **Contraste de texto**: 4.5:1 para texto normal, 3:1 para texto grande
- [ ] **Contraste de UI**: 3:1 para elementos de UI (bordas, ícones)
- [ ] **Tamanho de fonte**: Mínimo 14px (16px recomendado)
- [ ] **Line height**: Mínimo 1.5 para legibilidade

### Formulários
- [ ] **Labels associados**: Todos os inputs têm `<Label htmlFor="id">`
- [ ] **Mensagens de erro**: Associadas ao input (`aria-describedby`)
- [ ] **Validação**: Feedback claro e acessível
- [ ] **Required**: Campos obrigatórios marcados (`aria-required` ou visual)

### Interatividade
- [ ] **Alvos de toque**: Mínimo 44x44px em mobile
- [ ] **Estados visuais**: Hover, focus, active, disabled claramente visíveis
- [ ] **Feedback**: Ações têm feedback visual/imediato
- [ ] **Timeout**: Sem timeouts que interrompem usuário (ou aviso prévio)

## Checklist (antes de commit)

- [ ] Usa apenas tokens (sem hardcode)
- [ ] 4 estados de dados implementados
- [ ] Foco visível + aria-labels
- [ ] Contraste OK (4.5:1 texto, 3:1 grande)
- [ ] **Testado em dark mode** (toggle e verificar contraste)
- [ ] Alvos toque ≥ 44px
- [ ] Testado: mobile (375px), tablet (768px), desktop (1440px)
- [ ] Tabs/Modals com tamanhos estáveis (min-h)
- [ ] Navegação por teclado funciona
- [ ] Validação visual completa (light + dark)

## Quando Propor Novo Token

Se precisar algo que não existe:

1. **NÃO hardcode**
2. Abra issue com:
   - Caso de uso + screenshots
   - Nome semântico proposto (não hex)
   - Notas a11y + dark mode
   - Proposta Storybook
3. Aguarde aprovação DS owner
4. Implemente + documente

## Exemplo Completo

```tsx
// ✅ CÓDIGO IDEAL
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/patterns/EmptyState";
import { ErrorState } from "@/components/patterns/ErrorState";

function ArticlesList() {
  const { data, isLoading, error, refetch } = useArticles();
  
  // Estados obrigatórios
  if (isLoading) return <ArticlesListSkeleton />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;
  if (data.length === 0) {
    return (
      <EmptyState
        title="Nenhum artigo"
        action={{ label: "Adicionar", onClick: openDialog }}
      />
    );
  }
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.map(article => (
        <Card key={article.id}>
          <CardHeader>
            <CardTitle className="line-clamp-2">{article.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground line-clamp-3">
              {article.description}
            </p>
            
            <div className="flex gap-2 mt-4">
              <Button variant="outline" size="sm">Ver Detalhes</Button>
              <Button 
                variant="ghost" 
                size="icon"
                aria-label="Editar artigo"
              >
                <PencilIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

## Referências

- `core-rules-saas-app.mdc` - Princípios gerais, fluxo de trabalho
- `frontend-react-rule.mdc` - Regras específicas para React
- `storybook-design-system-rules.mdc` - Documentação visual

## Referência Rápida

**Guia Completo**: `DESIGN_SYSTEM_GUIDE.md` na raiz do projeto

**Dúvidas?** Consulte árvore de decisão ou abra issue.
