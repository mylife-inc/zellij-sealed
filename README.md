# Zellij

**A Next.js engine that turns a folder of plain text into a complete website —
marketing pages and documentation, one theme, one deployment.**

You write YAML, Markdown and assets. Zellij builds the site.

The name is Moroccan. *Zellij* is mosaic tilework, where elaborate walls are
composed from a small fixed vocabulary of geometric tiles. The engine works the
same way: pages are composed from a fixed vocabulary of **sections**, styled by
**themes**.

## Why

**Documentation tools make manuals. Site builders make landing pages.** A
product's site is one thing, and most teams end up maintaining two — a docs
generator and a marketing site, with two themes that drift apart and two
deployments to keep alive.

Zellij treats them as one. The same folder produces the landing page and the
manual, in the same theme, from the same build.

- **Your content is plain text you own.** A folder of YAML and Markdown, in
  your repository, in a format you can read without the tool.
- **A fixed vocabulary, not a blank canvas.** Nineteen section types and
  fourteen themes. Pages that look like they belong to the same product,
  because they are built from the same pieces.
- **Nothing to maintain.** The application lives in a container image. There is
  no framework in your repository to upgrade, and no build config to inherit.
- **One deployment.** Static files for any host, or a container that serves
  itself.

## Getting started

```bash
curl -fsSL https://raw.githubusercontent.com/mylife-inc/releases/main/zellij/install.sh | sh
zel new docs my-site
zel dev my-site
```

## Documentation

Everything — the content model, every section type, the CLI, and hands-on
guides — is at **[zellij.shebka.net](https://zellij.shebka.net)**.

## About this repository

The source is encrypted at rest with [CodeSeal](https://codeseal.shebka.net).
What is committed here is ciphertext; the build decrypts it in CI and publishes
the result. That is a deliberate choice about where the source lives, not a
statement about the licence.

---

© Shebka LLC
