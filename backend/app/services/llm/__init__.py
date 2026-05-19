"""LLM-facing prompt builders and response parsers.

Keeps prompt strings + structured-output schemas out of service-layer
code so they can be tested, swapped, and tracked independently of the
service that calls the LLM.
"""
