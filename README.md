# Agent Crew

A desktop control room for a crew of Claude Code agents, built from the design in `design/robot-crew-1a.svg`.

**Personal use only for now.** It drives your own `claude` login, so ask Anthropic before sharing it (see the plan).

**Status: local agents and crew features work.**
- **The crew:** twelve robots. The six from the design always show; the other six join the sidebar when you give them a session.
- **New session dialog:** pick a free robot, a task, a repo and its base branch, the model and the permission mode. Under
  "More options" you can add extra folders, allow rules and "Trust this repo's Claude settings". Anything that gives a
  robot more than the defaults is confirmed in a native dialog the page can't answer.
- **How a robot works:** in its own worktree (branch `crew-<robot>-<task>`), with live plan cards, tool rows, streamed
  replies and approval cards. Esc stops it. Typing a task to a sleeping robot still works too: you're asked for a repo.
- **Notifications:** a desktop notification when a robot needs your approval or gets stuck while the window isn't in
  front. Clicking it shows that robot.
- **Session header:** Changes (the diff against the base branch, plus new files), Open folder, and Archive. Archive asks
  whether to remove the worktree, and always keeps the branch.

**Not yet:** remote hosts (phase 3).

## Run it

```bash
npm install              # also downloads the Electron binary (npm here skips dependencies' install scripts)
npm run engine:prepare   # engine/work = vendored Paseo engine + Agent Crew's patches (engine/VENDORED.md)
npm run engine:build     # pinned install (no install scripts) + compile the engine
npm run dev              # Electron window with hot reload; starts the engine in the background
npm run dev:web          # the UI alone in a browser: http://127.0.0.1:5174  (?scenario=design = exactly the design)
npm test                 # unit tests (faces, sample crew, New session helpers, diff parsing)
npm run test:engine      # tests that pin the engine patches (needs the engine built)
npm run build            # typecheck + production build into out/
npm start                # run the production build
```

Real agents need Claude Code on this machine, signed in to your own account:

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude auth login
```

## Package it (AppImage)

```bash
npm run package          # build + stage the engine + release/Agent-Crew-<version>-x86_64.AppImage (~145 MB)
node scripts/smoke-packaged.mjs /tmp/ac-pkg release/Agent-Crew-0.1.0-x86_64.AppImage
```

- **The engine in the package:** `engine/build/stage.mjs` copies only its runtime files into `engine/stage` (~160 MB).
  The Agent SDK's bundled Claude Code binaries (~470 MB), terminals, voice, esbuild and typescript are left out.
  `scripts/after-pack.cjs` puts the stage in the app's resources, outside the asar archive.
- **Electron fuses:** no running as plain Node, no `NODE_OPTIONS` or `--inspect`, the app loads only from its asar,
  and no extra file:// privileges.
- **Runtime:** it uses the newer static AppImage runtime, so it runs with FUSE 3 (Ubuntu 24.04+) without libfuse2.
- **What the smoke test checks:** the window opens, the bundled engine starts and finds Claude Code, the production CSP
  applies, and the renderer runs sandboxed (seccomp filter and its own PID namespace, read from `/proc`).

## Tests with real agents

```bash
node scripts/e2e-app.mjs /tmp/ac-e2e     # the real app + real agents (Haiku), with screenshots (uses a little of your plan)
npm run engine:smoke -- /tmp/ac-smoke    # start the engine on its own and check auth from outside
node engine/build/record.mjs /tmp/ac-rec test/fixtures/engine-session.jsonl   # re-record the event fixture
```

The e2e script works through the real UI:
1. It gives sleeping Atlas a task and answers its approval cards.
2. It opens Atlas's Changes view.
3. It starts Rook from the New session dialog, in its own worktree.
4. It archives Rook, which removes Rook's worktree and keeps its branch.

It uses development-only test hooks: `AGENT_CREW_TEST_REPO`, `AGENT_CREW_TEST_MODEL`, `AGENT_CREW_TEST_MODE` and
`AGENT_CREW_TEST_ARCHIVE`, the archive dialog's answer. It runs with its own `--user-data-dir`. A packaged app ignores
those hooks.

## The engine

Agent Crew runs [Paseo](https://github.com/getpaseo/paseo)'s agent engine (Apache-2.0, v0.15.4), built from a pinned
copy in `engine/vendor/paseo`.
- **How it runs:** it's started as an Electron utility process. It listens on a private Unix socket under
  `$XDG_RUNTIME_DIR/agent-crew/`, and its password is handed over in memory. Its records live in
  `~/.config/agent-crew/engine` (owner-only), and worktrees in `~/.config/agent-crew/worktrees`.
- **What the patches change** (`engine/patches/`):
  - **0001:** the engine refuses everyone when it has no password, and there's no credential-file login, so agents
    can't sign in to it.
  - **0002:** no bypass mode, no raw CLI flags, and only your own Claude settings (no repo `.claude` settings or
    CLAUDE.md) unless you trust the repo in the New session dialog.
  - **0003:** no self-update from npm, and no hub.
  - **0004:** no automatic branch renaming, so branches keep the names Agent Crew gives them and no hidden model
    call runs on your plan.
- **Agents' extra rules:** every agent also gets deny rules for your secrets (`~/.ssh`, `~/.claude`, `.env*` and
  more) and for the engine's private folder.
- **What the launcher turns off:** the relay, plugins, usage polling, MCP, voice, push, the web UI and hidden
  background agents.

### Engine updates

```bash
npm run engine:check-updates                         # newer Paseo releases than the vendored one
node engine/build/check-updates.mjs --try v0.16.0    # fetch it into engine/candidate/, re-apply the patches, build, run the engine tests
node engine/build/check-updates.mjs --adopt          # make the tried release the vendored one (old copy kept in engine/candidate/previous/)
```

`--try` never touches `engine/vendor` or `engine/work`. It downloads only the vendored paths (a sparse, shallow clone of
the tag) and installs dependencies with `--ignore-scripts`. It reports which patched files changed upstream.

## Faces

The robots' faces are animated (`src/renderer/src/robots/robotFaceElement.ts`, ported from `design/robot-face.js`):
each shows its robot's status, and follows "reduce motion". The app icon is Atlas's pixel face from the design
(`npm run icon`).

## Try in the sample crew

- **+ New session:** the full dialog, with sample repos and models. Rook and the others join the sidebar.
- **Vega** waits on an approval. Allow once, Always allow, or Deny, and watch it carry on.
- **Sable** is asleep. Type a task to wake it.
- **Juno** is paused. Use Resume, in the sidebar or the transcript.
- **Nova** hit a usage limit. Use Try again.
- **Atlas's Changes** button shows its edits as a diff.
- **Broadcast to all** sends one message to every agent that's awake.
- **Esc** stops a running turn, and clicking a tool row opens its diff or output.

## Security baseline

- **The window:**
  - sandboxed, with `contextIsolation`, no Node in the page and no webviews
  - served from `app://crew`, with a strict CSP: no inline scripts or styles and no remote content
  - navigation and new windows blocked, and every device permission denied
- **The preload** exposes one function per crew action, never raw IPC. Main checks that every call comes from the
  main window's top frame and origin, and validates its arguments.
- **Folders** are chosen only in native dialogs shown by main. The page only ever holds opaque tokens for them.
