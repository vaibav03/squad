#!/bin/sh
# Swap the build-time sentinel for the real public origin (e.g. https://squad.example.com).
set -eu
ORIGIN="${PUBLIC_ORIGIN:-http://localhost:8080}"
ORIGIN="${ORIGIN%/}"
HOST_PART="${ORIGIN#*://}"
# Sentinel is "http://__SQUAD_PUBLIC_ORIGIN__"; replace the whole URL.
grep -rl "__SQUAD_PUBLIC_ORIGIN__" /usr/share/nginx/html/static 2>/dev/null | while read -r f; do
  sed -i "s#http://__SQUAD_PUBLIC_ORIGIN__#${ORIGIN}#g" "$f"
done
echo "squad-web: public origin ${ORIGIN} (host ${HOST_PART}), hub upstream ${HUB_UPSTREAM:-hub:8788}"
