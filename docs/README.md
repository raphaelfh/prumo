# 📚 Documentação do Review Hub

Bem-vindo à documentação completa do Review Hub! Esta pasta contém toda a documentação técnica, guias de desenvolvimento e informações sobre o projeto.

## 🗂️ Estrutura da Documentação

```
docs/
├── guias/                  # Guias práticos de desenvolvimento
├── estrutura_database/     # Documentação do banco de dados
├── deployment/             # Guias de deploy e configuração
├── tecnicas/               # Documentação técnica detalhada
├── templates/              # Templates e exemplos
├── planos/                 # Planos de refatoração e melhorias
└── legal/                  # Documentos legais
```

---

## 🎯 Início Rápido

### Para Novos Desenvolvedores

1. **Primeiro:** Leia [Guias de Desenvolvimento](./guias/README.md)
2. **Depois:** Configure seu ambiente com [Criar Novo Projeto Supabase Local](./guias/CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md)
3. **Então:** Entenda a [Arquitetura do Backend](./guias/ARQUITETURA_BACKEND.md)

### Para Desenvolvedores Experientes

Use os [Guias de Fluxo](./guias/README.md) como checklists para tarefas comuns.

---

## 📖 Documentação por Categoria

### 🛠️ Guias de Desenvolvimento

Guias práticos passo a passo para tarefas comuns de desenvolvimento.

| Guia | Descrição | Quando Usar |
|------|-----------|-------------|
| **[Índice de Guias](./guias/README.md)** | Visão geral de todos os guias | Ponto de partida |
| [Fluxo de Alteração de Database](./guias/FLUXO_ALTERACAO_DATABASE.md) | Como alterar o schema do banco | Adicionar campos, tabelas, ENUMs |
| [Fluxo para Adicionar Endpoint](./guias/FLUXO_ADICIONAR_ENDPOINT.md) | Como criar novos endpoints na API | Criar rotas REST |
| [Fluxo para Adicionar Feature](./guias/FLUXO_ADICIONAR_FEATURE.md) | Como implementar features completas | Features end-to-end |
| [Arquitetura do Backend](./guias/ARQUITETURA_BACKEND.md) | Estrutura e padrões do backend | Entender a arquitetura |
| [Criar Novo Projeto Supabase Local](./guias/CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md) | Setup do ambiente local | Primeira configuração |

---

### 🗄️ Banco de Dados

Documentação completa do schema do banco de dados.

| Documento | Descrição | Público |
|-----------|-----------|---------|
| **[README](./estrutura_database/README.md)** | Índice da documentação do banco | Todos |
| [Database Schema](./estrutura_database/DATABASE_SCHEMA.md) | Documentação completa e didática | Novos desenvolvedores |
| [Guia Rápido](./estrutura_database/GUIA_RAPIDO.md) | Referência rápida | Desenvolvedores experientes |
| [Estrutura do Projeto](./estrutura_database/ESTRUTURA_PROJETO_MACRO.md) | Como rodar o projeto localmente | Setup inicial |

**Conteúdo:**
- ✅ Todas as tabelas com estrutura detalhada
- ✅ Relacionamentos e foreign keys
- ✅ ENUMs e tipos customizados
- ✅ Índices e constraints
- ✅ Políticas RLS (Row Level Security)
- ✅ Triggers e functions
- ✅ Exemplos de queries

---

### 🚀 Deploy e Configuração

Guias para deploy e configuração de ambientes.

| Documento | Descrição |
|-----------|-----------|
| **[README](./deployment/README.md)** | Índice de deploy |
| [Guia de Deploy](./deployment/GUIA_DEPLOYMENT.md) | Como fazer deploy |
| [Deploy Completo](./deployment/DEPLOY.md) | Processo detalhado |
| [Variáveis de Ambiente](./deployment/ENV_VARS.md) | Configuração de env vars |

**Ambientes cobertos:**
- Vercel (Frontend)
- Render (Backend)
- Supabase (Database + Auth + Storage)

---

### 🔧 Documentação Técnica

Documentação técnica detalhada de componentes específicos.

| Documento | Descrição |
|-----------|-----------|
| [Arquitetura Zotero](./tecnicas/ZOTERO_ARCHITECTURE.md) | Integração com Zotero |
| [Implementação Zotero](./tecnicas/ZOTERO_IMPLEMENTATION_SUMMARY.md) | Detalhes de implementação |

---

### 📋 Templates

Templates e exemplos para uso no sistema.

| Documento | Descrição |
|-----------|-----------|
| [CHARMS 2.0 Template](./templates/CHARMS_2.0_COMPLETE_TEMPLATE.md) | Template completo CHARMS |
| [CHARMS Hierarquia](./templates/CHARMS_2.0_HIERARQUIA_VISUAL.md) | Estrutura hierárquica |

---

### 📝 Planos e Roadmap

Planos de refatoração, melhorias e próximos passos.

| Documento | Descrição | Status |
|-----------|-----------|--------|
| [Roadmap](planos/ROADMAP.md) | Roadmap do projeto | 🔄 Em andamento |

---

### ⚖️ Documentação Legal

Documentos legais e políticas do projeto.

| Documento | Descrição |
|-----------|-----------|
| [Código de Conduta](./legal/CODE_OF_CONDUCT.md) | Regras de convivência |
| [Política de Segurança](./legal/SECURITY.md) | Como reportar vulnerabilidades |
| [CLA](./legal/CLA.md) | Contributor License Agreement |

---

## 🔍 Busca Rápida

### Preciso fazer...

**Alteração no banco de dados:**
→ [Fluxo de Alteração de Database](./guias/FLUXO_ALTERACAO_DATABASE.md)

**Novo endpoint na API:**
→ [Fluxo para Adicionar Endpoint](./guias/FLUXO_ADICIONAR_ENDPOINT.md)

**Feature completa (backend + frontend):**
→ [Fluxo para Adicionar Feature](./guias/FLUXO_ADICIONAR_FEATURE.md)

**Entender como funciona:**
→ [Arquitetura do Backend](./guias/ARQUITETURA_BACKEND.md)

**Configurar ambiente local:**
→ [Criar Novo Projeto Supabase Local](./guias/CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md)

**Fazer deploy:**
→ [Guia de Deploy](./deployment/GUIA_DEPLOYMENT.md)

**Consultar schema do banco:**
→ [Database Schema](./estrutura_database/DATABASE_SCHEMA.md) ou [Guia Rápido](./estrutura_database/GUIA_RAPIDO.md)

---

## 📊 Mapa de Dependências

```
Novo Desenvolvedor
    ↓
[Guias de Desenvolvimento]
    ↓
[Arquitetura do Backend] ← [Database Schema]
    ↓
[Fluxos de Trabalho]
    ├─→ [Fluxo Database]
    ├─→ [Fluxo Endpoint]
    └─→ [Fluxo Feature]
    ↓
[Deploy]
```

---

## 🤝 Contribuindo para a Documentação

A documentação é um documento vivo! Se você:
- Encontrou algo desatualizado
- Tem sugestões de melhoria
- Quer adicionar novo conteúdo
- Encontrou um erro

**Por favor:**
1. Abra uma issue descrevendo o problema/sugestão
2. Ou faça um PR com a correção/melhoria
3. Siga o estilo e formato dos documentos existentes

### Padrões de Documentação

- Use Markdown
- Adicione emojis para melhor visualização
- Inclua exemplos práticos
- Mantenha linguagem clara e objetiva
- Adicione links para documentos relacionados
- Atualize a data de "Última atualização"

---

## 📞 Suporte

### Dúvidas sobre Documentação
- Abra uma issue com a tag `documentation`
- Use GitHub Discussions

### Dúvidas Técnicas
- Consulte os guias relevantes
- Verifique a seção de troubleshooting
- Abra uma issue se necessário

---

## 📈 Status da Documentação

| Categoria | Cobertura | Status |
|-----------|-----------|--------|
| Guias de Desenvolvimento | 90% | ✅ Completo |
| Database | 95% | ✅ Completo |
| Deploy | 80% | 🔄 Em andamento |
| Técnica | 70% | 🔄 Em andamento |
| Templates | 60% | 📋 Planejado |
| Legal | 100% | ✅ Completo |

---

## 🎯 Próximos Passos

### Documentação Planejada

- [ ] Guia de Debugging
- [ ] Guia de Performance
- [ ] Guia de Segurança
- [ ] Guia de Testes
- [ ] Documentação de APIs externas
- [ ] Guia de Troubleshooting Avançado

### Melhorias Planejadas

- [ ] Adicionar diagramas interativos
- [ ] Criar vídeos tutoriais
- [ ] Adicionar mais exemplos práticos
- [ ] Tradução para inglês

---

## 📚 Recursos Externos

### Tecnologias Principais

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy 2.0 Documentation](https://docs.sqlalchemy.org/en/20/)
- [Supabase Documentation](https://supabase.com/docs)
- [Pydantic V2 Documentation](https://docs.pydantic.dev/latest/)
- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

### Ferramentas

- [Alembic Tutorial](https://alembic.sqlalchemy.org/en/latest/tutorial.html)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Vite Documentation](https://vitejs.dev/)
- [TanStack Query](https://tanstack.com/query/latest)

---

**Última atualização:** Janeiro 2025

**Mantenedores:**
- Raphael Federicci Haddad

---

## 🌟 Agradecimentos

Obrigado a todos que contribuem para manter esta documentação atualizada e útil!
