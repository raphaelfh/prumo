"""ALCE-style citation precision/recall over a gold span set. Pure, stdlib-only
(mirrors parsing_bakeoff.scoring) so it unit-tests without parsers or PDFs."""

from __future__ import annotations

from parsing_bakeoff.scoring import normalize_text  # noqa: F401  (re-exported)


def _token_overlap(a: str, b: str) -> bool:
    """True when the token sets of ``a`` and ``b`` share at least one word.

    # NOTE: any shared token counts as support, which can inflate precision on
    # stopword overlap; revisit with a minimum-overlap threshold or token-F1
    # once a real labelled corpus exists.
    """
    return bool(set(a.split()) & set(b.split()))


def _supports(pred_span: str, gold_spans: list[str]) -> bool:
    """A pred span supports a gold span when their normalised texts have any
    token overlap (substring containment in either direction, or shared words).
    This covers both exact inclusion and partial-match evidence."""
    p = normalize_text(pred_span)
    for g in gold_spans:
        ng = normalize_text(g)
        if ng in p or p in ng or _token_overlap(p, ng):
            return True
    return False


def citation_precision(pred: dict[str, list[str]], gold: dict[str, list[str]]) -> float:
    total = supported = 0
    for name, spans in pred.items():
        for span in spans:
            total += 1
            if _supports(span, gold.get(name, [])):
                supported += 1
    return supported / total if total else 1.0


def citation_recall(pred: dict[str, list[str]], gold: dict[str, list[str]]) -> float:
    total = found = 0
    for name, gold_spans in gold.items():
        for g in gold_spans:
            total += 1
            if any(_supports(s, [g]) for s in pred.get(name, [])):
                found += 1
    return found / total if total else 1.0


def value_accuracy(pred: dict[str, str], gold: dict[str, str]) -> float:
    """Fraction of gold fields whose predicted value matches (after normalisation)."""
    if not gold:
        return 1.0
    hits = sum(
        1
        for name, g_val in gold.items()
        if normalize_text(pred.get(name, "")) == normalize_text(g_val)
    )
    return hits / len(gold)
