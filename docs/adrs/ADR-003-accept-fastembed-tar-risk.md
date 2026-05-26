# ADR-003: Accept the transitive `tar` HIGH advisory from fastembed

- **Status**: Accepted
- **Date**: 2026-05-24
- **Approver**: Juan Carlos Ghiringhelli (project owner — chose fastembed over lighter alternatives)
- **Relates to**: ADR-002 (team features in core), `docs/approved-packages.md`

## Context

Semantic de-duplication in the `team promote` action needs vector embeddings. The
owner chose **fastembed** (CPU-optimized, BGE-small-en-v1.5) over Transformers.js and
`@huggingface/transformers` v4.

`npm audit` after install reports one residual **HIGH**: `tar <= 7.5.10`
(node-tar arbitrary file create/overwrite via hardlink/symlink path traversal —
GHSA-34x7-hfp2-rc4v and related). It is pulled transitively by fastembed, which uses
`tar` to extract the model archive it downloads on first use. It cannot be resolved by
`npm audit fix` without `--force`, which would break fastembed's dependency tree.

The project's dependency protocol sets HIGH as a blocker unless the risk is documented
and an ADR names the approver. This is that record.

## Decision

Accept the residual `tar` HIGH for the **optional** `fastembed` dependency.

## Rationale & mitigations

- **Optional + isolated.** `fastembed` is an `optionalDependency`, dynamically imported
  by `FastEmbedGateway`. The core memory server never imports `tar`; only the opt-in
  embedding path does, and only at model-download time.
- **Trusted, fixed source.** The advisory is exploitable only when extracting a
  malicious archive. fastembed downloads from its pinned model host over HTTPS — not
  user-supplied tarballs — so the realistic attack requires compromising that host.
- **Graceful fallback.** If the model/native deps are unavailable, `promote` falls back
  to lexical similarity; nothing breaks.
- **Reversible.** The `EmbeddingGateway` port isolates the choice. Swapping fastembed for
  Transformers.js (or dropping it for a no-dep local embedder) is a single-file change to
  the gateway implementation plus the dependency entry.

## Consequences

- The audit gate will report 1 HIGH until upstream fastembed bumps `tar`. The pre-commit
  audit hook must allowlist this specific advisory (or scope audit to production,
  non-optional deps) so it does not block unrelated commits.
- Revisit when fastembed releases a build on a patched `tar`, or if the team prefers the
  lighter Transformers.js path.
