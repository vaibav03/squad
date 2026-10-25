# Interior events: director verbs

`packages/interior/src/agents/director.ts` is pure (no Phaser, no timers): `direct(event, config) -> Command[]`. The scene executes commands. Adapter v2 (spec 10 A-2) can adopt it as is. Tested in `src/agents/agents.test.ts`.

## Commands
| Command | Meaning |
|---|---|
| `ensure {agent}` | spawn the agent's character if absent (stable skin from a hash of the id) |
| `goto {agent, goal}` | walk by A* to a goal (below); unreachable goals are ignored |
| `lock {door, locked}` | lock or unlock a door by id; locked doors block pathfinding and show the locked sprite |
| `marker {agent, marker}` | `waiting` ring bubble, `check`, `alert` (red "!"), or `none` |
| `gather {room}` | every known agent walks to that room |
| `announce {text}` | polite live-region text (a11y) |

## Goals (three verbs)
- `room {room, prefer?}`: a free waypoint of the room (optionally with name prefix), spread across occupied ones, seeded random.
- `waypoint {name}`: a named point such as `commons.hearth`, `council.seat-3`; if occupied, a free sibling with the same stem.
- `door {door, side: 'a'|'b'}`: the tile just outside a door on that room's side (`door.<id>.a|b` waypoint, else computed).

## Event mapping
| VillageEvent | Commands |
|---|---|
| `agent.state` idle | go to room `commons`; marker none |
| `agent.state` studying | go to room `library` (prefer `library.aisle`) |
| `agent.state` in_call | go to `commons.hearth` |
| `agent.state` waiting_for_student | go to council door side a; marker waiting |
| `agent.message` | sender to `commons.center`, recipient (if not `commons`) to `commons.hearth`; conflict adds alert |
| `confirm.pending` / `confirm.done` | student to council door with waiting marker / check marker and unlock council door |
| `council.opinion` | unlock council door; member to `council.seat-N` (stable per member, 5 seats); dissent adds alert |
| `council.rank` / `council.verdict` | unlock council door; verdict dissenter gets alert |
| `quiz.question` | target student to room `classroom` (prefer `classroom.desk`) |
| `call.start` | agent to `commons.hearth` |
| `trip.confirmed` | gather all in `commons` |
| others | no commands |

The council door id defaults to `door-commons-council` (`DirectorConfig.councilDoor`). Waypoint and room names are the demo map's contract.
