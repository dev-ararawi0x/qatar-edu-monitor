# Hallili

Hallili is a modular monolith for reviewable, policy-gated assessment draft preparation.

## Authoritative design sources

Read `docs/README.md` first. The implementation follows the documents in `docs/product/`, `docs/technical-design/`, and `docs/implementation/`.

## Local development

```bash
pnpm install
cp .env.example .env # replace VALUES placeholders locally
pnpm db:up
pnpm dev
```

The web application is a TanStack Start application and is the only HTTP backend. The worker is a separate long-running Node.js process with no public business API.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

Real LMS integration is disabled by default and must remain disabled until the gates in `docs/technical-design/OPEN_DECISIONS.md` are satisfied with evidence.
