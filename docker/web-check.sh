#!/bin/sh
set -eu
root=/usr/share/nginx/html
for file in index.html js/app.js js/runtime/index.js js/runtime/access/session.js assets/characters.png; do
 test -s "$root/$file" || { echo 'Required frontend asset unavailable.' >&2; exit 1; }
done
config="$root/access-config.json"
if test -f /run/config/access-config.json; then config=/run/config/access-config.json; fi
validate() {
 awk 'BEGIN {RS="\0"} {if(length($0)>1024 || $0 !~ /^[[:space:]]*\{[[:space:]]*"mode"[[:space:]]*:[[:space:]]*"(disabled|local|oidc)"[[:space:]]*\}[[:space:]]*$/) exit 1; seen=1} END {if(!seen) exit 1}' "$1" || { echo 'Public access configuration invalid.' >&2; exit 1; }
}
validate "$config"
if test "${1:-}" = live; then validate /tmp/elyqreth-public-access.json; fi
