# Sistema de Background Jobs e Notificações

Sistema profissional para gerenciar tarefas de longa duração em background, permitindo ao usuário continuar usando a aplicação enquanto operações como importação do Zotero executam.

## 📋 Arquitetura

### 1. **Background Jobs Store** (`src/stores/useBackgroundJobs.ts`)
- Store Zustand com persistência em LocalStorage
- Mantém estado de jobs ativos e histórico recente
- Auto-limpeza de jobs antigos (> 1 semana)
- Máximo de 10 jobs completos mantidos em cache

### 2. **Notification Center** (`src/components/navigation/NotificationCenter.tsx`)
- Ícone de sino minimalista no topbar
- Badge com contador de notificações não lidas
- Dropdown com lista de jobs e suas estatísticas
- Design profissional usando shadcn/ui
- Navegação para projetos ao clicar em notificações

### 3. **Background Job Polling** (`src/hooks/useBackgroundJobPolling.ts`)
- Polling automático a cada 2 segundos
- Detecta conclusão/falha de jobs
- Dispara toasts e notificações automaticamente
- Limpa automaticamente jobs inativos

### 4. **Zotero Import Dialog** (`src/components/articles/ZoteroImportDialog.tsx`)
- Dialog de confirmação ao fechar durante importação
- Opção "Minimizar" (continua em background)
- Opção "Cancelar Importação" (interrompe processo)
- Sincronização com background jobs store

## 🚀 Fluxo de Uso

### 1. Usuário inicia importação Zotero
```typescript
const job = createZoteroImportJob(projectId, collectionKey, options);
addJob(job);
```

### 2. Durante importação
- Dialog mostra progresso em tempo real
- Usuário pode clicar em "Minimizar"
- Dialog fecha mas importação continua
- Toast confirma: "Importação continuando em background"

### 3. Background execution
- `useBackgroundJobPolling` monitora jobs ativos
- Atualiza store com progresso a cada 2s
- Badge no sino mostra jobs ativos

### 4. Ao completar
- Toast de sucesso: "Importação concluída! X importados, Y atualizados"
- Notificação aparece no NotificationCenter
- Badge atualiza com contador
- Botão "Ver Projeto" para navegar

## 📊 Types

### `BackgroundJob`
```typescript
interface BackgroundJob {
  id: string;
  type: JobType; // 'zotero-import'
  status: JobStatus; // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: JobProgress;
  stats?: JobStats;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata: Record<string, any>;
}
```

### `ZoteroImportJob`
```typescript
interface ZoteroImportJob extends BackgroundJob {
  type: 'zotero-import';
  metadata: {
    projectId: string;
    projectName?: string;
    collectionKey: string;
    collectionName?: string;
    options: ImportOptions;
  };
}
```

## 🎨 UI Components

### NotificationCenter
- **Local**: Topbar (entre FeedbackButton e ProfileMenu)
- **Ícone**: Sino (`Bell`) minimalista
- **Badge**: Vermelho com contador (máx 9+)
- **Dropdown**: Largura 400px, altura máx 500px
- **Items**: Cards clicáveis com:
  - Ícone de status (loading/success/error)
  - Título do job
  - Descrição contextual
  - Progress bar (se running)
  - Stats (se completed)
  - Timestamp relativo
  - Botão de remover (X)

### AlertDialog de Confirmação
Ao fechar dialog durante importação:
- **Título**: "Importação em andamento"
- **Descrição**: Explica opções disponíveis
- **Botões**:
  - "Cancelar Importação" (vermelho, com ícone XCircle)
  - "Continuar em Background" (primário, com ícone Minimize2)

## 🔧 Configuração

### Polling Interval
```typescript
// Padrão: 2000ms (2 segundos)
useBackgroundJobPolling({
  interval: 2000,
  onJobComplete: (job) => { /* ... */ },
  onJobFailed: (job) => { /* ... */ }
});
```

### LocalStorage Key
```typescript
// Chave: 'review-hub-background-jobs'
// Versão: 1
```

### Limpeza Automática
- Jobs > 1 semana: Removidos ao hidratar
- Jobs completos: Máximo de 10 mantidos
- Jobs ativos: Sempre mantidos

## 📝 Como Adicionar Novo Tipo de Job

### 1. Adicionar tipo em `background-jobs.ts`
```typescript
export type JobType = 'zotero-import' | 'my-new-job';

interface MyNewJob extends BackgroundJob {
  type: 'my-new-job';
  metadata: {
    // seus campos específicos
  };
}
```

### 2. Criar helper function
```typescript
export function createMyNewJob(...): MyNewJob {
  return {
    id: `my-new-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'my-new-job',
    status: 'pending',
    createdAt: Date.now(),
    metadata: { /* ... */ },
  };
}
```

### 3. Adicionar casos no `NotificationCenter.tsx`
```typescript
// getJobTitle()
if (job.type === 'my-new-job') {
  return 'Meu Novo Job';
}

// getJobDescription()
if (job.type === 'my-new-job') {
  const metadata = (job as MyNewJob).metadata;
  return `Processando ${metadata.something}...`;
}

// getCompletionMessage()
if (job.type === 'my-new-job') {
  return 'Job concluído com sucesso!';
}
```

### 4. Integrar no componente que inicia o job
```typescript
const { addJob, updateJob } = useBackgroundJobs();

const job = createMyNewJob(...);
addJob(job);

// Executar operação
const result = await myLongRunningOperation({
  onProgress: (progress) => {
    updateJob(job.id, {
      status: 'running',
      progress,
      startedAt: job.startedAt || Date.now(),
    });
  }
});

// Atualizar resultado final
updateJob(job.id, {
  status: result.success ? 'completed' : 'failed',
  completedAt: Date.now(),
  stats: result.stats,
  error: result.error,
});
```

## 🎯 Benefícios

1. **UX Profissional**: Usuário não fica preso em dialogs
2. **Feedback Visual**: Notificações claras de progresso e conclusão
3. **Persistência**: Jobs sobrevivem a reloads da página
4. **Escalável**: Fácil adicionar novos tipos de jobs
5. **Minimalista**: Design limpo e não invasivo
6. **Polling Eficiente**: Apenas jobs ativos são monitorados

## 🔍 Debug

### Verificar jobs no LocalStorage
```javascript
// Console do navegador
JSON.parse(localStorage.getItem('review-hub-background-jobs'))
```

### Log de polling
```typescript
// useBackgroundJobPolling.ts linha ~19
console.log('Active jobs:', activeJobs);
```

### Forçar limpeza
```typescript
const { clearCompletedJobs } = useBackgroundJobs();
clearCompletedJobs();
```

## 📚 Referências

- Store: Zustand v4 com persist middleware
- UI: shadcn/ui (Dialog, AlertDialog, DropdownMenu, Badge, Progress)
- Icons: Lucide React
- Toasts: Sonner

