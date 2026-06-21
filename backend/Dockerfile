# =================== BUILD STAGE ===================
FROM python:3.12-slim as builder

WORKDIR /app

# Install uv for faster dependency installation
RUN pip install --no-cache-dir uv

# Copy dependency files + the package itself. hatchling resolves
# `tool.hatch.build.targets.wheel.packages = ["app"]` at install time, so
# the source tree must exist before `uv pip install -e .` runs.
COPY pyproject.toml README.md ./
COPY app ./app

# Install dependencies (editable so the runtime stage can reuse site-packages)
RUN uv pip install --system --no-cache -e .

# =================== RUNTIME STAGE ===================
FROM python:3.12-slim as runtime

WORKDIR /app

# System libraries for the self-hosted Docling fallback parser. Docling pulls
# opencv (via rapidocr/docling-ibm-models), which dlopens libGL/libxcb/glib at
# `import cv2`. The slim base ships none of these, so the fallback otherwise
# crashes with "libxcb.so.1: cannot open shared object file". The default
# (cloud LlamaParse) path is pure HTTP and does not need these, but the
# fallback must not be a guaranteed crash.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libxcb1 libxext6 libsm6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN adduser --disabled-password --gecos "" appuser

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code and Alembic migration files
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

# Change ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

# Health check — read the same ${PORT:-8000} the CMD binds to so the
# container is correctly marked healthy on Railway (where PORT is
# injected) as well as locally (where it falls back to 8000).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import httpx, os; httpx.get(f'http://localhost:{os.environ.get(\"PORT\", \"8000\")}/health')" || exit 1

# Run migrations then start application
CMD ["sh", "-c", "alembic upgrade head && gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000} app.main:app"]

