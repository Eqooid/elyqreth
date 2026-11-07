#!/bin/sh
set -eu
fail() { echo "Invalid edge configuration: $1" >&2; exit 1; }
# No free-form nginx directives, URLs or shell evaluation can enter the template.
host=${EDGE_HOST:-}
printf '%s\n' "$host" | awk 'length($0)>253 || $0 !~ /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/ || $0 !~ /\./ || $0 ~ /\.\.|\.-|-\./ {exit 1} {n=split($0,a,".");for(i=1;i<=n;i++)if(length(a[i])>63)exit 1}' || fail EDGE_HOST
[ -n "$host" ] || fail EDGE_HOST
port=${EDGE_HTTPS_PORT:-443}
case "$port" in ''|*[!0-9]*) fail EDGE_HTTPS_PORT;; esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || fail EDGE_HTTPS_PORT
[ "$port" = "$(printf '%d' "$port")" ] || fail EDGE_HTTPS_PORT
authority=$host
[ "$port" = 443 ] || authority="$host:$port"
case ${EDGE_HSTS:-on} in on) hsts='max-age=31536000';; off) hsts='';; *) fail EDGE_HSTS;; esac
for file in /run/secrets/tls_certificate /run/secrets/tls_private_key; do
    [ -f "$file" ] && [ ! -L "$file" ] && [ -r "$file" ] && [ -s "$file" ] || fail TLS_files
    [ "$(wc -c < "$file")" -le 65536 ] || fail TLS_files
done
# Compose file-backed secrets retain host permissions; reject permissive Linux key modes.
mode=$(stat -c %a /run/secrets/tls_private_key)
case "$mode" in 400|440|600|640) ;; *) fail TLS_key_permissions;; esac
sed -e "s/@@HOST@@/$host/g" -e "s/@@AUTHORITY@@/$authority/g" -e "s/@@PORT@@/$port/g" -e "s/@@HSTS@@/$hsts/g" /opt/elyqreth/edge/nginx.conf.template > /tmp/edge-nginx.conf
nginx -t -c /tmp/edge-nginx.conf
exec nginx -c /tmp/edge-nginx.conf -g 'daemon off;'
