#!/usr/bin/env bash
#
# What publishing `zel` means, in one place.
#
#     scripts/publish.sh binary    v0.1.0 x86_64-unknown-linux-gnu [outdir]
#     scripts/publish.sh checksums [dir]
#     scripts/publish.sh release   v0.1.0 [dir]
#
# There were three copies of this before: the `binaries` job in
# `.github/workflows/release.yml`, `zrelease-local` in `scripts/app.sh`, and —
# once the engine repository was sealed — whatever the sealed repository's
# publish workflow was going to grow. Three copies of "build it, tar it, hash
# it" is three places for the archive name to drift, and the archive name is
# the contract the installer reads.
#
# So the workflows call this, the local release calls this, and a sealed
# repository calls this after CodeSeal has decrypted `cli/`. A runner needs no
# knowledge of the project beyond which target it is on.
#
# `bash` rather than `sh`: this runs on runners and on developer machines, both
# of which have it. `install.sh` is POSIX because it runs on whatever a user
# happens to have, which is a different problem.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DEFAULT="$ROOT/dist"

# The public repository that holds artefacts for several private projects.
# Releases in it are named for the project that produced them, so `zellij-v0.1.0`
# and not `v0.1.0` — `install.sh` looks for exactly that prefix.
RELEASES_REPO="${ZELLIJ_RELEASES_REPO:-mylife-inc/releases}"
SCOPE="${ZELLIJ_RELEASE_SCOPE:-zellij}"

say()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# sha256, wherever we are. Linux runners have `sha256sum`; macOS has `shasum`.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"
  else shasum -a 256 "$@"
  fi
}

require_version() {
  case "${1:-}" in
    v*) ;;
    '') die "A version is required, e.g. v0.1.0" ;;
    *)  die "Versions start with v — try v${1}" ;;
  esac
}

# --------------------------------------------------------------------- binary
#
# Build one target and leave `<name>.tar.gz` and `<name>.tar.gz.sha256` in the
# output directory.
#
# The checksum travels with the binary because `install.sh` refuses to install
# without one — a download it cannot verify is a download it will not run.
cmd_binary() {
  local version="${1:-}" target="${2:-}" out="${3:-$DIST_DEFAULT}"
  require_version "$version"
  [ -n "$target" ] || die "A target is required, e.g. x86_64-unknown-linux-gnu"

  command -v cargo >/dev/null 2>&1 || die "cargo is required and was not found."

  # In a sealed repository `cli/crates` exists only after CodeSeal has run. A
  # missing workspace here means the decrypt step did not happen, and saying so
  # is worth more than cargo's error about a manifest it cannot find.
  [ -d "$ROOT/cli/crates" ] || die "cli/crates is missing.
    In a sealed checkout this means the repository was not decrypted: run the
    codeseal-decrypt action before this script."

  # The version being published has to be the version being built.
  #
  # It was not checked, and it was not the same. The workflow takes its version
  # from a dispatch input and names every archive with it; nothing ever read
  # `cli/Cargo.toml`. So `zel-v0.1.2-*.tar.gz` shipped a binary answering
  # `zel 0.1.0`, and the release, the tag, the filenames and the checksums were
  # all internally consistent and all wrong together.
  #
  # Nothing failed. It was found by installing the published release and
  # running `--version`, which is the one check nobody automates.
  #
  # Checked against the manifest rather than the built binary, because it is
  # exact and needs no ability to execute the artefact — this cross-compiles to
  # four targets and can run at most one of them. It also fails in a second,
  # before the build rather than after.
  local declared
  declared=$(awk '/^\[workspace\.package\]/{p=1} p&&/^version *=/{gsub(/[" ]/,"",$3); print $3; exit}' "$ROOT/cli/Cargo.toml")
  [ -n "$declared" ] || die "Could not read the workspace version from cli/Cargo.toml."

  if [ "$declared" != "${version#v}" ]; then
    die "cli/Cargo.toml declares $declared, but this would publish ${version}.
    The archive name would say ${version#v} and the binary inside would answer
    $declared — a release that is wrong in a way nothing downstream can detect.

    Bump the workspace version in cli/Cargo.toml to ${version#v} and commit it,
    then publish again. The version belongs in git, so this script will not
    edit it: a CI runner rewriting a tracked file is a change nobody reviews."
  fi

  say "Building zel $version for $target"
  ( cd "$ROOT/cli" && cargo build --release --bin zel --target "$target" )

  local built="$ROOT/cli/target/$target/release/zel"
  [ -f "$built" ] || die "cargo reported success but $built does not exist."

  mkdir -p "$out"
  local name="zel-${version}-${target}"

  # `-C` so the archive holds `zel` at its root and not the build path. The
  # installer extracts exactly the member named `zel` and nothing else.
  tar -czf "$out/${name}.tar.gz" -C "$ROOT/cli/target/$target/release" zel
  ( cd "$out" && sha256_of "${name}.tar.gz" > "${name}.tar.gz.sha256" )

  say "Wrote $out/${name}.tar.gz"
}

# ------------------------------------------------------------------ checksums
#
# One `SHA256SUMS` covering every archive present.
#
# Both forms exist because two things produce releases and they chose
# differently: the workflow writes a `.sha256` per archive, this writes the
# combined file. `install.sh` reads either — it tried only the second once, and
# failed closed on a release that was complete and correct.
cmd_checksums() {
  local dir="${1:-$DIST_DEFAULT}"
  [ -d "$dir" ] || die "$dir does not exist."

  # `ls` in a subshell rather than a glob guard: an empty directory should say
  # so, not produce a SHA256SUMS naming a file called `*.tar.gz`.
  ( cd "$dir" && ls ./*.tar.gz >/dev/null 2>&1 ) || die "No archives in $dir."

  ( cd "$dir" && sha256_of ./*.tar.gz > SHA256SUMS && sha256_of -c SHA256SUMS )
  say "Wrote $dir/SHA256SUMS"
}

# ---------------------------------------------------------------------- image
#
# Build and push the base image `zel build` runs the engine inside.
#
# This is a *primitive*, in the same sense the binary is. Every product's
# documentation pipeline calls `zel build`, and `zel build` starts a container
# from `ghcr.io/mylife-inc/zellij-base:latest` — so a stale image means every
# site in the organisation is generated by a stale engine, whatever version of
# `zel` produced it.
#
# `linux/amd64` by default, and only that.
#
# The published `:latest` is already amd64-only, so this narrows nothing. CI
# builds arm64 too, on a native `ubuntu-24.04-arm` runner rather than under
# emulation — which is the right way and not one a laptop can copy: QEMU turns
# this build into a very long one for an architecture nothing here consumes.
# `zel build` runs on `ubuntu-latest` in every pipeline we have.
#
# Pass a platform list to override, once CI can do it natively:
#   scripts/publish.sh image v0.1.3 linux/amd64,linux/arm64
cmd_image() {
  local version="${1:-}" platforms="${2:-linux/amd64}"
  require_version "$version"

  command -v docker >/dev/null 2>&1 || die "docker is required and was not found."
  docker info >/dev/null 2>&1 || die "The docker daemon is not reachable.
    context: $(docker context show 2>/dev/null), DOCKER_HOST: ${DOCKER_HOST:-unset}"

  [ -f "$ROOT/docker/base.Dockerfile" ] || die "docker/base.Dockerfile is missing.
    In a sealed checkout this means the repository was not decrypted."

  # `latest` and the version, both. `latest` is what DEFAULT_IMAGE resolves to
  # and what every pipeline pulls; the version tag is what makes a build
  # reproducible after `latest` has moved on.
  local image="${ZELLIJ_IMAGE:-ghcr.io/mylife-inc/zellij-base}"

  say "Building $image for $platforms"
  # `--push` rather than `--load`: buildx cannot load a multi-platform result
  # into the local daemon, so a build that works for one platform would fail
  # the moment somebody adds a second. Pushing behaves the same either way.
  docker buildx build \
    --platform "$platforms" \
    --file "$ROOT/docker/base.Dockerfile" \
    --build-arg ZELLIJ_FEATURES=none \
    --tag "${image}:latest" \
    --tag "${image}:${version#v}" \
    --push \
    "$ROOT"

  say "Pushed ${image}:latest and ${image}:${version#v}"
}

# -------------------------------------------------------------------- release
#
# Create the release in the public artefact repository and attach everything.
#
# The installer is attached too: a pinned version can then always be installed
# the same way the release it belongs to was.
cmd_release() {
  local version="${1:-}" dir="${2:-$DIST_DEFAULT}"
  require_version "$version"
  [ -d "$dir" ] || die "$dir does not exist."

  command -v gh >/dev/null 2>&1 || die "The GitHub CLI (gh) is required and was not found."

  local tag="${SCOPE}-${version}"
  if gh release view "$tag" --repo "$RELEASES_REPO" >/dev/null 2>&1; then
    die "$tag already exists in $RELEASES_REPO."
  fi

  [ -f "$dir/SHA256SUMS" ] || cmd_checksums "$dir"
  cp "$ROOT/scripts/install.sh" "$dir/install.sh"

  # A version with a dash in it is a pre-release: `install.sh` skips those when
  # resolving "latest", so a release candidate cannot be installed by accident.
  local prerelease=()
  case "$version" in *-*) prerelease=(--prerelease) ;; esac

  say "Publishing $tag to $RELEASES_REPO"
  ( cd "$dir" && gh release create "$tag" \
      --repo "$RELEASES_REPO" \
      --title "Zellij $version" \
      "${prerelease[@]}" \
      --notes "\`zel\` $version.

\`\`\`
curl -fsSL https://raw.githubusercontent.com/$RELEASES_REPO/main/$SCOPE/install.sh | sh
\`\`\`
" \
      ./*.tar.gz ./*.sha256 SHA256SUMS install.sh )

  say "Published https://github.com/$RELEASES_REPO/releases/tag/$tag"
}

case "${1:-}" in
  binary)    shift; cmd_binary "$@" ;;
  image)     shift; cmd_image "$@" ;;
  checksums) shift; cmd_checksums "$@" ;;
  release)   shift; cmd_release "$@" ;;
  *)
    cat >&2 <<EOF
Usage: scripts/publish.sh <command>

  binary    <version> <target> [outdir]   build, package and hash one target
  image     <version> [platforms]         build and push the engine base image
  checksums [dir]                         write SHA256SUMS over the archives
  release   <version> [dir]               create the release and attach them

Environment:
  ZELLIJ_RELEASES_REPO   default mylife-inc/releases
  ZELLIJ_RELEASE_SCOPE   default zellij
  ZELLIJ_IMAGE           default ghcr.io/mylife-inc/zellij-base
EOF
    exit 2 ;;
esac
