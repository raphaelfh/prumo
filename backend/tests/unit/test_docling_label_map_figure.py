from app.infrastructure.parsing.docling_parser import _LABEL_MAP


def test_picture_maps_to_figure():
    assert _LABEL_MAP.get("picture") == "figure"


def test_image_maps_to_figure():
    assert _LABEL_MAP.get("image") == "figure"
