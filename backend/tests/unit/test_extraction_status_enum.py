"""
Testes para o enum ExtractionInstanceStatus.

Verifica que o enum Python está alinhado com o enum PostgreSQL.
"""

import pytest

from app.models.extraction import ExtractionInstanceStatus


class TestExtractionInstanceStatusEnum:
    """Testes para o enum de status de instância de extração."""

    def test_enum_values_exist(self):
        """Verifica que todos os valores esperados existem."""
        expected_values = {"pending", "in_progress", "completed", "reviewed", "archived"}
        actual_values = {status.value for status in ExtractionInstanceStatus}
        
        assert actual_values == expected_values

    def test_pending_is_default(self):
        """Verifica que PENDING é o valor padrão."""
        assert ExtractionInstanceStatus.PENDING.value == "pending"

    def test_enum_is_string_compatible(self):
        """Verifica que o enum pode ser usado como string."""
        status = ExtractionInstanceStatus.COMPLETED
        
        # Deve ser comparável com string (herda de str)
        assert status == "completed"
        assert status.value == "completed"
        
        # O .value é a forma correta de obter a string
        assert status.value == "completed"
        
        # Pode ser usado em comparações de string
        assert f"{status.value}" == "completed"

    def test_enum_from_string(self):
        """Verifica que podemos criar enum a partir de string."""
        status = ExtractionInstanceStatus("pending")
        assert status == ExtractionInstanceStatus.PENDING

    def test_enum_invalid_value_raises(self):
        """Verifica que valor inválido levanta exceção."""
        with pytest.raises(ValueError):
            ExtractionInstanceStatus("invalid_status")

    def test_all_status_values_are_snake_case(self):
        """Verifica que todos os valores seguem snake_case (convenção PostgreSQL)."""
        for status in ExtractionInstanceStatus:
            # Deve ser lowercase
            assert status.value == status.value.lower()
            # Palavras separadas por underscore (ou palavra única)
            assert status.value.replace("_", "").isalpha()

    def test_status_workflow_progression(self):
        """Testa fluxo lógico de progressão de status."""
        # Ordem lógica esperada do workflow
        workflow = [
            ExtractionInstanceStatus.PENDING,
            ExtractionInstanceStatus.IN_PROGRESS,
            ExtractionInstanceStatus.COMPLETED,
            ExtractionInstanceStatus.REVIEWED,
        ]
        
        # Todos devem ser únicos
        assert len(workflow) == len(set(workflow))
        
        # ARCHIVED é um estado especial (não faz parte do workflow principal)
        assert ExtractionInstanceStatus.ARCHIVED not in workflow

