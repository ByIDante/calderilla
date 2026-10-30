#!/usr/bin/env bash
# Crea el acceso directo de Calderilla en el menú de aplicaciones y en el escritorio (Linux).
# Se abre sin terminal; para cerrarla, «Cerrar Calderilla» en Ajustes. Vuelve a ejecutarlo si cambias de versión de Node.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
node="$(command -v node || true)"
if [[ -z "$node" ]]; then
  echo "No encuentro Node.js. Instálalo (versión 24 o superior) y vuelve a ejecutar este script."
  exit 1
fi

lanzador="$HOME/.local/share/applications/calderilla.desktop"
mkdir -p "$(dirname "$lanzador")"
cat > "$lanzador" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Calderilla
Comment=Tus ingresos, gastos, ocio e inversiones
Exec=sh -c 'cd "$raiz" && exec "$node" src/main.ts'
Icon=$raiz/src/estatico/icono.svg
Terminal=false
Categories=Office;Finance;
DESKTOP
chmod +x "$lanzador"

escritorio="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [[ -d "$escritorio" ]]; then
  cp "$lanzador" "$escritorio/calderilla.desktop"
  chmod +x "$escritorio/calderilla.desktop"
  # En Cinnamon y GNOME, el icono del escritorio debe marcarse como de confianza para abrirse con doble clic
  gio set "$escritorio/calderilla.desktop" metadata::trusted true 2>/dev/null || true
fi
echo "Listo: busca «Calderilla» en el menú o haz doble clic en el icono del escritorio."
