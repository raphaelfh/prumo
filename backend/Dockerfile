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

# Install dependencies into the system prefix (the runtime stage copies it).
# --torch-backend=cpu makes uv resolve torch/torchvision from the PyTorch CPU
# wheel index, dropping the ~1GB CUDA stack (nvidia-*/triton) that is dead
# weight on the CPU-only worker.
RUN uv pip install --system --no-cache --torch-backend=cpu -e .

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

# Run migrations then start application
CMD ["sh", "-c", "alembic upgrade head && gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000} app.main:app"]
