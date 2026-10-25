#!/bin/sh
# Own-port stack for e2e/multitab-matrix.mjs: hub 8995, web dev 5395, preview 5396, agents 4851-4854.
#   e2e/multitab-stack.sh up        hub + agents + vite dev (scripts/dev/all.ts)      -> pid file $RUN/all.pid
#   e2e/multitab-stack.sh preview   vite build (VITE_HUB_URL=hub) + vite preview 5396 -> pid file $RUN/preview.pid (needs `up`)
#   e2e/multitab-stack.sh down      stops ONLY the pids recorded in $RUN (never kills by name/port)
#   e2e/multitab-stack.sh status
# Run from the worktree you want to measure (ROOT = parent of this script's dir). RUN defaults to ./.multitab-run (gitignored? do not commit it).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${MT_RUN:-$ROOT/.multitab-run}"
HUB_PORT=8995; WEB_PORT=5395; PREV_PORT=5396; AGENT_BASE=4851
HUB="http://localhost:$HUB_PORT"
mkdir -p "$RUN"
spawn() { # name, cmd... : detached new session via node, writes pid
  name="$1"; shift
  node -e '
    const {spawn}=require("node:child_process"),fs=require("node:fs");
    const [log, pidf, ...cmd]=process.argv.slice(1);
    const fd=fs.openSync(log,"a");
    const c=spawn(cmd[0],cmd.slice(1),{detached:true,stdio:["ignore",fd,fd],cwd:process.cwd(),env:process.env});
    fs.writeFileSync(pidf,String(c.pid)); c.unref();' "$RUN/$name.log" "$RUN/$name.pid" "$@"
}
wait_url() { i=0; while [ $i -lt 120 ]; do curl -fs -o /dev/null "$1" && return 0; i=$((i+1)); sleep 1; done; echo "timeout waiting for $1" >&2; return 1; }
case "$1" in
  up)
    cd "$ROOT" || exit 1
    DEV_ALL_HUB_PORT=$HUB_PORT DEV_ALL_WEB_PORT=$WEB_PORT DEV_ALL_AGENT_PORT_BASE=$AGENT_BASE \
      HUB_CORS_ORIGINS="http://localhost:$PREV_PORT,http://localhost:$WEB_PORT" \
      spawn all pnpm exec tsx scripts/dev/all.ts
    wait_url "$HUB/health" && wait_url "http://localhost:$WEB_PORT/" && echo "up: hub $HUB web http://localhost:$WEB_PORT (pid $(cat "$RUN/all.pid"))" ;;
  preview)
    cd "$ROOT" || exit 1
    VITE_HUB_URL="$HUB" pnpm --filter @squad/web-host exec vite build >"$RUN/build.log" 2>&1 || { tail -20 "$RUN/build.log"; exit 1; }
    cd "$ROOT/apps/web-host" && spawn preview pnpm exec vite preview --port $PREV_PORT --strictPort
    wait_url "http://localhost:$PREV_PORT/" && echo "preview: http://localhost:$PREV_PORT (pid $(cat "$RUN/preview.pid"))" ;;
  down)
    for n in preview all; do
      [ -f "$RUN/$n.pid" ] || continue
      p=$(cat "$RUN/$n.pid"); kill -TERM "$p" 2>/dev/null   # all.ts reaps its own children; preview: also its group below
      [ "$n" = preview ] && kill -TERM -- "-$p" 2>/dev/null
      sleep 3; kill -0 "$p" 2>/dev/null && kill -KILL -- "-$p" 2>/dev/null
      rm -f "$RUN/$n.pid"; echo "stopped $n ($p)"
    done ;;
  status) for n in all preview; do [ -f "$RUN/$n.pid" ] && { p=$(cat "$RUN/$n.pid"); kill -0 "$p" 2>/dev/null && echo "$n running $p" || echo "$n dead"; }; done
    for u in "$HUB/health" "http://localhost:$WEB_PORT/" "http://localhost:$PREV_PORT/"; do curl -fs -o /dev/null "$u" && echo "ok $u" || echo "down $u"; done ;;
  *) sed -n 2,8p "$0"; exit 2 ;;
esac
