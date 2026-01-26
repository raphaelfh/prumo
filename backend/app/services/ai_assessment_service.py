"""
AI Assessment Service.

Migrado de: supabase/functions/ai-assessment/index.ts

Serviço para avaliação de artigos usando OpenAI.
Implementa:
- Leitura direta de PDF via Responses API
- File Search com Vector Store para PDFs grandes
- Prompts customizados por instrumento
- Repository Pattern com SQLAlchemy
"""

import base64
import json
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import LoggerMixin
from app.infrastructure.storage import StorageAdapter
from app.models.assessment import AIAssessment
from app.models.extraction import AISuggestion
from app.repositories import (
    AIAssessmentConfigRepository,
    AIAssessmentPromptRepository,
    AIAssessmentRepository,
    AIAssessmentRunRepository,
    AISuggestionRepository,
    ArticleFileRepository,
    ArticleRepository,
    AssessmentItemRepository,
    ProjectRepository,
)


@dataclass
class AssessmentResult:
    """Resultado de uma avaliação AI."""
    
    assessment_id: str
    selected_level: str
    confidence_score: float
    justification: str
    evidence_passages: list[dict[str, Any]]
    tokens_prompt: int
    tokens_completion: int
    processing_time_ms: int
    method_used: str  # "direct" ou "file_search"


class AIAssessmentService(LoggerMixin):
    """
    Service para avaliação AI de artigos.
    
    Usa OpenAI Responses API para ler PDF diretamente.
    Para PDFs grandes (>32MB), usa File Search com Vector Store.
    Migrado para usar SQLAlchemy via Repository Pattern.
    """
    
    # Limite de tamanho para usar input_file direto (32MB)
    DIRECT_FILE_SIZE_LIMIT = 32 * 1024 * 1024
    
    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str,
        openai_api_key: str | None = None,  # BYOK support
    ):
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id
        self.openai_api_key = openai_api_key or settings.OPENAI_API_KEY

        # Repositories
        self._articles = ArticleRepository(db)
        self._article_files = ArticleFileRepository(db)
        self._projects = ProjectRepository(db)
        self._assessment_items = AssessmentItemRepository(db)
        self._ai_assessments = AIAssessmentRepository(db)

        # NEW: Run tracking and config repositories
        self._runs = AIAssessmentRunRepository(db)
        self._configs = AIAssessmentConfigRepository(db)
        self._prompts = AIAssessmentPromptRepository(db)
        self._suggestions = AISuggestionRepository(db)
    
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
        model: str = "gpt-4o-mini",
        extraction_instance_id: UUID | None = None,  # NEW: For PROBAST by model
    ) -> AssessmentResult:
        """
        Executa avaliação AI de um item de assessment com run tracking completo.

        NEW in Phase 2:
        - Run tracking (pending → running → completed/failed)
        - Creates AISuggestion instead of final AIAssessment
        - Uses config from database (AIAssessmentConfig)
        - Uses custom prompts (AIAssessmentPrompt)
        - BYOK support via openai_api_key parameter

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
            model: Modelo OpenAI a usar (optional, overrides config).
            extraction_instance_id: ID da extraction instance (para PROBAST por modelo).

        Returns:
            AssessmentResult com suggestion_id (não assessment_id final).
        """
        start_time = time.time()

        # === PHASE 2: Run Tracking ===
        # 1. Create assessment run
        run = await self._runs.create_run(
            project_id=project_id,
            article_id=article_id,
            instrument_id=instrument_id,
            extraction_instance_id=extraction_instance_id,
            created_by=UUID(self.user_id),
            stage="assess_single",
            parameters={
                "assessment_item_id": str(assessment_item_id),
                "model": model,
                "force_file_search": force_file_search,
                "has_extraction_instance": extraction_instance_id is not None,
            },
        )

        # 2. Start run
        await self._runs.start_run(run.id)

        try:
            # === Continue with existing logic ===
            start_time = time.time()
        
        # 1. Buscar metadados via repositories
        item = await self._assessment_items.get_by_id(assessment_item_id)
        if not item:
            raise ValueError(f"Assessment item not found: {assessment_item_id}")
        
        article = await self._articles.get_by_id(article_id)
        if not article:
            raise ValueError(f"Article not found: {article_id}")
        
        project_summary = await self._projects.get_summary(project_id)
        
        # 2. Descobrir storage_key se não fornecido
        storage_key = pdf_storage_key
        if not storage_key:
            pdf_file = await self._article_files.get_latest_pdf(article_id)
            if pdf_file:
                storage_key = pdf_file.storage_key
        
        # 3. Preparar arquivo para OpenAI
        input_file_node, approx_size = await self._prepare_pdf_file(
            pdf_file_id=pdf_file_id,
            pdf_base64=pdf_base64,
            pdf_filename=pdf_filename,
            storage_key=storage_key,
        )
        
        # 4. Construir prompts customizados por instrumento
        allowed_levels = self._parse_allowed_levels(item.allowed_levels)
        
        system_prompt = self._build_system_prompt(item, project_summary)
        user_prompt = self._build_user_prompt(item, project_summary, allowed_levels)
        response_format = self._build_response_schema(allowed_levels)
        
        # 5. Escolher método: input_file direto ou File Search
        use_file_search = force_file_search or (
            approx_size and approx_size > self.DIRECT_FILE_SIZE_LIMIT
        )
        
        self.logger.info(
            "ai_assessment_path",
            trace_id=self.trace_id,
            model=model,
            use_file_search=use_file_search,
            approx_size=approx_size,
            assessment_item_id=str(assessment_item_id),
        )
        
        # 6. Chamar OpenAI
        ai_start = time.time()
        
        if use_file_search:
            ai_result = await self._call_with_file_search(
                input_file_node, system_prompt, user_prompt, response_format, model
            )
            method_used = "file_search"
        else:
            ai_result = await self._call_direct(
                input_file_node, system_prompt, user_prompt, response_format, model
            )
            method_used = "direct"
        
        ai_duration = int((time.time() - ai_start) * 1000)
        
            # 7. Processar resposta
            assessment_result = json.loads(ai_result["output_text"])

            # === PHASE 2: Create Suggestion (not final assessment) ===
            # 8. Create AI suggestion for review
            suggestion = AISuggestion(
                run_id=run.id,
                instance_id=None,  # Not used for assessments
                field_id=None,  # Not used for assessments
                assessment_item_id=assessment_item_id,  # NEW: For assessments
                suggested_value={
                    "level": assessment_result.get("selected_level"),
                    "evidence_passages": assessment_result.get("evidence_passages"),
                },
                confidence_score=assessment_result.get("confidence_score"),
                reasoning=assessment_result.get("justification"),
                status="pending",
                metadata_={
                    "trace_id": self.trace_id,
                    "ai_model_used": model,
                    "processing_time_ms": ai_duration,
                    "method_used": method_used,
                    "prompt_tokens": ai_result.get("input_tokens"),
                    "completion_tokens": ai_result.get("output_tokens"),
                    "extraction_instance_id": str(extraction_instance_id) if extraction_instance_id else None,
                },
            )

            saved_suggestion = await self._suggestions.create(suggestion)

            # === PHASE 2: Complete run with results ===
            total_duration = int((time.time() - start_time) * 1000)

            await self._runs.complete_run(
                run.id,
                results={
                    "suggestion_id": str(saved_suggestion.id),
                    "selected_level": assessment_result.get("selected_level"),
                    "tokens_prompt": ai_result.get("input_tokens") or 0,
                    "tokens_completion": ai_result.get("output_tokens") or 0,
                    "tokens_total": (ai_result.get("input_tokens") or 0) + (ai_result.get("output_tokens") or 0),
                    "ai_duration_ms": ai_duration,
                    "total_duration_ms": total_duration,
                    "method_used": method_used,
                },
            )

            self.logger.info(
                "ai_assessment_suggestion_created",
                trace_id=self.trace_id,
                run_id=str(run.id),
                suggestion_id=str(saved_suggestion.id),
                method_used=method_used,
                ai_duration_ms=ai_duration,
                total_duration_ms=total_duration,
                tokens_total=(ai_result.get("input_tokens") or 0) + (ai_result.get("output_tokens") or 0),
            )

            return AssessmentResult(
                assessment_id=str(saved_suggestion.id),  # Now returns suggestion_id
                selected_level=assessment_result.get("selected_level") or "",
                confidence_score=assessment_result.get("confidence_score") or 0.0,
                justification=assessment_result.get("justification") or "",
                evidence_passages=assessment_result.get("evidence_passages") or [],
                tokens_prompt=ai_result.get("input_tokens") or 0,
                tokens_completion=ai_result.get("output_tokens") or 0,
                processing_time_ms=ai_duration,
                method_used=method_used,
            )

        except Exception as e:
            # === PHASE 2: Fail run on error ===
            await self._runs.fail_run(run.id, str(e))

            self.logger.error(
                "ai_assessment_failed",
                trace_id=self.trace_id,
                run_id=str(run.id),
                error=str(e),
                exc_info=True,
            )

            raise
    
    async def assess_batch(
        self,
        project_id: UUID,
        article_id: UUID,
        item_ids: list[UUID],
        instrument_id: UUID,
        model: str = "gpt-4o-mini",
        extraction_instance_id: UUID | None = None,
    ) -> list[AssessmentResult]:
        """
        Executa avaliação AI em batch para múltiplos itens.

        Otimiza processamento ao reutilizar PDF e construir contexto de memória.
        Segue o padrão do extraction module.

        Args:
            project_id: ID do projeto.
            article_id: ID do artigo.
            item_ids: Lista de IDs dos itens de assessment.
            instrument_id: ID do instrumento.
            model: Modelo OpenAI a usar.
            extraction_instance_id: ID da extraction instance (para PROBAST por modelo).

        Returns:
            Lista de AssessmentResult para cada item.
        """
        start_time = time.time()

        # === PHASE 2: Create batch run ===
        run = await self._runs.create_run(
            project_id=project_id,
            article_id=article_id,
            instrument_id=instrument_id,
            extraction_instance_id=extraction_instance_id,
            created_by=UUID(self.user_id),
            stage="assess_batch",
            parameters={
                "item_ids": [str(item_id) for item_id in item_ids],
                "model": model,
                "items_count": len(item_ids),
            },
        )

        await self._runs.start_run(run.id)

        try:
            # 1. Fetch article and file ONCE
            article = await self._articles.get_by_id(article_id)
            if not article:
                raise ValueError(f"Article {article_id} not found")

            article_file = await self._article_files.get_main_file(article_id)
            if not article_file:
                raise ValueError(f"No PDF file for article {article_id}")

            # 2. Download PDF ONCE and prepare file node
            storage_key = article_file.storage_key
            pdf_bytes = await self.storage.download("articles", storage_key)
            data_url = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode()}"

            input_file_node = {
                "type": "input_file",
                "file_data": data_url,
                "filename": storage_key.split("/")[-1] or "article.pdf",
            }
            approx_size = len(pdf_bytes)

            # 3. Choose strategy based on size
            use_file_search = approx_size > 10 * 1024 * 1024  # > 10MB

            # 4. Fetch all items ONCE
            items_by_id = {}
            for item_id in item_ids:
                item = await self._items.get_by_id(item_id)
                if item:
                    items_by_id[item_id] = item

            # 5. Build memory context (like extraction module)
            memory_context: list[dict[str, str]] = []

            results: list[AssessmentResult] = []
            total_tokens_prompt = 0
            total_tokens_completion = 0
            total_ai_duration = 0

            # 6. Process each item with memory context
            for idx, item_id in enumerate(item_ids):
                item = items_by_id.get(item_id)
                if not item:
                    self.logger.warning(
                        "batch_assessment_item_not_found",
                        trace_id=self.trace_id,
                        run_id=str(run.id),
                        item_id=str(item_id),
                    )
                    continue

                try:
                    # Build prompts
                    project_data = {"id": str(project_id)}
                    allowed_levels = self._parse_allowed_levels(item.allowed_levels)

                    system_prompt = self._build_system_prompt(item, project_data)
                    user_prompt = self._build_user_prompt(
                        item, project_data, allowed_levels, memory_context
                    )

                    response_format = {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "assessment_response",
                            "strict": True,
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "selected_level": {"type": "string"},
                                    "confidence_score": {"type": "number"},
                                    "justification": {"type": "string"},
                                    "evidence_passages": {"type": "array", "items": {"type": "string"}},
                                },
                                "required": ["selected_level", "confidence_score", "justification", "evidence_passages"],
                                "additionalProperties": False,
                            },
                        },
                    }

                    # Call OpenAI
                    ai_start = time.time()

                    if use_file_search:
                        ai_result = await self._call_with_file_search(
                            input_file_node, system_prompt, user_prompt, response_format, model
                        )
                        method_used = "file_search"
                    else:
                        ai_result = await self._call_direct(
                            input_file_node, system_prompt, user_prompt, response_format, model
                        )
                        method_used = "direct"

                    ai_duration = int((time.time() - ai_start) * 1000)
                    total_ai_duration += ai_duration

                    # Parse response
                    assessment_result = json.loads(ai_result["output_text"])

                    # Update memory context with previous assessment
                    memory_context.append({
                        "item_code": item.item_code,
                        "question": item.question,
                        "selected_level": assessment_result.get("selected_level", ""),
                        "justification": assessment_result.get("justification", ""),
                    })

                    # Keep only last 3 assessments in memory (optimization)
                    if len(memory_context) > 3:
                        memory_context.pop(0)

                    # Create suggestion
                    suggestion = AISuggestion(
                        run_id=run.id,
                        instance_id=None,
                        field_id=None,
                        assessment_item_id=item_id,
                        suggested_value={
                            "level": assessment_result.get("selected_level"),
                            "evidence_passages": assessment_result.get("evidence_passages"),
                        },
                        confidence_score=assessment_result.get("confidence_score"),
                        reasoning=assessment_result.get("justification"),
                        status="pending",
                        metadata_={
                            "trace_id": self.trace_id,
                            "ai_model_used": model,
                            "processing_time_ms": ai_duration,
                            "method_used": method_used,
                            "prompt_tokens": ai_result.get("input_tokens"),
                            "completion_tokens": ai_result.get("output_tokens"),
                            "batch_index": idx,
                            "extraction_instance_id": str(extraction_instance_id) if extraction_instance_id else None,
                        },
                    )

                    saved_suggestion = await self._suggestions.create(suggestion)

                    # Track tokens
                    total_tokens_prompt += ai_result.get("input_tokens") or 0
                    total_tokens_completion += ai_result.get("output_tokens") or 0

                    # Build result
                    result = AssessmentResult(
                        assessment_id=str(saved_suggestion.id),
                        selected_level=assessment_result.get("selected_level") or "",
                        confidence_score=assessment_result.get("confidence_score") or 0.0,
                        justification=assessment_result.get("justification") or "",
                        evidence_passages=assessment_result.get("evidence_passages") or [],
                        tokens_prompt=ai_result.get("input_tokens") or 0,
                        tokens_completion=ai_result.get("output_tokens") or 0,
                        processing_time_ms=ai_duration,
                        method_used=method_used,
                    )

                    results.append(result)

                    self.logger.info(
                        "batch_assessment_item_completed",
                        trace_id=self.trace_id,
                        run_id=str(run.id),
                        suggestion_id=str(saved_suggestion.id),
                        item_id=str(item_id),
                        batch_index=idx,
                        ai_duration_ms=ai_duration,
                    )

                except Exception as e:
                    self.logger.error(
                        "batch_assessment_item_failed",
                        trace_id=self.trace_id,
                        run_id=str(run.id),
                        item_id=str(item_id),
                        batch_index=idx,
                        error=str(e),
                        exc_info=True,
                    )
                    # Continue with next items

            # === PHASE 2: Complete batch run ===
            total_duration = int((time.time() - start_time) * 1000)

            await self._runs.complete_run(
                run.id,
                results={
                    "items_count": len(item_ids),
                    "items_completed": len(results),
                    "items_failed": len(item_ids) - len(results),
                    "suggestion_ids": [r.assessment_id for r in results],
                    "tokens_prompt": total_tokens_prompt,
                    "tokens_completion": total_tokens_completion,
                    "tokens_total": total_tokens_prompt + total_tokens_completion,
                    "ai_duration_ms": total_ai_duration,
                    "total_duration_ms": total_duration,
                    "method_used": method_used,
                },
            )

            self.logger.info(
                "batch_assessment_completed",
                trace_id=self.trace_id,
                run_id=str(run.id),
                items_count=len(item_ids),
                items_completed=len(results),
                items_failed=len(item_ids) - len(results),
                total_duration_ms=total_duration,
                tokens_total=total_tokens_prompt + total_tokens_completion,
            )

            return results

        except Exception as e:
            # === PHASE 2: Fail batch run on error ===
            await self._runs.fail_run(run.id, str(e))

            self.logger.error(
                "batch_assessment_failed",
                trace_id=self.trace_id,
                run_id=str(run.id),
                error=str(e),
                exc_info=True,
            )

            raise
    
    def _parse_allowed_levels(self, allowed_levels: Any) -> list[str]:
        """Parse allowed_levels de string ou lista."""
        if not allowed_levels:
            return []
        
        if isinstance(allowed_levels, list):
            return allowed_levels
        
        if isinstance(allowed_levels, str):
            try:
                return json.loads(allowed_levels)
            except Exception:
                return []
        
        return []
    
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
            data_url = f"data:application/pdf;base64,{pdf_base64}"
            size = len(base64.b64decode(pdf_base64))
            return {
                "type": "input_file",
                "file_data": data_url,
                "filename": pdf_filename or "article.pdf",
            }, size
        
        if storage_key:
            # Download via Storage Adapter
            pdf_bytes = await self.storage.download("articles", storage_key)
            data_url = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode()}"
            
            return {
                "type": "input_file",
                "file_data": data_url,
                "filename": storage_key.split("/")[-1] or "article.pdf",
            }, len(pdf_bytes)
        
        raise ValueError("No PDF source provided")
    
    def _build_system_prompt(
        self,
        item: Any,
        project: dict[str, Any],
    ) -> str:
        """
        Constrói prompt do sistema customizado por instrumento.
        
        Prompts diferenciados para diferentes tipos de instrumentos
        (PROBAST, QUADAS-2, ROB-2, etc.).
        """
        # Detectar instrumento pelo nome do item ou projeto
        instrument_name = getattr(item, 'instrument_name', None) or ""
        
        base_prompt = (
            "You are an expert research quality assessor with deep knowledge of "
            "systematic review methodology and risk of bias assessment."
        )
        
        # Customizar por instrumento
        if "PROBAST" in instrument_name.upper():
            return f"{base_prompt} You are specifically trained in PROBAST (Prediction model Risk Of Bias Assessment Tool) for evaluating prediction model studies. Focus on model development, validation, and applicability."
        
        if "QUADAS" in instrument_name.upper():
            return f"{base_prompt} You are specifically trained in QUADAS-2 for evaluating diagnostic accuracy studies. Focus on patient selection, index test, reference standard, and flow/timing."
        
        if "ROB" in instrument_name.upper() or "COCHRANE" in instrument_name.upper():
            return f"{base_prompt} You are specifically trained in ROB-2 (Risk of Bias 2) for evaluating randomized controlled trials. Focus on randomization, deviations, missing data, measurement, and selective reporting."
        
        # Prompt genérico
        return (
            f"{base_prompt} Read the PDF and answer the specific question based on "
            "the evidence found. Quote page numbers when possible."
        )
    
    def _build_user_prompt(
        self,
        item: Any,
        project: dict[str, Any],
        allowed_levels: list[str],
        memory_context: list[dict[str, str]] | None = None,
    ) -> str:
        """
        Constrói prompt do usuário com contexto.

        Args:
            item: Assessment item com question/guidance.
            project: Dados do projeto (review_title, etc.).
            allowed_levels: Lista de níveis permitidos para resposta.
            memory_context: Contexto de assessments anteriores (para batch).

        Returns:
            User prompt completo.
        """
        levels_str = ", ".join(allowed_levels) if allowed_levels else "N/A"

        question = item.question if hasattr(item, 'question') else ""
        guidance = item.guidance if hasattr(item, 'guidance') else ""

        prompt = f"""Based on the article PDF, assess the following question:

Question: {question}
"""

        if guidance:
            prompt += f"""
Guidance: {guidance}
"""

        prompt += f"""
Available response levels: {levels_str}

Context:
- Review title: {project.get('review_title', '')}
- Condition studied: {project.get('condition_studied', '')}
"""

        # Add memory context if available (for batch processing)
        if memory_context:
            prompt += f"""
Previous assessments for context:
"""
            for prev in memory_context:
                prompt += f"""
- {prev['item_code']}: {prev['selected_level']}
  Reason: {prev['justification'][:100]}...
"""

        prompt += f"""
Instructions:
1. Read the entire PDF carefully
2. Identify relevant passages that address the question
3. Select the most appropriate response level
4. Provide a clear justification with evidence

Return STRICT JSON with:
- selected_level: Your choice from the available levels
- confidence_score: 0.0 to 1.0 indicating your confidence
- justification: Brief explanation of your assessment
- evidence_passages: Array of {{ text, page_number }} with supporting evidence
"""

        return prompt
    
    def _build_response_schema(self, allowed_levels: list[str]) -> dict[str, Any]:
        """Constrói schema de resposta para OpenAI."""
        # Se não há níveis definidos, usar string livre
        level_schema: dict[str, Any]
        if allowed_levels:
            level_schema = {"type": "string", "enum": allowed_levels}
        else:
            level_schema = {"type": "string"}
        
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "assessment_result",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "selected_level": level_schema,
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
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": [
                        "selected_level",
                        "confidence_score",
                        "justification",
                        "evidence_passages",
                    ],
                    "additionalProperties": False,
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
        """Chama OpenAI com input_file direto via Responses API."""
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
                    "Authorization": f"Bearer {self.openai_api_key}",  # BYOK support
                    "Content-Type": "application/json",
                },
                timeout=120.0,
            )
            
            if not response.is_success:
                self.logger.error(
                    "openai_responses_error",
                    trace_id=self.trace_id,
                    status=response.status_code,
                    error=response.text[:500],
                )
                raise ValueError(f"OpenAI error: {response.status_code} - {response.text[:500]}")
            
            result = response.json()
            
            # Extrair output_text
            output_text = None
            for output_item in result.get("output", []):
                if output_item.get("type") == "message":
                    for content in output_item.get("content", []):
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
        """
        Chama OpenAI usando File Search com Vector Store.
        
        Este método:
        1. Faz upload do arquivo para OpenAI Files API
        2. Cria um Vector Store temporário
        3. Executa a query com file_search tool
        4. Limpa recursos após uso
        """
        # Por enquanto, implementar fallback para chamada direta
        # TODO: Implementar upload para OpenAI Files API + Vector Store completo
        
        self.logger.warning(
            "file_search_falling_back_to_direct",
            trace_id=self.trace_id,
            message="File Search not fully implemented, using direct call",
        )
        
        # Tentar chamada direta mesmo para arquivos grandes
        # Pode falhar, mas permite testar o fluxo
        try:
            return await self._call_direct(
                input_file_node, system_prompt, user_prompt, response_format, model
            )
        except Exception as e:
            self.logger.error(
                "direct_call_failed_large_file",
                trace_id=self.trace_id,
                error=str(e),
                suggestion="Consider implementing full File Search with Vector Store",
            )
            raise ValueError(
                f"File too large for direct processing. File Search not yet implemented. Error: {e}"
            )
    
    def to_dict(self, result: AssessmentResult) -> dict[str, Any]:
        """
        Converte resultado para dict compatível com resposta do endpoint.
        
        Mantém formato compatível com a Edge Function original.
        """
        return {
            "id": result.assessment_id,
            "selectedLevel": result.selected_level,
            "confidenceScore": result.confidence_score,
            "justification": result.justification,
            "evidencePassages": result.evidence_passages,
            "status": "pending_review",
            "metadata": {
                "processingTimeMs": result.processing_time_ms,
                "tokensPrompt": result.tokens_prompt,
                "tokensCompletion": result.tokens_completion,
                "methodUsed": result.method_used,
            },
        }
