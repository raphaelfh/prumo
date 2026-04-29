"""
OpenAI Service.

Wrapper for OpenAI API calls with support for:
- Chat completions with JSON mode
- Structured outputs (json_schema)
- Retry with exponential backoff
- Token tracking
"""

import time
from typing import Any

import httpx
from pydantic import BaseModel
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.logging import LoggerMixin


class OpenAIUsage(BaseModel):
    """API token usage."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class OpenAIResponse(BaseModel):
    """Structured OpenAI response."""

    content: str
    usage: OpenAIUsage
    model: str
    finish_reason: str = "stop"
    duration_ms: float = 0


class OpenAIService(LoggerMixin):
    """
    Service for OpenAI API interactions.

    Includes automatic retry, structured outputs, and structured logging.
    Supports dynamic API key (BYOK) with global-key fallback.
    """

    def __init__(
        self,
        trace_id: str | None = None,
        api_key: str | None = None,
    ):
        """
        Initialize the service.

        Args:
            trace_id: Trace ID for logs.
            api_key: Custom API key (BYOK). If None, uses global key.
        """
        self.trace_id = trace_id
        self.base_url = "https://api.openai.com/v1"
        self._api_key = api_key
        self._client: httpx.AsyncClient | None = None

    @property
    def api_key(self) -> str:
        """Return API key (custom or global)."""
        if self._api_key:
            return self._api_key
        return settings.OPENAI_API_KEY

    async def _get_client(self) -> httpx.AsyncClient:
        """Return reusable HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(120.0, connect=10.0),
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def close(self) -> None:
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def chat_completion(
        self,
        messages: list[dict[str, Any]],
        model: str = "gpt-4o-mini",
        response_format: dict[str, Any] | None = None,
        temperature: float = 0.1,
        max_tokens: int | None = None,
    ) -> str:
        """
        Execute chat completion.

        Args:
            messages: Message list.
            model: Model to use.
            response_format: Response format (json_object or json_schema).
            temperature: Generation temperature.
            max_tokens: Token limit.

        Returns:
            Response text.
        """
        response = await self.chat_completion_full(
            messages=messages,
            model=model,
            response_format=response_format,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.content

    async def chat_completion_full(
        self,
        messages: list[dict[str, Any]],
        model: str = "gpt-4o-mini",
        response_format: dict[str, Any] | None = None,
        temperature: float = 0.1,
        max_tokens: int | None = None,
    ) -> OpenAIResponse:
        """
        Execute chat completion with full metadata.

        Returns object with content, usage, and metadata.
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

        client = await self._get_client()
        response = await client.post(
            f"{self.base_url}/chat/completions",
            json=payload,
        )

        duration = (time.time() - start_time) * 1000

        if not response.is_success:
            error_text = response.text[:500]
            self.logger.error(
                "openai_error",
                trace_id=self.trace_id,
                status=response.status_code,
                error=error_text,
                duration_ms=duration,
                model=model,
            )
            raise ValueError(f"OpenAI error: {response.status_code} - {error_text}")

        result = response.json()
        usage_data = result.get("usage", {})

        usage = OpenAIUsage(
            prompt_tokens=usage_data.get("prompt_tokens", 0),
            completion_tokens=usage_data.get("completion_tokens", 0),
            total_tokens=usage_data.get("total_tokens", 0),
        )

        self.logger.info(
            "openai_completion",
            trace_id=self.trace_id,
            model=model,
            status_code=response.status_code,
            duration_ms=duration,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            total_tokens=usage.total_tokens,
        )

        choice = result["choices"][0]
        return OpenAIResponse(
            content=choice["message"]["content"],
            usage=usage,
            model=result.get("model", model),
            finish_reason=choice.get("finish_reason", "stop"),
            duration_ms=duration,
        )

    def build_json_schema_format(
        self,
        schema: dict[str, Any],
        name: str = "response",
        strict: bool = True,
    ) -> dict[str, Any]:
        """
        Build json_schema payload for response_format.

        Args:
            schema: JSON schema for properties.
            name: Schema name.
            strict: Whether to enforce strict mode.

        Returns:
            Dict to use as response_format.
        """
        return {
            "type": "json_schema",
            "json_schema": {
                "name": name,
                "strict": strict,
                "schema": schema,
            },
        }
