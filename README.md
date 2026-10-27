# Eight Ball Club — 8-Ball Pool

Complete source for a browser game with bot matches (Easy, Medium, Hard), local two-player matches, and server-authoritative private WebSocket rooms.

## Run

Install Node.js 22 or newer, open a terminal in this folder, and run:

```sh
node server.js
```

Open http://localhost:3000 in a modern browser. There are no npm dependencies to install. The server serves the browser files and private rooms. Bot and same-device play run entirely in the browser; they can also be served by any static HTTP server.

Do not open index.html directly with a file:// URL: browser module security requires HTTP.

## Controls

- Start a match, then click a clear point behind the head string to place the cue ball. The placement button accepts its current position.
- Move the mouse, or drag the table on touch devices, to aim.
- After the break, call a ball and pocket with the dropdowns or by clicking the ball and pocket. From aim suggests a call; check the highlighted pocket before shooting.
- Drag the power meter and deliberately release it to shoot. Pointer cancellation does not shoot. With keyboard focus on the meter, arrows adjust power and Enter shoots.
- Drag the contact point on the spin diagram. Up gives follow, down gives draw, and left/right changes cushion behavior. Home resets spin when that diagram has focus.
- Arrow keys, mouse wheel, and precision buttons fine-tune aim. Shift reduces the adjustment increment.
- Escape opens Settings. Local simulation pauses in Settings; online play continues.
- A safety passes the turn even if a ball is pocketed.

## Two players

Choose Play vs Player → Same device for local play.

For two browser windows on one computer, choose Play vs Player → Private room. Create a room in one window, join its six-character code in the other. Use separate tabs or browser profiles so each client has its own session storage.

For separate devices on the same network, bind the server to your network interface:

PowerShell:

```powershell
$env:HOST = '0.0.0.0'
node server.js
```

macOS/Linux:

```sh
HOST=0.0.0.0 node server.js
```

Each player opens http://YOUR-SERVER-IP:3000 and uses the same room code. A localhost invite only works on the server computer; use the server's reachable address for other devices. Internet play requires hosting this Node process at a reachable address, normally behind an HTTPS reverse proxy that supports WebSocket upgrades. This project does not provision internet hosting or router forwarding.

The server owns physics, ball positions, rules, turns, placement, and shot validation. It rejects out-of-turn, duplicate, non-finite, and invalid actions. A disconnected player's table pauses and allows approximately 60 seconds to reconnect. Refreshing the same tab resumes using a private session token. Both players must request a rematch. Rooms are held in memory and are lost when the server restarts.

## Rules and simulation

Uses WPA-style called shots, open-table group assignment, first-contact and rail-after-contact tracking, scratches, ball in hand, break choices, 8-ball spotting, and called-pocket 8-ball wins/losses. Player 1 takes the first break; rematches alternate. The rules reference is https://www.wpapool.com/wp-content/uploads/2026/01/2026.01.02-WPA-Rules.pdf.

This is a planar billiards simulation with sphere inertia, sliding-to-rolling friction, restitution, follow/draw and side-spin cushion coupling. It is not a full three-dimensional simulator: jump, massé, airborne balls, and human-referee judgments are outside its model. There is no tournament lag or referee stalemate procedure.

## Tests

```sh
node --test test/*.test.js
```

The 26 automated checks passed: rack geometry, collision momentum, cut shots, cushions, spin, combinations, pocket mouths, settling, deterministic breaks, prediction, rules, placement and action validation, bot decisions, room creation/joining, authoritative rejection, reconnect, rematch, and leaving.

Browser visual and touch QA was not completed: the available preview attempt timed out. The automated checks do not establish device-specific browser rendering or touch behavior.

## Files

- index.html / style.css: interface and responsive layout.
- js/ball.js / physics.js: ball state and fixed 240 Hz simulation.
- js/rules.js / game.js: adjudication and game state transitions, shared with the server.
- js/ai.js: geometry, cloned simulations, difficulty, and safety selection.
- js/renderer.js / cue.js / aiming.js: canvas artwork, cue, and guides.
- js/input.js / spin.js / ui.js / audio.js: controls and presentation.
- js/main.js: local orchestration and game loop.
- js/multiplayer.js: browser WebSocket client and reconnect.
- server.js / js/websocket-server.js: HTTP service, private rooms, and WebSocket transport.
- test/: automated tests using the built-in Node test runner.
