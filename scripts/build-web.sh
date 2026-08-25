#!/usr/bin/env bash
# Build the static single-player version (GitHub Pages) into docs/
set -e
cd "$(dirname "$0")/.."
rm -rf docs && mkdir docs
npx --yes esbuild web/entry.js --bundle --minify --outfile=docs/local-server.js
cp public/style.css public/client.js docs/
sed 's|<script src="client.js"></script>|<script src="local-server.js"></script>\n<script src="client.js"></script>|' public/index.html > docs/index.html
echo "Built docs/ for GitHub Pages"
