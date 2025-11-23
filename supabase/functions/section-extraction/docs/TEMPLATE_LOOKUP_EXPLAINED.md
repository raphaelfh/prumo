# Template Lookup - Explicação

## O que é Template Lookup?

O **Template Lookup** é um mecanismo de resolução de templates que garante que o pipeline sempre use o template **ativo** do projeto, mesmo quando um `templateId` específico é fornecido na requisição.

## Por que existe?

Em um projeto, pode haver múltiplos templates de extração:

1. **Template antigo**: Versão 1.0.0 (desativado)
2. **Template novo**: Versão 2.0.0 (ativo) ← **Este é o que queremos usar**

Sem o template lookup, se o frontend enviar o `templateId` do template antigo, o pipeline extrairia usando campos desatualizados.

## Como funciona?

### 1. Fluxo no `template-builder.ts`

```typescript
// 1. Recebe templateId fornecido na requisição
let actualTemplateId = templateId;

// 2. Se projectId foi fornecido, busca template ATIVO do projeto
if (projectId) {
  const { data: activeTemplate } = await supabase
    .from("project_extraction_templates")
    .select("id")
    .eq("project_id", projectId)
    .eq("is_active", true)  // ← Busca apenas templates ATIVOS
    .maybeSingle();

  // 3. Se encontrou template ativo, usa ele (mesmo que seja diferente do fornecido)
  if (activeTemplate) {
    actualTemplateId = activeTemplate.id;
  }
}

// 4. Busca entity_type usando o templateId resolvido
const { data } = await supabase
  .from("extraction_entity_types")
  .select("*, fields:extraction_fields(*)")
  .eq("project_template_id", actualTemplateId)  // ← Usa template ativo
  .eq("id", entityTypeId)
  .single();
```

### 2. Cenários

#### Cenário A: Template fornecido = Template ativo
```
Frontend envia: templateId = "abc-123"
Banco: Template ativo = "abc-123"
Resultado: Usa "abc-123" ✅
```

#### Cenário B: Template fornecido ≠ Template ativo
```
Frontend envia: templateId = "abc-123" (antigo)
Banco: Template ativo = "xyz-789" (novo)
Resultado: Usa "xyz-789" ✅ (ignora o fornecido)
```

#### Cenário C: Sem projectId
```
Frontend envia: templateId = "abc-123"
Frontend NÃO envia: projectId
Resultado: Usa "abc-123" (sem lookup, assume que está correto)
```

## Benefícios

1. **Consistência**: Sempre usa o template mais recente do projeto
2. **Flexibilidade**: Permite atualizar templates sem quebrar requisições em andamento
3. **Segurança**: Evita usar templates desatualizados acidentalmente
4. **Manutenibilidade**: Centraliza a lógica de qual template usar

## Exemplo no Log

Quando o template lookup funciona, você verá nos logs:

```json
{
  "message": "Using active template instead of provided templateId",
  "providedTemplateId": "abc-123",
  "activeTemplateId": "xyz-789"
}
```

Ou se forem iguais:

```json
{
  "message": "Provided templateId matches active template",
  "templateId": "abc-123"
}
```

## Configuração no Banco

O template ativo é controlado pela coluna `is_active` na tabela `project_extraction_templates`:

```sql
-- Ativar novo template
UPDATE project_extraction_templates 
SET is_active = true 
WHERE id = 'xyz-789';

-- Desativar template antigo
UPDATE project_extraction_templates 
SET is_active = false 
WHERE id = 'abc-123';
```

---

**Resumo**: O Template Lookup garante que sempre usamos o template correto e atualizado do projeto, mesmo se o frontend enviar um ID de template desatualizado.

