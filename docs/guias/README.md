# 📚 Guias de Desenvolvimento - Review Hub

Bem-vindo aos guias práticos de desenvolvimento do Review Hub! Esta pasta contém fluxos de trabalho detalhados para tarefas comuns.

## 🎯 Guias Disponíveis

### 🗄️ [Fluxo de Alteração de Database](./FLUXO_ALTERACAO_DATABASE.md)
**Quando usar:** Sempre que precisar alterar o schema do banco de dados.

**Cobre:**
- ✅ Adicionar/remover campos
- ✅ Criar novas tabelas
- ✅ Adicionar ENUMs
- ✅ Criar relacionamentos
- ✅ Sincronizar Supabase + SQLAlchemy + Alembic
- ✅ Atualizar documentação do schema

**Tempo estimado:** 30-60 minutos

---

### 🚀 [Fluxo para Adicionar Novo Endpoint](./FLUXO_ADICIONAR_ENDPOINT.md)
**Quando usar:** Quando precisar criar uma nova rota na API.

**Cobre:**
- ✅ Criar schemas Pydantic
- ✅ Criar service com lógica de negócio
- ✅ Criar endpoint no router
- ✅ Registrar rota
- ✅ Adicionar rate limiting
- ✅ Criar testes unitários e de integração
- ✅ Exemplos de GET, POST, PUT, PATCH, DELETE

**Tempo estimado:** 20-40 minutos

---

### ✨ [Fluxo para Adicionar Nova Feature](./FLUXO_ADICIONAR_FEATURE.md)
**Quando usar:** Para implementar uma funcionalidade completa (backend + frontend).

**Cobre:**
- ✅ Planejamento e design
- ✅ Alterações no database
- ✅ Implementação backend (API + lógica)
- ✅ Implementação frontend (UI + integração)
- ✅ Testes completos (unit + integration + E2E)
- ✅ Documentação
- ✅ Code review e deploy

**Tempo estimado:** 2-8 horas (dependendo da complexidade)

---

### 🏗️ [Arquitetura do Backend](./ARQUITETURA_BACKEND.md)
**Quando usar:** Para entender a estrutura geral do backend.

**Cobre:**
- ✅ Visão geral da arquitetura
- ✅ Estrutura de pastas
- ✅ Camadas (Endpoints, Services, Repositories, Models)
- ✅ Fluxo de uma requisição
- ✅ Autenticação e segurança
- ✅ Serviços principais
- ✅ Padrões e convenções

**Tempo estimado:** 45-60 minutos de leitura

---

### 🆕 [Criar Novo Projeto Supabase Local](./CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md)
**Quando usar:** Ao configurar ambiente de desenvolvimento pela primeira vez.

**Cobre:**
- ✅ Instalação do Supabase CLI
- ✅ Inicialização de projeto local
- ✅ Configuração de variáveis de ambiente
- ✅ Aplicação de migrations
- ✅ Troubleshooting

**Tempo estimado:** 15-30 minutos

---

## 🗺️ Fluxograma de Decisão

```
Preciso fazer uma alteração no projeto...

┌─────────────────────────────────────┐
│ Qual tipo de alteração?             │
└─────────────────────────────────────┘
              │
              ├─── Alterar schema do banco?
              │    └─→ [FLUXO_ALTERACAO_DATABASE.md]
              │
              ├─── Adicionar novo endpoint na API?
              │    └─→ [FLUXO_ADICIONAR_ENDPOINT.md]
              │
              ├─── Implementar feature completa?
              │    └─→ [FLUXO_ADICIONAR_FEATURE.md]
              │
              ├─── Entender arquitetura do backend?
              │    └─→ [ARQUITETURA_BACKEND.md]
              │
              └─── Configurar ambiente local?
                   └─→ [CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md]
```

---

## 📖 Como Usar Estes Guias

### Para Desenvolvedores Novos

1. **Primeiro:** Leia [ARQUITETURA_BACKEND.md](./ARQUITETURA_BACKEND.md) para entender a estrutura
2. **Depois:** Configure seu ambiente com [CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md](./CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md)
3. **Então:** Use os guias de fluxo conforme necessário

### Para Desenvolvedores Experientes

Use os guias de fluxo como **checklists** para garantir que não esqueceu nenhum passo importante.

### Para Code Review

Use os checklists dos guias para verificar se o PR está completo.

---

## 🎓 Ordem de Aprendizado Recomendada

### Nível 1: Fundamentos
1. [ARQUITETURA_BACKEND.md](./ARQUITETURA_BACKEND.md) - Entenda a estrutura
2. [CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md](./CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md) - Configure ambiente

### Nível 2: Tarefas Básicas
3. [FLUXO_ADICIONAR_ENDPOINT.md](./FLUXO_ADICIONAR_ENDPOINT.md) - Crie endpoints simples
4. [FLUXO_ALTERACAO_DATABASE.md](./FLUXO_ALTERACAO_DATABASE.md) - Altere o banco

### Nível 3: Features Completas
5. [FLUXO_ADICIONAR_FEATURE.md](./FLUXO_ADICIONAR_FEATURE.md) - Implemente features end-to-end

---

## 🔗 Outros Recursos

### Documentação do Banco de Dados
- [Database Schema Completo](../estrutura_database/DATABASE_SCHEMA.md)
- [Guia Rápido do Schema](../estrutura_database/GUIA_RAPIDO.md)
- [Estrutura do Projeto](../estrutura_database/ESTRUTURA_PROJETO_MACRO.md)

### Documentação de Deploy
- [Guia de Deploy](../deployment/GUIA_DEPLOYMENT.md)
- [Variáveis de Ambiente](../deployment/ENV_VARS.md)

### Documentação Técnica
- [Arquitetura Zotero](../tecnicas/ZOTERO_ARCHITECTURE.md)
- [Implementação Zotero](../tecnicas/ZOTERO_IMPLEMENTATION_SUMMARY.md)

### Documentação Legal
- [Código de Conduta](../legal/CODE_OF_CONDUCT.md)
- [Política de Segurança](../legal/SECURITY.md)
- [CLA](../legal/CLA.md)

---

## 💡 Dicas Gerais

### Antes de Começar
- ✅ Leia o guia relevante completamente
- ✅ Entenda o contexto da mudança
- ✅ Verifique se há issues relacionadas
- ✅ Crie uma branch específica

### Durante o Desenvolvimento
- ✅ Siga os checklists dos guias
- ✅ Teste frequentemente
- ✅ Commit com mensagens descritivas
- ✅ Documente conforme desenvolve

### Antes de Fazer PR
- ✅ Todos os testes passam
- ✅ Linter passa
- ✅ Documentação atualizada
- ✅ Checklist do guia completo

---

## 🚨 Troubleshooting Geral

### Problema: Não sei qual guia usar

**Solução:** Use o fluxograma de decisão acima ou pergunte no canal de desenvolvimento.

### Problema: Guia está desatualizado

**Solução:** Abra uma issue ou PR para atualizar o guia.

### Problema: Preciso de ajuda

**Solução:**
1. Verifique a seção de troubleshooting do guia específico
2. Consulte a documentação técnica relacionada
3. Pergunte no canal de desenvolvimento
4. Abra uma issue se for um problema recorrente

---

## 📝 Convenções de Nomenclatura

### Commits
```bash
# Formato
<tipo>(<escopo>): <descrição>

# Tipos
feat:     Nova funcionalidade
fix:      Correção de bug
docs:     Documentação
style:    Formatação
refactor: Refatoração
test:     Testes
chore:    Manutenção

# Exemplos
feat(api): add endpoint to export extraction data
fix(database): correct foreign key constraint
docs(guides): update database flow guide
```

### Branches
```bash
# Formato
<tipo>/<descrição-curta>

# Tipos
feature/  - Nova funcionalidade
bugfix/   - Correção de bug
hotfix/   - Correção urgente
docs/     - Documentação
refactor/ - Refatoração

# Exemplos
feature/export-extraction-csv
bugfix/fix-article-upload
docs/update-database-guide
```

### Pull Requests
```markdown
# Título
<tipo>: <descrição clara>

# Descrição
## O que foi feito
- Item 1
- Item 2

## Por que
Explicação da motivação

## Como testar
1. Passo 1
2. Passo 2

## Checklist
- [ ] Testes passam
- [ ] Documentação atualizada
- [ ] Linter passa

Closes #123
```

---

## 🤝 Contribuindo para os Guias

Estes guias são documentos vivos! Se você:
- Encontrou algo desatualizado
- Tem sugestões de melhoria
- Quer adicionar um novo guia
- Encontrou um erro

**Por favor:**
1. Abra uma issue descrevendo o problema/sugestão
2. Ou faça um PR com a correção/melhoria
3. Siga o template de documentação existente

---

## 📊 Status dos Guias

| Guia | Status | Última Atualização |
|------|--------|-------------------|
| FLUXO_ALTERACAO_DATABASE.md | ✅ Completo | Janeiro 2025 |
| FLUXO_ADICIONAR_ENDPOINT.md | ✅ Completo | Janeiro 2025 |
| FLUXO_ADICIONAR_FEATURE.md | ✅ Completo | Janeiro 2025 |
| ARQUITETURA_BACKEND.md | ✅ Completo | Janeiro 2025 |
| CRIAR_NOVO_PROJETO_SUPABASE_LOCAL.md | ✅ Completo | Dezembro 2024 |

---

## 📞 Contato

Dúvidas sobre os guias? Entre em contato:
- **Issues:** Abra uma issue no GitHub
- **Discussões:** Use GitHub Discussions
- **Email:** [Conforme configurado no projeto]

---

**Última atualização:** Janeiro 2025

**Mantenedores:**
- Raphael Federicci Haddad

---

## 🎯 Próximos Guias Planejados

- [ ] FLUXO_DEBUGGING.md - Como debugar problemas comuns
- [ ] FLUXO_PERFORMANCE.md - Como otimizar performance
- [ ] FLUXO_SEGURANCA.md - Checklist de segurança
- [ ] FLUXO_TESTES.md - Estratégias de teste
- [ ] FLUXO_DEPLOY.md - Processo de deploy detalhado

Quer contribuir com algum desses? Abra uma issue!
