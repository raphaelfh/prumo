# Criar Novo Projeto Supabase Local (Sem Vincular ao Repo)

Este guia explica como criar um novo projeto Supabase local completamente independente do repositório atual.

## Pré-requisitos

1. **Docker Desktop** rodando
2. **Supabase CLI** instalado (`supabase --version`)
3. Um diretório separado para o novo projeto

## Passo a Passo

### 1. Criar Diretório para o Novo Projeto

Crie um diretório fora do repositório atual:

```bash
# Exemplo: criar em um diretório de projetos
mkdir ~/meus-projetos/novo-projeto-supabase
cd ~/meus-projetos/novo-projeto-supabase
```

**Importante**: Não crie dentro do diretório `review_hub` para manter totalmente separado.

### 2. Inicializar Novo Projeto Supabase

```bash
# Inicializar projeto Supabase vazio
supabase init
```

Este comando irá:
- Criar a estrutura de diretórios do Supabase
- Criar `supabase/config.toml` com configurações padrão
- Criar diretório `supabase/migrations/` vazio
- **NÃO** vincular a nenhum projeto remoto

### 3. Verificar Configuração

O arquivo `supabase/config.toml` criado não terá `project_id` vinculado:

```toml
# Configuração padrão sem project_id
[project]
# project_id = ""  # Vazio por padrão

[api]
enabled = true
port = 54321
```

### 4. Iniciar Supabase Local

```bash
# Iniciar todos os serviços localmente
supabase start
```

Este comando irá:
- Baixar imagens Docker necessárias (na primeira vez)
- Criar containers Docker isolados para este projeto
- Iniciar Postgres, Auth, Storage, etc.
- Gerar credenciais locais únicas

**Aguarde até ver a mensagem de sucesso com as credenciais.**

### 5. Obter Credenciais

Após `supabase start`, você verá:

```
API URL: http://127.0.0.1:54321
GraphQL URL: http://127.0.0.1:54321/graphql/v1
DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL: http://127.0.0.1:54323
anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkP...
```

Você também pode obter a qualquer momento:

```bash
supabase status
```

### 6. Acessar Supabase Studio

```bash
# Abrir Studio no navegador
supabase studio
```

Ou acesse manualmente: `http://127.0.0.1:54323`

## Comandos Úteis

### Gerenciar Projeto Local

```bash
# Ver status
supabase status

# Parar serviços
supabase stop

# Reiniciar serviços
supabase restart

# Ver logs
supabase logs
```

### Criar Primeira Migration

```bash
# Criar nova migration
supabase migration new criar_primeira_tabela

# Editar o arquivo criado em supabase/migrations/

# Aplicar migration localmente
supabase migration up --local

# Ver migrations aplicadas
supabase migration list --local
```

### Resetar Banco de Dados

```bash
# Resetar completamente (apaga todos os dados)
supabase db reset --local
```

### Gerar Tipos TypeScript

```bash
# Gerar tipos do banco local
supabase gen types typescript --local > types.ts
```

## 🔄 Rodar Dois Projetos Simultaneamente (Portas Diferentes)

### Por que Precisar de Portas Diferentes?

O Supabase local usa as seguintes portas por padrão:
- **API**: `54321`
- **Postgres**: `54322`
- **Studio**: `54323`
- **Kong**: `54324`
- **Auth**: `54325`
- **Storage**: `54326`
- **Realtime**: `54327`
- **Edge Functions**: `54328`

Se você já tem um projeto rodando (ex: `review_hub`), o segundo projeto precisa usar portas diferentes para evitar conflitos.

### Passo a Passo: Configurar Novo Projeto com Portas Diferentes

#### 1. Verificar Projeto Atual (review_hub)

```bash
# No diretório do review_hub
cd /Users/raphaelhaddad/PycharmProjects/review_hub

# Ver status e portas em uso
supabase status
```

Anote as portas que estão em uso (geralmente 54321-54328).

#### 2. Criar Novo Diretório e Inicializar

```bash
# Criar diretório para o novo projeto
mkdir ~/meu-segundo-projeto
cd ~/meu-segundo-projeto

# Inicializar Supabase
supabase init
```

#### 3. Configurar Portas Diferentes no config.toml

Edite o arquivo `supabase/config.toml` do **novo projeto** e configure portas diferentes:

```toml
# Exemplo: Portas para o segundo projeto (incrementando +100)
[api]
enabled = true
port = 54421  # Era 54321, agora 54421

[db]
port = 54422  # Era 54322, agora 54422

[studio]
enabled = true
port = 54423  # Era 54323, agora 54423

[kong]
enabled = true
port = 54424  # Era 54324, agora 54424

[auth]
enabled = true
port = 54425  # Era 54325, agora 54425

[storage]
enabled = true
port = 54426  # Era 54326, agora 54426

[realtime]
enabled = true
port = 54427  # Era 54327, agora 54427

[functions]
enabled = true
port = 54428  # Era 54328, agora 54428
```

**Estratégia de Portas**: 
- **Projeto 1 (review_hub)**: 54321-54328 (padrão)
- **Projeto 2 (novo)**: 54421-54428 (+100)
- **Projeto 3**: 54521-54528 (+200), etc.

#### 4. Iniciar o Novo Projeto

```bash
# No diretório do novo projeto
supabase start
```

Agora você terá:
- **Projeto 1 (review_hub)**: API em `http://127.0.0.1:54321`
- **Projeto 2 (novo)**: API em `http://127.0.0.1:54421`

#### 5. Verificar Ambos os Projetos

```bash
# Ver containers Docker rodando
docker ps --filter "name=supabase" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Verificar status do projeto 1
cd /Users/raphaelhaddad/PycharmProjects/review_hub
supabase status

# Verificar status do projeto 2
cd ~/meu-segundo-projeto
supabase status
```

### Exemplo Completo: Dois Projetos Rodando

```bash
# Terminal 1: Projeto review_hub (portas padrão)
cd /Users/raphaelhaddad/PycharmProjects/review_hub
supabase status
# API URL: http://127.0.0.1:54321
# Studio URL: http://127.0.0.1:54323

# Terminal 2: Novo projeto (portas +100)
cd ~/meu-segundo-projeto
supabase status
# API URL: http://127.0.0.1:54421
# Studio URL: http://127.0.0.1:54423
```

### Gerenciar Projetos Específicos

#### Parar Projeto Específico

```bash
# Parar apenas o projeto atual (onde você está)
cd ~/meu-segundo-projeto
supabase stop

# O outro projeto continua rodando
```

#### Ver Todos os Projetos em Execução

```bash
# Listar todos os containers Supabase
docker ps --filter "name=supabase" --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"

# Ver volumes de cada projeto
docker volume ls --filter "label=com.supabase.cli.project"
```

### Verificar Projetos em Execução

```bash
# Ver containers Docker do Supabase
docker ps --filter "name=supabase"

# Ver volumes Docker (cada projeto tem volumes próprios)
docker volume ls --filter "label=com.supabase.cli.project"

# Ver portas em uso
lsof -i :54321  # Verifica se porta está em uso
lsof -i :54421  # Verifica porta do segundo projeto
```

## Desvincular Projeto (Se Necessário)

Se você criar um projeto em um diretório que já tinha um link, você pode desvincular:

```bash
# Remover project_id do config.toml
# Edite supabase/config.toml e remova/comente a linha project_id

# Remover arquivo de referência (se existir)
rm -f supabase/.temp/project-ref
```

## Estrutura de Diretórios Criada

Após `supabase init`, você terá:

```
novo-projeto-supabase/
├── supabase/
│   ├── config.toml          # Configurações do projeto
│   ├── migrations/          # Migrations do banco (vazio inicialmente)
│   └── seed.sql             # Script de seed (opcional)
```

## Diferenças Entre Projetos

### Projeto Vinculado (review_hub)
- Tem `project_id` no `config.toml`
- Pode sincronizar com projeto remoto
- Usa migrations do repositório

### Projeto Local Independente (novo-projeto)
- Sem `project_id` no `config.toml`
- 100% local, sem conexão remota
- Migrations próprias e isoladas

## Exemplo Completo

```bash
# 1. Criar diretório
mkdir ~/meus-projetos/meu-novo-projeto
cd ~/meus-projetos/meu-novo-projeto

# 2. Inicializar Supabase
supabase init

# 3. Iniciar serviços
supabase start

# 4. Criar primeira migration
supabase migration new criar_tabelas

# 5. Editar migration (exemplo simples)
# Arquivo: supabase/migrations/YYYYMMDDHHMMSS_criar_tabelas.sql
# CREATE TABLE usuarios (
#   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#   nome TEXT NOT NULL,
#   email TEXT UNIQUE NOT NULL,
#   created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
# );

# 6. Aplicar migration
supabase migration up --local

# 7. Verificar no Studio
supabase studio
```

## Troubleshooting

### Porta já em uso

Se a porta 54321 já estiver em uso por outro projeto:

```bash
# Parar todos os projetos Supabase
supabase stop

# Ou configurar portas diferentes no config.toml
```

### Docker não está rodando

```bash
# Verificar Docker
docker ps

# Se não estiver rodando, inicie o Docker Desktop
```

### Conflito de containers

Se houver conflito entre projetos:

```bash
# Ver containers
docker ps -a

# Parar containers específicos
docker stop <container-id>

# Ou parar todos os projetos Supabase
supabase stop
```

## Próximos Passos

1. **Criar migrations** para definir seu schema
2. **Configurar variáveis de ambiente** no seu projeto frontend/backend
3. **Desenvolver localmente** sem afetar outros projetos
4. **Fazer deploy depois** quando estiver pronto (opcional)

## Referências

- [Supabase CLI - Local Development](https://supabase.com/docs/guides/cli/local-development)
- [Supabase CLI - Managing Multiple Projects](https://supabase.com/docs/reference/cli/supabase-projects)

