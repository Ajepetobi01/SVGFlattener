/**
 * resolveClipsAndMasks(svgEl)
 *
 * Call this AFTER flatten(svgEl) so that every shape is already a <path>
 * with baked-in absolute coordinates and no residual transform= attributes.
 *
 * Pure-math implementation — no external libraries required.
 *
 * What it does:
 *  1. mask="url(#id)"
 *     Figma inside-stroke masks follow this pattern exactly:
 *       <mask fill="white"><path d="…axis-aligned rect…"/></mask>
 *       <path d="…same rect…" stroke="color" stroke-width="N" mask="url(#id)"/>
 *     We replace both elements with a single even-odd filled ring path
 *     (outer rect + inner rect inset by stroke-width/2), giving an identical
 *     visual to the inside-stroke effect.
 *
 *  2. clip-path="url(#id)"
 *     After flatten() the <clipPath> contains a single <path> whose
 *     coordinates are an axis-aligned rectangle. We clip every descendant
 *     <path> of the clipped element against that rectangle using:
 *       – Liang-Barsky algorithm for line segments.
 *       – Recursive De Casteljau subdivision for cubic Bézier segments.
 *
 *  3. Removes now-unused <clipPath> and <mask> definitions.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════════════════ */

  window.resolveClipsAndMasks = function (svgEl) {
    resolveMasks(svgEl);
    resolveClipPaths(svgEl);
    cleanupDefs(svgEl);
  };

  /* ── dissolveGroups ──────────────────────────────────────────────────────
   * Optional post-processing step.
   * Unwraps leaf <g> elements (those containing no sub-<g>) by propagating
   * their presentation attributes down to child elements, then replacing
   * the <g> with its children in the parent.
   * Runs bottom-up so inner groups are dissolved before outer ones.
   * ─────────────────────────────────────────────────────────────────────── */
  window.dissolveGroups = function (svgEl) {
    var INHERIT = [
      'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
      'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
      'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule'
    ];

    // Reverse document order → innermost groups first.
    var groups = Array.from(svgEl.querySelectorAll('g')).reverse();
    groups.forEach(function (g) {
      if (!g.parentNode) return;          // already detached
      if (g.querySelector('g')) return;   // still has sub-groups — skip

      // Collect presentation attrs set on this <g>.
      var inherited = {};
      INHERIT.forEach(function (attr) {
        var val = g.getAttribute(attr);
        if (val !== null) inherited[attr] = val;
      });

      // Push them down to each child element (only if child doesn't override).
      var children = Array.from(g.childNodes);
      children.forEach(function (child) {
        if (child.nodeType !== 1) return;
        Object.keys(inherited).forEach(function (attr) {
          if (child.getAttribute(attr) === null) {
            child.setAttribute(attr, inherited[attr]);
          }
        });
      });

      // Hoist children into parent, remove empty <g>.
      var parent = g.parentNode;
      children.forEach(function (child) { parent.insertBefore(child, g); });
      parent.removeChild(g);
    });
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     MASK RESOLUTION
     Replaces each <mask> + masked <path> pair with a filled even-odd ring.
  ═══════════════════════════════════════════════════════════════════════════ */

  function resolveMasks(svgEl) {
    var els = Array.from(svgEl.querySelectorAll('[mask]'));
    els.forEach(function (el) { resolveOneMask(svgEl, el); });
  }

  function resolveOneMask(svgEl, el) {
    var ref = el.getAttribute('mask') || '';
    var m = ref.match(/url\(#([^)]+)\)/);
    if (!m) { el.removeAttribute('mask'); return; }

    var maskDef = svgEl.querySelector('#' + cssEscape(m[1]));
    var maskPathEl = maskDef && maskDef.querySelector('path');
    var maskRect = maskPathEl ? pathToAARect(maskPathEl.getAttribute('d') || '') : null;

    if (!maskRect) {
      el.removeAttribute('mask');
      if (maskDef) maskDef.remove();
      return;
    }

    var stroke = el.getAttribute('stroke') || el.style.stroke || '';
    var sw = parseFloat(el.getAttribute('stroke-width') || el.style.strokeWidth || '0');

    if (!stroke || !(sw > 0)) {
      el.removeAttribute('mask');
      if (maskDef) maskDef.remove();
      return;
    }

    var hw = sw / 2;
    var x1 = maskRect.x1, y1 = maskRect.y1, x2 = maskRect.x2, y2 = maskRect.y2;

    // Outer rectangle (clockwise) + inner rectangle (clockwise, inset by hw)
    // fill-rule=evenodd renders the ring (donut) between them.
    var outer = 'M' + f(x1)      + ' ' + f(y1)      + 'H' + f(x2)      + 'V' + f(y2)      + 'H' + f(x1)      + 'Z';
    var inner = 'M' + f(x1 + hw) + ' ' + f(y1 + hw) + 'H' + f(x2 - hw) + 'V' + f(y2 - hw) + 'H' + f(x1 + hw) + 'Z';

    var NS = 'http://www.w3.org/2000/svg';
    var ring = document.createElementNS(NS, 'path');
    ring.setAttribute('d', outer + ' ' + inner);
    ring.setAttribute('fill', stroke);
    ring.setAttribute('fill-rule', 'evenodd');
    ring.setAttribute('clip-rule', 'evenodd');

    var elId = el.getAttribute('id');
    if (elId) ring.setAttribute('id', elId);

    el.parentNode.replaceChild(ring, el);
    if (maskDef) maskDef.remove();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CLIP-PATH RESOLUTION
     Clips every descendant <path> against the axis-aligned clip rectangle.
  ═══════════════════════════════════════════════════════════════════════════ */

  function resolveClipPaths(svgEl) {
    var els = Array.from(svgEl.querySelectorAll('[clip-path]'));
    els.forEach(function (el) { resolveOneClipPath(svgEl, el); });
  }

  function resolveOneClipPath(svgEl, el) {
    var ref = el.getAttribute('clip-path') || '';
    var m = ref.match(/url\(#([^)]+)\)/);
    if (!m) { el.removeAttribute('clip-path'); return; }

    var clipDef = svgEl.querySelector('#' + cssEscape(m[1]));
    var clipPathEl = clipDef && clipDef.querySelector('path');
    var clipRect = clipPathEl ? pathToAARect(clipPathEl.getAttribute('d') || '') : null;

    if (!clipRect) {
      el.removeAttribute('clip-path');
      if (clipDef) clipDef.remove();
      return;
    }

    // Collect all <path> descendants (plus el itself when it is a <path>)
    var paths = el.tagName.toLowerCase() === 'path'
      ? [el]
      : Array.from(el.querySelectorAll('path'));

    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var d = p.getAttribute('d');
      if (!d) continue;

      var segs = parsePath(d);

      // Fast path: entire bounding box is already inside the clip rectangle
      var bbox = segsBBox(segs);
      if (bbox &&
          bbox.x1 >= clipRect.x1 - 1e-9 && bbox.x2 <= clipRect.x2 + 1e-9 &&
          bbox.y1 >= clipRect.y1 - 1e-9 && bbox.y2 <= clipRect.y2 + 1e-9) {
        continue;
      }

      var clippedD = clipSegments(segs, clipRect);
      if (clippedD.trim()) {
        p.setAttribute('d', clippedD);
      } else {
        p.remove();
      }
    }

    el.removeAttribute('clip-path');
    if (clipDef) clipDef.remove();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PATH PARSING
     Converts an SVG path string to an array of absolute segments.
     Handles: M m L l H h V v C c Z z
     Other commands (S Q T A) are forwarded as-is as {cmd:'raw', raw:string}.
  ═══════════════════════════════════════════════════════════════════════════ */

  function parsePath(d) {
    var out = [];
    var re = /([MmLlHhVvCcZz])([^MmLlHhVvCcZz]*)/g;
    var match;
    var cx = 0, cy = 0, sx = 0, sy = 0;

    function nums(s) {
      return s.trim().split(/[\s,]+/).map(Number).filter(function (n) { return !isNaN(n); });
    }

    while ((match = re.exec(d)) !== null) {
      var cmd = match[1], args = nums(match[2]);
      var i;

      switch (cmd) {
        case 'M':
          for (i = 0; i + 2 <= args.length; i += 2) {
            cx = args[i]; cy = args[i + 1];
            out.push(i === 0 ? { cmd: 'M', x: cx, y: cy } : { cmd: 'L', x: cx, y: cy });
          }
          if (args.length >= 2) { sx = args[0]; sy = args[1]; }
          break;

        case 'm':
          for (i = 0; i + 2 <= args.length; i += 2) {
            cx += args[i]; cy += args[i + 1];
            out.push(i === 0 ? { cmd: 'M', x: cx, y: cy } : { cmd: 'L', x: cx, y: cy });
          }
          if (args.length >= 2) { sx = cx; sy = cy; }
          break;

        case 'L':
          for (i = 0; i + 2 <= args.length; i += 2) {
            cx = args[i]; cy = args[i + 1];
            out.push({ cmd: 'L', x: cx, y: cy });
          }
          break;

        case 'l':
          for (i = 0; i + 2 <= args.length; i += 2) {
            cx += args[i]; cy += args[i + 1];
            out.push({ cmd: 'L', x: cx, y: cy });
          }
          break;

        case 'H':
          for (i = 0; i < args.length; i++) { cx = args[i]; out.push({ cmd: 'L', x: cx, y: cy }); }
          break;

        case 'h':
          for (i = 0; i < args.length; i++) { cx += args[i]; out.push({ cmd: 'L', x: cx, y: cy }); }
          break;

        case 'V':
          for (i = 0; i < args.length; i++) { cy = args[i]; out.push({ cmd: 'L', x: cx, y: cy }); }
          break;

        case 'v':
          for (i = 0; i < args.length; i++) { cy += args[i]; out.push({ cmd: 'L', x: cx, y: cy }); }
          break;

        case 'C':
          for (i = 0; i + 6 <= args.length; i += 6) {
            cx = args[i + 4]; cy = args[i + 5];
            out.push({ cmd: 'C', x1: args[i], y1: args[i + 1],
                                  x2: args[i + 2], y2: args[i + 3], x: cx, y: cy });
          }
          break;

        case 'c':
          for (i = 0; i + 6 <= args.length; i += 6) {
            out.push({ cmd: 'C', x1: cx + args[i],     y1: cy + args[i + 1],
                                  x2: cx + args[i + 2], y2: cy + args[i + 3],
                                  x:  cx + args[i + 4], y:  cy + args[i + 5] });
            cx += args[i + 4]; cy += args[i + 5];
          }
          break;

        case 'Z': case 'z':
          out.push({ cmd: 'Z' });
          cx = sx; cy = sy;
          break;

        default:
          out.push({ cmd: 'raw', raw: match[0] });
          if (args.length >= 2) { cx = args[args.length - 2]; cy = args[args.length - 1]; }
          break;
      }
    }

    return out;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     BOUNDING BOX OF PARSED SEGMENTS (conservative — uses control-point hull)
  ═══════════════════════════════════════════════════════════════════════════ */

  function segsBBox(segs) {
    var xs = [], ys = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.cmd === 'M' || s.cmd === 'L') { xs.push(s.x); ys.push(s.y); }
      if (s.cmd === 'C') { xs.push(s.x1, s.x2, s.x); ys.push(s.y1, s.y2, s.y); }
    }
    if (!xs.length) return null;
    return {
      x1: Math.min.apply(null, xs), x2: Math.max.apply(null, xs),
      y1: Math.min.apply(null, ys), y2: Math.max.apply(null, ys)
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PATH → AXIS-ALIGNED RECTANGLE
     For a rectangular path the bounding box is the rectangle.
  ═══════════════════════════════════════════════════════════════════════════ */

  function pathToAARect(d) {
    if (!d) return null;
    var bbox = segsBBox(parsePath(d));
    if (!bbox || bbox.x2 - bbox.x1 < 1e-6 || bbox.y2 - bbox.y1 < 1e-6) return null;
    return bbox;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CLIP SEGMENTS AGAINST AN AXIS-ALIGNED RECTANGLE
  ═══════════════════════════════════════════════════════════════════════════ */

  function clipSegments(segs, rect) {
    var out = [];
    var cx = 0, cy = 0, sx = 0, sy = 0;
    var ocx = null, ocy = null;  // output cursor (null = no open subpath)

    function moveTo(x, y) {
      if (ocx === null || Math.abs(x - ocx) > 1e-6 || Math.abs(y - ocy) > 1e-6) {
        out.push('M' + f(x) + ' ' + f(y));
        ocx = x; ocy = y;
      }
    }

    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];

      if (seg.cmd === 'M') {
        cx = seg.x; cy = seg.y; sx = seg.x; sy = seg.y;
        ocx = null; ocy = null;
        continue;
      }

      if (seg.cmd === 'Z') {
        if (ocx !== null) out.push('Z');
        ocx = null; ocy = null;
        cx = sx; cy = sy;
        continue;
      }

      if (seg.cmd === 'raw') { out.push(seg.raw); continue; }

      if (seg.cmd === 'L') {
        var lp = liangBarsky(cx, cy, seg.x, seg.y, rect);
        if (lp) {
          moveTo(lp.x0, lp.y0);
          out.push('L' + f(lp.x1) + ' ' + f(lp.y1));
          ocx = lp.x1; ocy = lp.y1;
        }
        cx = seg.x; cy = seg.y;
        continue;
      }

      if (seg.cmd === 'C') {
        var pieces = clipCubicRec(
          { x: cx,     y: cy     },
          { x: seg.x1, y: seg.y1 },
          { x: seg.x2, y: seg.y2 },
          { x: seg.x,  y: seg.y  },
          rect, 0
        );
        for (var j = 0; j < pieces.length; j++) {
          var p = pieces[j];
          moveTo(p.p0.x, p.p0.y);
          if (p.line) {
            out.push('L' + f(p.p3.x) + ' ' + f(p.p3.y));
          } else {
            out.push('C' + f(p.p1.x) + ' ' + f(p.p1.y) + ' ' +
                          f(p.p2.x) + ' ' + f(p.p2.y) + ' ' +
                          f(p.p3.x) + ' ' + f(p.p3.y));
          }
          ocx = p.p3.x; ocy = p.p3.y;
        }
        cx = seg.x; cy = seg.y;
        continue;
      }
    }

    return out.join(' ');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     LIANG-BARSKY LINE CLIPPING
     Returns {x0,y0,x1,y1} for the visible portion, or null if entirely outside.
  ═══════════════════════════════════════════════════════════════════════════ */

  function liangBarsky(x0, y0, x1, y1, rect) {
    var dx = x1 - x0, dy = y1 - y0;
    var tE = 0, tL = 1;

    var edges = [
      { p: -dx, q: x0 - rect.x1 },
      { p:  dx, q: rect.x2 - x0 },
      { p: -dy, q: y0 - rect.y1 },
      { p:  dy, q: rect.y2 - y0 }
    ];

    for (var i = 0; i < edges.length; i++) {
      var p = edges[i].p, q = edges[i].q;
      if (Math.abs(p) < 1e-12) {
        if (q < -1e-9) return null;
      } else {
        var r = q / p;
        if (p < 0) tE = Math.max(tE, r);
        else       tL = Math.min(tL, r);
      }
    }

    if (tE >= tL - 1e-9) return null;
    return { x0: x0 + tE * dx, y0: y0 + tE * dy,
             x1: x0 + tL * dx, y1: y0 + tL * dy };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CUBIC BÉZIER CLIPPING — RECURSIVE DE CASTELJAU SUBDIVISION
     Returns array of {p0,p1,p2,p3,line} pieces inside rect.
  ═══════════════════════════════════════════════════════════════════════════ */

  function clipCubicRec(p0, p1, p2, p3, rect, depth) {
    var xs = [p0.x, p1.x, p2.x, p3.x], ys = [p0.y, p1.y, p2.y, p3.y];
    var bx1 = Math.min.apply(null, xs), bx2 = Math.max.apply(null, xs);
    var by1 = Math.min.apply(null, ys), by2 = Math.max.apply(null, ys);

    if (bx2 < rect.x1 - 1e-9 || bx1 > rect.x2 + 1e-9 ||
        by2 < rect.y1 - 1e-9 || by1 > rect.y2 + 1e-9) return [];

    if (bx1 >= rect.x1 - 1e-9 && bx2 <= rect.x2 + 1e-9 &&
        by1 >= rect.y1 - 1e-9 && by2 <= rect.y2 + 1e-9) {
      return [{ p0: p0, p1: p1, p2: p2, p3: p3, line: false }];
    }

    if (depth >= 8) {
      var lp = liangBarsky(p0.x, p0.y, p3.x, p3.y, rect);
      if (!lp) return [];
      var q0 = { x: lp.x0, y: lp.y0 }, q3 = { x: lp.x1, y: lp.y1 };
      return [{ p0: q0, p1: q0, p2: q3, p3: q3, line: true }];
    }

    var halves = splitCubic(p0, p1, p2, p3, 0.5);
    var L = halves.left, R = halves.right;
    return clipCubicRec(L[0], L[1], L[2], L[3], rect, depth + 1).concat(
           clipCubicRec(R[0], R[1], R[2], R[3], rect, depth + 1));
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DE CASTELJAU SPLIT — splits a cubic Bézier at parameter t
  ═══════════════════════════════════════════════════════════════════════════ */

  function splitCubic(p0, p1, p2, p3, t) {
    function lerp(a, b) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
    var q0 = lerp(p0, p1), q1 = lerp(p1, p2), q2 = lerp(p2, p3);
    var r0 = lerp(q0, q1), r1 = lerp(q1, q2);
    var s  = lerp(r0, r1);
    return { left: [p0, q0, r0, s], right: [s, r1, q2, p3] };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CLEANUP — removes leftover <clipPath> and <mask> elements and empty <defs>
  ═══════════════════════════════════════════════════════════════════════════ */

  function cleanupDefs(svgEl) {
    Array.from(svgEl.querySelectorAll('clipPath, mask')).forEach(function (el) { el.remove(); });
    Array.from(svgEl.querySelectorAll('defs')).forEach(function (def) {
      if (!def.children.length) def.remove();
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     UTILITIES
  ═══════════════════════════════════════════════════════════════════════════ */

  function f(n) { return +n.toFixed(4) + ''; }

  function cssEscape(id) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id);
    return id.replace(/([^\w-])/g, '\\$1');
  }

})();
