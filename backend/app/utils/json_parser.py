"""
JSON Parser Robusto.

Utilitários para parsing de JSON com tratamento robusto de erros,
validação de schema e logging estruturado.
"""

import json
import re
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


class JSONParseError(Exception):
    """Erro específico de parsing JSON."""

    def __init__(self, message: str, original_content: str | None = None):
        super().__init__(message)
        self.original_content = original_content


def _extract_json_from_markdown(content: str) -> str:
    """
    Extrai JSON de blocos markdown ou texto misto.
    
    A OpenAI às vezes retorna JSON dentro de blocos ```json```.
    
    Args:
        content: String que pode conter JSON puro ou em markdown.
        
    Returns:
        String com apenas o JSON.
    """
    # Remove blocos markdown ```json ... ```
    json_block_pattern = r"```(?:json)?\s*([\s\S]*?)\s*```"
    match = re.search(json_block_pattern, content)
    if match:
        return match.group(1).strip()
    
    # Tenta encontrar JSON inline (começa com { ou [)
    content = content.strip()
    if content.startswith("{") or content.startswith("["):
        return content
    
    # Busca primeiro { ou [ no texto
    json_start = -1
    for i, char in enumerate(content):
        if char in "{[":
            json_start = i
            break
    
    if json_start >= 0:
        return content[json_start:]
    
    return content


def parse_json_safe(
    content: str,
    expected_keys: list[str] | None = None,
    trace_id: str | None = None,
    default: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Parse JSON de forma segura com validação e logging.
    
    Tenta extrair JSON de múltiplos formatos (puro, markdown)
    e valida a presença de chaves esperadas.
    
    Args:
        content: String contendo JSON.
        expected_keys: Lista de chaves que devem estar presentes.
        trace_id: ID de trace para logging.
        default: Valor default se parsing falhar (None levanta exceção).
        
    Returns:
        Dicionário parseado.
        
    Raises:
        JSONParseError: Se parsing falhar e default não for fornecido.
    """
    if not content or not content.strip():
        if default is not None:
            logger.warning(
                "JSON vazio recebido, usando default",
                trace_id=trace_id,
            )
            return default
        raise JSONParseError("Conteúdo JSON vazio", original_content=content)
    
    # Extrai JSON de possíveis wrappers
    cleaned = _extract_json_from_markdown(content)
    
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(
            "Falha ao parsear JSON",
            error=str(e),
            content_preview=content[:200] if content else None,
            trace_id=trace_id,
        )
        if default is not None:
            return default
        raise JSONParseError(
            f"JSON inválido: {e}",
            original_content=content,
        ) from e
    
    # Garante que é um dict
    if not isinstance(result, dict):
        logger.warning(
            "JSON parseado não é um dicionário",
            type=type(result).__name__,
            trace_id=trace_id,
        )
        # Se for lista, tenta wrappear
        if isinstance(result, list):
            result = {"items": result}
        elif default is not None:
            return default
        else:
            raise JSONParseError(
                f"JSON esperado como objeto, recebido {type(result).__name__}",
                original_content=content,
            )
    
    # Valida chaves esperadas
    if expected_keys:
        missing = [k for k in expected_keys if k not in result]
        if missing:
            logger.warning(
                "JSON faltando chaves esperadas",
                missing_keys=missing,
                available_keys=list(result.keys()),
                trace_id=trace_id,
            )
    
    return result


def parse_json_array_safe(
    content: str,
    trace_id: str | None = None,
    default: list[Any] | None = None,
) -> list[Any]:
    """
    Parse JSON array de forma segura.
    
    Útil quando se espera uma lista diretamente da resposta.
    
    Args:
        content: String contendo JSON array.
        trace_id: ID de trace para logging.
        default: Valor default se parsing falhar (None levanta exceção).
        
    Returns:
        Lista parseada.
        
    Raises:
        JSONParseError: Se parsing falhar e default não for fornecido.
    """
    if not content or not content.strip():
        if default is not None:
            return default
        raise JSONParseError("Conteúdo JSON vazio", original_content=content)
    
    cleaned = _extract_json_from_markdown(content)
    
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(
            "Falha ao parsear JSON array",
            error=str(e),
            content_preview=content[:200] if content else None,
            trace_id=trace_id,
        )
        if default is not None:
            return default
        raise JSONParseError(
            f"JSON inválido: {e}",
            original_content=content,
        ) from e
    
    # Se for dict com items, extrai
    if isinstance(result, dict):
        if "items" in result:
            result = result["items"]
        elif "models" in result:
            result = result["models"]
        elif "data" in result:
            result = result["data"]
        else:
            # Tenta primeiro valor que seja lista
            for value in result.values():
                if isinstance(value, list):
                    result = value
                    break
    
    if not isinstance(result, list):
        logger.warning(
            "JSON parseado não é uma lista",
            type=type(result).__name__,
            trace_id=trace_id,
        )
        if default is not None:
            return default
        raise JSONParseError(
            f"JSON esperado como array, recebido {type(result).__name__}",
            original_content=content,
        )
    
    return result


def extract_models_from_response(
    content: str,
    trace_id: str | None = None,
) -> list[dict[str, Any]]:
    """
    Extrai lista de modelos de resposta OpenAI.
    
    Trata múltiplos formatos de resposta:
    - Array direto: [{"name": ...}, ...]
    - Objeto com models: {"models": [...]}
    - Objeto com data: {"data": [...]}
    
    Args:
        content: Resposta da OpenAI.
        trace_id: ID de trace para logging.
        
    Returns:
        Lista de modelos extraídos.
    """
    try:
        result = parse_json_array_safe(content, trace_id=trace_id, default=[])
        return result
    except JSONParseError:
        logger.error(
            "Falha ao extrair modelos da resposta",
            content_preview=content[:200] if content else None,
            trace_id=trace_id,
        )
        return []

