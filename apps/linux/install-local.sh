#!/bin/bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

npm --prefix "$repo_root/apps/linux" run build
mkdir -p "$HOME/.local/bin" "$HOME/.config/quickshell"
ln -sfn "$repo_root/apps/linux/dist/dev-tray-linux" "$HOME/.local/bin/dev-tray-linux"
ln -sfn "$repo_root/apps/linux/quickshell" "$HOME/.config/quickshell/dev-tray"

echo "Installed dev-tray-linux and Quickshell config 'dev-tray'."
echo "Start it with: qs -c dev-tray -d"
