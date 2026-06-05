#!/usr/bin/env node
// Reads ~/Downloads/mytest.svg, embeds it in a self-contained HTML page,
// opens the page in the default browser, which then runs flatten() and
// auto-downloads the result as ~/Downloads/mytest_flattened.svg.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const svgPath = path.join(os.homedir(), 'Downloads', 'mytest.svg');
const flattenJsPath = path.join(__dirname, 'flatten.js');
const outHtmlPath = path.join(os.tmpdir(), 'flatten_runner.html');

const svgContent = fs.readFileSync(svgPath, 'utf8');
// flatten.js is an HTML wrapper — extract the JS from inside <script>
const flattenJs = fs.readFileSync(flattenJsPath, 'utf8').split('<script>')[1];
const resolveClipsJs = fs.readFileSync(path.join(__dirname, 'resolve_clips.js'), 'utf8');

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Flatten runner</title></head>
<body>
<p id="status">Processing...</p>
<div id="container" style="position:absolute;left:-9999px;top:-9999px;width:10000px;height:10000px;"></div>
<script>
${flattenJs}
<\/script>
<script>
${resolveClipsJs}
<\/script>
<script>
(function () {
  var svgSource = ${JSON.stringify(svgContent)};

  // Inject SVG into a visible-but-offscreen container so getScreenCTM() works
  var container = document.getElementById('container');
  container.innerHTML = svgSource;
  var svgEl = container.querySelector('svg');

  if (!svgEl) {
    document.getElementById('status').textContent = 'Error: no <svg> found in the file.';
    return;
  }

  // Give the browser a tick to lay out the SVG before measuring
  requestAnimationFrame(function () {
    try {
      flatten(svgEl);
      resolveClipsAndMasks(svgEl);

      var serializer = new XMLSerializer();
      var result = serializer.serializeToString(svgEl);
      // Ensure proper SVG header
      if (!result.startsWith('<?xml')) {
        result = '<?xml version="1.0" encoding="utf-8"?>\\n' + result;
      }

      var blob = new Blob([result], { type: 'image/svg+xml' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mytest_flattened.svg';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);

      document.getElementById('status').textContent =
        'Done! mytest_flattened.svg has been downloaded to your Downloads folder. You can close this tab.';
    } catch (e) {
      document.getElementById('status').textContent = 'Error during flatten: ' + e.message;
      console.error(e);
    }
  });
})();
</script>
</body>
</html>`;

fs.writeFileSync(outHtmlPath, html, 'utf8');
console.log('Generated:', outHtmlPath);
console.log('Opening in browser...');
execSync('open ' + JSON.stringify(outHtmlPath));
console.log('Done. Check your Downloads folder for mytest_flattened.svg once the browser page loads.');
