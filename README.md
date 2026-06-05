# SVG Flattener

Converts Figma-exported SVG files into fully flattened SVG output — all shapes converted to `<path>` elements, transforms baked into absolute coordinates, `clip-path` and `mask` references resolved, and (optionally) wrapper groups dissolved — producing clean, portable SVG with no `transform=`, `clip-path=`, or `mask=` attributes.

---

## What It Does

| Step | What happens |
|---|---|
| **Flatten** | Converts `<rect>`, `<circle>`, `<ellipse>`, `<polygon>`, `<line>` → `<path>`; bakes all `transform=` attributes into absolute path coordinates |
| **Resolve clip-paths** | Clips descendant paths against their axis-aligned clip rectangles using Liang-Barsky line clipping and De Casteljau cubic subdivision |
| **Resolve masks** | Converts Figma inside-stroke masks into filled even-odd ring paths |
| **Dissolve groups** *(optional)* | Unwraps leaf `<g>` wrapper groups (those containing no sub-groups), propagating their style attributes down to child paths — reduces group count to match Figma's flattened output |

---

## Files

| File | Purpose |
|---|---|
| `flatten.js` | Third-party SVG flattening engine by [Timo](https://github.com/timo22345) (MIT). HTML wrapper — source of truth. |
| `flatten_core.js` | Pure JS extracted from `flatten.js` — browser-loadable as a `<script src>`. Generated from `flatten.js`. |
| `resolve_clips.js` | Pure-math clip-path and mask resolution + optional group dissolution. No external dependencies. |
| `test.html` | Browser upload UI — drag-drop or click to select an SVG, flatten it, and download the result. |
| `flatten_svg.js` | Node.js runner — reads `~/Downloads/mytest.svg`, opens a browser tab, and auto-downloads `mytest_flattened.svg`. |

---

## Usage

### Option 1 — Browser UI (recommended)

Open `test.html` directly in any modern browser (no server needed):

1. Open `test.html` in Chrome, Firefox, or Safari
2. Drop an SVG file onto the drop zone or click to browse
3. Choose whether to **Keep all groups** or **Dissolve leaf groups (Figma-like)**
4. Click **Flatten & Download**
5. The flattened SVG is saved to your downloads folder

> All processing happens locally in the browser. No data is sent anywhere.

---

### Option 2 — Node.js runner

Processes `~/Downloads/mytest.svg` and saves `~/Downloads/mytest_flattened.svg`.

**Requirements:** Node.js and a browser installed on your machine.

```bash
node flatten_svg.js
```

The script generates a temporary HTML page, opens it in your default browser, and the browser auto-downloads the result.

---

### Regenerating `flatten_core.js`

If you modify `flatten.js`, regenerate `flatten_core.js` with:

```bash
node -e "const fs=require('fs'); const raw=fs.readFileSync('flatten.js','utf8'); fs.writeFileSync('flatten_core.js', raw.split('<script>')[1]);"
```

---

## Credits

- **flatten.js** — © 2014 Timo (https://github.com/timo22345), MIT License
- **resolve_clips.js** — pure-math clip/mask/group implementation, written for this project
