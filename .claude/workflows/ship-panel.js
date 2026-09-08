export const meta = {
  name: 'ship-panel',
  description: 'Adversarial plan review for /ship-spec: five lenses in parallel (six with a spec — its claims are checked against the tree), blocking findings cross-verified by independent refuters; a finding no refuter answered stays blocking',
  whenToUse: 'Phase 2 of /ship-spec, on a written plan. args: { plan, worktree, spec? }',
  phases: [
    { title: 'Lenses', detail: 'constitution/layering, security/RLS/BOLA, migration-safety, simplicity/YAGNI, test-coverage, spec-conformance (with a spec)' },
    { title: 'Verify', detail: 'two independent refuters per blocking finding; any refutation kills it; none answering keeps it blocking as unverified' },
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

// With a spec in hand, a sixth lens reviews the plan's PARENT. A spec written
// without implementing drifts: on the first live run, 12 of its concrete
// claims contradicted the tree, two changed scope, and one prescribed a
// constitution violation — every one of which the plan inherited. Catching
// them here is cheaper than at design review.
if (args.spec) {
  LENSES.push({
    key: 'spec',
    prompt: `Review the SPEC at ${args.spec} — not only the plan — through the SPEC-CONFORMANCE lens: every
file, line, symbol, table, column, route or ADR status it names must exist as described (quote what the
tree actually says where it differs); every write path it prescribes must comply with
docs/reference/constitution.md §VI — no new direct-PostgREST write for application data; every
user-visible state it implies (loading, empty, error, not-found, unauthorized) must be enumerated. A spec
claim the plan carried forward unchanged is BLOCKING when the tree contradicts it or the constitution
forbids it. Cite the spec section and the plan step.`,
  })
}

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
    ).then(r => (r ? { lens: l.key, findings: r.findings || [] } : null)), // null = lens died; keep it null so it is reported as missing
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
log(`${deduped.length} findings before verification (${blocking.length} blocking candidates, ${advisory.length} advisory) from ${covered.length}/${LENSES.length} lenses`)

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
  blocking.map((f, idx) => () =>
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
          { label: `verify:B${idx + 1}:${f.lens}:${i}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'ship-verifier' },
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
// A finding whose refuters did not return is NOT cleared: it stays blocking
// until the orchestrator checks it. On the first live run one such finding —
// a deleted error surface rendered as a permanent aria-hidden shimmer — was
// real, and a verdict keyed on `confirmed` alone would have cleared the plan.
if (unverified.length) log(`${unverified.length} blocking finding(s) got no refuter answer — kept as blocking (unverified), not refuted`)
if (advisory.length > 15) log(`advisory truncated to 15: ${advisory.length - 15} dropped`)
const verdict = confirmed.length + unverified.length === 0 ? 'no-blocking-objection' : 'revise-plan'
log(`verdict ${verdict}: ${confirmed.length} blocking confirmed, ${unverified.length} unverified, ${refuted.length} refuted, ${Math.min(advisory.length, 15)} advisory`)

return {
  verdict,
  lenses_covered: covered.map(c => c.lens),
  lenses_missing: missing,
  blocking: confirmed,
  refuted,
  unverified,
  advisory: advisory.slice(0, 15),
}
