"""Parsing bake-off harness (Phase 0 of ADR-0011).

A standalone research tool — deliberately *outside* the app layers — that
runs candidate PDF parsers (Docling, MinerU, LlamaParse, OpenDataLoader-PDF)
over a frozen, labelled set of real papers and scores them on table
fidelity, bounding-box correctness, section/reference recovery, and
per-article cost + latency, so the concrete parser for
``app/infrastructure/parsing`` can be chosen from data rather than from
public leaderboards (which do not cover scanned clinical PDFs).

The harness ships **no documents**. See ``README.md`` for provisioning the
evaluation set on an approved (non-public) surface.
"""
