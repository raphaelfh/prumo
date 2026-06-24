"""Unit test for the DoclingParser pipeline configuration.

The self-hosted Docling parser must run with OCR DISABLED. Docling's default is
``do_ocr=True``, which loads RapidOCR; RapidOCR 3.9+ promoted a PP-OCRv6 model
the torch backend can't resolve (no ``onnxruntime`` on the slim worker), raising
``Unsupported configuration: torch.PP-OCRv6.det.small`` at pipeline init. Our
inputs are born-digital scientific PDFs with an embedded text layer, so OCR is
unnecessary; disabling it skips the RapidOCR import entirely and neutralises the
transitive-version drift.

Skipped when docling is not installed (dev machines without torch); the CI image
and the worker image install docling so it runs there.
"""

import importlib.util

import pytest

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("docling") is None,
    reason="docling not installed in this environment",
)


def test_pdf_pipeline_options_disable_ocr_keep_tables_on_cpu():
    from docling.datamodel.accelerator_options import AcceleratorDevice
    from docling.datamodel.pipeline_options import TableFormerMode

    from app.infrastructure.parsing.docling_parser import _pdf_pipeline_options

    opts = _pdf_pipeline_options()

    # The bug: OCR on -> RapidOCR/PP-OCRv6/torch crash. Must be off.
    assert opts.do_ocr is False
    # Tables are load-bearing for scientific extraction: keep structure on,
    # FAST mode for CPU cost, cell text matched verbatim from the PDF text layer.
    assert opts.do_table_structure is True
    assert opts.table_structure_options.mode == TableFormerMode.FAST
    assert opts.table_structure_options.do_cell_matching is True
    # The worker has no GPU; pin the accelerator to CPU explicitly.
    assert opts.accelerator_options.device == AcceleratorDevice.CPU
