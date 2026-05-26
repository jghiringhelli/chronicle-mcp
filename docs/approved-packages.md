# Approved Packages

AI-maintained dependency registry (see `.claude/standards/protocols.md`). Run
`npm audit --audit-level=high` before adding/upgrading; record audit status here.

| Package | Version range | Purpose | Alternatives rejected | Rationale | Audit status |
|---|---|---|---|---|---|
| @modelcontextprotocol/sdk | ^1.0.0 | MCP server/transport | — | Official MCP SDK | 0 HIGH |
| better-sqlite3 | ^11.0.0 | Local-first synchronous storage | sql.js (slower), node:sqlite (immature) | Fast synchronous SQLite, native prebuilds | 0 HIGH |
| postgres | ^3.4.9 | Railway sync (cloud) | pg (heavier API) | Lightweight, tagged-template SQL | 0 HIGH |
| zod | ^4.0.0 | MCP tool input schemas | — | Standard for MCP tool validation | 0 HIGH |
| fastembed | ^2.1.0 (optional) | CPU vector embeddings (BGE-small-en-v1.5, 384-dim) for semantic `promote` dedup | @xenova/transformers (hard `sharp` native dep), @huggingface/transformers v4 (heaviest: sharp + tokenizers + onnxruntime all hard deps) | Purpose-built CPU embeddings; declared **optional** + lazy-loaded with lexical fallback so a failed/offline install never breaks the server | **1 HIGH accepted** — transitive `tar` (model extraction). See ADR-003. |
| typescript-eslint | ^8.0.0 (dev) | ESLint 9 flat-config TypeScript linting | separate @typescript-eslint/{parser,plugin} (more wiring) | Unified flat-config entrypoint | 0 HIGH |
| @eslint/js | ^9.0.0 (dev) | ESLint recommended JS ruleset | — | Required for flat config | 0 HIGH |

## Notes

- `@vitest/coverage-v8` was realigned from `^4.1.0` to `^2.1.0` to match the
  installed `vitest@2` — the prior mismatch made `npm install` fail to resolve.
- fastembed pulls native binaries (`onnxruntime-node`, `@anush008/tokenizers`) and
  downloads its model on first use, cached under `~/.chronicle/models`. Because it is
  an `optionalDependency` resolved via dynamic import, none of this is in the core
  runtime path; `FastEmbedGateway` throws and callers fall back to lexical similarity
  when it is absent or offline.
