# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. Assumes the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **seam**, **adapter**.

## Dependency categories

When assessing a candidate for deepening, classify its dependencies. The category determines how the deepened module is tested across its seam.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test through the new interface directly. No adapter needed.

### 2. Local-substitutable

Dependencies with a local stand-in that runs in the test suite. On prumo: the real Postgres behind local Supabase (pytest `db_client`), MSW v2 for the frontend network. Deepenable if the stand-in exists. The seam is internal; no port at the module's external interface.

Postgres is category 2, never 4: RLS, deferred constraints and migrations do not survive being mocked (see `web-testing` § Anti-patterns).

### 3. Remote but owned (Ports & Adapters)

Your own code across a process boundary: the frontend calling FastAPI through the typed `apiClient`, a FastAPI endpoint enqueueing a Celery task. Define a **port** (interface) at the seam. The deep module owns the logic; the transport is injected as an **adapter**. Tests use an in-memory adapter; production uses the HTTP or queue adapter.

Recommendation shape: *"Define a port at the seam, implement the HTTP adapter for production and an in-memory adapter for tests, so the logic sits in one deep module even though it is deployed across a process boundary."*

### 4. True external (Mock)

Third-party services you don't control: LLM providers, Supabase Auth and Storage, Vercel and Railway APIs. The deepened module takes the external dependency as an injected port; tests provide a fake adapter.

## Seam discipline

- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a port unless at least two adapters are justified (typically production + test). A single-adapter seam is just indirection.
- **Internal seams vs external seams.** A deep module can have internal seams (private to its implementation, used by its own tests) as well as the external seam at its interface. Don't expose internal seams through the interface just because tests use them.

## Testing strategy: replace, don't layer

- Old tests on shallow modules become waste once tests at the deepened module's interface exist; delete them.
- Write new tests at the deepened module's interface. The **interface is the test surface**.
- Tests assert on observable outcomes through the interface, not internal state.
- Tests should survive internal refactors, since they describe behaviour, not implementation. If a test has to change when the implementation changes, it is testing past the interface.
- Deleting the shallow modules can orphan helpers. Run `npx knip`, `npx knip --production` and the vulture ratchet in the same PR, and tighten the baselines rather than parking findings.
