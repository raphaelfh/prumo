# Atualização: Gestão de Membros do Projeto

## Resumo das Alterações

Foi implementada uma melhoria significativa na gestão de membros do projeto, permitindo:
1. ✅ **Selecionar o papel (role)** ao adicionar novos membros
2. ✅ **Editar o papel** de membros existentes
3. ✅ **4 papéis disponíveis** com permissões distintas

## Migração do Banco de Dados

### ENUM `project_member_role` Criado

```sql
CREATE TYPE project_member_role AS ENUM (
  'manager',    -- Gerente do projeto
  'reviewer',   -- Revisor
  'viewer',     -- Visualizador
  'consensus'   -- Revisor de consenso
);
```

### Conversão da Coluna `role`

- **Antes**: `VARCHAR` (texto livre)
- **Depois**: `project_member_role` (ENUM com valores específicos)
- **Default**: `'reviewer'`
- **Migração automática**: Valores `'lead'` foram convertidos para `'manager'`

### Policies Atualizadas

As policies de RLS foram recriadas para funcionar com o novo tipo ENUM, mantendo a mesma lógica de segurança.

## Papéis Disponíveis

### 🔵 Manager (Gerente)
- **Permissões**: Acesso completo
- **Pode**:
  - Gerenciar configurações do projeto
  - Adicionar/remover/editar membros
  - Modificar qualquer avaliação
  - Acessar todas as funcionalidades
- **Badge**: Azul (variant: `default`)

### 🟢 Reviewer (Revisor)
- **Permissões**: Participação ativa na revisão
- **Pode**:
  - Visualizar artigos
  - Adicionar artigos
  - Realizar avaliações
  - Ver avaliações de outros (dependendo das configurações)
- **Não pode**: Alterar configurações ou gerenciar membros
- **Badge**: Cinza (variant: `secondary`)

### ⚪ Viewer (Visualizador)
- **Permissões**: Apenas leitura
- **Pode**:
  - Visualizar artigos
  - Ver avaliações
  - Acessar relatórios
- **Não pode**: Adicionar artigos, avaliar ou editar
- **Badge**: Branco/outline (variant: `outline`)

### 🟢 Consensus (Consenso)
- **Permissões**: Resolução de conflitos
- **Pode**:
  - Tudo que o Reviewer pode
  - Resolver conflitos entre revisores
  - Dar palavra final em desacordos
- **Propósito**: Revisor de consenso em dupla-avaliação cega
- **Badge**: Cinza (variant: `secondary`)

## Interface Atualizada

### 1. Adicionar Novo Membro

**Antes:**
```
[Email Input] [Botão Adicionar]
```
- Papel fixo: sempre "reviewer"

**Depois:**
```
[Email Input] [Select Role] [Botão Adicionar]
```
- Selecione o papel desejado antes de adicionar
- Descrição dinâmica mostra as permissões do papel selecionado

**Exemplo de uso:**
1. Digite o email do usuário
2. Selecione o papel no dropdown
3. Veja a descrição das permissões
4. Clique em "Adicionar"

### 2. Editar Papel de Membro Existente

**Funcionalidade completamente nova!**

**Modo de Visualização:**
```
[Nome] [Email] [Badge Role] [Botão Editar ✏️] [Botão Remover 🗑️]
```

**Modo de Edição:**
```
[Nome] [Email] [Select Role] [Botão Salvar ✓] [Botão Cancelar ✗]
```

**Fluxo:**
1. Clique no botão "Editar" (ícone lápis) ao lado do badge
2. Select aparece com o papel atual selecionado
3. Escolha o novo papel
4. Clique em "Salvar" (✓ verde) ou "Cancelar" (✗)
5. Toast confirma a alteração

### 3. Card de Informações

Lista detalhada de todos os papéis com suas permissões:

```
📋 Papéis e Permissões

[Badge Gerente]    Gerencia configurações, membros e tem acesso completo
[Badge Revisor]    Avalia artigos e participa da revisão
[Badge Visualizador] Apenas visualização, sem permissão de edição
[Badge Consenso]   Resolve conflitos entre revisores
```

## Estrutura de Dados

### Interface TypeScript

```typescript
type MemberRole = 'manager' | 'reviewer' | 'viewer' | 'consensus';

interface ProjectMember {
  id: string;
  user_id: string;
  role: MemberRole;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

const MEMBER_ROLES: Record<MemberRole, { 
  label: string; 
  description: string; 
  variant: any 
}> = {
  manager: {
    label: 'Gerente',
    description: 'Gerencia configurações, membros e tem acesso completo',
    variant: 'default'
  },
  // ... outros roles
};
```

## Funções Principais

### `handleInviteMember`
- Adiciona novo membro com o papel selecionado
- Valida se o usuário existe
- Mostra toast com o papel adicionado

### `handleStartEditRole`
- Inicia o modo de edição para um membro
- Salva o estado atual do papel

### `handleSaveRole`
- Salva a alteração do papel no banco
- Atualiza a lista de membros
- Mostra confirmação

### `handleCancelEditRole`
- Cancela a edição sem salvar
- Retorna ao modo de visualização

### `handleRemoveMember`
- Remove membro do projeto
- Confirmação obrigatória

## Estados do Componente

```typescript
const [inviteEmail, setInviteEmail] = useState("");
const [selectedRole, setSelectedRole] = useState<MemberRole>('reviewer');
const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
const [editingRole, setEditingRole] = useState<MemberRole | null>(null);
```

- **inviteEmail**: Email do novo membro
- **selectedRole**: Papel selecionado ao adicionar
- **editingMemberId**: ID do membro sendo editado (null = nenhum)
- **editingRole**: Papel temporário durante edição

## Validações e Segurança

### Frontend
- ✅ Validação de email obrigatório
- ✅ Confirmação antes de remover membro
- ✅ Feedback visual durante carregamento
- ✅ Tratamento de erros (usuário não existe, já é membro, etc)

### Backend (RLS Policies)
- ✅ Apenas membros do projeto podem ver outros membros
- ✅ Apenas managers podem alterar membros
- ✅ Proteção contra alterações não autorizadas

## UX/UI Melhorias

### Feedback Visual
- 🟢 **Sucesso**: Toast verde ao adicionar/editar
- 🔴 **Erro**: Toast vermelho com mensagem clara
- ⏳ **Loading**: Estados de carregamento visíveis
- ✏️ **Edição**: Modo inline sem modal

### Acessibilidade
- ✅ `aria-label` em todos os botões de ícone
- ✅ Labels visíveis e descritivos
- ✅ Cores com contraste adequado
- ✅ Foco visível na navegação por teclado

### Responsividade
- 📱 Layout adaptável para mobile
- 💻 Otimizado para desktop
- 📊 Espaçamento adequado em todas as telas

## Casos de Uso

### Caso 1: Adicionar Revisor Novo
1. Admin vai para Configurações → Equipe
2. Digite email: `joao@exemplo.com`
3. Seleciona papel: "Revisor"
4. Clica em "Adicionar"
5. João pode agora avaliar artigos

### Caso 2: Promover Revisor a Gerente
1. Admin vê lista de membros
2. Encontra "Maria" com papel "Revisor"
3. Clica no ícone de editar (✏️)
4. Seleciona "Gerente" no dropdown
5. Clica em salvar (✓)
6. Maria agora pode gerenciar o projeto

### Caso 3: Adicionar Visualizador Externo
1. Pesquisador quer dar acesso a orientador
2. Adiciona email com papel "Visualizador"
3. Orientador pode ver o progresso
4. Orientador NÃO pode modificar nada

### Caso 4: Designar Revisor de Consenso
1. Projeto com dupla-avaliação cega
2. Adiciona terceiro revisor como "Consenso"
3. Quando há conflito, revisor de consenso resolve
4. Papel específico para metodologia Cochrane

## Retrocompatibilidade

### Dados Antigos
- ✅ Valores `'lead'` automaticamente convertidos para `'manager'`
- ✅ Valores `'reviewer'` mantidos inalterados
- ✅ Valores inválidos convertidos para `'reviewer'` (padrão)

### Interface
- ✅ Componente totalmente reescrito mas mantém funcionalidades básicas
- ✅ Nenhuma funcionalidade anterior foi removida
- ✅ Apenas adicionadas novas capacidades

## Testes Realizados

- ✅ Compilação TypeScript (0 erros)
- ✅ Build Vite (sucesso)
- ✅ Linting (0 erros)
- ✅ Migração Supabase (aplicada com sucesso)
- ✅ Policies RLS recriadas corretamente

## Como Testar

```bash
# Iniciar desenvolvimento
npm run dev

# Navegar para:
1. Projeto → Configurações → Equipe
2. Testar adicionar membro com diferentes papéis
3. Testar editar papel de membro existente
4. Verificar badges e descrições
```

### Checklist de Testes Manuais

- [ ] Adicionar membro como "Gerente"
- [ ] Adicionar membro como "Revisor"
- [ ] Adicionar membro como "Visualizador"
- [ ] Adicionar membro como "Consenso"
- [ ] Editar papel de "Revisor" para "Gerente"
- [ ] Editar papel de "Gerente" para "Revisor"
- [ ] Cancelar edição de papel
- [ ] Remover membro
- [ ] Verificar validação de email inválido
- [ ] Verificar erro ao adicionar usuário não cadastrado
- [ ] Verificar erro ao adicionar usuário já membro

## Próximos Passos Sugeridos

### 1. Permissões Granulares
Implementar verificações de permissão por papel em outras partes do sistema:
- Botões de "Adicionar Artigo" só para reviewer+
- Configurações só para manager
- Avaliações só para reviewer e consensus

### 2. Auditoria
- Log de alterações de papel
- Histórico de quem alterou o papel de quem

### 3. Convites Pendentes
- Enviar email de convite
- Sistema de aceitação de convite
- Tokens de convite temporários

### 4. Permissões Customizadas
- Criar papéis personalizados
- Checkboxes de permissões específicas
- Templates de papéis

### 5. Bulk Operations
- Adicionar múltiplos membros de uma vez
- Alterar papel de múltiplos membros
- Importar membros de CSV

## Conclusão

A gestão de membros agora é:
- ✅ **Mais flexível**: 4 papéis distintos
- ✅ **Mais intuitiva**: Seleção visual de papéis
- ✅ **Mais editável**: Altere papéis facilmente
- ✅ **Mais segura**: ENUM no banco + RLS policies
- ✅ **Mais clara**: Descrições detalhadas de cada papel

O sistema está pronto para suportar diferentes fluxos de trabalho de revisão sistemática, desde projetos pequenos com poucos revisores até grandes revisões com múltiplas camadas de validação e consenso.

