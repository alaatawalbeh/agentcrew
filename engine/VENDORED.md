# Vendored engine: Paseo

`engine/vendor/paseo/` is a **pristine** copy of part of [getpaseo/paseo](https://github.com/getpaseo/paseo), never edited
by hand. All changes live in `engine/patches/`.

| | |
|---|---|
| Upstream | https://github.com/getpaseo/paseo |
| Release | v0.15.4 |
| Commit | `1c00b365c9e0b74c1580eba33d905d693125ae21` (2026-11-10, "chore(release): cut 0.15.4") |
| Vendored | 2026-11-13 |
| License | Apache-2.0, with an upstream preamble. See `vendor/paseo/LICENSE`. |

**Copied:**
- `packages/{server,protocol,client,plugin,relay,highlight}`
- `skills/`
- the root `package.json`, `package-lock.json` (used for the pinned dependency versions) and `tsconfig.base.json`
- `LICENSE`
- `patches/@opencode-ai+sdk+1.14.46.patch` (upstream's only engine-related dependency patch)

**Not copied:** the React Native app, desktop app, CLI, website, built-in plugins (`plugins/`) and everything else.

## How it's used

1. `node engine/build/prepare.mjs` makes `engine/work/`, which is gitignored. It is a copy of the vendored tree with:
   - the workspace trimmed to the six engine packages
   - React and React Native dropped from `@getpaseo/plugin`'s dev and peer dependencies (the server only uses its
     non-UI parts)
   - every patch in `engine/patches/` applied in order
2. `node engine/build/build.mjs` installs the pinned dependencies inside `engine/work/` with `--ignore-scripts`,
   applies the upstream dependency patch, and compiles the packages. Terminals, voice, the opencode bridge and the
   built-in plugins are not built.

## Updating to a newer Paseo release

`engine/build/check-updates.mjs` does this beside the real engine, in `engine/candidate/` (gitignored):

1. `node engine/build/check-updates.mjs` lists releases newer than the vendored one.
2. `node engine/build/check-updates.mjs --try <tag>` fetches only the paths above from that tag, re-applies every patch
   (listing all that fail, not just the first), builds it and runs the engine tests against it. It also lists which
   patched files changed upstream. Nothing in `vendor/` or `work/` changes.
   - If a patch fails, fix it against `engine/candidate/work` and regenerate it with `node engine/build/make-patch.mjs`.
3. `node engine/build/check-updates.mjs --adopt` replaces `vendor/paseo/` with the tried release and updates the table
   above. The old copy is kept in `engine/candidate/previous/`.
4. Then: `npm run engine:prepare && npm run engine:build && npm run test:engine`, and the end-to-end test.

## Patches

Each file in `engine/patches/` starts with a comment saying what it changes and why. Files changed by a patch count as
"modified by Agent Crew" for the Apache-2.0 notice requirement (section 4b).
