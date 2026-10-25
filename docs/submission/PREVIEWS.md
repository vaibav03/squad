# `hackathon.py submit` previews (Tracks 3 and 2)

Run from `/Users/vaibav/Documents/projects/devhacks/cubbie-hackathon-kit/skills/cubbie-hackathon`. These commands are PREVIEWS. They never include `--yes`; only the owner adds `--yes`, after sign-in and review. The repo stays private until the owner says otherwise.

Owner decisions still open: team name, project names (suggestions: "Cubbie Study Group" for Track 3, "Cubbie Circle" for Track 2), member name and email, video link, website.

Pitch lengths (verified with a script): Track 3 pitch is 139 characters, Track 2 pitch is 140 characters (limit 140).

## Track 3 (groupchat)

```sh
python3 scripts/hackathon.py whoami && python3 scripts/hackathon.py status
python3 scripts/hackathon.py submit --track groupchat \
  --team "<team>" --name "<name: e.g. Cubbie Study Group>" \
  --pitch "@cubbie in your class group chat: answers doubts from your own course files with citations, quizzes the group, finds your first wrong step." \
  --member "<Your Name> <you@asu.edu>" \
  --repo https://github.com/vaibav03/squad/tree/main/docs/demo/track3 \
  --video <https unlisted video link>
# review the preview; the owner repeats with --yes
```

## Track 2 (agents)

```sh
python3 scripts/hackathon.py submit --track agents \
  --team "<team>" --name "<name: e.g. Cubbie Circle>" \
  --pitch "Each student gets a Cubbie agent that plans study sessions and trips with friends, shares only what it must, and asks you before it commits." \
  --member "<Your Name> <you@asu.edu>" \
  --repo https://github.com/vaibav03/squad/tree/main/docs/demo/track2 \
  --video <https unlisted video link>
# review the preview; the owner repeats with --yes
python3 scripts/hackathon.py mine && python3 scripts/hackathon.py gallery --track agents
```

## What was run, and what was not

- `whoami` reported "Not signed in. Run: login --google, or login --email <your email>".
- `status` reported Tracks 2 and 3 OPEN since Thu Oct 22 with no closing time set.
- A preview submit with placeholder fields was attempted and the tool answered "You're not signed in", so no real preview output exists yet. The owner must sign in first, then run the commands above and paste the preview output here.
