# Cyber Harness — Profile Loadout Manual

How many model profiles you keep loaded on the Spark changes how the **cyber
harness** behaves: which agent role runs on which model, how much work runs in
parallel, and whether a non-cyber workload (for example a RAG stack) can share
the box. This manual explains the 3 / 2 / 1 profile loadouts and the effect of
each on the harness.

## The pieces

### The three cyber tiers

| Tier | Model | Context | Footprint | What it is for |
|------|-------|---------|-----------|----------------|
| **big** | Cyber‑Tiel 35B (Q6) + privacy filter | 262K | ~54 GB | The flagship reasoner. Planning, orchestration, deep analysis, PoC design. Also the **default / fallback** for every role. |
| **medium** | BugHunter v8 (35B‑A3B, Q4) | 131K | ~25 GB | Fast executor. High‑volume "run and check" work. |
| **small** | DeepSeek 9B | 131K | ~14 GB | Light, cheap tasks. Recon and write‑ups. |

Each profile occupies **one load slot**. The slot cap is **4**, and the usable
memory budget is **~120.5 GB** (124.6 GB total minus a 4 GB reserve). The
per‑profile memory fit check is the real guard — the slot cap is only a ceiling.

### How the harness maps roles to tiers

| Agent role | Bound tier |
|------------|-----------|
| Planning / decomposition / main control | **big** (default) |
| Deep reasoning / PoC design / pentest reasoning | **big** (default) |
| Worker (run & check) | **medium** |
| Finding retest | **medium** |
| OSINT / recon | **small** |
| Report writing | **small** |

### The fallback rule (important)

If an agent's bound tier **is not loaded**, the harness does not fail — it
**falls back to the default tier (big)**. Mechanically: the call returns
"model not loaded," the harness fails over to big, and a circuit breaker opens
for that tier for a short cooldown (~5 min) so subsequent calls skip straight to
big instead of retrying a dead model. When the tier is loaded again, it rejoins
automatically once the breaker lapses.

**Consequence:** the harness keeps working with *whatever* tiers are loaded — as
long as **big is one of them**. big is the floor. If big is not loaded, the
planning/orchestration roles have nothing to fall back to and the harness cannot
drive a case.

---

## 3 profiles active — full tiering

**Loadout:** big + medium + small (~93 GB, 3/4 slots, ~27 GB free). No room for
a RAG/non‑cyber profile.

**Use this when:** you are actively working a case and want maximum throughput —
the whole Spark dedicated to cyber.

**Effect on the harness:**
- Every role runs on its ideal model.
- The worker offloads to medium and recon/reporting offload to small, so they
  run **in parallel with** big instead of queueing behind it.
- big is freed up to focus on planning and the hard reasoning.
- This is the fastest end‑to‑end mode for a live investigation.

**Trade‑off:** no RAG or other non‑cyber workload can be resident at the same
time.

---

## 2 profiles active — partial tiering

With two slots you pick which specialization to keep. The remaining roles fall
back to big.

### big + medium
~79 GB. Planning/reasoning on big, the worker and retest on medium. OSINT and
report writing **fall back to big**.
**Use when:** execution‑heavy work (lots of run‑and‑check) and recon/reporting
is light. You keep the worker fast without paying for the small model.

### big + small
~68 GB. Planning/reasoning on big, recon and reporting on small. The worker and
retest **fall back to big**.
**Use when:** OSINT/recon‑heavy or report‑heavy phases where you want cheap,
parallel recon/write‑ups, and the worker volume is low enough to sit on big.

### big + a non‑cyber profile (e.g. RAG)
~106 GB for big + a ~52 GB RAG stack. All cyber roles **collapse onto big** via
fallback (medium and small are not loaded).
**Use when:** you need a document/RAG workload resident at the same time as the
harness. The harness still fully functions, but as a **single‑model** setup —
everything runs on Cyber‑Tiel, with no offload, so it is slower under load.

### medium + small (no big) — avoid
The planning/orchestration roles default to big, which is not loaded, and have
nothing to fall back to. The harness cannot orchestrate a case. Only useful for
direct API calls to those two models, not for running the harness.

---

## 1 profile active — single model

### big only
~54 GB, leaving ~66 GB free (enough to also hold one non‑cyber profile later).
The **entire harness runs on Cyber‑Tiel**: every bound role falls back to big.
Everything works; there is no offload, so heavy phases run serially on one model.
**Use when:** focused deep work, constrained memory, or you want the simplest and
strongest single‑model setup. This is also the safe fallback mode whenever a
non‑cyber profile is sharing the box.

### medium only / small only — not viable for the harness
big is not loaded, so orchestration has no fallback and the harness cannot drive
a case. These are fine as a plain model endpoint (direct gateway calls) but not
for the harness workflow.

---

## Quick reference

| Loadout | ~Memory | Slots | Harness result |
|---------|---------|-------|----------------|
| big + medium + small | 93 GB | 3 | Full tiering, max parallel throughput, no RAG |
| big + medium | 79 GB | 2 | Fast worker; recon/report on big |
| big + small | 68 GB | 2 | Cheap recon/report; worker on big |
| big + RAG | 106 GB | 2 | Full harness, single‑model, RAG resident |
| big only | 54 GB | 1 | Full harness, single‑model, simplest |
| medium/small without big | — | 1–2 | **Broken** — no orchestration model |

**Rules of thumb**
- **Always keep big loaded** if you want the harness to orchestrate a case.
- Add **medium** for execution‑heavy work, **small** for recon/reporting‑heavy
  work, **both** when you want everything parallel and the Spark is dedicated to
  cyber.
- A non‑cyber profile (RAG, etc.) can share the box only with **big alone** —
  never with the extra tiers, and never all three cyber tiers at once (that
  exceeds the memory budget).
- After you load a tier that had been missing, give it ~a minute: its breaker
  cooldown has to lapse before the harness routes to it again.
