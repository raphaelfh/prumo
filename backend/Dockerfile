# =================== BUILD STAGE ===================
FROM python:3.12-slim as builder

WORKDIR /app

# Install uv for faster dependency installation
RUN pip install --no-cache-dir uv

# Copy dependency files + the package itself. `uv.lock` MUST be here: without
# it the install below silently resolves fresh from the pyproject ranges (see
# the comment on that RUN). hatchling resolves
# `tool.hatch.build.targets.wheel.packages = ["app"]` at install time, so
# the source tree must exist before `uv pip install -e .` runs.
COPY pyproject.toml uv.lock README.md ./
COPY app ./app

# Install dependencies into the system prefix (the runtime stage copies it).
#
# THE LOCK IS THE CONTRACT. `uv pip install` is the pip-compatible interface
# and does NOT read `uv.lock` — only `uv sync` does. This used to be a bare
# `uv pip install -e .`, so every image re-resolved from the pyproject ranges
# at build time while CI ran `uv sync --frozen`. Prod and CI drifted apart and
# nothing said so: an image built 2026-08-10 picked up genai-prices 0.1.4,
# whose `Usage` gained a field pydantic-ai's `RequestUsage` does not accept,
# and `RequestUsage.extract` swallows that TypeError and returns ZERO usage —
# so every LLM token count in prod was silently recorded as 0 for three weeks.
# `tests/unit/llm/test_extractor.py` now guards the seam, but the guard only
# helps if the image installs what CI tested. Export the lock, install that.
#
# `uv sync` would build a `.venv`, which the runtime stage's site-packages COPY
# does not pick up — so export to requirements and keep the --system layout.
# --no-hashes: the PyTorch CPU wheels below are not the hashes the lock pins.
#
# --torch-backend=cpu makes uv resolve torch/torchvision from the PyTorch CPU
# wheel index, dropping the ~1GB CUDA stack that is dead weight on the CPU-only
# worker. It only redirects the index, so the CUDA packages must also be
# dropped from the exported requirements or they come back (measured: +600MB
# of triton alone). torch itself stays at the LOCKED version, as +cpu.
RUN uv export --frozen --no-dev --no-hashes --no-emit-project -o /tmp/requirements.txt \
    && grep -vE '^(nvidia-|triton|pytorch-triton)' /tmp/requirements.txt > /tmp/requirements.cpu.txt \
    && uv pip install --system --no-cache --torch-backend=cpu -r /tmp/requirements.cpu.txt \
    && uv pip install --system --no-cache --no-deps -e .

# Prefetch ONLY the models the OCR-disabled standard pipeline needs (layout +
# TableFormer) into the image, so the worker NEVER downloads at runtime. OCR
# (RapidOCR) is disabled in the parser, and the code-formula / picture models
# are unused — skip them to keep the image lean.
RUN python -c "from pathlib import Path; from docling.utils.model_downloader import download_models; download_models(output_dir=Path('/opt/docling-models'), with_layout=True, with_tableformer=True, with_code_formula=False, with_picture_classifier=False, with_rapidocr=False, with_easyocr=False)"

# =================== RUNTIME STAGE ===================
FROM python:3.12-slim as runtime

WORKDIR /app

# System libraries for the self-hosted Docling parser. docling-ibm-models /
# opencv historically dlopen libGL/libxcb/glib at import; the slim base ships
# none of these. Kept conservatively even though OCR is now disabled — removing
# them is a separate, tested cleanup once cv2 is confirmed unreachable.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libxcb1 libxext6 libsm6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN adduser --disabled-password --gecos "" appuser

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy the prefetched Docling models
COPY --from=builder /opt/docling-models /opt/docling-models

# Copy application code and Alembic migration files
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

# Serve Docling models from the prefetched dir and forbid any runtime model
# download (fail fast instead of hanging the worker offline).
ENV DOCLING_ARTIFACTS_PATH=/opt/docling-models \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

# Change ownership
RUN chown -R appuser:appuser /app /opt/docling-models

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

# Health check — read the same ${PORT:-8000} the CMD binds to so the
# container is correctly marked healthy on Railway (where PORT is
# injected) as well as locally (where it falls back to 8000).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import httpx, os; httpx.get(f'http://localhost:{os.environ.get(\"PORT\", \"8000\")}/health')" || exit 1

# Run migrations, converge the seed catalogue, then start the application.
#
# `python -m app.seed` is idempotent end to end, so running it on every boot
# makes a deploy converge the global template catalogue instead of relying on
# a human remembering to seed after promoting. Two idempotence shapes now
# coexist: most seeders early-return on an existing row (and the instruction
# backfill is fill-if-null), while `seed_probast_ai` CONVERGES — it updates
# the row and replaces its children under deterministic ids every boot, which
# is what lets a corrected template spec reach a database that already has it.
# A seed failure aborts the boot LOUDLY: Railway
# marks the deploy failed and keeps the previous build live, which is the
# correct failure mode — never serve code whose catalogue is missing.
# The worker overrides this CMD (Celery start command), so the seed runs
# exactly once per deploy, after Alembic and before gunicorn.
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000} app.main:app"]
