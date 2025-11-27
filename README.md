# Review Hub

![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![CLA](https://img.shields.io/badge/CLA-Required-orange.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)
![React](https://img.shields.io/badge/React-18.3-blue.svg)

Sistema completo para gerenciamento de revisões sistemáticas e meta-análises.

## Funcionalidades Principais

- **Gerenciamento de Artigos**: Importe, organize e gerencie artigos de pesquisa
- **Integração com Zotero**: Importe artigos diretamente das suas collections do Zotero
- **Extração de Dados**: Crie formulários customizados para extração de dados
- **Avaliação de Qualidade**: Avalie o risco de viés usando instrumentos padronizados
- **Colaboração**: Trabalhe em equipe com controle de acesso e permissões
- **Visualização de PDFs**: Leitor de PDF integrado com anotações

## ⚖️ Licenciamento

Este projeto é Open Source sob a licença **GNU Affero General Public License v3.0 (AGPL-3.0)**.

### O que isso significa?

✅ **Você pode usar, estudar e modificar este software gratuitamente.**

✅ **Se você usar este software em uma aplicação que roda em rede (SaaS, Web)**, você deve disponibilizar o código-fonte da sua aplicação completa sob a mesma licença (AGPL-3.0).

### Licença Comercial (Enterprise)

Se você deseja usar este software em produtos proprietários, aplicações comerciais fechadas, ou sem a obrigação de abrir seu próprio código-fonte, você deve adquirir uma **Licença Comercial**.

**Benefícios da Licença Comercial:**
- 🛡️ **Isenção das obrigações de Copyleft** (não precisa abrir seu código)
- 🤝 **Suporte prioritário e garantias legais**
- 📧 **Entre em contato conosco para adquirir uma licença comercial**

Para mais informações sobre licenciamento comercial, entre em contato através do repositório, via issues ou por email.

**Contato para Licenças Comerciais**: [Adicione seu email aqui]

## 🚀 Início Rápido

### Pré-requisitos

- Node.js 18+ e npm (recomendado usar [nvm](https://github.com/nvm-sh/nvm#installing-and-updating))
- Supabase CLI (para desenvolvimento local)
- Git

### Instalação

```sh
# 1. Clone o repositório
git clone <YOUR_GIT_URL>
cd review_hub

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com suas credenciais do Supabase

# 4. Inicie o servidor de desenvolvimento
npm run dev
```

O aplicativo estará disponível em `http://localhost:5173`

### Desenvolvimento Local com Supabase

```sh
# Inicie o Supabase localmente
supabase start

# Execute as migrações
supabase db reset

# As Edge Functions estarão disponíveis localmente
```

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

- [Guia de Contribuição](.github/CONTRIBUTING.md)
- [Código de Conduta](docs/legal/CODE_OF_CONDUCT.md)
- [Política de Segurança](docs/legal/SECURITY.md)
- [Integração com Zotero](./docs/tecnicas/ZOTERO_ARCHITECTURE.md)
- [Análise Crítica da Codebase](./docs/analises/ANALISE_CRITICA_CODEBASE.md)

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor, leia nosso [Guia de Contribuição](.github/CONTRIBUTING.md) para detalhes sobre nosso código de conduta e o processo para submeter pull requests.

**Importante**: Antes de contribuir, você precisará assinar nosso [Contributor License Agreement (CLA)](docs/legal/CLA.md).

### Primeiros Passos

1. Fork o repositório
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'feat: adiciona AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

Para mais detalhes, consulte [CONTRIBUTING.md](.github/CONTRIBUTING.md).

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
  - [Supabase](https://supabase.com/) - Backend as a Service
    - PostgreSQL - Banco de dados
    - Edge Functions (Deno) - Funções serverless
    - Row Level Security (RLS) - Segurança de dados
    - Realtime - Subscriptions em tempo real

- **Ferramentas:**
  - [Vitest](https://vitest.dev/) - Framework de testes
  - [Testing Library](https://testing-library.com/) - Testes de componentes
  - [ESLint](https://eslint.org/) - Linter
  - [Zod](https://zod.dev/) - Validação de schemas

## 📦 Estrutura do Projeto

```
review_hub/
├── src/                    # Código fonte do frontend
│   ├── components/         # Componentes React
│   ├── hooks/              # Custom hooks
│   ├── services/           # Serviços e APIs
│   ├── pages/              # Páginas/rotas
│   ├── types/              # Definições TypeScript
│   └── lib/                # Utilitários
├── supabase/
│   ├── functions/          # Edge Functions (Deno)
│   └── migrations/         # Migrações do banco de dados
├── docs/                   # Documentação
│   ├── legal/              # Documentos legais
│   ├── tecnicas/           # Documentação técnica
│   ├── guias/              # Guias de setup
│   ├── planos/             # Planos de refatoração
│   ├── analises/           # Análises da codebase
│   └── templates/          # Templates CHARMS
└── .cursor/rules/          # Regras do Cursor AI Agent
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

Certifique-se de configurar as seguintes variáveis de ambiente:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 📝 Licença

Este projeto está licenciado sob a **GNU Affero General Public License v3.0 (AGPL-3.0)**. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🙏 Agradecimentos

Agradecemos a todos os contribuidores que ajudam a tornar este projeto melhor!
