# Agent instructions (Codex / other coding agents)

1. Read `docs/README.md`, `docs/requirements.md`, `docs/screen-design.md`, `docs/architecture.md`, and `docs/decisions.md` before implementation. Treat `docs/decisions.md` as authoritative when documents conflict.
2. Implement the MVP first. Do not add backend, authentication, analytics collection, or third-party tracking without explicit approval.
3. Keep keyboard layout and question sets data-driven. Validate that every question contains only keys available in the selected hand.
4. Prioritize iPhone Safari landscape UX, touch accessibility, and correct per-row keyboard offsets.
5. Do not claim haptics or orientation lock work on iPhone Safari without device verification.
6. Run available build/tests and report what was verified vs. what needs physical-device testing.
7. Never commit secrets, tokens, personal data, or real user activity logs.
8. When requirements are ambiguous, list assumptions and ask before making irreversible design choices.

Suggested first task: scaffold Vue 3 + Vite, implement keyboard layout and Lv.1–3 practice with feedback and local persistence, then test/build.
