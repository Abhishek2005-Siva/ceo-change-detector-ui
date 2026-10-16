#!/usr/bin/env bash
# Builds the Kaggle server kernel into ./out (secrets are filled in here; ./out is git-ignored and deleted after pushing).
# Needs in ../../.env : NGROK_AUTHTOKEN, NGROK_DOMAIN, SEC_USER_AGENT   and   API_KEY_FILE (path to the service API key)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/../../../.env}"
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
OUT="$HERE/out"; rm -rf "$OUT"; mkdir -p "$OUT"
( cd "$HERE/.." && zip -qr "$OUT/app.zip" app -x '*__pycache__*' '*.pyc' )
node -e '
const fs=require("fs"); const [, tpl, zip, out, key, ua, tok, dom, hours, idle]=process.argv;
let s=fs.readFileSync(tpl,"utf8");
const rep={__APP_B64__:fs.readFileSync(zip).toString("base64"),__API_KEY__:fs.readFileSync(key,"utf8").trim(),__SEC_UA__:ua,__NGROK_TOKEN__:tok,__NGROK_DOMAIN__:dom,__RUN_HOURS__:hours,__IDLE_MINUTES__:idle};
for (const [k,v] of Object.entries(rep)) { if(!v) { console.error("missing value for "+k); process.exit(1) } s=s.split(k).join(v) }
fs.writeFileSync(out,s)' "$HERE/server_template.py" "$OUT/app.zip" "$OUT/server.py" "${API_KEY_FILE:?set API_KEY_FILE}" "$(get SEC_USER_AGENT)" "$(get NGROK_AUTHTOKEN)" "$(get NGROK_DOMAIN)" "${RUN_HOURS:-11}" "${IDLE_MINUTES:-45}"
rm -f "$OUT/app.zip"
cat > "$OUT/kernel-metadata.json" <<JSON
{
  "id": "thanujamanjunath/filinglens-server",
  "title": "filinglens-server",
  "code_file": "server.py",
  "language": "python",
  "kernel_type": "script",
  "is_private": true,
  "enable_gpu": true,
  "enable_tpu": false,
  "enable_internet": true,
  "dataset_sources": ["thanujamanjunath/filinglens-adapters"],
  "competition_sources": [],
  "kernel_sources": []
}
JSON
echo "built $OUT ($(du -h "$OUT/server.py" | cut -f1))"
