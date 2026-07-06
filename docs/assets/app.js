(() => {
  const P = window.PAINTS || [];
  const PROV = window.PROVIDERS || {};
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The public page never exposes a real inventory. Derive a deterministic
  // "example rack" from each paint id (stable for every visitor, tied to
  // nobody's install) so owned-first matching stays demonstrable with no
  // personal data. Real ownership lives only in your local install.
  const inExampleRack = (id) => {
    let h = 0;
    for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
    return h % 7 === 0;
  };
  P.forEach((p) => { p.o = inExampleRack(p.i) ? 1 : 0; });

  // ---- color helpers ------------------------------------------------------
  const clamp = (n) => Math.max(0, Math.min(255, n | 0));
  const hex2 = (n) => clamp(n).toString(16).padStart(2, '0');
  const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  const parseHex = (s) => {
    const m = /^#?([0-9a-f]{6})$/i.exec((s || '').trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const hue = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return -1; // greys sort first
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const sortByHue = (arr) => arr.slice().sort((a, b) => {
    const ha = hue(a.c), hb = hue(b.c);
    if (ha !== hb) return ha - hb;
    return lum(b.c) - lum(a.c);
  });

  // ---- hero swatch wall ---------------------------------------------------
  const wall = document.getElementById('wall');
  if (wall && P.length) {
    const N = 196;
    const step = P.length / N;
    const picks = [];
    for (let k = 0; k < N; k++) picks.push(P[Math.floor(k * step)]);
    const frag = document.createDocumentFragment();
    sortByHue(picks).forEach((p, idx) => {
      const i = document.createElement('i');
      i.style.background = toHex(p.c);
      i.title = `${p.n} · ${PROV[p.p] || p.p}`;
      if (!reduce) i.style.animationDelay = `${(idx % 28) * 22 + Math.floor(idx / 28) * 40}ms`;
      frag.appendChild(i);
    });
    wall.appendChild(frag);
  }

  // ---- matcher ------------------------------------------------------------
  const brandAccent = {
    citadel: '#c9a24c', army_painter: '#7fb0e0', vallejo: '#d08f8f', ak_interactive: '#8fc99a',
  };
  const brands = Object.keys(PROV);

  const color = document.getElementById('color');
  const hexInput = document.getElementById('hex');
  const preview = document.getElementById('preview');
  const ownedOnly = document.getElementById('ownedOnly');
  const results = document.getElementById('results');
  const legend = document.getElementById('legend');

  function nearestPerBrand(target, ownedFilter) {
    return brands.map((b) => {
      let best = null;
      for (const p of P) {
        if (p.p !== b) continue;
        if (ownedFilter && !p.o) continue;
        const d = dist(p.c, target);
        if (!best || d < best.d) best = { p, d };
      }
      return best;
    }).filter(Boolean).sort((x, y) => x.d - y.d);
  }

  function renderMatch() {
    const target = parseHex(hexInput.value) || parseHex(color.value) || [201, 162, 76];
    const tHex = toHex(target);
    preview.style.background = tHex;
    preview.style.color = lum(target) > 0.55 ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.8)';
    preview.textContent = tHex.toUpperCase();

    const winners = nearestPerBrand(target, ownedOnly.checked);
    results.innerHTML = '';
    if (!winners.length) {
      results.innerHTML = '<p style="font-family:var(--f-mono);color:var(--bone-dim)">No paints in the example rack for this target. Untick “Example rack only”.</p>';
      return;
    }
    winners.forEach((w, idx) => {
      const p = w.p;
      const card = document.createElement('article');
      card.className = 'pcard';
      if (!reduce) card.style.animationDelay = `${idx * 45}ms`;
      const textOnFace = lum(p.c) > 0.55 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.7)';
      card.innerHTML = `
        <div class="face" style="background:${toHex(p.c)}">
          <span class="rank" style="color:${textOnFace};background:${lum(p.c) > 0.55 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)'}">${String(idx + 1).padStart(2, '0')}</span>
          ${p.o ? '<span class="own">In rack</span>' : ''}
        </div>
        <div class="body">
          <div class="pname">${p.n}</div>
          <div class="brand">${PROV[p.p] || p.p}</div>
          <dl>
            <dt>dist</dt><dd>${w.d}</dd>
            <dt>rgb</dt><dd>${p.c.join(', ')}</dd>
            <dt>hex</dt><dd>${toHex(p.c).toUpperCase()}</dd>
            ${p.f ? `<dt>type</dt><dd>${p.f.replace(/_/g, ' ')}</dd>` : ''}
          </dl>
        </div>`;
      results.appendChild(card);
    });
  }

  // legend (brand counts)
  if (legend) {
    legend.innerHTML = brands.map((b) => {
      const n = P.filter((p) => p.p === b).length;
      return `<span><i style="background:${brandAccent[b] || '#999'}"></i>${PROV[b] || b} · ${n}</span>`;
    }).join('');
  }

  function syncFromHex() {
    const rgb = parseHex(hexInput.value);
    if (rgb) color.value = toHex(rgb);
    renderMatch();
  }
  function syncFromColor() {
    hexInput.value = color.value.toUpperCase();
    renderMatch();
  }
  if (hexInput) hexInput.addEventListener('input', syncFromHex);
  if (color) color.addEventListener('input', syncFromColor);
  if (ownedOnly) ownedOnly.addEventListener('change', renderMatch);

  // presets — evocative bench targets
  const presetEl = document.getElementById('presets');
  const PRESETS = [
    ['Gold', '#c9a24c'], ['Bone', '#d4c8a8'], ['Blood', '#7a1a1a'],
    ['Ork flesh', '#1a4a2a'], ['Sky', '#4aba8c'], ['Void', '#141428'],
    ['Rust', '#84462a'], ['Magenta', '#c953ab'],
  ];
  if (presetEl) {
    PRESETS.forEach(([name, hexv]) => {
      const b = document.createElement('button');
      b.style.background = hexv;
      b.title = name;
      b.setAttribute('aria-label', `Preset ${name}`);
      b.addEventListener('click', () => { hexInput.value = hexv.toUpperCase(); syncFromHex(); });
      presetEl.appendChild(b);
    });
  }

  // ---- the rack -----------------------------------------------------------
  const racks = document.getElementById('racks');
  const read = document.getElementById('rack-read');
  if (racks) {
    brands.forEach((b) => {
      const group = P.filter((p) => p.p === b);
      const wrap = document.createElement('div');
      wrap.className = 'rack-group';
      const owned = group.filter((p) => p.o).length;
      wrap.innerHTML = `<h3><span>${PROV[b] || b}</span><span><b>${group.length}</b> pots · ${owned} in example rack</span></h3>`;
      const grid = document.createElement('div');
      grid.className = 'rack';
      const frag = document.createDocumentFragment();
      sortByHue(group).forEach((p) => {
        const i = document.createElement('i');
        i.style.background = toHex(p.c);
        i.dataset.o = p.o ? '1' : '0';
        i.dataset.n = p.n; i.dataset.b = PROV[p.p] || p.p; i.dataset.id = p.i;
        i.dataset.hex = toHex(p.c).toUpperCase();
        frag.appendChild(i);
      });
      grid.appendChild(frag);
      grid.addEventListener('pointerover', (e) => {
        const t = e.target;
        if (t.tagName !== 'I' || !read) return;
        read.innerHTML = `<b>${t.dataset.n}</b> · ${t.dataset.b} · ${t.dataset.hex} · <span style="opacity:.7">${t.dataset.id}</span>${t.dataset.o === '1' ? ' · <span style="color:var(--owned)">in example rack</span>' : ''}`;
      });
      wrap.appendChild(grid);
      racks.appendChild(wrap);
    });
  }

  // ---- copy buttons -------------------------------------------------------
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const old = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = old; }, 1400);
      } catch { /* clipboard unavailable */ }
    });
  });

  renderMatch();
})();
