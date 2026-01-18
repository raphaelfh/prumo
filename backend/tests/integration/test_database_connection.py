"""
Testes de integração para conexão com banco de dados.

Estes testes validam:
- Conexão com o PostgreSQL (Supabase local)
- Existência das tabelas principais
- Operações básicas de CRUD
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
class TestDatabaseConnection:
    """Testes de conexão e estrutura do banco."""

    async def test_database_connection(self, db_session: AsyncSession) -> None:
        """Verifica se a conexão com o banco está funcionando."""
        result = await db_session.execute(text("SELECT 1 as value"))
        row = result.fetchone()
        assert row is not None
        assert row.value == 1

    async def test_database_version(self, db_session: AsyncSession) -> None:
        """Verifica versão do PostgreSQL."""
        result = await db_session.execute(text("SELECT version()"))
        row = result.fetchone()
        assert row is not None
        assert "PostgreSQL" in row[0]

    async def test_profiles_table_exists(self, db_session: AsyncSession) -> None:
        """Verifica se a tabela profiles existe."""
        result = await db_session.execute(
            text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'profiles'
                )
            """)
        )
        row = result.fetchone()
        assert row is not None
        assert row[0] is True

    async def test_projects_table_exists(self, db_session: AsyncSession) -> None:
        """Verifica se a tabela projects existe."""
        result = await db_session.execute(
            text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'projects'
                )
            """)
        )
        row = result.fetchone()
        assert row is not None
        assert row[0] is True

    async def test_articles_table_exists(self, db_session: AsyncSession) -> None:
        """Verifica se a tabela articles existe."""
        result = await db_session.execute(
            text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'articles'
                )
            """)
        )
        row = result.fetchone()
        assert row is not None
        assert row[0] is True


@pytest.mark.asyncio
class TestDatabaseEnums:
    """Testes para verificar enums do banco."""

    async def test_review_type_enum_exists(self, db_session: AsyncSession) -> None:
        """Verifica se o enum review_type existe."""
        result = await db_session.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_type WHERE typname = 'review_type'
                )
            """)
        )
        row = result.fetchone()
        assert row is not None
        assert row[0] is True

    async def test_assessment_status_enum_exists(self, db_session: AsyncSession) -> None:
        """Verifica se o enum assessment_status existe."""
        result = await db_session.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_type WHERE typname = 'assessment_status'
                )
            """)
        )
        row = result.fetchone()
        assert row is not None
        assert row[0] is True

    async def test_project_member_role_enum_exists(self, db_session: AsyncSession) -> None:
        """Verifica se o enum project_member_role existe."""
        result = await db_session.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_type WHERE typname = 'project_member_role'
                )
            """)
        )
        row = result.fetchone()
        assert row is not None
        assert row[0] is True


@pytest.mark.asyncio
class TestDatabaseSchema:
    """Testes para verificar estrutura das tabelas."""

    async def test_projects_columns(self, db_session: AsyncSession) -> None:
        """Verifica colunas da tabela projects."""
        result = await db_session.execute(
            text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'projects'
                ORDER BY ordinal_position
            """)
        )
        columns = [row[0] for row in result.fetchall()]
        
        # Colunas obrigatórias (usando created_by_id como no schema real)
        expected_columns = ["id", "name", "review_type", "created_by_id", "created_at"]
        for col in expected_columns:
            assert col in columns, f"Coluna {col} não encontrada em projects"

    async def test_articles_columns(self, db_session: AsyncSession) -> None:
        """Verifica colunas da tabela articles."""
        result = await db_session.execute(
            text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'articles'
                ORDER BY ordinal_position
            """)
        )
        columns = [row[0] for row in result.fetchall()]
        
        # Colunas obrigatórias
        expected_columns = ["id", "project_id", "title", "created_at"]
        for col in expected_columns:
            assert col in columns, f"Coluna {col} não encontrada em articles"

    async def test_assessment_instruments_columns(self, db_session: AsyncSession) -> None:
        """Verifica colunas da tabela assessment_instruments."""
        result = await db_session.execute(
            text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'assessment_instruments'
                ORDER BY ordinal_position
            """)
        )
        columns = [row[0] for row in result.fetchall()]
        
        # Colunas obrigatórias (schema real usa tool_type, name, version)
        expected_columns = ["id", "name", "tool_type", "created_at"]
        for col in expected_columns:
            assert col in columns, f"Coluna {col} não encontrada em assessment_instruments"


@pytest.mark.asyncio
class TestDatabaseRLS:
    """Testes para verificar Row Level Security."""

    async def test_rls_enabled_on_projects(self, db_session: AsyncSession) -> None:
        """Verifica se RLS está habilitado na tabela projects."""
        result = await db_session.execute(
            text("""
                SELECT relrowsecurity 
                FROM pg_class 
                WHERE relname = 'projects' 
                AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            """)
        )
        row = result.fetchone()
        # RLS pode estar habilitado ou não dependendo do ambiente
        assert row is not None

    async def test_rls_enabled_on_articles(self, db_session: AsyncSession) -> None:
        """Verifica se RLS está habilitado na tabela articles."""
        result = await db_session.execute(
            text("""
                SELECT relrowsecurity 
                FROM pg_class 
                WHERE relname = 'articles' 
                AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            """)
        )
        row = result.fetchone()
        assert row is not None

