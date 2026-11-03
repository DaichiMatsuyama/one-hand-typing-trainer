# Claude Code project instructions

This is a small iPhone-first, landscape-oriented, single-hand typing-position training web app. Read `docs/README.md`, `docs/requirements.md`, `docs/screen-design.md`, `docs/architecture.md`, and `docs/decisions.md`, then follow `AGENTS.md` as shared engineering instructions. Treat `docs/decisions.md` as authoritative when documents conflict.

Implement incrementally. Prefer clear Vue 3 components and data-driven keyboard layouts/questions. The primary user must be able to practice from a URL without installing anything or signing in. Do not introduce a backend or transmit usage data in the MVP. Validate question keys, handle incorrect taps without advancing, and test on iPhone Safari before treating layout as finished.

Start by summarizing implementation steps and identifying unresolved JIS/US layout choices, then scaffold the MVP. Never store credentials in client code.
