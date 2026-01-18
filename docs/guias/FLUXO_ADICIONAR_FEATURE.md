# ✨ Guia: Fluxo para Adicionar Nova Feature

Este guia descreve o processo completo para adicionar uma nova funcionalidade no Review Hub, desde o planejamento até o deploy.

## 📋 Visão Geral do Fluxo

```
1. Planejamento e Design
   ↓
2. Alterações no Database (se necessário)
   ↓
3. Backend (API + Lógica)
   ↓
4. Frontend (UI + Integração)
   ↓
5. Testes (Unit + Integration + E2E)
   ↓
6. Documentação
   ↓
7. Code Review
   ↓
8. Deploy
```

---

## 🎯 Passo a Passo Detalhado

### 1️⃣ Planejamento e Design

#### a) Definir Requisitos

Documente claramente:
- **O que** a feature faz
- **Por que** é necessária
- **Quem** vai usar
- **Como** vai funcionar

**Exemplo:**
```markdown
## Feature: Exportar Dados de Extração para CSV

### O que
Permitir que usuários exportem dados extraídos de artigos para arquivo CSV.

### Por que
Facilitar análise de dados em ferramentas externas (Excel, R, Python).

### Quem
Pesquisadores que precisam analisar dados extraídos.

### Como
1. Usuário acessa página de extração
2. Clica em botão "Exportar CSV"
3. Sistema gera CSV com todos os dados extraídos
4. Download automático do arquivo
```

#### b) Criar Issue/Task

Crie uma issue no GitHub/Linear com:
- Título descritivo
- Descrição detalhada
- Labels apropriadas (feature, backend, frontend)
- Estimativa de esforço

#### c) Design da Solução

Desenhe a solução técnica:

**Backend:**
- Novos endpoints necessários?
- Alterações no banco de dados?
- Novos services/repositories?

**Frontend:**
- Novos componentes?
- Alterações em páginas existentes?
- Novos hooks/services?

**Exemplo:**
```
Backend:
- GET /api/v1/extraction/export/csv?projectId=X&templateId=Y
- Service: ExportService.export_to_csv()
- Repository: Usar ExtractionRepository existente

Frontend:
- Botão "Exportar CSV" em ExtractionPage
- Hook: useExportExtraction()
- Service: extractionService.exportToCsv()
```

---

### 2️⃣ Alterações no Database (se necessário)

Se a feature requer mudanças no banco, siga o [Fluxo de Alteração de Database](./FLUXO_ALTERACAO_DATABASE.md).

**Exemplo:** Adicionar tabela de histórico de exportações

```sql
-- supabase/migrations/YYYYMMDD_add_export_history.sql

CREATE TABLE public.export_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    export_type VARCHAR(50) NOT NULL, -- 'csv', 'excel', 'json'
    file_size_bytes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_export_history_user_id ON public.export_history(user_id);
CREATE INDEX idx_export_history_project_id ON public.export_history(project_id);
```

---

### 3️⃣ Backend (API + Lógica)

#### a) Criar Service

**Arquivo:** `backend/app/services/export_service.py`

```python
import csv
import io
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_repository import ExtractionRepository
from app.core.logging import get_logger

logger = get_logger(__name__)

class ExportService:
    """Serviço para exportação de dados."""

    def __init__(self, db: AsyncSession, user_id: str):
        self.db = db
        self.user_id = user_id
        self._extractions = ExtractionRepository(db)

    async def export_to_csv(
        self,
        project_id: UUID,
        template_id: UUID,
    ) -> bytes:
        """
        Exporta dados de extração para CSV.

        Args:
            project_id: ID do projeto
            template_id: ID do template

        Returns:
            Bytes do arquivo CSV

        Raises:
            ValueError: Se não houver dados para exportar
        """
        logger.info(
            "exporting_to_csv",
            project_id=str(project_id),
            template_id=str(template_id),
            user_id=self.user_id,
        )

        # Buscar dados
        extractions = await self._extractions.get_by_template(
            project_id=project_id,
            template_id=template_id,
        )

        if not extractions:
            raise ValueError("Nenhum dado para exportar")

        # Gerar CSV
        output = io.StringIO()
        writer = csv.writer(output)

        # Header
        writer.writerow(["Article ID", "Field", "Value", "Created At"])

        # Rows
        for extraction in extractions:
            writer.writerow([
                str(extraction.article_id),
                extraction.field_name,
                extraction.value,
                extraction.created_at.isoformat(),
            ])

        # Converter para bytes
        csv_bytes = output.getvalue().encode("utf-8")

        logger.info(
            "csv_exported",
            size_bytes=len(csv_bytes),
            rows=len(extractions),
        )

        return csv_bytes
```

#### b) Criar Endpoint

**Arquivo:** `backend/app/api/v1/endpoints/export.py`

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from uuid import UUID
import io

from app.core.deps import DbSession, CurrentUser
from app.services.export_service import ExportService
from app.utils.rate_limiter import limiter

router = APIRouter()

@router.get(
    "/csv",
    summary="Exportar dados para CSV",
    description="Exporta dados de extração de um template para arquivo CSV",
)
@limiter.limit("5/minute")  # Limite baixo para operações pesadas
async def export_to_csv(
    project_id: UUID = Query(..., alias="projectId"),
    template_id: UUID = Query(..., alias="templateId"),
    db: DbSession = Depends(),
    user: CurrentUser = Depends(),
):
    """Exporta dados de extração para CSV."""
    service = ExportService(db=db, user_id=user.sub)

    try:
        csv_bytes = await service.export_to_csv(
            project_id=project_id,
            template_id=template_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Retornar como download
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=extraction_{template_id}.csv"
        },
    )
```

#### c) Registrar Router

**Arquivo:** `backend/app/api/v1/router.py`

```python
from app.api.v1.endpoints import export

api_router.include_router(
    export.router,
    prefix="/export",
    tags=["Export"],
)
```

#### d) Criar Testes

**Arquivo:** `backend/tests/unit/test_export_service.py`

```python
import pytest
from unittest.mock import AsyncMock
from uuid import uuid4

from app.services.export_service import ExportService

@pytest.mark.asyncio
async def test_export_to_csv_success(export_service):
    """Testa exportação bem-sucedida."""
    # Arrange
    mock_extractions = [
        MagicMock(
            article_id=uuid4(),
            field_name="Study Type",
            value="RCT",
            created_at=datetime.now(),
        ),
    ]
    export_service._extractions.get_by_template = AsyncMock(
        return_value=mock_extractions
    )

    # Act
    result = await export_service.export_to_csv(
        project_id=uuid4(),
        template_id=uuid4(),
    )

    # Assert
    assert isinstance(result, bytes)
    assert b"Article ID,Field,Value" in result
```

---

### 4️⃣ Frontend (UI + Integração)

#### a) Criar Service

**Arquivo:** `src/services/exportService.ts`

```typescript
import { apiClient } from './apiClient';

export interface ExportOptions {
  projectId: string;
  templateId: string;
}

export const exportService = {
  /**
   * Exporta dados de extração para CSV
   */
  async exportToCsv(options: ExportOptions): Promise<Blob> {
    const response = await apiClient.get('/export/csv', {
      params: {
        projectId: options.projectId,
        templateId: options.templateId,
      },
      responseType: 'blob', // Importante para download
    });

    return response.data;
  },

  /**
   * Faz download do arquivo CSV
   */
  downloadCsv(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};
```

#### b) Criar Hook

**Arquivo:** `src/hooks/useExportExtraction.ts`

```typescript
import { useMutation } from '@tanstack/react-query';
import { exportService, ExportOptions } from '@/services/exportService';
import { toast } from '@/hooks/use-toast';

export function useExportExtraction() {
  return useMutation({
    mutationFn: async (options: ExportOptions) => {
      const blob = await exportService.exportToCsv(options);
      const filename = `extraction_${options.templateId}.csv`;
      exportService.downloadCsv(blob, filename);
      return { success: true };
    },
    onSuccess: () => {
      toast({
        title: 'Exportação concluída',
        description: 'O arquivo CSV foi baixado com sucesso.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Erro na exportação',
        description: error.response?.data?.detail || 'Erro ao exportar dados',
        variant: 'destructive',
      });
    },
  });
}
```

#### c) Criar/Atualizar Componente

**Arquivo:** `src/components/ExtractionPage/ExportButton.tsx`

```typescript
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { useExportExtraction } from '@/hooks/useExportExtraction';

interface ExportButtonProps {
  projectId: string;
  templateId: string;
}

export function ExportButton({ projectId, templateId }: ExportButtonProps) {
  const exportMutation = useExportExtraction();

  const handleExport = () => {
    exportMutation.mutate({ projectId, templateId });
  };

  return (
    <Button
      onClick={handleExport}
      disabled={exportMutation.isPending}
      variant="outline"
    >
      <Download className="mr-2 h-4 w-4" />
      {exportMutation.isPending ? 'Exportando...' : 'Exportar CSV'}
    </Button>
  );
}
```

#### d) Integrar na Página

**Arquivo:** `src/pages/ExtractionPage.tsx`

```typescript
import { ExportButton } from '@/components/ExtractionPage/ExportButton';

export function ExtractionPage() {
  const { projectId, templateId } = useParams();

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Extração de Dados</h1>
        <ExportButton projectId={projectId!} templateId={templateId!} />
      </div>
      {/* Resto da página */}
    </div>
  );
}
```

---

### 5️⃣ Testes

#### a) Testes Unitários (Backend)

```bash
cd backend
uv run pytest tests/unit/test_export_service.py -v
```

#### b) Testes de Integração (Backend)

```bash
uv run pytest tests/integration/test_export_endpoints.py -v
```

#### c) Testes Unitários (Frontend)

**Arquivo:** `src/components/ExtractionPage/ExportButton.test.tsx`

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportButton } from './ExportButton';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

describe('ExportButton', () => {
  it('renders export button', () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <ExportButton projectId="123" templateId="456" />
      </QueryClientProvider>
    );

    expect(screen.getByText('Exportar CSV')).toBeInTheDocument();
  });

  it('shows loading state when exporting', async () => {
    // Test implementation
  });
});
```

#### d) Teste Manual

1. Inicie backend e frontend
2. Navegue até página de extração
3. Clique em "Exportar CSV"
4. Verifique se arquivo foi baixado
5. Abra arquivo e verifique conteúdo

---

### 6️⃣ Documentação

#### a) Atualizar README (se necessário)

Se a feature é significativa, adicione na seção de funcionalidades.

#### b) Criar/Atualizar Guia de Usuário

**Arquivo:** `docs/guias/COMO_EXPORTAR_DADOS.md`

```markdown
# Como Exportar Dados de Extração

## Passo a Passo

1. Acesse a página de extração do seu projeto
2. Clique no botão "Exportar CSV" no canto superior direito
3. O arquivo será baixado automaticamente
4. Abra o arquivo em Excel, Google Sheets ou outra ferramenta

## Formato do CSV

O arquivo CSV contém as seguintes colunas:
- Article ID: ID único do artigo
- Field: Nome do campo extraído
- Value: Valor extraído
- Created At: Data da extração
```

#### c) Atualizar CHANGELOG

**Arquivo:** `CHANGELOG.md`

```markdown
## [Unreleased]

### Added
- Exportação de dados de extração para CSV (#123)
```

---

### 7️⃣ Code Review

#### a) Criar Pull Request

```bash
git checkout -b feature/export-extraction-csv
git add .
git commit -m "feat: add CSV export for extraction data

- Add ExportService with export_to_csv method
- Add GET /api/v1/export/csv endpoint
- Add ExportButton component
- Add useExportExtraction hook
- Add unit and integration tests
- Add user documentation

Closes #123"

git push origin feature/export-extraction-csv
```

#### b) Checklist do PR

- [ ] Código segue padrões do projeto
- [ ] Todos os testes passam
- [ ] Cobertura de testes adequada
- [ ] Documentação atualizada
- [ ] Sem breaking changes (ou documentados)
- [ ] Performance adequada
- [ ] Segurança verificada

#### c) Responder Feedback

- Responda comentários do reviewer
- Faça ajustes solicitados
- Mantenha discussão construtiva

---

### 8️⃣ Deploy

#### a) Merge do PR

Após aprovação, faça merge para `main`.

#### b) Deploy Automático

O CI/CD deve fazer deploy automaticamente:
- Backend: Render/Vercel
- Frontend: Vercel
- Database: Supabase

#### c) Verificar em Produção

1. Acesse ambiente de produção
2. Teste a feature
3. Monitore logs e métricas
4. Verifique se não há erros

#### d) Comunicar Release

- Atualize CHANGELOG
- Notifique equipe/usuários
- Documente breaking changes (se houver)

---

## 📝 Checklist Completo

### Planejamento
- [ ] Requisitos documentados
- [ ] Issue criada
- [ ] Design técnico definido
- [ ] Estimativa de esforço

### Database
- [ ] Migrations criadas (se necessário)
- [ ] Documentação atualizada
- [ ] Testado localmente

### Backend
- [ ] Service criado/atualizado
- [ ] Repository criado/atualizado (se necessário)
- [ ] Endpoint criado
- [ ] Router registrado
- [ ] Schemas Pydantic criados
- [ ] Testes unitários
- [ ] Testes de integração
- [ ] Linter passa
- [ ] Type checker passa

### Frontend
- [ ] Service criado
- [ ] Hook criado
- [ ] Componente criado/atualizado
- [ ] Integrado na página
- [ ] Testes unitários
- [ ] Teste manual
- [ ] Linter passa
- [ ] Type checker passa

### Documentação
- [ ] README atualizado (se necessário)
- [ ] Guia de usuário criado/atualizado
- [ ] CHANGELOG atualizado
- [ ] Comentários no código

### Code Review
- [ ] PR criado
- [ ] Descrição clara
- [ ] Checklist preenchido
- [ ] Feedback respondido
- [ ] Aprovado

### Deploy
- [ ] Merge para main
- [ ] Deploy bem-sucedido
- [ ] Testado em produção
- [ ] Sem erros em logs
- [ ] Release comunicado

---

## 🚨 Troubleshooting

### Feature não funciona em produção

**Checklist:**
1. Migrations foram aplicadas?
2. Variáveis de ambiente configuradas?
3. Build foi bem-sucedido?
4. Logs mostram algum erro?

### Testes falhando

**Checklist:**
1. Banco de dados de teste está limpo?
2. Mocks estão corretos?
3. Fixtures estão atualizadas?
4. Dependências estão instaladas?

### Performance ruim

**Checklist:**
1. Queries estão otimizadas?
2. Índices foram criados?
3. Rate limiting configurado?
4. Caching implementado (se necessário)?

---

## 📚 Referências

- [Fluxo de Alteração de Database](./FLUXO_ALTERACAO_DATABASE.md)
- [Fluxo de Adicionar Endpoint](./FLUXO_ADICIONAR_ENDPOINT.md)
- [Arquitetura do Backend](./ARQUITETURA_BACKEND.md)
- [Guia de Contribuição](../../.github/CONTRIBUTING.md)

---

**Última atualização:** Janeiro 2025
