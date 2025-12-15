# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
AI Assessment Service.

Migrado de: supabase/functions/ai-assessment/index.ts

Serviço para avaliação de artigos usando OpenAI.
Suporta leitura direta de PDF e fallback para File Search.
"""

import time
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import Client

from app.core.config import settings
from app.core.logging import LoggerMixin


class AIAssessmentService(LoggerMixin):
    """
    Service para avaliação AI de artigos.
    
    Usa OpenAI Responses API para ler PDF diretamente.
    """
    
    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        supabase: Client,
        trace_id: str,
    ):
        self.db = db
        self.user_id = user_id
        self.supabase = supabase
        self.trace_id = trace_id
    
    async def assess(
        self,
        project_id: UUID,
        article_id: UUID,
        assessment_item_id: UUID,
        instrument_id: UUID,
        pdf_storage_key: str | None = None,
        pdf_base64: str | None = None,
        pdf_filename: str | None = None,
        pdf_file_id: str | None = None,
        force_file_search: bool = False,
    ) -> dict[str, Any]:
        """
        Executa avaliação AI de um item de assessment.
        
        Args:
            project_id: ID do projeto.
            article_id: ID do artigo.
            assessment_item_id: ID do item de assessment.
            instrument_id: ID do instrumento.
            pdf_storage_key: Chave do PDF no storage.
            pdf_base64: PDF em base64 (alternativa).
            pdf_filename: Nome do arquivo PDF.
            pdf_file_id: ID do arquivo no OpenAI (alternativa).
            force_file_search: Forçar uso de File Search.
            
        Returns:
            Dict com resultado do assessment salvo.
        """
        start_time = time.time()
        
        # 1. Buscar metadados
        item_result = (
            self.supabase.table("assessment_items")
            .select("*")
            .eq("id", str(assessment_item_id))
            .single()
            .execute()
        )
        
        article_result = (
            self.supabase.table("articles")
            .select("*")
            .eq("id", str(article_id))
            .single()
            .execute()
        )
        
        project_result = (
            self.supabase.table("projects")
            .select("description, review_title, condition_studied, eligibility_criteria, study_design")
            .eq("id", str(project_id))
            .single()
            .execute()
        )
        
        item = item_result.data
        article = article_result.data
        project = project_result.data
        
        # 2. Descobrir storage_key se não fornecido
        storage_key = pdf_storage_key
        if not storage_key:
            files_result = (
                self.supabase.table("article_files")
                .select("storage_key")
                .eq("article_id", str(article_id))
                .ilike("file_type", "%pdf%")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if files_result.data:
                storage_key = files_result.data[0]["storage_key"]
        
        # 3. Preparar arquivo para OpenAI
        input_file_node, approx_size = await self._prepare_pdf_file(
            pdf_file_id=pdf_file_id,
            pdf_base64=pdf_base64,
            pdf_filename=pdf_filename,
            storage_key=storage_key,
        )
        
        # 4. Construir prompt
        allowed_levels = item.get("allowed_levels", [])
        if isinstance(allowed_levels, str):
            import json
            try:
                allowed_levels = json.loads(allowed_levels)
            except Exception:
                allowed_levels = []
        
        system_prompt = (
            "You are an expert research quality assessor. "
            "Read the PDF and answer the specific question based on the evidence found. "
            "Quote page numbers."
        )
        
        user_prompt = self._build_user_prompt(item, project, allowed_levels)
        response_format = self._build_response_schema(allowed_levels)
        
        # 5. Escolher caminho: input_file direto ou File Search
        size_limit = 32 * 1024 * 1024  # 32MB
        use_file_search = force_file_search or (approx_size and approx_size > size_limit)
        
        model = "gpt-4o-mini"
        
        self.logger.info(
            "ai_assessment_path",
            trace_id=self.trace_id,
            model=model,
            use_file_search=use_file_search,
            approx_size=approx_size,
        )
        
        # 6. Chamar OpenAI
        ai_start = time.time()
        
        if use_file_search:
            ai_result = await self._call_with_file_search(
                input_file_node, system_prompt, user_prompt, response_format, model
            )
        else:
            ai_result = await self._call_direct(
                input_file_node, system_prompt, user_prompt, response_format, model
            )
        
        ai_duration = (time.time() - ai_start) * 1000
        
        # 7. Processar resposta
        import json
        assessment_result = json.loads(ai_result["output_text"])
        
        # 8. Salvar no banco
        assessment_data = {
            "project_id": str(project_id),
            "article_id": str(article_id),
            "assessment_item_id": str(assessment_item_id),
            "instrument_id": str(instrument_id),
            "user_id": self.user_id,
            "selected_level": assessment_result.get("selected_level"),
            "confidence_score": assessment_result.get("confidence_score"),
            "justification": assessment_result.get("justification"),
            "evidence_passages": assessment_result.get("evidence_passages"),
            "ai_model_used": model,
            "processing_time_ms": int(ai_duration),
            "prompt_tokens": ai_result.get("input_tokens"),
            "completion_tokens": ai_result.get("output_tokens"),
            "status": "pending_review",
        }
        
        saved = (
            self.supabase.table("ai_assessments")
            .insert(assessment_data)
            .execute()
        )
        
        total_duration = (time.time() - start_time) * 1000
        
        self.logger.info(
            "ai_assessment_complete",
            trace_id=self.trace_id,
            assessment_id=saved.data[0]["id"] if saved.data else None,
            ai_duration_ms=ai_duration,
            total_duration_ms=total_duration,
        )
        
        return saved.data[0] if saved.data else {}
    
    async def _prepare_pdf_file(
        self,
        pdf_file_id: str | None,
        pdf_base64: str | None,
        pdf_filename: str | None,
        storage_key: str | None,
    ) -> tuple[dict[str, Any], int | None]:
        """
        Prepara arquivo PDF para envio à OpenAI.
        
        Returns:
            Tuple com node do arquivo e tamanho aproximado.
        """
        if pdf_file_id:
            return {"type": "input_file", "file_id": pdf_file_id}, None
        
        if pdf_base64:
            import base64
            data_url = f"data:application/pdf;base64,{pdf_base64}"
            size = len(base64.b64decode(pdf_base64))
            return {
                "type": "input_file",
                "file_data": data_url,
                "filename": pdf_filename or "article.pdf",
            }, size
        
        if storage_key:
            # Download do Supabase Storage
            response = self.supabase.storage.from_("articles").download(storage_key)
            if not response:
                raise FileNotFoundError(f"PDF not found: {storage_key}")
            
            import base64
            pdf_bytes = bytes(response)
            data_url = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode()}"
            
            return {
                "type": "input_file",
                "file_data": data_url,
                "filename": storage_key.split("/")[-1] or "article.pdf",
            }, len(pdf_bytes)
        
        raise ValueError("No PDF source provided")
    
    def _build_user_prompt(
        self,
        item: dict[str, Any],
        project: dict[str, Any],
        allowed_levels: list[str],
    ) -> str:
        """Constrói prompt do usuário com contexto."""
        levels_str = ", ".join(allowed_levels) if allowed_levels else "N/A"
        
        return f"""Based on the article PDF, assess: {item.get('question', '')}

Available response levels: {levels_str}

Context:
- Review title: {project.get('review_title', '')}
- Condition studied: {project.get('condition_studied', '')}

Return STRICT JSON with:
- selected_level: Your choice from the available levels
- confidence_score: 0.0 to 1.0
- justification: Brief explanation
- evidence_passages: Array of {{ text, page_number }} with supporting evidence
"""
    
    def _build_response_schema(self, allowed_levels: list[str]) -> dict[str, Any]:
        """Constrói schema de resposta para OpenAI."""
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "assessment_result",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "selected_level": {
                            "type": "string",
                            "enum": allowed_levels if allowed_levels else ["unknown"],
                        },
                        "confidence_score": {"type": "number"},
                        "justification": {"type": "string"},
                        "evidence_passages": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string"},
                                    "page_number": {"type": "integer"},
                                },
                                "required": ["text", "page_number"],
                            },
                        },
                    },
                    "required": [
                        "selected_level",
                        "confidence_score",
                        "justification",
                        "evidence_passages",
                    ],
                },
            },
        }
    
    async def _call_direct(
        self,
        input_file_node: dict[str, Any],
        system_prompt: str,
        user_prompt: str,
        response_format: dict[str, Any],
        model: str,
    ) -> dict[str, Any]:
        """Chama OpenAI com input_file direto."""
        payload = {
            "model": model,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {
                    "role": "user",
                    "content": [
                        input_file_node,
                        {"type": "input_text", "text": user_prompt},
                    ],
                },
            ],
            "text": {"format": response_format},
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                timeout=120.0,
            )
            
            if not response.is_success:
                raise ValueError(f"OpenAI error: {response.status_code} - {response.text[:500]}")
            
            result = response.json()
            
            # Extrair output_text
            output_text = None
            for item in result.get("output", []):
                if item.get("type") == "message":
                    for content in item.get("content", []):
                        if content.get("type") == "output_text":
                            output_text = content.get("text")
                            break
            
            return {
                "output_text": output_text,
                "input_tokens": result.get("usage", {}).get("input_tokens"),
                "output_tokens": result.get("usage", {}).get("output_tokens"),
            }
    
    async def _call_with_file_search(
        self,
        input_file_node: dict[str, Any],
        system_prompt: str,
        user_prompt: str,
        response_format: dict[str, Any],
        model: str,
    ) -> dict[str, Any]:
        """Chama OpenAI usando File Search com Vector Store."""
        # TODO: Implementar upload para OpenAI Files API + Vector Store
        # Por enquanto, fallback para chamada direta
        self.logger.warning(
            "file_search_not_implemented",
            trace_id=self.trace_id,
            message="Falling back to direct call",
        )
        return await self._call_direct(
            input_file_node, system_prompt, user_prompt, response_format, model
        )

