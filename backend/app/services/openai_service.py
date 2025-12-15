# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
OpenAI Service.

Wrapper para chamadas à API da OpenAI.
"""

import time
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.core.logging import LoggerMixin


class OpenAIService(LoggerMixin):
    """
    Service para interação com OpenAI API.
    
    Inclui retry automático e logging estruturado.
    """
    
    def __init__(self, trace_id: str | None = None):
        self.trace_id = trace_id
        self.base_url = "https://api.openai.com/v1"
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "gpt-4o-mini",
        response_format: dict[str, Any] | None = None,
        temperature: float = 0.1,
        max_tokens: int | None = None,
    ) -> str:
        """
        Executa chat completion.
        
        Args:
            messages: Lista de mensagens.
            model: Modelo a usar.
            response_format: Formato de resposta (json_object, etc).
            temperature: Temperatura para geração.
            max_tokens: Limite de tokens.
            
        Returns:
            Texto da resposta.
        """
        start_time = time.time()
        
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        
        if response_format:
            payload["response_format"] = response_format
        
        if max_tokens:
            payload["max_tokens"] = max_tokens
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                timeout=120.0,
            )
            
            duration = (time.time() - start_time) * 1000
            
            if not response.is_success:
                self.logger.error(
                    "openai_error",
                    trace_id=self.trace_id,
                    status=response.status_code,
                    error=response.text[:500],
                )
                raise ValueError(f"OpenAI error: {response.status_code}")
            
            result = response.json()
            
            usage = result.get("usage", {})
            self.logger.info(
                "openai_completion",
                trace_id=self.trace_id,
                model=model,
                duration_ms=duration,
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
            )
            
            return result["choices"][0]["message"]["content"]
    
    async def embeddings(
        self,
        texts: list[str],
        model: str = "text-embedding-3-small",
    ) -> list[list[float]]:
        """
        Gera embeddings para textos.
        
        Args:
            texts: Lista de textos.
            model: Modelo de embedding.
            
        Returns:
            Lista de vetores de embedding.
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                json={
                    "model": model,
                    "input": texts,
                },
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                timeout=60.0,
            )
            
            if not response.is_success:
                raise ValueError(f"OpenAI embeddings error: {response.status_code}")
            
            result = response.json()
            
            return [item["embedding"] for item in result["data"]]

