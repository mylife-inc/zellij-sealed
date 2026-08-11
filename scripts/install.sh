#!/bin/sh
#
# Install `zel`, the Zellij CLI.
#
#     curl -fsSL https://raw.githubusercontent.com/mylife-inc/releases/main/zellij/install.sh | sh
#
# Binaries live in a public releases repository, because Zellij's own
# repository is private and a private repository's release assets are not
# downloadable without a token. Nothing here needs one.
#
#   ZEL_VERSION      pin a version, e.g. v0.1.0. Default: the latest.
#   ZEL_INSTALL_DIR  where to put the binary. Default: ~/.local/bin.
#
# POSIX sh on purpose: this runs on whatever the machine has.

set -eu

REPO="${ZEL_REPO:-mylife-inc/releases}"
# Releases in the shared repository are named for the project that produced
# them, so several private repositories can publish into one public one.
SCOPE="${ZEL_SCOPE:-zellij}"
INSTALL_DIR="${ZEL_INSTALL_DIR:-$HOME/.local/bin}"

say()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required and was not found."; }

need uname
need tar
command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 ||
  die "Either curl or wget is required."

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  else
    wget -qO- "$1"
  fi
}

fetch_to() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1"
  else
    wget -qO "$2" "$1"
  fi
}

# ------------------------------------------------------------------ platform

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux)  os_part="unknown-linux-gnu" ;;
  Darwin) os_part="apple-darwin" ;;
  MINGW*|MSYS*|CYGWIN*)
    die "Windows is supported, but not by this script. Download the .zip from
    https://github.com/$REPO/releases and put zel.exe on your PATH." ;;
  *) die "Unsupported operating system: $os" ;;
esac

case "$arch" in
  x86_64|amd64)  arch_part="x86_64" ;;
  arm64|aarch64) arch_part="aarch64" ;;
  *) die "Unsupported architecture: $arch" ;;
esac

target="${arch_part}-${os_part}"

# ------------------------------------------------------------------- version

if [ -n "${ZEL_VERSION:-}" ]; then
  version="$ZEL_VERSION"
else
  say "Finding the latest release"
  # The shared repository holds releases for several projects, so `latest` is
  # not ours. Take the newest tag carrying our scope.
  #
  # Pre-releases are skipped: somebody running an install one-liner is asking
  # for the stable version. A pinned ZEL_VERSION still installs whatever it
  # names, which is how a release candidate gets tested.
  #
  # The filtering is in the pattern rather than a second `grep -v -- '-'`,
  # because a lone dash as a grep argument is exactly the sort of thing one
  # implementation somewhere reads as an option. `v0.1.0-rc.1` does not match
  # here: the closing quote has to follow the digits.
  version="$(
    fetch "https://api.github.com/repos/$REPO/releases?per_page=100" |
      sed -n 's/.*"tag_name": *"'"$SCOPE"'-\(v[0-9][0-9.]*\)".*/\1/p' |
      head -1
  )" || true

  [ -n "$version" ] || die "Found no stable $SCOPE release in $REPO.
    There may be a pre-release: see
    https://github.com/$REPO/releases
    and install it with ZEL_VERSION=v0.0.0-rc.1"
fi

tag="${SCOPE}-${version}"
archive="zel-${version}-${target}.tar.gz"
base="https://github.com/$REPO/releases/download/$tag"

# ------------------------------------------------------------------ download

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading zel $version for $target"
fetch_to "$base/$archive" "$tmp/$archive" ||
  die "No build for $target in $tag.
    See https://github.com/$REPO/releases/tag/$tag"

# A checksum that is never verified is decoration. If one is published, it has
# to match; if the download is served over a compromised connection, this is
# the only thing standing in the way.
#
# So every path that cannot verify stops, rather than warning and carrying on.
# This is a script people run as `curl … | sh`, which means whoever can
# interfere with the download can also interfere with the checksum — and the
# easiest way to do that is not to forge it but to make the request for it
# fail. A warning is not a defence against that. It is the attack succeeding
# with a note attached.
#
# Nothing legitimate is lost by refusing: the release workflow publishes a
# `.sha256` beside every archive it uploads, so a missing one means the release
# is broken or the response is not the one that was published. Both are reasons
# to stop.
if [ "${ZEL_INSECURE_SKIP_CHECKSUM:-}" = "1" ]; then
  warn "ZEL_INSECURE_SKIP_CHECKSUM=1 — installing without verifying the download."
elif fetch_to "$base/$archive.sha256" "$tmp/$archive.sha256" 2>/dev/null; then
  say "Verifying"
  expected="$(cut -d' ' -f1 < "$tmp/$archive.sha256")"

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$archive" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp/$archive" | cut -d' ' -f1)"
  else
    die "Neither sha256sum nor shasum is available, so the download cannot be
    verified. Install one, or re-run with ZEL_INSECURE_SKIP_CHECKSUM=1 if you
    accept an unverified binary."
  fi

  if [ "$actual" != "$expected" ]; then
    die "Checksum mismatch.
    expected $expected
    actual   $actual
    Nothing was installed."
  fi
else
  die "No checksum could be fetched for $archive, so the download cannot be
    verified. Every release publishes one beside its archive, so this means
    either the release is incomplete or the response was not the published one.
    Nothing was installed.

    To install anyway: ZEL_INSECURE_SKIP_CHECKSUM=1"
fi

# ------------------------------------------------------------------- install

# Take one named member out of the archive, and check it is what it claims.
#
# A tarball is a list of paths chosen by whoever built it, and `tar -x` honours
# that list — including symlinks, and including members that unpack outside the
# directory you pointed it at. Naming `zel` means nothing else in the archive is
# written to disk at all, which is the difference between extracting an archive
# and trusting one.
#
# The `-L` check is the other half. A member named `zel` can be a symlink, and
# a symlink survives `chmod +x` and `mv` perfectly well — what lands on your
# PATH would be a pointer at whatever the archive chose.
#
# `--no-same-owner` is not in POSIX tar, so a shell that has not got it falls
# through to the plain form rather than failing to install.
tar --no-same-owner -xzf "$tmp/$archive" -C "$tmp" zel 2>/dev/null ||
  tar -xzf "$tmp/$archive" -C "$tmp" zel 2>/dev/null ||
  die "The archive did not contain a zel binary."

if [ ! -f "$tmp/zel" ] || [ -L "$tmp/zel" ]; then
  die "The archive's zel is not a regular file. Nothing was installed."
fi

mkdir -p "$INSTALL_DIR"
# Move into place rather than copy over a running binary: replacing an
# executable that is currently executing fails on some systems, and `zel
# upgrade` calls this script.
mv "$tmp/zel" "$INSTALL_DIR/zel.new"
chmod +x "$INSTALL_DIR/zel.new"
mv "$INSTALL_DIR/zel.new" "$INSTALL_DIR/zel"

say "Installed $INSTALL_DIR/zel"

# ---------------------------------------------------------------------- PATH

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    warn "$INSTALL_DIR is not on your PATH."
    printf '\n    Add this to your shell profile:\n\n'
    printf '      export PATH="%s:$PATH"\n\n' "$INSTALL_DIR"
    ;;
esac

"$INSTALL_DIR/zel" --version || true

cat <<'EOF'

  Next:

    zel new docs my-docs     a content folder that already validates
    zel dev my-docs          serve it, and watch it
    zel --help               everything else

  https://zellij.shebka.net/guide/quickstart
EOF
