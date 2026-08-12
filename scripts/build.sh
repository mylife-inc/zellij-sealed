#!/usr/bin/env bash
#
# Zellij's build, run by CI after CodeSeal has decrypted the repository.
#
# By the time this runs, `specs/`, `engine/` and `cli/crates/` exist as
# plaintext on the runner and the key material that decrypted them has already
# been destroyed — the `codeseal-decrypt` action does that before it returns.
# Nothing here needs a secret, and nothing here should ask for one.
#
# The commands mirror .github/workflows/ci.yml, on purpose. A sealed repository
# that builds differently from the plaintext one proves the sealing works and
# nothing else; the point is that the SAME build runs on a repository GitHub
# cannot read.
#
# This lives here rather than in the sealed repository because the sealed
# repository is derived: everything in it comes from this tree, so anything
# that exists only there is one re-seal away from being lost.
set -euo pipefail

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- decryption

# Prove the decryption happened before spending ten minutes discovering it did
# not. Without this, a failed decrypt surfaces as a TypeScript error about a
# missing module — which reads as a code problem and sends you looking in
# entirely the wrong place.
say "Checking the working tree was decrypted"
missing=""
for f in engine/packages/zellij/package.json \
         cli/crates/zellij-core/Cargo.toml \
         specs/zellij-engine-spec.md; do
  [ -s "$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
  echo "build: these should exist and do not:$missing" >&2
  echo "build: the repository was not decrypted — check the dispatch token." >&2
  exit 1
fi
echo "  decrypted: engine, cli/crates, specs"

# ------------------------------------------------------------------ the engine

say "Installing dependencies"
# Plain `npm ci`, exactly as upstream CI runs it.
#
# It was `npm ci --install-links` here, which failed with "Missing:
# @shebka/zellij@ from lock file". `--install-links` changes how `file:`
# workspace dependencies resolve — packed rather than symlinked — and the
# lockfile was generated without it, so npm correctly reported the tree and the
# lock disagreeing. The flag belongs where the wrapper app is installed inside
# a container, not here.
npm ci

say "Type-checking every workspace"
npm run typecheck

say "Engine unit tests"
# `npx vitest run --root …` rather than `npm run test`, matching upstream.
npx vitest run --root engine/packages/zellij

say "Building the engine package"
npm run build --workspace @shebka/zellij

# ------------------------------------------------------------------- the CLI

say "CLI format"
(cd cli && cargo fmt --all --check)

say "CLI lint"
(cd cli && cargo clippy --workspace --all-targets -- -D warnings)

say "CLI tests"
(cd cli && cargo test --workspace)

say "Build complete"
