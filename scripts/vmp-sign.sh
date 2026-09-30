#!/bin/sh
# Firma VMP (Verified Media Path) de la app empaquetada, requisito para
# que el CDM de Widevine reproduzca contenido protegido (Netflix, etc.).
# Usa el servicio EVS de castLabs: hace falta una cuenta (gratuita):
#   /usr/bin/python3 -m pip install --user castlabs-evs
#   /usr/bin/python3 -m castlabs_evs.account signup      (una vez)
# Se corre DESPUÉS de `npm run package:mac` y ANTES de cualquier firma de
# Apple (que hoy no hacemos). Firma el directorio que contiene el .app.
set -e
PKG_DIR="${1:-dist/mac}"
[ -d "$PKG_DIR" ] || { echo "no existe $PKG_DIR (¿corriste npm run package:mac?)"; exit 1; }
/usr/bin/python3 -m castlabs_evs.vmp sign-pkg "$PKG_DIR"
/usr/bin/python3 -m castlabs_evs.vmp verify-pkg "$PKG_DIR"
