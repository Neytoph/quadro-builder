#!/usr/bin/env bash
# 按托管版的构建变量编一份（和主仓库 deploy/ship.sh 里那一行一致），给本地联调环境的 /builder/ 用。
set -euo pipefail
cd "$(dirname "$0")/.."
export VITE_SYNC_BASE=/quadro VITE_ANALYTICS_URL=/events \
  VITE_SHARE_API=/quadro/shares VITE_REGISTER_URL=/register VITE_LOGIN_URL=/login
export VITE_COMMUNITY_WRITE='{"zh":"/write.html","en":"/en/write.html","de":"/de/write.html"}'
export VITE_PUBLISH_PAGE='{"zh":"/publish.html","en":"/en/publish.html","de":"/de/publish.html"}'
export VITE_PUBLISH_API=/quadro/plaza/designs
./node_modules/.bin/vite build --base=/builder/
