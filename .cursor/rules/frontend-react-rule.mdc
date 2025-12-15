---
description: Boas práticas para React (Vite ou Next) em SaaS.
alwaysApply: false
priority: high
globs:
  - "src/**/*.{tsx,ts}"
  - "src/components/**/*"
  - "src/hooks/**/*"
  - "src/pages/**/*"
---

## Persona

Atue como um **Senior Software Engineer** com foco em:
- Código React limpo, modular e manutenível
- Princípios DRY (Don't Repeat Yourself) e KISS (Keep It Simple, Stupid)
- Performance otimizada sem over-engineering
- Componentes focados em uma única responsabilidade

## Quando Aplicar Esta Regra

Esta regra se aplica quando trabalhar com:
- **Componentes React** (`.tsx`, `.jsx`)
- **Custom Hooks** (`use*.ts`)
- **Gerenciamento de Estado** (Context, Zustand, TanStack Query)
- **Formulários** (react-hook-form, validação)
- **Performance React** (memoização, code splitting)
- **Estrutura de pastas** frontend

## Prioridade

**Alta** - Aplicar sempre que trabalhar com código React/frontend.

## Princípios Fundamentais

### DRY (Don't Repeat Yourself)

**Elimine duplicação através de:**
- Custom hooks para lógica reutilizável
- Componentes base/composição
- Utilitários centralizados
- Abstrações quando padrão se repete 3+ vezes

### KISS (Keep It Simple, Stupid)

**Prefira simplicidade:**
- Componentes pequenos e focados
- Lógica direta sobre abstrações complexas
- Estado local quando possível, global apenas quando necessário
- Evite over-engineering

### Modularidade

**Componentes/hooks/services devem:**
- Ter uma responsabilidade única
- Ser testáveis isoladamente
- Ter interfaces claras (props, retornos)
- Ser reutilizáveis quando apropriado

## Arquitetura & Estado

### Estrutura de Pastas

**Estrutura atual (aceitável):**
```
src/
├── components/  → Por tipo (ui/, patterns/, domain/)
├── hooks/       → Por domínio (assessment/, extraction/)
├── services/    → Por domínio
└── integrations/
    ├── supabase/ → Cliente Supabase (Auth, Realtime)
    └── api/      → Cliente FastAPI
```

**Estrutura ideal (futuro - migrar gradualmente):**
```
src/
├── features/
│   ├── assessment/
│   │   ├── ui/       → Componentes específicos
│   │   ├── hooks/    → useAssessment, useBatchAssessment
│   │   └── services/ → assessmentService
│   └── extraction/
├── shared/      → Componentes/hooks compartilhados
└── integrations/
    ├── supabase/ → Auth, Realtime, Storage
    └── api/      → Cliente HTTP para FastAPI
```

- **Supabase Client**: Auth, Realtime subscriptions, Storage.
- **API Client**: Operações de negócio via FastAPI (extração, assessment, etc).
- **TanStack Query**: Dados remotos (chaves estáveis, `staleTime` racional).
- **react-hook-form + zod**: Formulários com validação.

### Modularidade de Componentes

**Componentes devem ser:**
- **Focados**: Uma responsabilidade por componente
- **Composáveis**: Componentes pequenos que se combinam
- **Reutilizáveis**: Quando padrão se repete, abstrair

```tsx
// ❌ Componente monolítico (viola modularidade)
function ArticleManagement() {
  // 500+ linhas
  // Gerencia lista, formulário, validação, API, estado...
}

// ✅ Componentes modulares (KISS + DRY)
function ArticleList() {
  const { data, isLoading } = useArticles();
  return <DataTable data={data} loading={isLoading} />;
}

function ArticleForm() {
  const form = useForm<ArticleFormData>({ resolver: zodResolver(schema) });
  return <Form form={form} />;
}

function ArticleManagement() {
  return (
    <div>
      <ArticleList />
      <ArticleForm />
    </div>
  );
}
```

## UI/UX

- **Tailwind** + lib de componentes consistente (ex.: shadcn/ui); A11y (ARIA) obrigatória.
- Sempre trate `loading`, `empty state`, `error` e `retry` (ver `design-system.mdc`).
- **ErrorBoundary** por página/feature; *toasts* apenas para feedback transitório.

### ErrorBoundary

- Um ErrorBoundary por feature/page crítica.
- Integrar com `errorTracker.captureError()` (ver `core-rules-saas-app.mdc`).
- Mostrar mensagem amigável + botão "Tentar novamente".

```tsx
class FeatureErrorBoundary extends React.Component {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    errorTracker.captureError(error, {
      component: this.props.componentName,
      metadata: { errorInfo },
    });
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <ErrorState 
          message="Algo deu errado" 
          onRetry={() => window.location.reload()} 
        />
      );
    }
    return this.props.children;
  }
}
```

## Performance

### Regra de Ouro

**Não otimize prematuramente.** Use React DevTools Profiler para identificar gargalos reais.

### Árvore de Decisão: Quando Usar Otimizações

```
Componente re-renderiza desnecessariamente?
├─ Props mudam mas valor é igual?
│  └─ → React.memo com função de comparação customizada
│
├─ Cálculo custoso em cada render?
│  └─ → useMemo (filtros, transformações grandes)
│
├─ Callback passado como prop para componente memoizado?
│  └─ → useCallback
│
├─ Bundle muito grande?
│  └─ → Code splitting (lazy loading)
│
└─ Lista muito longa?
   └─ → Virtualização (VirtualList)
```

### Quando usar otimizações

- **`React.memo`**: Componente recebe props iguais mas re-renderiza desnecessariamente.
  ```tsx
  // ✅ CORRETO: Memoização quando necessário
  export const ExpensiveComponent = React.memo(({ data }) => {
    // Render custoso
  }, (prevProps, nextProps) => prevProps.data.id === nextProps.data.id);
  
  // ❌ ERRADO: Memoização desnecessária
  export const SimpleComponent = React.memo(({ text }) => {
    return <p>{text}</p>; // Componente simples não precisa de memo
  });
  ```

- **`useMemo`**: Cálculo custoso (ex: filtros/transformações grandes).
  ```tsx
  // ✅ CORRETO: useMemo para cálculos custosos
  const filteredData = useMemo(() => {
    return largeArray.filter(/* lógica complexa */);
  }, [largeArray, filterCriteria]);
  
  // ❌ ERRADO: useMemo para cálculos simples
  const count = useMemo(() => items.length, [items]); // Desnecessário
  const simpleCount = items.length; // ✅ Simples e direto
  ```

- **`useCallback`**: Callback passado como prop e componente filho é memoizado.
  ```tsx
  // ✅ CORRETO: useCallback quando necessário
  const handleClick = useCallback(() => {
    // lógica
  }, [dependencies]);
  
  <MemoizedChild onClick={handleClick} />
  
  // ❌ ERRADO: useCallback desnecessário
  const handleClick = useCallback(() => {
    setCount(c => c + 1);
  }, []); // Se filho não é memoizado, não precisa
  ```

### Code-splitting

- **Rotas**: automático com React Router `lazy()`.
  ```tsx
  const AssessmentPage = lazy(() => import('./pages/AssessmentFullScreen'));
  ```

- **Features**: manual para bundles grandes (PDF viewer, charts).
  ```tsx
  const PDFViewer = lazy(() => import('./components/PDFViewer'));
  ```

### Outros

- Imagens otimizadas; evite libs pesadas para pequenos utilitários.
- Use `VirtualList` para listas longas (já implementado em `components/performance/`).

## Exemplos Positivos ✅

### DRY: Hook Reutilizável

```tsx
// ✅ Hook reutilizável (DRY)
function usePagination<T>(items: T[], itemsPerPage = 10) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(items.length / itemsPerPage);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return items.slice(start, start + itemsPerPage);
  }, [items, currentPage, itemsPerPage]);
  
  return {
    currentPage,
    totalPages,
    paginatedItems,
    goToPage: setCurrentPage,
    nextPage: () => setCurrentPage(p => Math.min(p + 1, totalPages)),
    prevPage: () => setCurrentPage(p => Math.max(p - 1, 1)),
  };
}

// Uso em múltiplos componentes
function ArticleList() {
  const { data } = useArticles();
  const pagination = usePagination(data);
  // ...
}

function ProjectList() {
  const { data } = useProjects();
  const pagination = usePagination(data);
  // ...
}
```

### KISS: Componente Simples

```tsx
// ✅ Componente simples e direto (KISS)
function ArticleCard({ article }: { article: Article }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{article.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{article.description}</p>
      </CardContent>
    </Card>
  );
}
```

### Modularidade: Componentes Focados

```tsx
// ✅ Componentes modulares e focados
function ArticleListHeader({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex justify-between items-center">
      <h2>Artigos</h2>
      <Button onClick={onAdd}>Adicionar</Button>
    </div>
  );
}

function ArticleListContent({ articles }: { articles: Article[] }) {
  if (articles.length === 0) return <EmptyState />;
  return (
    <div className="grid gap-4">
      {articles.map(article => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </div>
  );
}

function ArticleList() {
  const { data, isLoading } = useArticles();
  if (isLoading) return <Skeleton />;
  
  return (
    <div>
      <ArticleListHeader onAdd={() => {/* ... */}} />
      <ArticleListContent articles={data} />
    </div>
  );
}
```

## Exemplos Negativos ❌

### Duplicação de Lógica (Violação DRY)

```tsx
// ❌ Lógica duplicada em múltiplos componentes
function ArticleList() {
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;
  const start = (page - 1) * itemsPerPage;
  const paginated = articles.slice(start, start + itemsPerPage);
  // ... lógica de paginação duplicada
}

function ProjectList() {
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;
  const start = (page - 1) * itemsPerPage;
  const paginated = projects.slice(start, start + itemsPerPage);
  // ... mesma lógica duplicada
}

// ✅ Solução: Hook reutilizável (ver exemplo positivo acima)
```

### Complexidade Desnecessária (Violação KISS)

```tsx
// ❌ Over-engineering: Abstração complexa desnecessária
function useAdvancedDataManager<T>(config: {
  fetcher: (params: any) => Promise<T>;
  transformer: (data: any) => T;
  cacheStrategy: 'memory' | 'localStorage' | 'indexedDB';
  retryStrategy: { maxRetries: number; backoff: 'linear' | 'exponential' };
  // ... 20+ opções
}) {
  // 200+ linhas de código complexo
}

// ✅ Solução: Simples e direto
function useArticles() {
  return useQuery({
    queryKey: ['articles'],
    queryFn: fetchArticles,
  });
}
```

### Componente Monolítico (Violação Modularidade)

```tsx
// ❌ Componente fazendo tudo (500+ linhas)
function ArticleManagement() {
  // Estado de lista
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Estado de formulário
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  
  // Lógica de API
  // Lógica de validação
  // Lógica de UI
  // ... tudo misturado
}

// ✅ Solução: Componentes modulares (ver exemplo positivo acima)
```

### Otimização Prematura

```tsx
// ❌ Memoização desnecessária
const SimpleText = React.memo(({ text }: { text: string }) => {
  return <p>{text}</p>; // Componente simples não precisa de memo
});

// ✅ Simples e direto
function SimpleText({ text }: { text: string }) {
  return <p>{text}</p>;
}
```

### Estado Global Desnecessário

```tsx
// ❌ Estado global para dados locais
const useArticleStore = create((set) => ({
  selectedArticle: null,
  setSelectedArticle: (article) => set({ selectedArticle: article }),
}));

function ArticleCard({ article }: { article: Article }) {
  const { setSelectedArticle } = useArticleStore();
  // Estado usado apenas neste componente
}

// ✅ Estado local quando possível
function ArticleCard({ article }: { article: Article }) {
  const [selected, setSelected] = useState(false);
  // Estado local é suficiente
}
```

## Integração com FastAPI

### Cliente API

Use o cliente centralizado em `src/integrations/api/client.ts`:

```typescript
import { apiClient } from '@/integrations/api/client';

// Em hooks/services
async function extractSection(request: ExtractionRequest) {
  return apiClient<ExtractionResponse>(
    '/api/v1/extraction/sections',
    {
      method: 'POST',
      body: JSON.stringify(request),
    }
  );
}
```

### TanStack Query com FastAPI

```typescript
// ✅ Hook que usa FastAPI
function useAIAssessment() {
  return useMutation({
    mutationFn: async (request: AssessmentRequest) => {
      return apiClient<ApiResponse<AssessmentResult>>(
        '/api/v1/assessment/ai',
        {
          method: 'POST',
          body: JSON.stringify(request),
        }
      );
    },
    onError: (error) => {
      toast.error('Erro ao executar avaliação');
    },
  });
}
```

### Supabase vs FastAPI

| Operação | Usar |
|----------|------|
| Auth (login, signup, logout) | Supabase Client |
| Realtime subscriptions | Supabase Client |
| Storage (upload/download) | Supabase Client |
| CRUD simples | Pode usar qualquer um |
| AI/LLM operations | FastAPI |
| Extração de dados | FastAPI |
| Operações complexas | FastAPI |

```typescript
// ✅ Auth: Supabase
import { supabase } from '@/integrations/supabase/client';
await supabase.auth.signInWithPassword({ email, password });

// ✅ AI Assessment: FastAPI
import { apiClient } from '@/integrations/api/client';
await apiClient('/api/v1/assessment/ai', { method: 'POST', body });
```

## Segurança no Front

- Nunca expor **service role**; use **anon key** no cliente.
- **Validação dupla**: front (zod) + back (Pydantic).
- **Token JWT**: Automaticamente incluído nas requisições via `apiClient`.

## Checklist de Validação

Antes de considerar código React completo, verificar:

- [ ] **DRY aplicado**: Sem duplicação de lógica (hooks reutilizáveis quando apropriado)
- [ ] **KISS aplicado**: Código simples, sem complexidade desnecessária
- [ ] **Modularidade**: Componentes/hooks focados em uma responsabilidade
- [ ] **Type safety**: Props tipadas, sem `any` desnecessário
- [ ] **Performance**: Otimizações apenas quando necessário (memo, useMemo, useCallback)
- [ ] **Estados tratados**: Loading, error, empty, ready (ver `design-system.mdc`)
- [ ] **ErrorBoundary**: Implementado para features críticas
- [ ] **Acessibilidade**: ARIA labels, contraste, navegação por teclado
- [ ] **Testes**: Componentes testáveis, hooks testados quando críticos
- [ ] **Code splitting**: Lazy loading para rotas e features grandes
- [ ] **Validação**: Formulários com react-hook-form + zod
- [ ] **TanStack Query**: Para dados remotos (chaves estáveis, staleTime)

## Referências

- `core-rules-saas-app.mdc` - Princípios gerais, fluxo de trabalho
- `design-system.mdc` - UI/UX, acessibilidade, tokens
- `fastapi-backend-rules.mdc` - Endpoints e formato de resposta do backend
- `database-sqlalchemy-rules.mdc` - Estrutura de dados

## Entregáveis do AI

- Componentes com exemplo de uso + teste (Testing Library/Vitest) e breve rationale de decisões.
- Sempre explicar trade-offs de decisões arquiteturais (DRY vs KISS, performance vs simplicidade).
