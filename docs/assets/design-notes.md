# warpaint page — design notes (log of choices, for future passes)

Aesthetic: physical paint-rack / swatch-card system. Bench = warm graphite (chaos black),
faces/text = wraithbone bone, single accent = retributor gold. Chroma comes from the real
1607-paint RGB dataset, not decoration.

Avoided AI defaults: not cream+serif+terracotta; not near-black+one-acid-accent (accent is a
restrained metallic gold and the "accents" are 1,607 real colors + bone card surfaces);
not broadsheet hairline newspaper.

Type: Big Shoulders Display (signage/stencil display) + Hanken Grotesk (body) + Space Mono (labels/data).
Signature: working cross-brand color matcher + live swatch wall, both driven by real catalog data.
Data: assets/paints.js (window.PAINTS), owned flags baked from live /api/inventory (101).
