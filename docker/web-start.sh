#!/bin/sh
set -eu
/bin/sh /opt/elyqreth/web-check.sh
config=/usr/share/nginx/html/access-config.json
if test -f /run/config/access-config.json; then config=/run/config/access-config.json; fi
# Publish only a validated enum snapshot, never the operator's mounted input file.
mode=$(awk 'BEGIN {RS="\0"} {if(length($0)>1024 || $0 !~ /^[[:space:]]*\{[[:space:]]*"mode"[[:space:]]*:[[:space:]]*"(disabled|local|oidc)"[[:space:]]*\}[[:space:]]*$/) exit 1; if($0 ~ /"disabled"/) print "disabled"; else if($0 ~ /"local"/) print "local"; else if($0 ~ /"oidc"/) print "oidc"; else exit 1}' "$config")
printf '{"mode":"%s"}\n' "$mode" > /tmp/elyqreth-public-access.json
nginx -t
exec nginx -g 'daemon off;'
