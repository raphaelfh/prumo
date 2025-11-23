# Guia de Contribuição

Obrigado por considerar contribuir para o **Review Hub**! Este documento fornece diretrizes para contribuir com o projeto.

## 📋 Índice

- [Código de Conduta](#código-de-conduta)
- [Como Posso Contribuir?](#como-posso-contribuir)
- [Processo de Desenvolvimento](#processo-de-desenvolvimento)
- [Padrões de Código](#padrões-de-código)
- [Processo de Pull Request](#processo-de-pull-request)
- [Reportando Bugs](#reportando-bugs)
- [Sugerindo Melhorias](#sugerindo-melhorias)

## 📜 Código de Conduta

Este projeto segue um [Código de Conduta](CODE_OF_CONDUCT.md). Ao participar, você concorda em manter este código.

## 🤝 Como Posso Contribuir?

### Reportando Bugs

Se você encontrou um bug:

1. Verifique se o bug já não foi reportado nas [Issues](https://github.com/seu-usuario/review-hub/issues)
2. Se não foi reportado, crie uma nova issue usando o [template de bug report](.github/ISSUE_TEMPLATE/bug_report.md)
3. Forneça o máximo de detalhes possível:
   - Passos para reproduzir
   - Comportamento esperado vs. comportamento atual
   - Ambiente (navegador, OS, versão do Node.js)
   - Screenshots (se aplicável)

### Sugerindo Melhorias

Temos ideias para melhorias? Ótimo!

1. Verifique se a sugestão já não existe nas [Issues](https://github.com/seu-usuario/review-hub/issues)
2. Crie uma nova issue usando o [template de feature request](.github/ISSUE_TEMPLATE/feature_request.md)
3. Descreva claramente:
   - O problema que a feature resolve
   - Como você imagina que funcionaria
   - Alternativas consideradas

### Contribuindo com Código

1. **Fork** o repositório
2. **Clone** seu fork:
   ```bash
   git clone https://github.com/seu-usuario/review-hub.git
   cd review-hub
   ```
3. **Crie uma branch** para sua feature:
   ```bash
   git checkout -b feature/minha-feature
   ```
   Ou para correção de bugs:
   ```bash
   git checkout -b fix/correcao-bug
   ```
4. **Instale as dependências**:
   ```bash
   npm install
   ```
5. **Faça suas alterações**
6. **Teste suas alterações**:
   ```bash
   npm test
   npm run lint
   ```
7. **Commit** suas mudanças:
   ```bash
   git commit -m "feat: adiciona nova funcionalidade X"
   ```
   Use [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` para novas features
   - `fix:` para correções de bugs
   - `docs:` para documentação
   - `style:` para formatação
   - `refactor:` para refatoração
   - `test:` para testes
   - `chore:` para tarefas de manutenção
8. **Push** para seu fork:
   ```bash
   git push origin feature/minha-feature
   ```
9. **Abra um Pull Request** no repositório original

## 🔄 Processo de Desenvolvimento

### Estrutura do Projeto

```
review-hub/
├── src/                    # Código fonte do frontend
│   ├── components/         # Componentes React
│   ├── hooks/              # Custom hooks
│   ├── services/           # Serviços e APIs
│   └── types/              # Definições TypeScript
├── supabase/
│   ├── functions/          # Edge Functions (Deno)
│   └── migrations/         # Migrações do banco de dados
└── docs/                   # Documentação
```

### Setup do Ambiente de Desenvolvimento

1. **Pré-requisitos**:
   - Node.js 18+ e npm
   - Supabase CLI (para desenvolvimento local)
   - Git

2. **Configuração**:
   ```bash
   # Clone o repositório
   git clone https://github.com/seu-usuario/review-hub.git
   cd review-hub
   
   # Instale dependências
   npm install
   
   # Configure variáveis de ambiente
   cp .env.example .env.local
   # Edite .env.local com suas credenciais
   
   # Inicie o servidor de desenvolvimento
   npm run dev
   ```

3. **Supabase Local** (opcional):
   ```bash
   # Inicie Supabase localmente
   supabase start
   
   # Execute migrações
   supabase db reset
   ```

## 📝 Padrões de Código

### TypeScript

- Use TypeScript estrito
- Evite `any` - use tipos específicos
- Documente funções complexas com JSDoc
- Siga as regras do ESLint configuradas

### React

- Use componentes funcionais com hooks
- Mantenha componentes pequenos e focados
- Use `useMemo` e `useCallback` quando apropriado
- Siga os padrões do projeto (ver `.cursor/rules/`)

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: adiciona integração com novo serviço
fix: corrige bug na validação de formulário
docs: atualiza documentação da API
style: formata código com Prettier
refactor: reorganiza estrutura de pastas
test: adiciona testes para novo hook
chore: atualiza dependências
```

### Cabeçalhos de Copyright

**IMPORTANTE**: Todos os novos arquivos de código fonte devem incluir o cabeçalho de copyright:

```typescript
/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */
```

## 🔀 Processo de Pull Request

### Antes de Abrir um PR

- [ ] Código segue os padrões do projeto
- [ ] Testes foram adicionados/atualizados
- [ ] Documentação foi atualizada (se necessário)
- [ ] Código foi testado localmente
- [ ] Lint passa sem erros (`npm run lint`)
- [ ] Testes passam (`npm test`)
- [ ] Build funciona (`npm run build`)

### Durante o PR

1. **Preencha o template de PR** completamente
2. **Descreva suas mudanças** de forma clara
3. **Referencie issues** relacionadas (ex: "Fixes #123")
4. **Adicione screenshots** se a mudança afeta a UI
5. **Aguarde feedback** e responda aos comentários

### CLA (Contributor License Agreement)

**OBRIGATÓRIO**: Antes de seu PR ser mesclado, você deve assinar o [CLA](CLA.md).

- O bot CLA Assistant irá solicitar automaticamente
- Seu PR ficará bloqueado até a assinatura
- Leia o CLA cuidadosamente antes de assinar

### Revisão de Código

- Mantenedores revisarão seu PR
- Pode haver solicitações de mudanças
- Responda aos comentários e faça as alterações solicitadas
- Marque o PR como "ready for review" quando estiver pronto

### Após o Merge

- Seu PR será mesclado após aprovação
- Obrigado pela contribuição! 🎉

## 🐛 Reportando Bugs

Use o [template de bug report](.github/ISSUE_TEMPLATE/bug_report.md) e inclua:

- **Descrição clara** do problema
- **Passos para reproduzir**
- **Comportamento esperado**
- **Comportamento atual**
- **Screenshots** (se aplicável)
- **Ambiente**: OS, navegador, versão do Node.js
- **Logs** relevantes (se houver)

## 💡 Sugerindo Melhorias

Use o [template de feature request](.github/ISSUE_TEMPLATE/feature_request.md) e inclua:

- **Problema** que a feature resolve
- **Solução proposta**
- **Alternativas consideradas**
- **Contexto adicional**

## ❓ Perguntas?

- Abra uma [issue com a tag "question"](.github/ISSUE_TEMPLATE/question.md)
- Ou entre em contato através do repositório

## 📚 Recursos Adicionais

- [Documentação do Projeto](./docs/)
- [Licenciamento](README.md#-licenciamento)
- [Código de Conduta](CODE_OF_CONDUCT.md)
- [CLA](CLA.md)

---

**Obrigado por contribuir para o Review Hub!** 🚀

