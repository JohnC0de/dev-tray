#!/bin/bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
bin_dir="$HOME/.local/bin"
quickshell_dir="${XDG_CONFIG_HOME:-$HOME/.config}/quickshell"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    echo "Dev Tray needs $bin_dir on PATH in the graphical session." >&2
    echo "Add 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to your session environment, then rerun this installer." >&2
    exit 1
    ;;
esac

npm --prefix "$repo_root/apps/linux" run build
mkdir -p "$bin_dir" "$quickshell_dir"
ln -sfn "$repo_root/apps/linux/dist/dev-tray-linux" "$bin_dir/dev-tray-linux"
ln -sfn "$repo_root/apps/linux/quickshell" "$quickshell_dir/dev-tray"

echo "Installed dev-tray-linux in $bin_dir and Quickshell config 'dev-tray' in $quickshell_dir."
echo "Keep $bin_dir on PATH in the graphical session."
echo "Start it with: qs -c dev-tray -d"
