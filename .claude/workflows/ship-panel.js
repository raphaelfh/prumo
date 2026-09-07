export const meta = {
  name: 'ship-panel',
  description: 'Adversarial plan review for /ship-spec: five lenses in parallel, blocking findings cross-verified by independent refuters before they are reported',
  whenToUse: 'Phase 2 of /ship-spec, on a written plan. args: { plan, worktree, spec? }',
  phases: [
    { title: 'Lenses', detail: 'constitution/layering, security/RLS/BOLA, migration-safety, simplicity/YAGNI, test-coverage' },
    { title: 'Verify', detail: 'two independent refuters per blocking finding; majority decides' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs. Subagents start in the main checkout, so the worktree path is
// mandatory in every prompt.
// ---------------------------------------------------------------------------
if (!args || !args.plan || !args.worktree) {
  throw new Error('ship-panel needs args { plan: <plan path>, worktree: <absolute path>, spec?: <spec path> }')
}
const PLAN = args.plan
const WORKTREE = args.worktree
const SPEC = args.spec ? `The spec it argues from is ${args.spec}; the spec is the authority when the plan is ambiguous.` : ''

const RUBRIC = `
Severity rubric (apply strictly — a reviewer asked for gaps will find some; only real ones count):
- BLOCKING only if the plan, as written, would (a) fail a CI gate (ruff, tsc, eslint, pytest, vitest,
  knip in both modes, vulture ratchet, copy-key ratchet, scope-guard fitness, architectural fitness,
  API contract), (b) violate docs/reference/constitution.md (typed boundaries, layering, provenance /
  append-only human selection), (c) reproduce a recurring incident class — BOLA / missing
  project-membership scoping or a copied ownership predicate, run-state TOCTOU, swallowed errors,
  schema drift (model change without migration or head-pin move), ApiResponse envelope drift, stale
  TanStack cache after a mutation — or (d) leave a stated requirement without a test.
- ADVISORY otherwise. Cap advisory at 3 per lens. No style preferences, no re-architecture.
Every finding cites the plan step (or file:line it would touch) and states the evidence.`

const LENSES = [
  {
    key: 'constitution',
    prompt: `Review the plan through the CONSTITUTION / LAYERING lens: typed boundaries, no layer leak
(endpoint → service → repository), Pydantic v2 schemas at the edge, provenance and append-only selection
(constitution §IX). Read docs/reference/constitution.md and the plan.`,
  },
  {
    key: 'security',
    prompt: `Review the plan through the SECURITY / RLS / BOLA lens: project-membership scoping on every
read and write, one ownership predicate imported from .claude/rules/backend.md §Ownership guards (never
re-typed), run-state TOCTOU on stage transitions, RLS policy implications for Supabase-side reads. Read
.claude/rules/backend.md and the plan.`,
  },
  {
    key: 'migration',
    prompt: `Review the plan through the MIGRATION-SAFETY lens: any SQLAlchemy model change must carry an
Alembic migration (revision id ≤ 32 chars) and move the test_migration_roundtrip head-pin in the same
task; downgrade must work; destructive DDL must self-guard in SQL; PostgREST readers of a dropped
column break prod. Read docs/reference/migrations.md and the plan.`,
  },
  {
    key: 'simplicity',
    prompt: `Review the plan through the SIMPLICITY / YAGNI lens: could 200 lines be 50; speculative
abstraction, config or handling for impossible cases; duplicated helpers the repo already has; a
step that adds legacy instead of cleaning the code it touches. Read the plan and the files it names.`,
  },
  {
    key: 'tests',
    prompt: `Review the plan through the TEST-COVERAGE lens: every step carries a failing test at the
right layer (pytest integration on real Postgres, vitest + MSW, Playwright only for E2E); endpoint
steps include a direct endpoint-coroutine unit test (handler lines under httpx ASGITransport do not
register in diff coverage); tests interleaved, never batched at the end; diff-cover 80. Read the plan.`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'where', 'summary', 'evidence'],
        properties: {
          severity: { type: 'string', enum: ['blocking', 'advisory'] },
          where: { type: 'string', description: 'plan step id/title or file:line' },
          summary: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Phase 1 — five lenses, in parallel. A barrier is correct here: the verify
// stage dedups across lenses and exits early when nothing is blocking.
// ---------------------------------------------------------------------------
phase('Lenses')
const lensResults = await parallel(
  LENSES.map(l => () =>
    agent(
      `Work in ${WORKTREE} (run pwd; cd there if needed). Read the plan at ${PLAN}. ${SPEC}
${l.prompt}
${RUBRIC}
Return findings only; no prose.`,
      { label: `lens:${l.key}`, phase: 'Lenses', schema: FINDINGS_SCHEMA },
    ).then(r => ({ lens: l.key, findings: (r && r.findings) || [] })),
  ),
)

const covered = lensResults.filter(Boolean)
const missing = LENSES.map(l => l.key).filter(k => !covered.some(c => c.lens === k))
if (missing.length) log(`lenses that did not return (rate limit / error): ${missing.join(', ')}`)

const all = covered.flatMap(c => c.findings.map(f => ({ ...f, lens: c.lens })))
const seen = new Set()
const deduped = all.filter(f => {
  const k = `${f.where}::${f.summary.toLowerCase().slice(0, 80)}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
})
const blocking = deduped.filter(f => f.severity === 'blocking')
const advisory = deduped.filter(f => f.severity === 'advisory')
log(`${deduped.length} findings (${blocking.length} blocking, ${advisory.length} advisory) from ${covered.length}/${LENSES.length} lenses`)

// ---------------------------------------------------------------------------
// Phase 2 — adversarial verification of blocking findings only. Two refuters
// with distinct lenses; a finding survives only if neither refutes it.
// ---------------------------------------------------------------------------
phase('Verify')
const REFUTERS = [
  'CORRECTNESS: is the claimed defect actually what the plan says, or a misreading of the step?',
  'ALREADY-HANDLED: does the repo already cover this — an existing guard, test, gate, fixture or migration convention that makes the finding moot? Cite file:line.',
]

const verified = await parallel(
  blocking.map(f => () =>
    parallel(
      REFUTERS.map((lens, i) => () =>
        agent(
          `Work in ${WORKTREE} (run pwd; cd there if needed). Plan: ${PLAN}. ${SPEC}
A reviewer raised this BLOCKING finding on the plan:
  where: ${f.where}
  summary: ${f.summary}
  evidence: ${f.evidence}
Try to REFUTE it through this lens — ${lens}
Read the actual code and docs; quote what you found. Default to refuted=true only with evidence that
the finding is wrong or already handled; otherwise refuted=false with the reason.`,
          { label: `verify:${f.lens}:${i}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'ship-verifier' },
        ),
      ),
    ).then(votes => {
      const v = votes.filter(Boolean)
      const refutations = v.filter(x => x.refuted)
      return {
        ...f,
        confirmed: v.length > 0 && refutations.length === 0,
        unverified: v.length === 0,
        verifier_notes: v.map(x => (x.refuted ? 'REFUTED: ' : 'STANDS: ') + x.reason),
      }
    }),
  ),
)

const confirmed = verified.filter(Boolean).filter(v => v.confirmed)
const refuted = verified.filter(Boolean).filter(v => !v.confirmed && !v.unverified)
const unverified = verified.filter(Boolean).filter(v => v.unverified)
if (unverified.length) log(`${unverified.length} blocking finding(s) could not be verified (listed as unverified, not refuted)`)

return {
  verdict: confirmed.length === 0 ? 'no-blocking-objection' : 'revise-plan',
  lenses_covered: covered.map(c => c.lens),
  lenses_missing: missing,
  blocking: confirmed,
  refuted,
  unverified,
  advisory: advisory.slice(0, 15),
}
