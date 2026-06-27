from citation_eval.scoring import citation_precision, citation_recall


def test_precision_penalizes_unsupported_citation():
    gold = {"dose": ["patients got 50 mg"]}
    pred = {"dose": ["patients got 50 mg", "unrelated sentence"]}
    assert citation_precision(pred, gold) == 0.5


def test_recall_rewards_finding_the_span():
    gold = {"dose": ["patients got 50 mg"]}
    pred = {"dose": ["50 mg twice daily was given"]}
    assert citation_recall(pred, gold) == 1.0
