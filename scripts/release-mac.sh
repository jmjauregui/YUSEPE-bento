#!/bin/sh
# Genera los instalables de macOS (DMG + zip) A PARTIR de la app ya firmada
# con VMP en dist/mac. electron-builder arma su DMG y su zip ANTES de que
# firmemos, así que los que deja `npm run package:mac` llevan una app sin
# firma y Netflix no reproduce en ellos (y su dmg-builder necesita un
# python que macOS ya no trae). Orden correcto:
#   npm run package:mac && npm run vmp-sign && npm run release:mac
# Sale con error si la app de dist/mac no tiene firma VMP válida.
set -e
cd "$(dirname "$0")/.."
APP="dist/mac/YUSEPE Bento.app"
[ -d "$APP" ] || { echo "no existe $APP (¿corriste npm run package:mac?)"; exit 1; }
/usr/bin/python3 -m castlabs_evs.vmp -n verify-pkg dist/mac | grep -q "Signature is valid" \
  || { echo "dist/mac NO tiene firma VMP válida: corre npm run vmp-sign primero"; exit 1; }
VERSION="$(node -e "process.stdout.write(require('./package.json').version)")"
ZIP="dist/YUSEPE Bento-$VERSION-mac.zip"
DMG="dist/YUSEPE Bento-$VERSION.dmg"
rm -f "$ZIP" "$DMG" dist/*.blockmap

# zip: ditto conserva los enlaces simbólicos del framework (unzip/zip no).
ditto -c -k --keepParent "$APP" "$ZIP"

# DMG: carpeta con la app + enlace a /Applications, imagen comprimida.
STAGE="$(mktemp -d)"
ditto "$APP" "$STAGE/YUSEPE Bento.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "YUSEPE Bento $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

# Comprueba que lo que quedó adentro del zip es la app firmada.
CHECK="$(mktemp -d)"; ditto -x -k "$ZIP" "$CHECK"
/usr/bin/python3 -m castlabs_evs.vmp -n verify-pkg "$CHECK" | tail -1
rm -rf "$CHECK"
ls -la "$ZIP" "$DMG"
