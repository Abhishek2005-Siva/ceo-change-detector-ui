#!/usr/bin/env bash
# Starts (or restarts) the FilingLens model server on Kaggle. Build first: API_KEY_FILE=... ./build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export KAGGLE_API_TOKEN="${KAGGLE_API_TOKEN:-$HOME/.kaggle_accounts/thanujamanjunath/access_token}"
kaggle kernels push -p "$HERE/out"
rm -rf "$HERE/out"   # it contained the API key and ngrok token
echo "Pushed. Boot + model loading takes a few minutes. Status: kaggle kernels status thanujamanjunath/filinglens-server"
