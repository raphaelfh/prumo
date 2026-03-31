"""
Response Formatter.

Utilitarios for formatacao de respostas da API,
incluindo conversao entre snake_case and camelCase.
"""

import re
from typing import Any


def to_camel_case(snake_str: str) -> str:
    """
    Converte string de snake_case for camelCase.

    Args:
        snake_str: String em snake_case.

    Returns:
        String em camelCase.

    Exemplo:
        >>> to_camel_case("entity_type_id")
        "entityTypeId"
    """
    components = snake_str.split("_")
    return components[0] + "".join(x.title() for x in components[1:])


def to_snake_case(camel_str: str) -> str:
    """
    Converte string de camelCase for snake_case.

    Args:
        camel_str: String em camelCase.

    Returns:
        String em snake_case.

    Exemplo:
        >>> to_snake_case("entityTypeId")
        "entity_type_id"
    """
    return re.sub(r"(?<!^)(?=[A-Z])", "_", camel_str).lower()


def dict_to_camel_case(data: dict[str, Any]) -> dict[str, Any]:
    """
    Converte keys de dict de snake_case for camelCase.

    Processa recursivamente dicts and listas aninhados.

    Args:
        data: Dicionario with keys em snake_case.

    Returns:
        Dicionario with keys em camelCase.
    """
    result: dict[str, Any] = {}
    for key, value in data.items():
        camel_key = to_camel_case(key)
        if isinstance(value, dict):
            result[camel_key] = dict_to_camel_case(value)
        elif isinstance(value, list):
            result[camel_key] = [
                dict_to_camel_case(item) if isinstance(item, dict) else item for item in value
            ]
        else:
            result[camel_key] = value
    return result


def dict_to_snake_case(data: dict[str, Any]) -> dict[str, Any]:
    """
    Converte keys de dict de camelCase for snake_case.

    Processa recursivamente dicts and listas aninhados.

    Args:
        data: Dicionario with keys em camelCase.

    Returns:
        Dicionario with keys em snake_case.
    """
    result: dict[str, Any] = {}
    for key, value in data.items():
        snake_key = to_snake_case(key)
        if isinstance(value, dict):
            result[snake_key] = dict_to_snake_case(value)
        elif isinstance(value, list):
            result[snake_key] = [
                dict_to_snake_case(item) if isinstance(item, dict) else item for item in value
            ]
        else:
            result[snake_key] = value
    return result


def format_extraction_response(
    created_count: int,
    suggestions: list[dict[str, Any]] | None = None,
    models: list[dict[str, Any]] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    """
    Formata resposta padrao de extraction.

    Create uma resposta consistente for endpoints de extraction
    with conversao automatica for camelCase.

    Args:
        created_count: Numero de itens criados.
        suggestions: List de suggestions criadas.
        models: List de modelos extraidos.
        error: Error message, if any.

    Returns:
        Resposta formatada em camelCase.
    """
    response: dict[str, Any] = {
        "created_count": created_count,
    }

    if suggestions is not None:
        response["suggestions"] = [
            dict_to_camel_case(s) if isinstance(s, dict) else s for s in suggestions
        ]

    if models is not None:
        response["models"] = [dict_to_camel_case(m) if isinstance(m, dict) else m for m in models]

    if error is not None:
        response["error"] = error

    return dict_to_camel_case(response)


def format_model_extraction_response(
    models_count: int,
    models: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Formata resposta de extraction de modelos.

    Args:
        models_count: Numero de modelos extraidos.
        models: List de modelos.

    Returns:
        Resposta formatada.
    """
    return {
        "modelsCount": models_count,
        "models": [dict_to_camel_case(m) if isinstance(m, dict) else m for m in models],
    }


def format_section_extraction_response(
    created_count: int,
    suggestions: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Formata resposta de extraction de sections.

    Args:
        created_count: Numero de suggestions criadas.
        suggestions: List de suggestions.

    Returns:
        Resposta formatada.
    """
    return {
        "createdCount": created_count,
        "suggestions": [dict_to_camel_case(s) if isinstance(s, dict) else s for s in suggestions],
    }
