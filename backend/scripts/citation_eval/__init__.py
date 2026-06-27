"""ALCE-style citation precision/recall evaluation harness.

A standalone research tool — deliberately *outside* the app layers — that
scores extraction predictions against a gold-labelled corpus of supporting
spans, mirroring the posture of ``parsing_bakeoff``.

The harness ships **no documents**. See the task-8 brief for the manifest
shape and provisioning guidance.
"""
