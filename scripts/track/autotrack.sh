#!/usr/bin/env bash
# Background loop that keeps docs/tracking/* committed on origin/main.
#
#   scripts/track/autotrack.sh start     # start the loop in the background (survives the shell)
#   scripts/track/autotrack.sh stop      # stop it and release the lock
#   scripts/track/autotrack.sh status    # running? last log lines, last tracker commit
#   scripts/track/autotrack.sh once      # one cycle in the foreground (what the loop runs)
#
# Safety: it never touches the main checkout or any lead's worktree. All work happens in a
# dedicated detached worktree ($SQUAD_WT_DIR/tracker) that is reset to origin/main each cycle.
# It stages `docs/tracking` explicitly (never `git add -A`), refuses to commit anything else,
# rebases onto origin/main before pushing, and never force-pushes. No secrets are read or logged.
set -uo pipefail

SELF="${BASH_SOURCE[0]}"
case "$SELF" in /*) ;; *) SELF="$PWD/$SELF" ;; esac

COMMON=$(git -C "$(dirname "$SELF")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
DEFAULT_MAIN="${COMMON%/.git}"
SQUAD_MAIN="${SQUAD_MAIN:-${DEFAULT_MAIN:-/Users/vaibav/Documents/projects/devhacks/squad}}"
SQUAD_WT_DIR="${SQUAD_WT_DIR:-$(dirname "$SQUAD_MAIN")/squad-wt}"
TRACKER="${TRACKER:-$SQUAD_WT_DIR/tracker}"
LOG="${AUTOTRACK_LOG:-/tmp/squad-autotrack.log}"
PIDFILE="${AUTOTRACK_PIDFILE:-/tmp/squad-autotrack.pid}"
LOCK="${AUTOTRACK_LOCK:-/tmp/squad-autotrack.lock}"
INTERVAL="${AUTOTRACK_INTERVAL:-600}"
RUN_COPY="/tmp/squad-autotrack-run.sh"
TRAILER="Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }
tg() { git -C "$TRACKER" "$@"; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# ---- lock (mkdir is atomic; a lock whose pid is dead is stale) -----------------
acquire() {
  if mkdir "$LOCK" 2>/dev/null; then echo $$ >"$LOCK/pid"; return 0; fi
  old=$(cat "$LOCK/pid" 2>/dev/null || true)
  if alive "$old"; then return 1; fi
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null && echo $$ >"$LOCK/pid" && return 0
  return 1
}
release() { [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"; }

ensure_tracker() {
  if [ ! -e "$TRACKER/.git" ]; then
    git -C "$SQUAD_MAIN" fetch origin --quiet >>"$LOG" 2>&1
    git -C "$SQUAD_MAIN" worktree add --detach "$TRACKER" origin/main >>"$LOG" 2>&1 || return 1
  fi
}

shas() { grep -o '^- `[0-9a-f]\{7,\}`' "$1" 2>/dev/null | tr -d '`- ' | sort -u; }

cycle() {
  ensure_tracker || { log "ERROR cannot create tracker worktree"; return 1; }
  tg fetch --all --prune --quiet >>"$LOG" 2>&1 || { log "ERROR fetch failed"; return 1; }
  tg rebase --abort >/dev/null 2>&1
  tg reset --hard --quiet origin/main || return 1
  tg clean -fdq -- docs/tracking

  runner="$TRACKER/scripts/track/track.sh"
  [ -x "$runner" ] || runner="$(dirname "$SELF")/track.sh"
  [ -f "$runner" ] || { log "ERROR track.sh not found"; return 1; }
  summary=$(TRACK_REPO="$TRACKER" TRACK_NO_FETCH=1 bash "$runner" 2>>"$LOG") || { log "ERROR track.sh failed"; return 1; }

  if [ -z "$(tg status --porcelain -- docs/tracking)" ]; then
    log "no change ($summary)"
    return 0
  fi

  # new commits = shas present in the regenerated changelog but not in the committed one
  tg show HEAD:docs/tracking/CHANGELOG.md >/tmp/squad-autotrack.old 2>/dev/null || : >/tmp/squad-autotrack.old
  shas /tmp/squad-autotrack.old >/tmp/squad-autotrack.old.s
  shas "$TRACKER/docs/tracking/CHANGELOG.md" >/tmp/squad-autotrack.new.s
  new=$(comm -13 /tmp/squad-autotrack.old.s /tmp/squad-autotrack.new.s | wc -l | tr -d ' ')
  nb=$(printf '%s' "$summary" | sed -n 's/.*branches=\([0-9]*\).*/\1/p')

  tg add docs/tracking
  bad=$(tg diff --cached --name-only | grep -v '^docs/tracking/' || true)
  if [ -n "$bad" ]; then
    log "ERROR refusing to commit files outside docs/tracking: $bad"
    tg reset --quiet
    return 1
  fi
  tg commit --quiet -m "track: ${nb:-?} branches, $new new commits" -m "$TRAILER" >>"$LOG" 2>&1 || { log "ERROR commit failed"; return 1; }

  i=0
  while [ "$i" -lt 4 ]; do
    i=$((i + 1))
    tg fetch origin --quiet >>"$LOG" 2>&1
    if ! tg rebase origin/main >>"$LOG" 2>&1; then
      tg rebase --abort >/dev/null 2>&1
      log "ERROR rebase conflict, dropping this cycle"
      tg reset --hard --quiet origin/main
      return 1
    fi
    if tg push origin HEAD:main >>"$LOG" 2>&1; then
      log "pushed $(tg rev-parse --short HEAD): track: ${nb:-?} branches, $new new commits"
      return 0
    fi
    log "push rejected (attempt $i), retrying"
    sleep 3
  done
  log "ERROR push failed after retries"
  return 1
}

once() {
  if ! acquire; then log "another cycle is running, skipping"; return 0; fi
  trap 'release' EXIT
  cycle
  rc=$?
  release
  trap - EXIT
  return $rc
}

loop() {
  existing=$(cat "$PIDFILE" 2>/dev/null || true)
  if alive "$existing" && [ "$existing" != "$$" ]; then log "loop already running as $existing"; exit 0; fi
  echo $$ >"$PIDFILE"
  trap 'log "loop $$ stopping"; rm -f "$PIDFILE"; release; exit 0' TERM INT HUP
  log "loop $$ started, interval ${INTERVAL}s, tracker $TRACKER"
  while :; do
    once || log "cycle failed (see above)"
    sleep "$INTERVAL" &
    wait $!
  done
}

start() {
  existing=$(cat "$PIDFILE" 2>/dev/null || true)
  if alive "$existing"; then echo "already running (pid $existing)"; return 0; fi
  cp "$SELF" "$RUN_COPY" && chmod +x "$RUN_COPY"
  export SQUAD_MAIN SQUAD_WT_DIR TRACKER AUTOTRACK_LOG AUTOTRACK_PIDFILE AUTOTRACK_LOCK AUTOTRACK_INTERVAL
  AUTOTRACK_LOG="$LOG" AUTOTRACK_PIDFILE="$PIDFILE" AUTOTRACK_LOCK="$LOCK" AUTOTRACK_INTERVAL="$INTERVAL"
  if command -v perl >/dev/null 2>&1; then
    nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' bash "$RUN_COPY" loop </dev/null >>"$LOG" 2>&1 &
  else
    nohup bash "$RUN_COPY" loop </dev/null >>"$LOG" 2>&1 &
  fi
  sleep 2
  p=$(cat "$PIDFILE" 2>/dev/null || true)
  if alive "$p"; then echo "started (pid $p), log $LOG"; else echo "failed to start, see $LOG" >&2; return 1; fi
}

stop() {
  p=$(cat "$PIDFILE" 2>/dev/null || true)
  if alive "$p"; then
    pkill -TERM -P "$p" 2>/dev/null
    kill -TERM "$p" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do alive "$p" || break; sleep 1; done
    alive "$p" && kill -KILL "$p" 2>/dev/null
    echo "stopped (pid $p)"
  else
    echo "not running"
  fi
  rm -f "$PIDFILE"
  lp=$(cat "$LOCK/pid" 2>/dev/null || true)
  alive "$lp" || rm -rf "$LOCK"
}

status() {
  p=$(cat "$PIDFILE" 2>/dev/null || true)
  if alive "$p"; then echo "running (pid $p), interval ${INTERVAL}s"; else echo "not running"; fi
  echo "log: $LOG"
  tail -n 5 "$LOG" 2>/dev/null | sed 's/^/  /'
  if [ -e "$TRACKER/.git" ]; then
    echo "last tracker commit on origin/main:"
    git -C "$TRACKER" log origin/main --grep='^track: ' -1 --format='  %h %ad %s' --date=format:'%Y-%m-%d %H:%M' 2>/dev/null
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  once) once ;;
  loop) loop ;;
  *) echo "usage: $0 start|stop|status|once" >&2; exit 2 ;;
esac
