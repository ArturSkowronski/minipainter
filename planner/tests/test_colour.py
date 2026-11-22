import pytest

from wpm import colour


def test_black_to_white_is_one():
    assert colour.distance("#000000", "#ffffff") == pytest.approx(1.0, abs=0.001)
    assert colour.distance("#b3202a", "#b3202a") == 0


def test_round_trip_is_exact():
    for c in ("#000000", "#ffffff", "#b3202a", "#2a5caa", "#8b8e93"):
        assert colour.from_oklab(colour.to_oklab(c)) == c


def test_mix_ends_and_middle():
    a, b = "#b3202a", "#2a5caa"
    assert colour.mix(a, b, 0) == a and colour.mix(a, b, 1) == b
    grey = colour.mix("#000000", "#ffffff", 0.5)
    assert grey[1:3] == grey[3:5] == grey[5:7] and "#5a5a5a" < grey < "#6c6c6c"
    assert colour.distance(a, colour.mix(a, b, 0.25)) < colour.distance(a, colour.mix(a, b, 0.75))


def test_lighten_and_darken_move_lightness():
    red = "#b3202a"
    light = colour.to_oklab(red)[0]
    assert colour.to_oklab(colour.lighten(red))[0] == pytest.approx(light + 0.18, abs=0.02)
    assert colour.to_oklab(colour.darken(red))[0] == pytest.approx(light - 0.25, abs=0.02)
    assert colour.lighten("#ffffff") == "#ffffff" and colour.darken("#000000") == "#000000"
    assert colour.to_oklab(colour.darken(red, 0.45))[0] < colour.to_oklab(colour.darken(red))[0]


def test_clean_hex():
    assert colour.clean_hex(" #B3202A ") == "#b3202a"
    for bad in ("red", "#12345", "b3202a", None, 12, "#gggggg"):
        with pytest.raises(ValueError):
            colour.clean_hex(bad)
