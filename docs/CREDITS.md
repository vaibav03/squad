# Credits and licenses

Squad uses no Cubbie assets or branding. Authoritative license tables and texts live next to the assets: `assets/pixel/LICENSES.md` (with `assets/pixel/_licenses/`), `assets/fluent-characters/LICENSES.md`, `assets/fluent-objects/LICENSES.md`, `assets/fonts/*/OFL.txt`. This page summarizes them; if they disagree, the files next to the assets win.

## Modern Interiors by LimeZu (NOT in this repository)

[Modern Interiors](https://limezu.itch.io/moderninteriors) by LimeZu is licensed to the repository owner. It is **not redistributed in this repo**: it lives only in the git-ignored folder `assets/vendor/` on the owner's machine, and a CI guard is specified to fail the build if pack files or their hashes appear under `assets/` (`docs/specs/10-interior-campus.md`). The repo ships a CC0 placeholder atlas (`assets/interior/placeholder/`) instead, and a recipe file (`assets/interior/vendor-recipe.example.json`) that lets the owner point the engine at their own copy. No screenshot in this repo's docs shows pack art.

Required credit line, shown in the app footer and in any recording or screenshot of a build that uses the pack:

> World art: Modern Interiors by LimeZu

Anyone who clones this repo does not get the pack and must buy their own license to use it.

## Pixel art (`assets/pixel/`)

All sources allow commercial use and modification. Credit lines are courtesy unless stated. Rejected for license reasons: Tiny RPG Character Pack (Zerie) and Citizens 1 (Ulerinn) (no redistribution), Sidescroller City Scapes (CC BY-NC), Village Landscape (OGA, CC BY, unused).

| Pack | Source | License | Credit line |
| --- | --- | --- | --- |
| Ninja Adventure Asset Pack (characters, monsters, FX, UI, emotes, interiors, items) | https://pixel-boy.itch.io/ninja-adventure-asset-pack | CC0 1.0 | Pixel-boy and AAA |
| Autumn Town (buildings, characters, enemies, day and night backgrounds) | https://nirva.itch.io/autumntown | Author statement: free to use and edit in commercial or personal projects without credit. Not a formal CC license. | Nirva. `Props_TownNight_litwindows.png` is our derived edit. |
| Kenney: Pixel Platformer, Farm Expansion, Tiny Town, Roguelike Characters, Pixel UI Pack, UI Pack Pixel Adventure, Emotes Pack | https://kenney.nl | CC0 | Kenney |
| Gothicvania collection, Sideview Fantasy sprites | https://opengameart.org/content/gothicvania-patreons-collection | CC0 and public domain | Luis Zuno (@ansimuz) |
| Village Buildings, Windmill, Hills Scenery Background, Pixel Clouds, Stone Fence and Street Lamp, Chimney Smoke, Campfire, Animated Emote Bubbles, Pixel Platformer Characters | OpenGameArt (URLs in `assets/pixel/LICENSES.md`) | CC0 | OpenGameArt contributors |
| Generated village parallax layers (day and night, 12 layers each) | Made for this project | CC0 | none |
| Composed cast, props and UI sprites (`assets/pixel/composed/`) | Derived from the packs above by this project | Follow the source licenses | tracked in the license files |

## Characters and objects (`assets/fluent-characters/`, `assets/fluent-objects/`)

| Asset | Source | License | Credit line |
| --- | --- | --- | --- |
| Avatars, personas, champion and boss characters, hero objects | [Microsoft Fluent Emoji, 3D](https://github.com/microsoft/fluentui-emoji) | MIT (text in `assets/fluent-characters/LICENSE-fluentui-emoji-MIT.txt`) | Character art: Microsoft Fluent Emoji, (c) Microsoft Corporation, MIT License. No Microsoft endorsement is implied. |
| Icons | [Lucide](https://github.com/lucide-icons/lucide) | ISC | Lucide contributors |
| Lottie: typing dots, success check | airbnb/lottie-ios samples | Apache-2.0 | keep the notice |
| Lottie: confetti, celebrate, loading pulse | LottieFiles/dotlottie-web samples | MIT | keep the notice |
| Lottie: lock unlocking | Jefferson González Castillo via LottieFiles | Lottie Simple License | author credit |
| Dot-grid and plus-grid patterns | Made for this project | CC0 | none |

## Fonts (`assets/fonts/`)

| Font | Copyright | License |
| --- | --- | --- |
| Inter | The Inter Project Authors (https://github.com/rsms/inter) | SIL OFL 1.1 |
| Jersey 10 | The Soft Type Project Authors (https://github.com/scfried/soft-type-jersey) | SIL OFL 1.1 |
| Silkscreen | The Silkscreen Project Authors (https://github.com/googlefonts/silkscreen) | SIL OFL 1.1 |

## Course material

Introductory Statistics 2e, Barbara Illowsky, Susan Dean and OpenStax contributors, OpenStax, Rice University, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), free at https://openstax.org/details/books/introductory-statistics-2e. We extracted page ranges of four chapters unchanged. No endorsement by OpenStax or Rice University is implied.

## Open-source dependencies (summary)

Direct runtime dependencies, from the workspace `package.json` files; each keeps its own license, see its package page. Dev tools (TypeScript, Vitest, ESLint, Prettier, tsx) are omitted.

| Area | Packages |
| --- | --- |
| Server | `hono`, `@hono/node-server`, `ws`, `pino`, `dotenv`, `better-sqlite3` |
| Validation | `zod` |
| LLM | `@google/genai` (Gemini) |
| Crypto | `@noble/curves`, `@noble/hashes` |
| Documents and images | `unpdf`, `sharp` |
| Chat transports | `@photon-ai/imessage-kit`, `discord.js` |
| Web | `react`, `react-dom`, `react-router-dom`, `lucide-react` |
| Village | `phaser`, `easystarjs` |
