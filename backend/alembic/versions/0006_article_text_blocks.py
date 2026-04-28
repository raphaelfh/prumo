"""article_text_blocks: per-page indexed text for AI-grounded citations

Revision ID: 0006_article_text_blocks
Revises: 0005_hitl_invariants
Create Date: 2026-04-28

Required by Phase 3 of the PDF viewer refactor (Citation API +
ExtractionEvidence integration). Spec:
``docs/superpowers/specs/2026-04-28-pdf-viewer-database-requirements.md``.

The viewer renders citations with `{page, charStart, charEnd, quote}` already
attached. Producing those char ranges and quotes reliably needs pre-indexed
text per page with stable character offsets and bounding boxes — i.e. the
output of OpenDataLoader-PDF (or equivalent) run once at article ingestion.
``article_files.text_raw`` exists but is a single concatenated blob: no
page boundaries, no char offsets, no bboxes.

Block-type vocabulary is closed (7 values) — if OpenDataLoader-PDF emits
something not in the set, the loader maps it to ``paragraph``. Adding new
values is a follow-up migration; rejecting writes is hard to roll back.

RLS: rows are visible / writable to project members of the owning article's
project, mirroring the policies on ``article_files`` (which back-link via
``article_file_id``).
"""

from alembic import op

revision = "0006_article_text_blocks"
down_revision = "0005_hitl_invariants"
branch_labels = None
depends_on = None


_CREATE_TABLE = """
CREATE TABLE public.article_text_blocks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_file_id UUID NOT NULL
        REFERENCES public.article_files(id) ON DELETE CASCADE,
    page_number     INTEGER NOT NULL,
    block_index     INTEGER NOT NULL,
    text            TEXT NOT NULL,
    char_start      INTEGER NOT NULL,
    char_end        INTEGER NOT NULL,
    bbox            JSONB NOT NULL,
    block_type      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT article_text_blocks_page_positive CHECK (page_number >= 1),
    CONSTRAINT article_text_blocks_block_nonneg CHECK (block_index >= 0),
    CONSTRAINT article_text_blocks_char_start_nonneg CHECK (char_start >= 0),
    CONSTRAINT article_text_blocks_char_range_valid CHECK (char_end >= char_start),
    CONSTRAINT article_text_blocks_block_type_valid CHECK (
        block_type IN ('paragraph', 'heading', 'list_item', 'table_cell',
                       'figure_caption', 'header', 'footer')
    )
);
"""

_INDEX_FILE_PAGE_BLOCK = (
    "CREATE INDEX idx_article_text_blocks_file_page_block "
    "ON public.article_text_blocks (article_file_id, page_number, block_index);"
)

_INDEX_FILE_ID = (
    "CREATE INDEX idx_article_text_blocks_file_id "
    "ON public.article_text_blocks (article_file_id);"
)

_RLS_ENABLE = (
    "ALTER TABLE public.article_text_blocks ENABLE ROW LEVEL SECURITY;"
)

_RLS_SELECT = """
CREATE POLICY "Members can view article text blocks"
    ON public.article_text_blocks
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.article_files af
            WHERE af.id = article_text_blocks.article_file_id
              AND public.is_project_member(af.project_id, auth.uid())
        )
    );
"""

_RLS_INSERT = """
CREATE POLICY "Members can insert article text blocks"
    ON public.article_text_blocks
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.article_files af
            WHERE af.id = article_text_blocks.article_file_id
              AND public.is_project_member(af.project_id, auth.uid())
        )
    );
"""

_RLS_UPDATE = """
CREATE POLICY "Members can update article text blocks"
    ON public.article_text_blocks
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.article_files af
            WHERE af.id = article_text_blocks.article_file_id
              AND public.is_project_member(af.project_id, auth.uid())
        )
    );
"""

_RLS_DELETE = """
CREATE POLICY "Members can delete article text blocks"
    ON public.article_text_blocks
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.article_files af
            WHERE af.id = article_text_blocks.article_file_id
              AND public.is_project_member(af.project_id, auth.uid())
        )
    );
"""


def upgrade() -> None:
    op.execute(_CREATE_TABLE)
    op.execute(_INDEX_FILE_PAGE_BLOCK)
    op.execute(_INDEX_FILE_ID)
    op.execute(_RLS_ENABLE)
    op.execute(_RLS_SELECT)
    op.execute(_RLS_INSERT)
    op.execute(_RLS_UPDATE)
    op.execute(_RLS_DELETE)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.article_text_blocks;")
