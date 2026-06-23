"""Design-stability assertions: these lock deliberate design choices.
A refactor that breaks one of these is changing behavior, not fixing a bug."""

from app.llm.prompts import section_extraction


def test_format_renders_brace_laden_entity_name_literally():
    # WHY (#6): prompts use str.format(**kwargs); user values are arguments,
    # never the template, so braces / format-specs in entity_name render
    # literally and are never re-evaluated. A refactor to f-strings over user
    # values would reintroduce an injection/breakage risk.
    out = section_extraction.render(
        entity_name="Dataset {article_text} {0:.2f}",
        entity_description="desc",
        article_text="SECRET",
        memory_context=None,
    )
    assert "Dataset {article_text} {0:.2f}" in out
    # The real article_text slot substituted exactly once; entity_name's literal
    # "{article_text}" did NOT trigger a second substitution.
    assert out.count("SECRET") == 1
