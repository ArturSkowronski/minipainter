"""Colours as `#rrggbb` strings, compared and blended in OKLab, where equal steps look equal.

Blending two paints here is a straight line between their colours: an indication of a mix, not pigment
physics.
"""
import math
import re

_HEX = re.compile(r"#[0-9a-f]{6}")
Lab = tuple[float, float, float]


def clean_hex(value) -> str:
    """Lower-case `#rrggbb`. ValueError for anything else."""
    text = value.strip().lower() if isinstance(value, str) else ""
    if not _HEX.fullmatch(text):
        raise ValueError("a colour is written #rrggbb")
    return text


def hex_to_rgb(colour: str) -> tuple[int, int, int]:
    n = int(colour[1:], 16)
    return (n >> 16) & 255, (n >> 8) & 255, n & 255


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


def _linear(channel: int) -> float:
    c = channel / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _encoded(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def to_oklab(colour: str) -> Lab:
    r, g, b = (_linear(c) for c in hex_to_rgb(colour))
    l = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def _linear_rgb(lab: Lab) -> tuple[float, float, float]:
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)


def from_oklab(lab: Lab) -> str:
    """The nearest displayable colour by clamping each channel."""
    return rgb_to_hex(*(round(255 * _encoded(min(1.0, max(0.0, c)))) for c in _linear_rgb(lab)))


def _displayable(lab: Lab) -> Lab:
    """The same lightness and hue with as much of the chroma as the screen can show."""
    def fits(candidate: Lab) -> bool:
        return all(-1e-4 <= c <= 1 + 1e-4 for c in _linear_rgb(candidate))

    if fits(lab):
        return lab
    L, a, b = lab
    low, high = 0.0, 1.0
    for _ in range(20):
        mid = (low + high) / 2
        low, high = (mid, high) if fits((L, a * mid, b * mid)) else (low, mid)
    return L, a * low, b * low


def distance(first: str, second: str) -> float:
    return math.dist(to_oklab(first), to_oklab(second))


def mix(first: str, second: str, share: float) -> str:
    """`share` of `second` in `first`: 0 is `first`, 1 is `second`."""
    if share <= 0:
        return first
    if share >= 1:
        return second
    a, b = to_oklab(first), to_oklab(second)
    return from_oklab(tuple(x + (y - x) * share for x, y in zip(a, b)))


def lighten(colour: str, amount: float = 0.18) -> str:
    """Lighter and a little less saturated, the way a highlight of a colour is."""
    L, a, b = to_oklab(colour)
    if L >= 1 - 1e-6:
        return colour
    return from_oklab(_displayable((min(1.0, L + amount), a * 0.9, b * 0.9)))


def darken(colour: str, amount: float = 0.25) -> str:
    L, a, b = to_oklab(colour)
    if L <= 1e-6:
        return colour
    return from_oklab(_displayable((max(0.0, L - amount), a, b)))
