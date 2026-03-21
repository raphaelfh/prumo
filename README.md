# Review Hub

![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)
![React](https://img.shields.io/badge/React-18.3-blue.svg)

Sistema completo para gerenciamento de revisões sistemáticas e meta-análises.

## ✨ Funcionalidades Principais

- **Gerenciamento de Artigos**: Importe, organize e gerencie artigos de pesquisa
- **Integração com Zotero**: Importe artigos diretamente das suas collections do Zotero
- **Avaliação com IA**: Avaliação automatizada de qualidade usando GPT-4o e Claude
- **Batch Processing**: Processe múltiplos artigos e itens de avaliação em paralelo
- **Extração de Dados**: Crie formulários customizados para extração de dados
- **Avaliação de Qualidade**: Avalie o risco de viés usando instrumentos padronizados (CHARMS, RoB 2, etc.)
- **Colaboração**: Trabalhe em equipe com controle de acesso e permissões
- **Visualização de PDFs**: Leitor de PDF integrado com anotações e busca semântica


## 🚀 Início Rápido

### Pré-requisitos

- Node.js 18+ e npm (recomendado usar [nvm](https://github.com/nvm-sh/nvm#installing-and-updating))
- Python 3.11+ e [uv](https://github.com/astral-sh/uv) (para o backend)
- Supabase CLI (para desenvolvimento local)
- Docker Desktop (para Supabase local)
- Git
- Make (geralmente já instalado no macOS/Linux)

### 🎯 Início Rápido com Makefile (Recomendado)

O projeto inclui um Makefile completo para facilitar o desenvolvimento:

```sh
# 1. Clone o repositório
git clone https://github.com/raphaelfh/review-hub-fastapi.git
cd review-hub

# 2. Execute o setup completo (primeira vez)
make setup
# ou: ./scripts/setup.sh

# 3. Configure as variáveis de ambiente (se necessário)
# Edite .env e backend/.env com suas credenciais

# 4. Inicie todos os serviços (Supabase + Backend + Frontend)
make start

# 5. Verifique o status
make status

# 6. Veja todas as URLs importantes
make urls
```

**Nota**: O script de setup não depende de configurações pessoais (`.zshrc`, etc). Ele configura tudo automaticamente.

**Comandos Makefile úteis:**
- `make start` - Inicia todos os serviços
- `make stop` - Para todos os serviços
- `make restart` - Reinicia todos os serviços
- `make status` - Verifica status de todos os serviços
- `make health` - Health check de todos os serviços
- `make urls` - Mostra todas as URLs importantes
- `make help` - Lista todos os comandos disponíveis

### Instalação Manual

Se preferir iniciar os serviços manualmente:

```sh
# 1. Clone o repositório
git clone https://github.com/raphaelfh/review-hub-fastapi.git
cd review-ai-hub

# 2. Instale as dependências do frontend
npm install

# 3. Instale as dependências do backend
cd backend && uv sync && cd ..

# 4. Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais do Supabase

# 5. Inicie o Supabase localmente
cd supabase && supabase start && cd ..

# 6. Inicie o backend (em um terminal)
cd backend && uv run uvicorn app.main:app --reload --port 8000

# 7. Inicie o frontend (em outro terminal)
npm run dev
```

O aplicativo estará disponível em:
- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:8000`
- Backend Docs: `http://localhost:8000/api/v1/docs`
- Supabase Studio: `http://127.0.0.1:54323`

## 🛠️ Scripts Disponíveis

- `npm run dev` - Inicia servidor de desenvolvimento com hot-reload
- `npm run build` - Build de produção
- `npm run build:dev` - Build em modo desenvolvimento
- `npm run preview` - Preview do build de produção
- `npm run lint` - Executa o linter
- `npm test` - Executa testes em modo watch
- `npm run test:run` - Executa testes uma vez
- `npm run test:coverage` - Executa testes com cobertura

## 📚 Documentação

### Guias de Desenvolvimento
- **[Índice de Guias](docs/guias/README.md)** - Todos os guias práticos
- [Fluxo de Alteração de Database](docs/guias/FLUXO_ALTERACAO_DATABASE.md)
- [Fluxo para Adicionar Endpoint](docs/guias/FLUXO_ADICIONAR_ENDPOINT.md)
- [Fluxo para Adicionar Feature](docs/guias/FLUXO_ADICIONAR_FEATURE.md)
- [Arquitetura do Backend](docs/guias/ARQUITETURA_BACKEND.md)

### Documentação do Banco de Dados
- [Database Schema Completo](docs/estrutura_database/DATABASE_SCHEMA.md)
- [Guia Rápido do Schema](docs/estrutura_database/GUIA_RAPIDO.md)

### Documentação Técnica
- [Integração com Zotero](docs/tecnicas/ZOTERO_ARCHITECTURE.md)

### Documentação Legal

- [Guia de Contribuição](CONTRIBUTING.md)
- [Código de Conduta](CODE_OF_CONDUCT.md)
- [Política de Segurança](SECURITY.md)

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor, leia nosso [Guia de Contribuição](CONTRIBUTING.md) para detalhes sobre nosso
código de conduta e o processo para submeter pull requests.

### Primeiros Passos

1. Fork o repositório
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'feat: adiciona AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

Para mais detalhes, consulte [CONTRIBUTING.md](CONTRIBUTING.md).

## 🏗️ Tecnologias Utilizadas

Este projeto é construído com:

- **Frontend:**
  - [Vite](https://vitejs.dev/) - Build tool e dev server
  - [React](https://react.dev/) - Biblioteca UI
  - [TypeScript](https://www.typescriptlang.org/) - Tipagem estática
  - [Tailwind CSS](https://tailwindcss.com/) - Estilização
  - [shadcn/ui](https://ui.shadcn.com/) - Componentes UI
  - [TanStack Query](https://tanstack.com/query) - Gerenciamento de estado servidor
  - [React Router](https://reactrouter.com/) - Roteamento

- **Backend:**
  - [FastAPI](https://fastapi.tiangolo.com/) - Framework Python moderno e rápido
  - [Supabase](https://supabase.com/) - Backend as a Service
    - PostgreSQL - Banco de dados
    - Row Level Security (RLS) - Segurança de dados
    - Realtime - Subscriptions em tempo real
  - [OpenAI API](https://openai.com/) - GPT-4o para avaliações de IA
  - [Anthropic API](https://anthropic.com/) - Claude para avaliações de IA

- **Ferramentas:**
  - [Vitest](https://vitest.dev/) - Framework de testes
  - [Testing Library](https://testing-library.com/) - Testes de componentes
  - [ESLint](https://eslint.org/) - Linter
  - [Zod](https://zod.dev/) - Validação de schemas

## 📦 Estrutura do Projeto

```
review-ai-hub/
├── frontend/               # Código fonte do frontend
│   ├── components/         # Componentes React
│   ├── hooks/              # Custom hooks
│   ├── services/           # Serviços e APIs
│   ├── pages/              # Páginas/rotas
│   ├── contexts/           # React contexts (Auth, etc.)
│   ├── config/             # Configurações da aplicação
│   ├── lib/                # Utilitários e helpers
│   └── integrations/       # Integrações com APIs externas
├── backend/                # Backend FastAPI
│   ├── app/                # Código da aplicação
│   │   ├── api/            # Endpoints REST
│   │   ├── core/           # Configuração e segurança
│   │   ├── services/       # Lógica de negócio
│   │   └── models/         # Modelos de dados
│   └── tests/              # Testes do backend
├── supabase/
│   └── migrations/         # Migrações do banco de dados
├── docs/                   # Documentação
│   ├── deployment/         # Guias de deploy
│   ├── legal/              # Documentos legais
│   ├── tecnicas/           # Documentação técnica
│   ├── guias/              # Guias de desenvolvimento
│   ├── estrutura_database/ # Schema do banco de dados
│   └── templates/          # Templates de instrumentos
└── scripts/                # Scripts de automação
```

## 🚢 Deploy

### Build de Produção

```sh
npm run build
```

Os arquivos serão gerados em `dist/` e podem ser servidos por qualquer servidor estático.

### Opções de Deploy

- **Vercel**: Conecte seu repositório GitHub e configure as variáveis de ambiente
- **Netlify**: Similar ao Vercel, com suporte a Edge Functions
- **Supabase**: Use o Supabase Hosting para backend 
- **Docker**: Containerize a aplicação para deploy em qualquer plataforma

### Variáveis de Ambiente Necessárias

Consulte a [Documentação de Variáveis de Ambiente](docs/deployment/ENV_VARS.md) para lista completa.

**Frontend (`.env`):**
```env
VITE_SUPABASE_ENV=local|production
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
VITE_FASTAPI_BASE_URL=http://localhost:8000
```

**Backend (`backend/.env`):**
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## 📝 Licença

Este projeto está licenciado sob a **GNU Affero General Public License v3.0 (AGPL-3.0-only)**. Veja os
arquivos [LICENSE](LICENSE) e [LICENSE.txt](LICENSE.txt) na raiz do repositório para o texto completo da licença.

## 🙏 Agradecimentos

Agradecemos a todos os contribuidores que ajudam a tornar este projeto melhor!
