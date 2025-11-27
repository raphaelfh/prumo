# Workflows Desabilitados

Esta pasta contém workflows do GitHub Actions que foram desabilitados.

## cla-check.yml.disabled

**Motivo da desabilitação**: O repositório está usando o serviço web do [CLA Assistant](https://cla-assistant.io/) que gerencia o CLA via webhooks.

**Como funciona agora**:
- O CLA Assistant cria webhooks automaticamente no repositório
- Monitora Pull Requests automaticamente
- Gerencia assinaturas via dashboard web
- Permite adicionar colaboradores manualmente

**Para reabilitar** (se necessário):
1. Mover este arquivo de volta para `.github/workflows/cla-check.yml`
2. Configurar o secret `CLA_PAT` no GitHub
3. Corrigir o `path-to-document` para `docs/legal/CLA.md`

**Nota**: Não é necessário reabilitar se você está usando o serviço web do CLA Assistant.

