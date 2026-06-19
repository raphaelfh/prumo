"""Unit tests for the JATS → gold parser."""

from __future__ import annotations

from parsing_bakeoff.jats_gold import gold_from_jats, parse_jats

JATS = """<article>
  <front><article-meta><title-group>
    <article-title>Game-based education in T2DM</article-title>
  </title-group></article-meta></front>
  <body>
    <sec><title>Methods</title><p>We randomised 72 adults.</p></sec>
    <sec><title>Results</title>
      <table-wrap><label>Table 1</label><table>
        <thead><tr><th>Arm</th><th>N</th></tr></thead>
        <tbody>
          <tr><td>Control</td><td>36</td></tr>
          <tr><td>Intervention</td><td>36</td></tr>
        </tbody>
      </table></table-wrap>
    </sec>
  </body>
  <back><ref-list>
    <ref><mixed-citation>Smith J. Diabetes care. 2021.</mixed-citation></ref>
    <ref><mixed-citation>Doe A. Lancet. 2022.</mixed-citation></ref>
  </ref-list></back>
</article>"""


class TestParseJats:
    def test_extracts_title(self) -> None:
        assert parse_jats(JATS).title == "Game-based education in T2DM"

    def test_extracts_section_headings(self) -> None:
        assert parse_jats(JATS).sections == ["Methods", "Results"]

    def test_extracts_table_cells_per_table(self) -> None:
        tables = parse_jats(JATS).tables
        assert len(tables) == 1
        assert tables[0] == ["Arm", "N", "Control", "36", "Intervention", "36"]

    def test_extracts_references(self) -> None:
        refs = parse_jats(JATS).references
        assert len(refs) == 2
        assert "Smith J" in refs[0]


def test_gold_from_jats_maps_to_gold_labels() -> None:
    gold = gold_from_jats(JATS)
    assert gold.sections == ["Methods", "Results"]
    assert gold.all_cells == ["Arm", "N", "Control", "36", "Intervention", "36"]
    assert len(gold.references) == 2
    assert gold.regions == []  # XML has no pixel coordinates
