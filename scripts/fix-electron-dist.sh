#!/bin/sh
# El instalador de npm del paquete `electron` extrae el zip sin conservar
# los enlaces simbólicos del framework, y el Electron de castLabs
# (github:castlabs/electron-releases, ver package.json) queda sin poder
# arrancar ("Library not loaded: @rpath/Electron Framework.framework").
# Este script re-extrae el zip descargado con `ditto`, que sí los
# conserva. Correrlo después de cada `npm install` / `npm ci`.
set -e
cd "$(dirname "$0")/.."
VERSION="$(node -e "process.stdout.write(require('electron/package.json').version)")"
ARCH="$(uname -m | sed 's/x86_64/x64/')"
ZIP="$(find "$HOME/Library/Caches/electron" -name "electron-v${VERSION}-darwin-${ARCH}.zip" 2>/dev/null | head -1)"
if [ -z "$ZIP" ]; then
  URL="https://github.com/castlabs/electron-releases/releases/download/v${VERSION}/electron-v${VERSION}-darwin-${ARCH}.zip"
  ZIP="/tmp/electron-v${VERSION}-darwin-${ARCH}.zip"
  echo "descargando $URL"; curl -fL -o "$ZIP" "$URL"
fi
rm -rf node_modules/electron/dist/Electron.app
ditto -x -k "$ZIP" node_modules/electron/dist
"node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" --version
