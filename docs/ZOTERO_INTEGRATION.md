# Integração com Zotero

Guia completo para configurar e usar a integração do Review Hub com o Zotero.

## Visão Geral

A integração com o Zotero permite importar artigos diretamente das suas collections do Zotero para os projetos do Review Hub, incluindo todos os metadados bibliográficos.

## Configuração Inicial

### 1. Obter User ID e API Key do Zotero

#### Passo 1: Acessar as Configurações de API

1. Faça login na sua conta do Zotero em [zotero.org](https://www.zotero.org)
2. Acesse [Configurações → API Keys](https://www.zotero.org/settings/keys)
3. Seu **User ID** aparece no topo da página (ex: `123456`)

#### Passo 2: Criar uma Nova API Key

1. Clique em "Create new private key"
2. Dê um nome descritivo (ex: "Review Hub Integration")
3. Configure as permissões necessárias:
   - ✅ **Allow library access** (obrigatório)
   - ✅ **Allow file access** (recomendado para futura importação de PDFs)
   - ✅ **Allow notes access** (opcional)
   - ⚠️ Desabilitar **Allow write access** (não necessário)
4. Selecione "Personal Library" ou a biblioteca do grupo que deseja usar
5. Clique em "Save Key"
6. **IMPORTANTE**: Copie a API Key gerada. Ela só será exibida uma vez!

### 2. Configurar no Review Hub

1. No Review Hub, acesse **Project Settings → Advanced**
2. Localize a seção **"Integração Zotero"**
3. Preencha os campos:
   - **Zotero User ID**: Seu ID numérico do Zotero
   - **API Key**: A chave gerada anteriormente
   - **Tipo de Biblioteca**: Escolha "Biblioteca Pessoal" ou "Biblioteca de Grupo"
4. Clique em **"Conectar ao Zotero"**
5. (Opcional) Clique em **"Testar Conexão"** para verificar se tudo está funcionando

## Importando Artigos

### Fluxo de Importação

1. Na lista de artigos do projeto, clique em **"Importar do Zotero"**
2. **Passo 1 - Selecionar Collection**: 
   - Uma lista de todas as suas collections aparecerá
   - Selecione a collection que deseja importar
   - Clique em "Próximo"
3. **Passo 2 - Configurar Opções**:
   - **Baixar PDFs automaticamente**: ✅ Download de PDFs e attachments do Zotero
   - **Baixar apenas PDFs**: ✅ Recomendado (se desabilitado, também baixa HTML snapshots)
   - **Atualizar artigos existentes**: ✅ Recomendado (atualiza metadados de artigos já existentes)
   - **Importar tags como keywords**: ✅ Recomendado (importa tags do Zotero como palavras-chave)
4. Clique em **"Iniciar Importação"**
5. **Passo 3 - Progresso**:
   - Acompanhe o progresso em tempo real
   - Veja estatísticas de importação (importados, atualizados, pulados, erros)
   - Ao finalizar, clique em "Fechar"

### O que é Importado

Os seguintes campos são mapeados do Zotero para o Review Hub:

| Zotero | Review Hub |
|--------|------------|
| `title` | Título |
| `abstractNote` | Resumo |
| `creators` | Autores (formatados) |
| `publicationTitle` | Título da Revista |
| `volume` | Volume |
| `issue` | Edição/Issue |
| `pages` | Páginas |
| `DOI` | DOI |
| `date` | Ano de Publicação |
| `ISSN` | ISSN |
| `url` | URL |
| `tags` | Palavras-chave |
| `itemType` | Tipo de Artigo |
| `language` | Idioma |

## Download de PDFs

### Como Funciona

Durante a importação, o sistema:

1. **Busca attachments** de cada item do Zotero
2. **Filtra arquivos válidos**: Apenas `imported_file` e `imported_url` (não links externos)
3. **Prioriza inteligentemente**:
   - PDFs com palavras "main", "article", "manuscript" no título → prioridade
   - PDFs sem palavras "supplement", "supporting" no título → prioridade
   - Primeiro PDF na lista → geralmente é o principal
4. **Classifica automaticamente**:
   - **Primeiro PDF** → `MAIN` (arquivo principal)
   - **Demais PDFs** → `SUPPLEMENT` (material suplementar)
   - Se artigo já tem MAIN, todos vão como SUPPLEMENT

### Heurísticas de Classificação

O sistema usa as seguintes heurísticas para identificar o PDF principal:

**Indicadores de arquivo MAIN**:
- Título contém: "main", "article", "manuscript", "full text", "published", "final"
- Primeiro na lista de attachments do Zotero
- Formato PDF (priorizado sobre HTML)

**Indicadores de arquivo SUPPLEMENT**:
- Título contém: "supplement", "supporting", "appendix", "additional"
- Arquivos subsequentes ao primeiro PDF

### Limites de Tamanho

- **Máximo por arquivo**: 50MB
- Arquivos maiores são **automaticamente pulados** com warning
- Não falha a importação do artigo, apenas não baixa o PDF

### Formatos Suportados

- **PDF** (prioritário)
- **HTML** (snapshots de páginas web, se "Baixar apenas PDFs" desabilitado)
- Outros formatos suportados pela tabela `article_files`

## Detecção de Duplicatas

O sistema verifica automaticamente se um artigo já existe antes de importar, usando a seguinte ordem de prioridade:

1. **Zotero Item Key**: Se o artigo já foi importado anteriormente
2. **DOI**: Identificador mais confiável
3. **Título**: Fallback caso não haja DOI

### Comportamento com Duplicatas

- **Com "Atualizar artigos existentes" ativado**: O artigo existente terá seus metadados atualizados se a versão do Zotero for mais recente
- **Com "Atualizar artigos existentes" desativado**: Artigos duplicados são pulados

## Limitações Conhecidas

### Funcionalidades Implementadas

1. ✅ **Download automático de PDFs**: PDFs e attachments são baixados automaticamente durante a importação
2. ✅ **Detecção inteligente de arquivo principal**: Sistema usa heurísticas para identificar qual PDF é o principal
3. ✅ **Upload para Supabase Storage**: Arquivos armazenados de forma segura e acessível
4. ✅ **Classificação automática**: MAIN vs SUPPLEMENT baseado em priorização

### Funcionalidades Ainda Não Implementadas

1. **Sincronização contínua**: A importação é manual e sob demanda
2. **Importação de notas**: Notas do Zotero não são importadas
3. **Re-download de PDFs atualizados**: Sistema não detecta se PDF foi modificado no Zotero

### Limitações da API do Zotero

- **Rate Limiting**: 120 requisições por minuto
- **Tamanho de resposta**: Máximo 100 items por requisição (o sistema faz múltiplas requisições automaticamente se necessário)

## Troubleshooting

### "Credenciais não encontradas"

**Problema**: A integração não está configurada ou as credenciais expiraram.

**Solução**:
1. Vá em Project Settings → Advanced
2. Configure novamente a integração com uma nova API Key

### "Erro ao conectar com Zotero"

**Problemas comuns**:
- API Key inválida ou expirada
- User ID incorreto
- Permissões insuficientes na API Key
- Tipo de biblioteca incorreto (user vs group)

**Solução**:
1. Verifique se você copiou corretamente o User ID e API Key
2. Gere uma nova API Key com as permissões corretas
3. Teste a conexão em Project Settings → Advanced → "Testar Conexão"

### "Nenhuma collection encontrada"

**Problema**: Sua biblioteca Zotero não tem collections ou o tipo de biblioteca está incorreto.

**Solução**:
1. Verifique se você tem collections criadas no Zotero
2. Confirme que selecionou o tipo de biblioteca correto (Pessoal vs Grupo)
3. Verifique se a API Key tem permissão para acessar as collections

### Artigos importados sem alguns campos

**Problema**: Alguns metadados não foram importados.

**Solução**:
- Verifique se os campos estão preenchidos no Zotero
- Alguns tipos de items no Zotero podem não ter todos os campos mapeados
- Você pode editar os artigos manualmente após a importação

## Segurança

### Armazenamento de Credenciais

- As credenciais (User ID e API Key) são armazenadas de forma **criptografada** no Supabase Vault
- As credenciais **nunca** são expostas ao frontend
- Apenas o usuário autenticado pode acessar suas próprias credenciais
- As credenciais são descriptografadas apenas quando necessário, em um ambiente seguro (Edge Function)

### Boas Práticas

1. **Não compartilhe** sua API Key com ninguém
2. **Use permissões mínimas**: Não habilite "write access" se não for necessário
3. **Revogue** API Keys antigas se não estiver mais usando
4. **Regenere** periodicamente suas API Keys por segurança

## FAQ

### Posso importar de múltiplas collections?

Atualmente, a importação é feita uma collection por vez. Para importar de múltiplas collections, repita o processo para cada uma.

### Os artigos importados podem ser editados?

Sim! Após a importação, os artigos funcionam como qualquer outro artigo no Review Hub e podem ser editados normalmente.

### Posso ressincronizar uma collection?

Sim. Basta importar novamente a mesma collection. O sistema detectará artigos existentes e atualizará seus metadados se a versão do Zotero for mais recente.

### A importação afeta meus dados no Zotero?

Não. A integração é **somente leitura**. Nenhum dado no Zotero é modificado ou deletado.

### Preciso manter a integração conectada?

A integração só é necessária durante a importação. Artigos já importados permanecerão no sistema mesmo se você desconectar a integração.

### Posso usar diferentes contas Zotero em projetos diferentes?

Atualmente, a integração é por usuário, não por projeto. Todos os projetos do mesmo usuário usarão a mesma conta Zotero configurada.

## Suporte

Se você encontrar problemas não listados aqui:

1. Verifique os logs do navegador (Console do Desenvolvedor)
2. Entre em contato com o suporte técnico
3. Reporte bugs no repositório do GitHub

## Recursos Adicionais

- [Documentação oficial da API do Zotero](https://www.zotero.org/support/dev/web_api/v3/start)
- [Guia de permissões de API Keys](https://www.zotero.org/support/dev/web_api/v3/oauth)
- [Fórum da comunidade Zotero](https://forums.zotero.org/)

