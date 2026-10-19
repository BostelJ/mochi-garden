# Developing Mochi Garden

Notes for working on the app. The user-facing overview is in [README.md](README.md); cutting a
release is in [RELEASING.md](RELEASING.md).

## Code layout and checks

- The page (`ui/`) is plain JavaScript as ES modules, with no build step: `index.html` loads
  `main.js`, and every file imports what it uses. `tauri.js` is the bridge to the Rust side (and a
  no-op outside the app, so the modules also load in Node).
  - Sessions: `state.js` (plots, tabs, the tab in front), `persist.js` (garden.json),
    `sessions.js` (open/end/switch, the session list), `events.js` (hooks, tokens, the session
    registry), `demo.js` (MOCHI_DEMO), `main.js` (startup and wiring).
  - The garden: `garden.js` (world, camera, mochis), `farm.js` (land, coins, crops), `build.js`
    (the sessions' garden tools), `pieces.js`, `wardrobe.js`, `desk.js`, `town.js`, `sky.js`,
    `seeds.js`, `helpers.js`, `social.js`, `rewards.js`, `harvest.js`, `cards.js`, `usage.js`.
- `npm run check`: TypeScript checks the JavaScript through its JSDoc (`tsconfig.json`; the core
  shapes, like `Plot` and `Piece`, are in `ui/types.d.ts`). Nothing is compiled.
- `npm test`: Node's test runner on the garden's rules (`tests/`): coins, building and removing,
  placement, harvest, dressing up. `tests/setup.mjs` stands in for just enough of a browser.
- Rust: `cargo test --lib --manifest-path src-tauri/Cargo.toml`.
- GitHub runs all three on every push (`.github/workflows/check.yml`).
- In the app's devtools console, `mochi` holds every module's exports (`mochi.plots`,
  `mochi.buildPieces(...)`), which is how `tools/console.py` drives a test garden.
- The art preview tools (`tools/render_*.mjs`) run some page files as plain scripts in Node;
  `tools/ui-script.mjs` strips the module syntax for them.

Real Claude Code sessions in terminals beside a pixel garden. Each session is a mochi: it walks
in, builds a bench while the first answer is written, shows `!` when it's done and you haven't
looked, `?` when it needs you, and its plot grows with the session's lifetime tokens. While it
works it pops token seeds (`ui/seeds.js`): the app re-reads live transcripts every 400 ms, new
tokens go into a per-mochi bank, and the bank pays out as seeds (one per ~120 tokens, up to 40/s).
Seeds that land on open ground plant or water flowers (`ui/plants.js`, saved per plot). Replying
within 8 minutes of a mochi finishing builds a streak (`ui/rewards.js`): x3 golden seeds, x5 sparkle
trails and a glowing plot, x8 every colour. Seeds pop with pitched sounds ([ sound ] toggle). While
the window is in the background, every open session's mochi peeks up over the taskbar above the
tray (on a Mac, from the screen's bottom edge in the corner beside the Dock) (`ui/overlay.html`, [ tray ] toggle): working ones jiggle and shake seeds out, a "?" bounces
when one needs you, "!" when one is done. Clicking a mochi opens its session (the window lets
clicks through except over a mochi: `src/overlay.rs` polls the cursor against the page's rects,
in screen px). The taskbar button glows while mochis work.
Usage is the garden's water: each tab's status line (curl to `/status/<tab>`) reports Claude Code's
`rate_limits` (`ui/usage.js`). The garden shows them as sky (`ui/sky.js`): what's left of the 5-hour
window is the time of day (morning → golden hour → dusk → night with fireflies and lanterns; a reset
is a sunrise) and what's left of the week is the season (spring → summer → autumn → winter; a reset
is a burst of spring petals). The side panel shows both as smooth bars. Subagents are helper mochis (`ui/helpers.js`): SubagentStart throws a
piece of the parent onto the grass below its plot, tool use inside the subagent keeps it busy, and
SubagentStop brings it home with its transcript's tokens.

- Install: `src-tauri/target/release/bundle/nsis/Mochi Garden_0.1.0_x64-setup.exe` (build with
  `npx tauri build --bundles nsis`), or run `src-tauri/target/release/mochi-garden.exe` directly.
  On a Mac: `npx tauri build --bundles app,dmg` makes `Mochi Garden.app` (and a .dmg) under
  `src-tauri/target/release/bundle/`; drag the app into /Applications.
- Update your own install: `npm run ship` (works from a session inside the garden). It builds into
  `src-tauri/target-ship`, stages the build in the data folder and hands it to the running app
  (`/update` on the hook port, token from `app.json`; `src/update.rs`, `ui/update.js`). The app
  installs it once no mochi is working or asking and nothing has been typed for 20 s: a detached
  helper waits for it to quit, swaps the exe (Windows) or .app (Mac), and starts it again, back in
  the tray if it was there. Open sessions resume. If the app isn't running, ship installs at once.
- Terminal: Ctrl+C copies a selection (else interrupts), Ctrl+V pastes, right-click copies/pastes,
  Ctrl+click opens links. Pasting a screenshot (clipboard holds only an image) sends Claude Code its
  image-paste key (Alt+V on Windows, Ctrl+V on a Mac) so it attaches the image. On a Mac, Cmd
  replaces Ctrl for the app's keys: Cmd+C/V, Cmd+click, Cmd+T/W, Cmd+1..9. App keys: Ctrl+Shift+T new, Ctrl+Shift+W end, Ctrl+Tab / Ctrl+Shift+Tab,
  Ctrl+1..9. Closing asks: keep running in the tray, or quit; open sessions come back on launch.
- Click a mochi for its card (`ui/cards.js`): allow/deny a permission, pick a question's answer, or
  reply in place. Idle mochis visit neighbours and the town square (`ui/social.js`, `ui/town.js`),
  which grows with the garden's lifetime tokens; each week ends with a harvest summary (`ui/harvest.js`).
- Icons: `tools/icon.py <png>` draws the Windows one; `node tools/icon_mac.mjs` writes the Mac's
  `icon.icns` and its menu bar template icon (`tray-mac.png`).
- Art in `ui/art/` comes from approved concept sheets, sampled back to true pixels: crops by
  `tools/extract_crops.py`; the desk, typewriter frames, fence pieces and lantern post by
  `tools/extract_sprites.py` (cuts every object out, measuring the fake-pixel size from outlines).
  Detailed small things don't survive that sampling, so the desk and typewriter are hand-pixelled
  in code (`ui/desk.js`); `node tools/render_desk.mjs <png>` renders them for a quick look.
- New session: `[ + new ]` or Ctrl+T. Click a mochi to open its terminal. Only open sessions are in
  the garden: ending one (`x`, Ctrl+Shift+W, `/exit`) closes its tab and its mochi packs up and walks
  off; its garden is kept, and resuming that session (`/resume`, `--continue`, attaching to a
  background job) walks it back in. `/clear` packs the old conversation away and a new mochi arrives.
- `[ quality ]` draws the garden at the display's full refresh rate (otherwise 30 fps while things
  move, 15 when it's still).
- How it works: each tab runs `claude --session-id <id> --settings <tab>.json --mcp-config
  <tab>.mcp.json`; the settings file adds HTTP hooks posting every event to the app (`src/hooks.rs`),
  which reads token usage and the AI title from the session transcript. Data:
  `%APPDATA%\MochiGarden\garden.json`, raw events in `hooks.log`.
- Gardens are built by their sessions, if they want to. The MCP config gives each session the app's
  `garden` tools (`src/mcp.rs`, handled in `ui/build.js`): `look` (a text map of its garden, its
  wallet, the catalog and the wardrobe), `build`, `remove`, `dress` (free: head, neck, face and
  back items in any colour, drawn by `ui/wardrobe.js`; until a session dresses itself, its age's
  scarf and hats show), `name` (its name goes big on the sign, the topic below) and `harvest` (eat a
  ripe crop, or have its mochi carry it to a neighbour, who finds it among its gifts in `look`).
  Nothing announces ripe crops; a session finds them only if it looks. The server's instructions are one neutral line
  saying the plot is there to use whenever it likes, or never; nothing nudges it, and the tools are
  pre-allowed so building never asks you. Coins: a wallet of 250 to start, plus 1 coin per 100 tokens the
  session uses; prices run from 40 (a path tile) to 1,000 (a shed). A garden has no fixed shape: it's the desk corner plus whatever was built, and can grow to any
  free grass within 2 tiles of what it already has (a tile clear of neighbours and the town square).
  The mochi walks out and builds each piece. Pieces are hand-pixelled in `ui/pieces.js` (preview:
  `node tools/render_pieces.mjs <png>`).
- The garden is an 80x56-tile world seen through a camera (`ui/garden.js`) that frames the gardens:
  close in on a first mochi, easing out (in whole device pixels) as gardens are added around the
  middle. Token seeds still fall on their own (`ui/farm.js`): on soil pieces they grow crops, on bare
  grass wildflowers. Mochis type on an animated typewriter (`ui/desk.js`).
- Dev switches: `MOCHI_DATA_DIR=<folder>` (a scratch garden: always use it for tests), `MOCHI_DEMO=1`
  (`MOCHI_DEMO_ONLY=<title>` for a single demo plot) (one plot per growth stage), `MOCHI_AUTOSTART=1` +
  `MOCHI_TEST_PROMPT` + `MOCHI_TEST_CWD` (start a session and type a prompt).
  `tools/shot.ps1 <png> [-Title ...]` screenshots a window; with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, `tools/console.py "<title>" "<js>"`
  evaluates JS in a page (`window.__errors` holds uncaught errors).
