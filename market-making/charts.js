// Small, dependency-free charts for the essay. Each figure carries its data in a
// <script type="application/json"> inside a .chart[data-kind] element; this file
// draws it as SVG sized to the container, with a hover readout and a data table.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, cls, parent, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  const color = (c) => (c && c.startsWith("#") ? c : `var(--${c || "s1"})`);

  // Clean tick values covering [lo, hi].
  function ticks(lo, hi, n) {
    if (hi === lo) { hi = lo + 1; }
    const raw = (hi - lo) / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * step; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function fmtNum(v, f) {
    if (f && f.fn) return f.fn(v);
    const d = f && f.digits != null ? f.digits : null;
    const pre = (f && f.prefix) || "";
    const suf = (f && f.suffix) || "";
    const sign = f && f.signed && v > 0 ? "+" : "";
    let s;
    if (d != null) s = v.toFixed(d);
    else if (Math.abs(v) >= 10000) s = (v / 1000).toFixed(0) + "K";
    else if (Math.abs(v) >= 1000) s = (v / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    else if (Math.abs(v) >= 100 || Number.isInteger(v)) s = String(Math.round(v));
    else s = String(+v.toPrecision(3));
    if (s.startsWith("-") && pre) return "−" + pre + s.slice(1) + suf;
    return sign + pre + s.replace(/^-/, "−") + suf;
  }
  function fmtTime(ms, span, utcOffsetH) {
    const d = new Date(ms + (utcOffsetH || 0) * 3600e3);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    if (span > 3 * 86400e3) return `${mon} ${d.getUTCDate()}`;
    if (span > 86400e3) return `${mon} ${d.getUTCDate()} ${hh}:${mm}`;
    return `${hh}:${mm}`;
  }
  function timeTicks(lo, hi) {
    const span = hi - lo;
    const steps = [60e3, 300e3, 900e3, 1800e3, 3600e3, 2 * 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 86400e3, 2 * 86400e3, 7 * 86400e3];
    const step = steps.find((s) => span / s <= 6) || 14 * 86400e3;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }

  function tipAt(box, tip, px, py) {
    const bw = box.clientWidth;
    tip.style.opacity = 1;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = px + 14;
    if (x + tw > bw) x = px - tw - 14;
    tip.style.left = Math.max(0, x) + "px";
    tip.style.top = Math.max(0, py - th - 8) + "px";
  }
  function tipRow(tip, c, value, label, box) {
    const r = h("div", "r", tip);
    const i = h("i", box ? "box" : "", r);
    i.style.background = color(c);
    h("b", "", r, value);
    if (label) h("span", "", r, label);
  }

  function header(root, spec) {
    if (spec.title) h("div", "title", root, spec.title);
    if (spec.sub) h("div", "sub", root, spec.sub);
    const series = spec.series || [];
    if (series.length > 1 || spec.legend) {
      const lg = h("div", "legend", root);
      (spec.legend || series).forEach((s) => {
        const it = h("span", "", lg);
        const i = h("i", spec.kind === "bar" || s.box ? "box" : "", it);
        i.style.background = color(s.color);
        if (s.opacity) i.style.opacity = s.opacity;
        it.appendChild(document.createTextNode(s.name));
      });
    }
  }

  function table(root, cols, rows) {
    const d = h("details", "data", root);
    h("summary", "", d, "Data");
    const w = h("div", "wrap", d);
    const t = h("table", "", w);
    const tr = h("tr", "", h("thead", "", t));
    cols.forEach((c) => h("th", "", tr, c));
    const tb = h("tbody", "", t);
    rows.forEach((r) => {
      const row = h("tr", "", tb);
      r.forEach((c) => h("td", "", row, c));
    });
  }

  // ---- line chart -------------------------------------------------------
  function line(root, spec) {
    header(root, spec);
    const box = h("div", "", root);
    box.style.position = "relative";
    const tip = h("div", "tip", box);
    const W = Math.max(280, root.clientWidth);
    const H = spec.height || Math.round(Math.min(360, Math.max(220, W * 0.5)));
    const isTime = spec.x && spec.x.type === "time";
    const endRoom = spec.endLabels === false ? 12 : (spec.endRoom || 64);
    const m = { t: 10, r: endRoom, b: spec.x && spec.x.label ? 42 : 26, l: spec.yWidth || 46 };
    const series = spec.series;
    let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
    series.forEach((s) => s.data.forEach(([x, y]) => {
      if (y == null) return;
      xlo = Math.min(xlo, x); xhi = Math.max(xhi, x); ylo = Math.min(ylo, y); yhi = Math.max(yhi, y);
    }));
    if (spec.y && spec.y.min != null) ylo = Math.min(ylo, spec.y.min);
    if (spec.y && spec.y.max != null) yhi = Math.max(yhi, spec.y.max);
    if (spec.y && spec.y.zero !== false) { ylo = Math.min(ylo, 0); yhi = Math.max(yhi, 0); }
    if (spec.x && spec.x.min != null) xlo = spec.x.min;
    if (spec.x && spec.x.max != null) xhi = spec.x.max;
    const yt = ticks(ylo, yhi, spec.y && spec.y.ticks || 5);
    ylo = Math.min(ylo, yt[0]); yhi = Math.max(yhi, yt[yt.length - 1]);
    const sx = (x) => m.l + ((x - xlo) / (xhi - xlo || 1)) * (W - m.l - m.r);
    const sy = (y) => m.t + (1 - (y - ylo) / (yhi - ylo || 1)) * (H - m.t - m.b);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": spec.title || spec.alt || "chart" }, box);
    const g = el("g", { class: "grid" }, svg);
    yt.forEach((v) => {
      el("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v) }, g);
      const t = el("text", { x: m.l - 8, y: sy(v) + 4, "text-anchor": "end", class: "tick" }, svg);
      t.textContent = fmtNum(v, spec.y);
    });
    if (ylo < 0 && yhi > 0) el("line", { x1: m.l, x2: W - m.r, y1: sy(0), y2: sy(0), class: "baseline" }, svg);
    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "baseline" }, svg);
    const xt = isTime ? timeTicks(xlo, xhi) : ticks(xlo, xhi, spec.x && spec.x.ticks || Math.max(3, Math.floor(W / 110)));
    xt.forEach((v) => {
      if (v < xlo - 1e-9 || v > xhi + 1e-9) return;
      const t = el("text", { x: sx(v), y: H - m.b + 16, "text-anchor": "middle", class: "tick" }, svg);
      t.textContent = isTime ? fmtTime(v, xhi - xlo, spec.x.utcOffset) : fmtNum(v, spec.x);
    });
    if (spec.x && spec.x.label) {
      const t = el("text", { x: m.l + (W - m.l - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "axis-label" }, svg);
      t.textContent = spec.x.label;
    }
    if (spec.y && spec.y.label) {
      const t = el("text", { x: m.l - 8, y: m.t - 2, "text-anchor": "end", class: "axis-label" }, svg);
      t.textContent = "";
    }
    (spec.bands || []).forEach((b) => {
      el("rect", { x: sx(b.x0), width: Math.max(1, sx(b.x1) - sx(b.x0)), y: m.t, height: H - m.t - m.b, fill: "var(--raised)" }, svg);
    });
    (spec.marks || []).forEach((mk) => {
      el("line", { x1: sx(mk.x), x2: sx(mk.x), y1: m.t, y2: H - m.b, class: "baseline" }, svg);
      const right = sx(mk.x) > W * 0.7;
      const t = el("text", { x: sx(mk.x) + (right ? -4 : 4), y: m.t + 10, "text-anchor": right ? "end" : "start", class: "note" }, svg);
      t.textContent = mk.label;
    });
    const step = spec.step;
    series.forEach((s) => {
      if (s.area) {
        // One closed wash per unbroken run of points, so a gap stays empty.
        const base = sy(Math.max(ylo, 0)).toFixed(1);
        const runs = [[]];
        s.data.forEach((p) => { if (p[1] == null) runs.push([]); else runs[runs.length - 1].push(p); });
        let d = "";
        runs.filter((r) => r.length).forEach((r) => {
          let pv = null;
          r.forEach(([x, y], i) => {
            const X = sx(x).toFixed(1), Y = sy(y).toFixed(1);
            d += i === 0 ? `M${X},${base}V${Y}` : (step || s.step) ? `H${X}V${Y}` : `L${X},${Y}`;
            pv = X;
          });
          d += `V${base}Z`;
        });
        el("path", { d, fill: `var(--wash${s.color === "s2" ? 2 : 1})` }, svg);
      }
      let d = "", prev = null;
      s.data.forEach(([x, y]) => {
        if (y == null) { prev = null; return; }
        const X = sx(x).toFixed(1), Y = sy(y).toFixed(1);
        if (prev == null) d += `M${X},${Y}`;
        else if (step || s.step) d += `H${X}V${Y}`;
        else d += `L${X},${Y}`;
        prev = [X, Y];
      });
      el("path", { d, fill: "none", stroke: color(s.color), "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: s.opacity || 1 }, svg);
    });
    if (spec.endLabels !== false) {
      const ends = series.filter((s) => !s.noLabel).map((s) => {
        const pts = s.data.filter((p) => p[1] != null);
        const last = pts[pts.length - 1];
        return { s, x: sx(last[0]), y: sy(last[1]), v: last[1] };
      });
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].ly = ends[i - 1].ly + 14;
      ends.forEach((e) => {
        e.ly = e.ly || e.y;
        el("circle", { cx: e.x, cy: e.y, r: 4, fill: color(e.s.color), stroke: "var(--surface)", "stroke-width": 2 }, svg);
        const t = el("text", { x: e.x + 8, y: (e.ly || e.y) + 4, class: "endlabel" }, svg);
        t.textContent = e.s.endLabel || fmtNum(e.v, spec.y);
      });
    }
    // Hover: a crosshair that snaps to the nearest x, one readout for every series.
    const hair = el("line", { y1: m.t, y2: H - m.b, class: "hair", opacity: 0 }, svg);
    const dots = series.map((s) => el("circle", { r: 4, fill: color(s.color), stroke: "var(--surface)", "stroke-width": 2, opacity: 0 }, svg));
    const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
    const nearest = (arr, x) => {
      let lo = 0, hi = arr.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid][0] < x) lo = mid; else hi = mid; }
      return Math.abs(arr[lo][0] - x) <= Math.abs(arr[hi][0] - x) ? arr[lo] : arr[hi];
    };
    function move(ev) {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const xv = xlo + ((px - m.l) / (W - m.l - m.r)) * (xhi - xlo);
      tip.textContent = "";
      let hx = null;
      series.forEach((s, i) => {
        const p = nearest(s.data.filter((q) => q[1] != null), xv);
        if (hx == null) {
          hx = p[0];
          h("div", "h", tip, isTime ? new Date(p[0] + (spec.x.utcOffset || 0) * 3600e3).toISOString().slice(0, 16).replace("T", " ") + (spec.x.tz ? " " + spec.x.tz : "") : (spec.x.name || "") + " " + fmtNum(p[0], spec.x));
        }
        dots[i].setAttribute("cx", sx(p[0])); dots[i].setAttribute("cy", sy(p[1])); dots[i].setAttribute("opacity", 1);
        tipRow(tip, s.color, fmtNum(p[1], spec.y.tip || spec.y), s.name);
      });
      hair.setAttribute("x1", sx(hx)); hair.setAttribute("x2", sx(hx)); hair.setAttribute("opacity", 1);
      tipAt(box, tip, (sx(hx) / W) * box.clientWidth, (m.t / H) * box.clientHeight + 30);
    }
    function leave() { tip.style.opacity = 0; hair.setAttribute("opacity", 0); dots.forEach((d) => d.setAttribute("opacity", 0)); }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", leave);
    if (!root.dataset.tabled) {
      const xs = [...new Set(series.flatMap((s) => s.data.map((p) => p[0])))].sort((a, b) => a - b);
      const thin = xs.length > 400 ? Math.ceil(xs.length / 400) : 1;
      const maps = series.map((s) => new Map(s.data.map((p) => [p[0], p[1]])));
      const rows = xs.filter((_, i) => i % thin === 0).map((x) => [
        isTime ? new Date(x + (spec.x.utcOffset || 0) * 3600e3).toISOString().slice(0, 16).replace("T", " ") : fmtNum(x, spec.x),
        ...maps.map((mp) => (mp.has(x) && mp.get(x) != null ? fmtNum(mp.get(x), spec.y.tip || spec.y) : "")),
      ]);
      root._table = [[spec.x.name || spec.x.label || "x", ...series.map((s) => s.name)], rows];
    }
  }

  // ---- bar chart (vertical columns or horizontal bars) --------------------
  function bar(root, spec) {
    spec.kind = "bar";
    header(root, spec);
    const box = h("div", "", root);
    box.style.position = "relative";
    const tip = h("div", "tip", box);
    const cats = spec.categories;
    const series = spec.series;
    const horiz = !!spec.horizontal;
    const W = Math.max(280, root.clientWidth);
    const labelW = horiz ? Math.min(spec.labelWidth || 150, Math.round(W * 0.48)) : 0;
    const band = horiz ? (spec.band || 24) : null;
    const H = horiz ? cats.length * band + 34 : (spec.height || Math.round(Math.min(320, Math.max(200, W * 0.45))));
    const m = horiz ? { t: 4, r: 52, b: 28, l: labelW } : { t: 14, r: 12, b: spec.x && spec.x.label ? 44 : 28, l: spec.yWidth || 46 };
    let lo = 0, hi = 0;
    series.forEach((s) => s.values.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    const vt = ticks(lo, hi, horiz ? 4 : 5);
    lo = Math.min(lo, vt[0]); hi = Math.max(hi, vt[vt.length - 1]);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": spec.title || "chart" }, box);
    const g = el("g", { class: "grid" }, svg);
    const plotLen = horiz ? W - m.l - m.r : H - m.t - m.b;
    const sv = (v) => ((v - lo) / (hi - lo || 1)) * plotLen;
    vt.forEach((v) => {
      if (horiz) {
        el("line", { x1: m.l + sv(v), x2: m.l + sv(v), y1: m.t, y2: H - m.b }, g);
        const t = el("text", { x: m.l + sv(v), y: H - m.b + 16, "text-anchor": "middle", class: "tick" }, svg);
        t.textContent = fmtNum(v, spec.y);
      } else {
        const y = H - m.b - sv(v);
        el("line", { x1: m.l, x2: W - m.r, y1: y, y2: y }, g);
        const t = el("text", { x: m.l - 8, y: y + 4, "text-anchor": "end", class: "tick" }, svg);
        t.textContent = fmtNum(v, spec.y);
      }
    });
    const nS = series.length;
    const slot = horiz ? band : (W - m.l - m.r) / cats.length;
    const thick = Math.min(spec.maxThick || 24, Math.max(2, (slot - 2) / nS - 2));
    const zero = sv(0);
    const showEvery = horiz ? 1 : Math.max(1, Math.ceil(cats.length / Math.floor((W - m.l - m.r) / 44)));
    cats.forEach((c, ci) => {
      if (horiz) {
        const t = el("text", { x: m.l - 8, y: m.t + ci * band + band / 2 + 4, "text-anchor": "end", class: "tick" }, svg);
        t.textContent = c;
        t.style.fill = "var(--ink-2)";
        t.style.fontSize = "12px";
      } else if (ci % showEvery === 0) {
        const t = el("text", { x: m.l + ci * slot + slot / 2, y: H - m.b + 16, "text-anchor": "middle", class: "tick" }, svg);
        t.textContent = c;
      }
      series.forEach((s, si) => {
        const v = s.values[ci];
        if (v == null) return;
        const len = Math.abs(sv(v) - zero);
        const off = (slot - nS * (thick + 2)) / 2 + si * (thick + 2);
        const r = Math.min(4, len / 2, thick / 2);
        let d;
        if (horiz) {
          const y = m.t + ci * band + off, x0 = m.l + zero, x1 = v >= 0 ? x0 + len : x0 - len;
          d = v >= 0
            ? `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + thick - r}Q${x1},${y + thick} ${x1 - r},${y + thick}H${x0}Z`
            : `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + thick - r}Q${x1},${y + thick} ${x1 + r},${y + thick}H${x0}Z`;
        } else {
          const x = m.l + ci * slot + off, y0 = H - m.b - zero, y1 = v >= 0 ? y0 - len : y0 + len;
          d = v >= 0
            ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + thick - r}Q${x + thick},${y1} ${x + thick},${y1 + r}V${y0}Z`
            : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + thick - r}Q${x + thick},${y1} ${x + thick},${y1 - r}V${y0}Z`;
        }
        const p = el("path", { d, fill: color((s.colors && s.colors[ci]) || s.color), class: "bar", tabindex: 0 }, svg);
        if (spec.valueLabels && horiz) {
          const t = el("text", { x: m.l + zero + (v >= 0 ? len + 6 : -len - 6), y: m.t + ci * band + off + thick / 2 + 4, "text-anchor": v >= 0 ? "start" : "end", class: "endlabel" }, svg);
          t.textContent = fmtNum(v, spec.y);
        }
        const show = (ev) => {
          tip.textContent = "";
          h("div", "h", tip, (spec.x && spec.x.name ? spec.x.name + " " : "") + c);
          series.forEach((s2) => s2.values[ci] != null && tipRow(tip, (s2.colors && s2.colors[ci]) || s2.color, fmtNum(s2.values[ci], spec.y.tip || spec.y), nS > 1 || spec.seriesInTip ? s2.name : "", true));
          const rb = svg.getBoundingClientRect(), pb = p.getBoundingClientRect();
          tipAt(box, tip, pb.left - rb.left + pb.width / 2, pb.top - rb.top);
          p.style.opacity = 0.8;
        };
        const hide = () => { tip.style.opacity = 0; p.style.opacity = 1; };
        p.addEventListener("pointerenter", show);
        p.addEventListener("focus", show);
        p.addEventListener("pointerleave", hide);
        p.addEventListener("blur", hide);
      });
    });
    if (horiz) el("line", { x1: m.l + zero, x2: m.l + zero, y1: m.t, y2: H - m.b, class: "baseline" }, svg);
    else el("line", { x1: m.l, x2: W - m.r, y1: H - m.b - zero, y2: H - m.b - zero, class: "baseline" }, svg);
    if (spec.x && spec.x.label) {
      const t = horiz
        ? el("text", { x: m.l + (W - m.l - m.r) / 2, y: H - 2, "text-anchor": "middle", class: "axis-label" }, svg)
        : el("text", { x: m.l + (W - m.l - m.r) / 2, y: H - 8, "text-anchor": "middle", class: "axis-label" }, svg);
      t.textContent = spec.x.label;
    }
    root._table = [[spec.x && spec.x.name || "", ...series.map((s) => s.name)], cats.map((c, i) => [c, ...series.map((s) => (s.values[i] == null ? "" : fmtNum(s.values[i], spec.y.tip || spec.y)))])];
  }

  // ---- categorical grid (policy maps) -------------------------------------
  function grid(root, spec) {
    header(root, spec);
    const lg = h("div", "legend", root);
    spec.classes.forEach((c) => {
      const it = h("span", "", lg);
      const i = h("i", "box", it);
      i.style.background = color(c.color);
      it.appendChild(document.createTextNode(c.name));
    });
    const box = h("div", "", root);
    box.style.position = "relative";
    const tip = h("div", "tip", box);
    const W = Math.max(260, root.clientWidth);
    const nx = spec.xs.length, ny = spec.ys.length;
    const m = { t: 6, r: 8, b: 44, l: 62 };
    const cw = (W - m.l - m.r) / nx;
    const ch = spec.plotHeight ? spec.plotHeight / ny : Math.min(28, Math.max(8, cw * (spec.aspect || 1)));
    const H = m.t + ny * ch + m.b;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": spec.title || "chart" }, box);
    const byName = Object.fromEntries(spec.classes.map((c) => [c.key, c]));
    for (let yi = 0; yi < ny; yi++) {
      for (let xi = 0; xi < nx; xi++) {
        const k = spec.cells[yi][xi];
        const c = byName[k];
        if (!c) continue;
        const x = m.l + xi * cw, y = m.t + (ny - 1 - yi) * ch;
        const gp = spec.gap == null ? 1 : spec.gap;
        const r = el("rect", { x: x + gp / 2, y: y + gp / 2, width: Math.max(0.5, cw - gp + (gp ? 0 : 0.6)), height: Math.max(0.5, ch - gp + (gp ? 0 : 0.6)), fill: color(c.color), rx: gp ? 1.5 : 0, class: "bar" }, svg);
        r.addEventListener("pointerenter", () => {
          tip.textContent = "";
          h("div", "h", tip, `${spec.xName} ${spec.xs[xi]}, ${spec.yName} ${spec.ys[yi]}`);
          tipRow(tip, c.color, c.name, "", true);
          const rb = svg.getBoundingClientRect(), pb = r.getBoundingClientRect();
          tipAt(box, tip, pb.left - rb.left + pb.width / 2, pb.top - rb.top);
        });
        r.addEventListener("pointerleave", () => { tip.style.opacity = 0; });
      }
    }
    const xe = Math.max(1, Math.ceil(nx / Math.floor((W - m.l - m.r) / 40)));
    spec.xs.forEach((v, i) => {
      if (i % xe) return;
      const t = el("text", { x: m.l + i * cw + cw / 2, y: m.t + ny * ch + 15, "text-anchor": "middle", class: "tick" }, svg);
      t.textContent = v;
    });
    const ye = Math.max(1, Math.ceil(ny / Math.floor((ny * ch) / 18)));
    spec.ys.forEach((v, i) => {
      if (i % ye) return;
      const t = el("text", { x: m.l - 8, y: m.t + (ny - 1 - i) * ch + ch / 2 + 4, "text-anchor": "end", class: "tick" }, svg);
      t.textContent = v;
    });
    const xl = el("text", { x: m.l + (W - m.l - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "axis-label" }, svg);
    xl.textContent = spec.xLabel;
    const yl = el("text", { x: 10, y: m.t + (ny * ch) / 2, "text-anchor": "middle", class: "axis-label", transform: `rotate(-90 10 ${m.t + (ny * ch) / 2})` }, svg);
    yl.textContent = spec.yLabel;
    root._table = [[`${spec.yName} \\ ${spec.xName}`, ...spec.xs.map(String)], spec.ys.map((y, yi) => [String(y), ...spec.cells[yi].map((k) => (byName[k] ? byName[k].name : ""))]).reverse()];
  }

  const KINDS = { line, bar, grid };

  function render(root) {
    const spec = root._spec || (root._spec = JSON.parse(root.querySelector("script[type='application/json']").textContent));
    const keep = root.querySelector("script[type='application/json']");
    const det = root.querySelector("details.data");
    const open = det && det.open;
    root.textContent = "";
    root.appendChild(keep);
    KINDS[root.dataset.kind](root, spec);
    if (root._table && spec.table !== false) {
      table(root, root._table[0], root._table[1]);
      if (open) root.querySelector("details.data").open = true;
    }
  }

  function all() {
    document.querySelectorAll(".chart[data-kind]").forEach((c) => {
      try { render(c); } catch (e) { console.error(e); }
    });
  }
  let lastW = 0, timer = null;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (Math.abs(window.innerWidth - lastW) < 8) return;
      lastW = window.innerWidth;
      all();
    }, 150);
  });
  document.addEventListener("DOMContentLoaded", () => { lastW = window.innerWidth; all(); });
})();
