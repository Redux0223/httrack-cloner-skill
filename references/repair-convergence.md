# Repair Convergence SOP

## Failure Evidence

Use only observable artifacts: `.cloner/state.json`, `.cloner/trace-summary.json`, `.cloner/artifact-trace.json`, reports, file hashes, tests, builds, preview requests, and proof results. Do not claim access to hidden reasoning traces. `artifact-trace.json` separates external edits made between launcher resumes from files changed by the orchestrator itself.

Each failed gate must record:

- stage and duration
- stable `failureSignature`
- previous signature and consecutive count
- finding codes and structured cause counts
- repair action code and strategy
- changed artifacts with before/after hashes
- named regression test
- expected and actual delta
- `converged` result

The repair record describes source changes, not hand-edited reports. Any external change under `react/reports/**`, `proof/proof-contract.json`, `.cloner/invocation.json`, or captured `react/public/**` is suspicious until the responsible verifier regenerates the report and cross-checks immutable evidence.

A repair containing only report, proof, manifest, or invocation edits is rejected. It must include a source, captured-asset, generated-service, or regression-test delta owned by the failing gate.

## Rerun Rule

Do not rerun a gate until a repair record exists. Read `.cloner/next-actions.json` and execute its action codes in order. A rerun is valid only when at least one artifact changed and the record predicts a measurable delta such as fewer unresolved references, fewer legacy bootstraps, a newly implemented bridge member, or a newly passing interaction checkpoint.

The loop is non-convergent when:

- the same signature occurs twice consecutively
- a signature recurs within the latest three failures
- unresolved or legacy counts oscillate without reaching zero
- the same strategy previously failed for the same classification

When non-convergent, keep working but choose a different repair category. Do not weaken proof thresholds, delete findings, rename legacy bundles, or retry unchanged code. Repeated deep-proof failures such as unchanged hold-gate checkpoints, missing stage progression, or unresolved content-signature mismatches require a different repair strategy, not another identical rerun.

When bootstrap or engine findings coexist with content or public-asset findings, repair ownership first. Replacing phrases or deleting files before the source-derived bootstrap and engine bridge exists is the wrong repair category and cannot establish convergence.

## Required Cause Classes

Classify failures as route, content, layout, behavior, asset, network, lifecycle, bridge, or proof-checkpoint. Content-type mismatches are asset failures, not parser failures. A remaining automatic sink is a network failure even if its literal was partially rewritten.

## Final Trace

Delivery requires stage durations, all failed gates, repeated failures, repair categories, external and pipeline artifact deltas, final gate results, and links to architecture, style/content/asset provenance, network, build, authoritative proof, reproducibility, delivery, and browser-open evidence. Source/local checkpoint artifacts for wheel and blocking gates, dynamic frame metrics, and the latest `.cloner/trace-summary.json`, `.cloner/artifact-trace.json`, plus `.cloner/repair-history.json` entries must be part of that trace. A deeper failed proof remains authoritative over any later shallow pass until an equal-depth or deeper rerun passes.

For legacy failures, the trace must also link `legacy-classification.json`, `bootstrap-contract.json`, and `react-owned-ui.json`. `REPAIR_LOOP` without executing the generated action list is an execution failure, not a completed analysis result.
