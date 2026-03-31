"""
OpenAI Service.

Comprehensive wrapper for OpenAI API calls with support for:
- Chat completions with JSON mode
- Structured outputs (json_schema)
- Responses API for PDFs
- Embeddings
- Retry with exponential backoff
- Token tracking
"""

import base64
import json
import time
from typing import Any, TypeVar

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

T = TypeVar("T", bound=BaseModel)


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
        self._using_user_key = api_key is not None

    @property
    def api_key(self) -> str:
        """Return API key (custom or global)."""
        if self._api_key:
            return self._api_key
        return settings.OPENAI_API_KEY

    @property
    def is_using_user_key(self) -> bool:
        """Indicates whether user key (BYOK) is active."""
        return self._using_user_key

    def set_api_key(self, api_key: str | None) -> None:
        """
        Set dynamic API key.

        Invalidate HTTP client so the new key is used.

        Args:
            api_key: New API key or None to use global key.
        """
        self._api_key = api_key
        self._using_user_key = api_key is not None
        # Invalidate client to use new key
        if self._client and not self._client.is_closed:
            # Do not close here to avoid async edge cases
            # Client is recreated on next request
            self._client = None

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
            duration_ms=duration,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
        )

        choice = result["choices"][0]
        return OpenAIResponse(
            content=choice["message"]["content"],
            usage=usage,
            model=result.get("model", model),
            finish_reason=choice.get("finish_reason", "stop"),
            duration_ms=duration,
        )

    async def chat_completion_structured(
        self,
        messages: list[dict[str, Any]],
        response_model: type[T],
        model: str = "gpt-4o-mini",
        temperature: float = 0.1,
        max_tokens: int | None = None,
    ) -> T:
        """
        Execute chat completion with Pydantic-structured response.

        Uses json_schema to enforce output format.

        Args:
            messages: Message list.
            response_model: Pydantic model for response validation.
            model: OpenAI model.
            temperature: Sampling temperature.
            max_tokens: Token limit.

        Returns:
            Pydantic model instance.
        """
        # Generate JSON schema from Pydantic model
        schema = response_model.model_json_schema()

        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": response_model.__name__,
                "strict": True,
                "schema": schema,
            },
        }

        content = await self.chat_completion(
            messages=messages,
            model=model,
            response_format=response_format,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # Parse and validate with Pydantic
        data = json.loads(content)
        return response_model.model_validate(data)

    async def responses_api_with_pdf(
        self,
        pdf_data: bytes | str,
        system_prompt: str,
        user_prompt: str,
        response_format: dict[str, Any] | None = None,
        model: str = "gpt-4o-mini",
        filename: str = "document.pdf",
    ) -> dict[str, Any]:
        """
        Use Responses API to analyze PDF directly.

        Args:
            pdf_data: PDF bytes or base64 string.
            system_prompt: System prompt.
            user_prompt: User prompt.
            response_format: Structured response format.
            model: Model to use.
            filename: File name.

        Returns:
            Dict with output_text, input_tokens, and output_tokens.
        """
        start_time = time.time()

        # Convert to base64 if needed
        if isinstance(pdf_data, bytes):
            pdf_base64 = base64.b64encode(pdf_data).decode()
        else:
            pdf_base64 = pdf_data

        data_url = f"data:application/pdf;base64,{pdf_base64}"

        payload: dict[str, Any] = {
            "model": model,
            "input": [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": system_prompt}],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_file",
                            "file_data": data_url,
                            "filename": filename,
                        },
                        {"type": "input_text", "text": user_prompt},
                    ],
                },
            ],
        }

        if response_format:
            payload["text"] = {"format": response_format}

        client = await self._get_client()
        response = await client.post(
            f"{self.base_url}/responses",
            json=payload,
        )

        duration = (time.time() - start_time) * 1000

        if not response.is_success:
            error_text = response.text[:500]
            self.logger.error(
                "openai_responses_error",
                trace_id=self.trace_id,
                status=response.status_code,
                error=error_text,
            )
            raise ValueError(f"OpenAI Responses API error: {response.status_code}")

        result = response.json()

        # Extract output_text
        output_text = None
        for item in result.get("output", []):
            if item.get("type") == "message":
                for content in item.get("content", []):
                    if content.get("type") == "output_text":
                        output_text = content.get("text")
                        break

        usage = result.get("usage", {})

        self.logger.info(
            "openai_responses_completion",
            trace_id=self.trace_id,
            model=model,
            duration_ms=duration,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
        )

        return {
            "output_text": output_text,
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
            "duration_ms": duration,
        }

    async def embeddings(
        self,
        texts: list[str],
        model: str = "text-embedding-3-small",
    ) -> list[list[float]]:
        """
        Generate embeddings for texts.

        Args:
            texts: Text list.
            model: Embedding model.

        Returns:
            List of embedding vectors.
        """
        client = await self._get_client()
        response = await client.post(
            f"{self.base_url}/embeddings",
            json={
                "model": model,
                "input": texts,
            },
        )

        if not response.is_success:
            raise ValueError(f"OpenAI embeddings error: {response.status_code}")

        result = response.json()

        return [item["embedding"] for item in result["data"]]

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
