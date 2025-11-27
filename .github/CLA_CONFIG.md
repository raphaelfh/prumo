# Configuração do CLA (Contributor License Agreement)

## Status Atual

✅ **Usando**: Serviço web do [CLA Assistant](https://cla-assistant.io/)  
❌ **Desabilitado**: GitHub Action (redundante)

## Como Funciona

O CLA Assistant está configurado para funcionar via **webhooks**:

1. **Webhook Automático**: Criado automaticamente quando você vincula o CLA ao repositório
2. **Monitoramento**: Monitora todos os Pull Requests automaticamente
3. **Verificação**: Verifica se o autor do PR assinou o CLA
4. **Comentários**: Comenta automaticamente nos PRs pedindo assinatura (se necessário)
5. **Status Checks**: Atualiza o status do PR (✅ assinado / ❌ não assinado)

## Gerenciar Assinaturas

### Via Dashboard Web

1. Acesse: https://cla-assistant.io/
2. Faça login com sua conta GitHub
3. Selecione o repositório: `raphaelfh/review-hub`
4. Você verá:
   - Lista de todas as assinaturas
   - Histórico de assinaturas
   - Opção de adicionar colaboradores manualmente

### Adicionar Colaboradores Manualmente

1. No dashboard do CLA Assistant, vá em **"Signed CLAs"** ou **"Manage"**
2. Procure por **"Add signer manually"** ou **"Manual Sign"**
3. Adicione:
   - **Email** do colaborador
   - **Nome** (opcional)
   - **GitHub username** (se tiver)
4. Clique em **"Save"**

Depois disso:
- ✅ O colaborador aparecerá como assinado
- ✅ PRs dele não serão bloqueados pelo CLA
- ✅ Você pode ver todas as assinaturas no dashboard

## Documento do CLA

O documento do CLA está localizado em: [`docs/legal/CLA.md`](../../docs/legal/CLA.md)

## Webhooks Configurados

O CLA Assistant cria automaticamente os seguintes webhooks:
- **Pull Request events**: `opened`, `synchronize`, `reopened`
- **Status**: Verificado em Settings → Webhooks do repositório

## Verificar Configuração

Para verificar se o CLA Assistant está funcionando:

1. Acesse: https://github.com/raphaelfh/review-hub/settings/hooks
2. Procure por webhooks do `cla-assistant.io`
3. Deve haver um webhook ativo

## Troubleshooting

### O bot não está comentando nos PRs?

1. Verifique se o webhook está ativo: https://github.com/raphaelfh/review-hub/settings/hooks
2. Verifique se o CLA está vinculado: https://cla-assistant.io/
3. Teste criando um PR de teste

### Como reabilitar o GitHub Action?

Se você quiser usar o GitHub Action em vez do serviço web:

1. Mover `.github/workflows/disabled/cla-check.yml.disabled` para `.github/workflows/cla-check.yml`
2. Corrigir o `path-to-document` para `docs/legal/CLA.md`
3. Configurar o secret `CLA_PAT` no GitHub
4. Remover o webhook do cla-assistant.io (se não quiser usar ambos)

**Nota**: Não é recomendado usar ambos simultaneamente (redundante).

---

**Última atualização**: Janeiro 2025

