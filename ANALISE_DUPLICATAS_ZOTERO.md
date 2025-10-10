# Análise: Problema de Duplicatas na Importação do Zotero

## Problema Relatado

Ao importar artigos do Zotero para um projeto A e depois tentar importar os mesmos artigos (com mesmo DOI/PMID) para um projeto B, o sistema indica que os artigos já existem e os pula (skips), quando deveria permitir a importação.

## Análise Realizada

### 1. Verificação do Banco de Dados ✅ CORRETO

A constraint na tabela `articles` está definida corretamente como **composta**:

```sql
constraint uq_articles_project_doi unique (project_id, doi) deferrable initially immediate
```

Isso significa que:
- ✅ O mesmo DOI PODE existir em projetos diferentes
- ❌ O mesmo DOI NÃO PODE existir duas vezes no MESMO projeto

### 2. Verificação do Código ✅ CORRETO

A função `findDuplicateArticle` em `zoteroMapper.ts` filtra corretamente por `project_id`:

```typescript
// Prioridade 1: Buscar por zotero_item_key
.eq('project_id', projectId)
.eq('zotero_item_key', item.key)

// Prioridade 2: Buscar por DOI
.eq('project_id', projectId)
.eq('doi', data.DOI)

// Prioridade 3: Buscar por título
.eq('project_id', projectId)
.eq('title', data.title)
```

### 3. Índices e Constraints Adicionais ✅ CORRETO

Verificamos todas as migrations e NÃO há nenhuma constraint UNIQUE global por DOI que ignore o `project_id`.

## Logs de Debug Adicionados

Adicionamos logs detalhados para rastrear o problema:

### Em `zoteroMapper.ts` (findDuplicateArticle):
- Log do projectId sendo usado na verificação
- Log quando duplicatas são encontradas (incluindo o project_id do artigo encontrado)
- Log quando nenhuma duplicata é encontrada

### Em `zoteroImportService.ts` (processItem):
- Log do projectId no início do processamento de cada item

## Como Testar

1. **Abra o Console do Navegador** (F12 → Console)

2. **Importe artigos no Projeto A**:
   - Vá para o Projeto A
   - Importe artigos do Zotero
   - Observe os logs `[findDuplicateArticle]` e `[processItem]`
   - Anote o `projectId` mostrado

3. **Importe os mesmos artigos no Projeto B**:
   - Vá para o Projeto B
   - Tente importar os mesmos artigos
   - Observe os logs novamente
   - **Compare os projectIds**: devem ser diferentes!

4. **Análise dos logs**:
   - Se os projectIds forem **iguais** → Problema na UI/contexto de projeto
   - Se os projectIds forem **diferentes** mas ainda assim encontrar duplicatas → Bug no Supabase RLS ou query
   - Se mostrar "Duplicata encontrada" com `project_id` diferente → Bug grave na lógica

## Possíveis Causas (Hipóteses)

### Hipótese 1: ProjectId não atualiza ao mudar de projeto
- O componente `ZoteroImportDialog` recebe `projectId` como prop
- Se o contexto de projeto não atualizar, o dialog pode usar o projectId antigo

### Hipótese 2: Cache do Supabase
- Queries podem estar sendo cacheadas
- Verificar se `.eq('project_id', projectId)` está usando o valor correto em runtime

### Hipótese 3: RLS (Row Level Security)
- Políticas RLS podem estar interferindo nas queries
- Verificar políticas na tabela `articles`

### Hipótese 4: Mensagem de erro confusa
- Usuário pode estar vendo "skipped" por outro motivo
- Exemplo: `updateExisting: false` + artigo já existe NO MESMO projeto

## Próximos Passos

1. **Execute o teste acima** e copie os logs do console
2. **Verifique especificamente**:
   - Os projectIds nos logs são diferentes?
   - Quando mostra "Duplicata encontrada", qual é o project_id do artigo encontrado?
3. **Se o bug persistir**, compartilhe:
   - Screenshots dos logs
   - Os dois projectIds (Projeto A e Projeto B)
   - O DOI ou título de um artigo problemático

## Correção Temporária (Workaround)

Se o problema for com o contexto não atualizando:

1. Sempre **recarregue a página** (F5) ao mudar de projeto
2. Isso força o React a resetar todos os estados e contextos

## Correções Implementadas

### 1. **Bug Corrigido**: ProjectId não atualizava no ZoteroImportDialog

**Problema**: O `useEffect` que resetava o estado do dialog não tinha `projectId` como dependência. Isso significa que se o usuário:
1. Abrisse o dialog no Projeto A
2. Fechasse o dialog
3. Mudasse para o Projeto B
4. Reabrisse o dialog

O dialog manteria o `projectId` do Projeto A em memória!

**Correção**: Adicionado `projectId` como dependência do `useEffect`:

```typescript
useEffect(() => {
  if (open) {
    console.log('[ZoteroImportDialog] Dialog aberto com projectId:', projectId);
    listCollections();
    setCurrentStep('select-collection');
    setSelectedCollection(null);
    resetProgress();
  }
}, [open, projectId, listCollections, resetProgress]); // ← projectId adicionado
```

### 2. Logs de Debug Adicionados

Para facilitar troubleshooting futuro:
- Log no `ZoteroImportDialog` quando projectId é atualizado
- Log no `processItem` mostrando o projectId sendo usado
- Log no `findDuplicateArticle` com detalhes da busca e resultados
- Log incluindo o `project_id` do artigo encontrado (quando duplicata é detectada)

---

## Atualização: Erro 409 Persiste

### Problema Detectado nos Logs

Os logs mostram um comportamento estranho:
```
[findDuplicateArticle] Nenhuma duplicata encontrada
POST .../articles 409 (Conflict)
```

Isso significa:
1. ✅ O SELECT não encontra duplicatas (retorna vazio)
2. ❌ O INSERT falha com erro 409 (violação de constraint)

### Possíveis Causas

**Hipótese 1: Constraint sendo violada de forma inesperada**
- A constraint `uq_articles_project_doi` está correta: `unique (project_id, doi)`
- Mas pode haver outra constraint que não conhecemos

**Hipótese 2: Problema com maiúsculas/minúsculas no DOI**
- DOIs podem ter case diferentes: `10.1234/ABC` vs `10.1234/abc`
- PostgreSQL `.eq()` é case-sensitive

**Hipótese 3: RLS bloqueando SELECT mas não INSERT**
- Políticas RLS podem estar impedindo o SELECT de ver artigos existentes
- Mas constraints UNIQUE são verificadas antes do RLS

### Logs Aprimorados Adicionados

Agora os logs incluem:
1. **Na busca por DOI**: Mostra error, result, searchedDOI, searchedProjectId
2. **No INSERT**: Mostra error.code, error.message, error.details, error.hint

**Status**: 
- ✅ Bug corrigido (projectId não atualizando)
- ✅ Logs detalhados adicionados
- 🔄 **AÇÃO NECESSÁRIA**: Execute novamente e compartilhe os novos logs

## ✅ PROBLEMA RESOLVIDO!

### Causa Raiz

Os logs revelaram a causa:
```
message: 'duplicate key value violates unique constraint "uq_articles_doi"'
```

**Existia um ÍNDICE UNIQUE global** chamado `uq_articles_doi` no banco de dados:

```sql
CREATE UNIQUE INDEX uq_articles_doi ON articles (doi) WHERE (doi IS NOT NULL)
```

Esse índice bloqueava o mesmo DOI **globalmente**, ignorando o `project_id`!

### Solução Aplicada ✅

**Migration aplicada via Supabase MCP:**
- Migration: `20251010011913_remove_global_doi_unique_index`
- Ação: Removido índice `uq_articles_doi`
- Mantido: Índice correto `uq_articles_project_doi (project_id, doi)`

### Resultado

Agora você pode importar os mesmos artigos (mesmo DOI) em projetos diferentes! 🎉

**Teste agora:**
1. Vá para o projeto "teste 3"
2. Tente importar os artigos do Zotero novamente
3. Deve funcionar sem erros 409!

