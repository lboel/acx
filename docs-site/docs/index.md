---
hide:
  - navigation
---

<div class="acx-hero" markdown="1">
<div markdown="1">
# Agent Cartridge <small>`.acx`</small>

<p class="acx-tagline">An open standard for <strong>portable, self-improving</strong> AI agents — cartridges that learn, level up, form teams, and run workflows. One file you can insert, share, sell, and trust.</p>

<div class="acx-pills">
<span class="acx-pill">single-file SQLite</span>
<span class="acx-pill">ed25519 + DSSE signed</span>
<span class="acx-pill">provable level</span>
<span class="acx-pill">agent information graphs</span>
<span class="acx-pill">OCI-distributable</span>
<span class="acx-pill">zero-dependency ref impl</span>
</div>

<div class="acx-actions">
<a class="acx-button acx-button--primary" href="share/">Share an agent</a>
<a class="acx-button" href="concepts/overview/">See how ACX works</a>
<a class="acx-button acx-button--quiet" href="format/agent-graph/">Map an agent team</a>
</div>
</div>
<div class="acx-cart">
<img src="_assets/cartridge.svg" alt="An Agent Cartridge: a game cartridge with a signed ROM chip, a field-learned SAVE battery, a skill row, and a Lv.29 principal level badge.">
</div>
</div>

<div class="acx-flow" aria-label="An ACX agent is packaged, signed, submitted through a pull request, verified, and reused">
<div class="acx-flow__node"><span>01</span><strong>Package</strong><small>skills + memory + loop</small></div>
<div class="acx-flow__arrow" aria-hidden="true">→</div>
<div class="acx-flow__node"><span>02</span><strong>Sign</strong><small>content-addressed proof</small></div>
<div class="acx-flow__arrow" aria-hidden="true">→</div>
<div class="acx-flow__node"><span>03</span><strong>Share</strong><small>small, reviewable PR</small></div>
<div class="acx-flow__arrow" aria-hidden="true">→</div>
<div class="acx-flow__node"><span>04</span><strong>Verify</strong><small>reject any tampering</small></div>
<div class="acx-flow__arrow" aria-hidden="true">→</div>
<div class="acx-flow__node"><span>05</span><strong>Reuse</strong><small>load or staff a team</small></div>
</div>

<p class="acx-flow-caption">One signed artifact. A five-step trust loop. No platform lock-in.</p>

## Think of it like a game cartridge

You already know this object. A **classic game cartridge** is a small, self-contained thing you
*insert* into any console and it just boots — no install, no account, region-free, and you can lend or
sell it. An **Agent Cartridge** is the same idea for an AI agent — coding is the flagship use case, but any agent that has skills, learns, and runs a loop fits.

=== "🎮 The cartridge"

    - **Insert & boot.** A host opens the `.acx` file, checks the signature, negotiates the tools it
      declares, and runs it. No bespoke setup. See [Loading a cartridge](lifecycle/loading.md).
    - **ROM chip + save battery.** The **<span class="acx-rom">ROM · signed</span>** holds the
      immutable, shareable core (skills, capabilities, loop policy, identity). The
      **<span class="acx-save">SAVE · field-learned</span>** holds what the agent learned on *your*
      codebase — and can be wiped before you re-share. See [the cartridge model](concepts/cartridge-model.md).
    - **Region-free.** A cartridge is codebase-agnostic: it carries transferable expertise, then
      accumulates codebase-specific learnings locally without contaminating the core.
    - **Collect & trade.** Cartridges are signed, identity-bound, and distributable as OCI artifacts —
      the substrate for a marketplace of specialized agents. See [capabilities](format/capabilities.md).
    - **Level up.** An agent earns a **verifiable level** by real work on a held-out benchmark — not a
      number it prints about itself. See [how agents level up](leveling/provable-level.md).

=== "🔩 The engineering"

    - A cartridge is a single **SQLite** database (`application_id` `0x41435831` = `"ACX1"`), openable
      by the stock `sqlite3` CLI.
    - The signed core is a **content-addressed ROM manifest** wrapped in a **DSSE / in-toto** envelope
      (ed25519), recomputed from live bytes so any content edit is detected as `tampered`.
    - It is also a portable **harness** — the loop, context policy, tool contract, and memory travel
      together as declarative, signed data. See [bundled loops & the agent OS](concepts/agent-os.md).
    - The reference implementation is **zero-dependency** (Node's builtin `node:sqlite` + `node:crypto`)
      and every claim on this site is backed by a runnable proof. See [Proofs](proofs.md).

## Five ideas

Not just coding agents — any AI agent that has skills, accumulates knowledge, and runs a loop.

<div class="acx-grid" markdown="1">

<div class="acx-card" markdown="1">
### 🧠 Learn
Transferable expertise (ROM) travels everywhere; environment-specific memory (SAVE) accumulates on the job — packed as a real [LanceDB dataset](format/packages.md). Content stays out; only [descriptions](format/knowledge-okf.md) travel.
</div>

<div class="acx-card" markdown="1">
### 📈 Self-improve
Competence is [earned on real work](leveling/provable-level.md): a provable level minted only after an independent held-out re-run. Get better — and prove it.
</div>

<div class="acx-card" markdown="1">
### 👥 Form teams
Cartridges [reference each other by hash](concepts/studio.md) and are staffed onto a project by role, level, and capability — a portable roster.
</div>

<div class="acx-card" markdown="1">
### 🔧 Build workflows
Compose agents into [Conditional Agentic Loops](format/loops-cal.md) on the CLI or in a [visual builder](format/loops-cal.md) — who does what, when, under which conditions.
</div>

<div class="acx-card" markdown="1">
### 🕸 Route knowledge
Make the implicit team structure explicit with a signed [Agent Graph](format/agent-graph.md): who owns context, who directs or reports to whom, and where separate loops converge.
</div>

</div>

## What is inside a cartridge

<div class="acx-grid" markdown="1">

<div class="acx-card" markdown="1">
### [Skills](format/skills.md)
`SKILL.md` bundles in agentskills.io format, extractable by stock `sqlite3`.
</div>

<div class="acx-card" markdown="1">
### [Capabilities](format/capabilities.md)
The sellable claim: *"great at building DAGs with Airflow + Snowflake"*, evidence-backed.
</div>

<div class="acx-card" markdown="1">
### [Memory](format/memory.md)
Two tiers — transferable (ROM) vs field-learned (SAVE) — with a fail-closed scrub gate.
</div>

<div class="acx-card" markdown="1">
### [Harness requirements](format/harness-requirements.md)
The machine-readable contract of tools a host must provide to boot the cartridge.
</div>

<div class="acx-card" markdown="1">
### [Loop & context policy](format/loop-context.md)
The agent's harness as signed data — informed by Lilian Weng's harness engineering.
</div>

<div class="acx-card" markdown="1">
### [Provable level](leveling/provable-level.md)
A W3C Verifiable Credential earned via independent, held-out re-run. Unfakeable.
</div>

</div>

## Where cartridges come from: the studio

Cartridges are the *output* of a company of agents. In [AGENTIBUS](concepts/studio.md) — the reference
studio — agents **emerge from real work**, get **hired**, are **dispatched into your projects**, and
**level up** as they ship. When one has learned enough to be worth sharing, you **export it as a
cartridge**: a signed employee file you can lend, sell, or send to another studio, where it is
**re-hired already specialized**.

<p class="acx-figure" markdown="1">
![A roster of three agent cartridges — Engineer (Lv.29), Architect (Lv.22), Reviewer (Lv.15) — on a shelf.](_assets/roster.svg){ width="620" }
</p>

That is the full loop — [**from hire to cartridge and back**](lifecycle/company-loop.md). Every project
makes the studio smarter; every shared cartridge makes the whole ecosystem smarter.

!!! note "Two senses of “leveling up”"
    Inside a studio an agent gains **XP** and a **career tier** from completed work — useful, but
    self-asserted game state. To make that standing *portable and trustworthy across studios*, a
    cartridge earns a [**provable level**](leveling/provable-level.md): a signed credential minted only
    after an independent, held-out re-run. Local progression, cross-studio proof.

!!! success "Everything here is proven"
    The standard *stands* and the character level is *demonstrably earned, not asserted*. The
    [Proofs](proofs.md) page shows the verbatim output of 113 passing tests, an export→verify→strip→tamper
    round-trip, and a full level-issuance run — all reproducible with `node --experimental-sqlite`.

## Where to start

- New here? Read the [Overview](concepts/overview.md), then the [cartridge model](concepts/cartridge-model.md).
- Want to run it? Jump to the [CLI reference](reference/cli.md) and the [Proofs](proofs.md).
- Want to share a team? Start with the signed [`ship-a-feature`](format/loops-cal.md) workflow, then run
  `acx workflow lint`, `sign`, `verify`, and `ready`.
- Want to map how the team communicates? Open the visual [Agent Graph](format/agent-graph.md) guide and
  describe context owners, direction, reporting returns, and loop convergence.
- Want your agent to share itself? Open [Share ACX](share.md) and use the bundled
  [`$acx-share-agent`](share.md#let-an-agent-prepare-its-own-share-pr) skill.
- Building a host? Start with [Loading a cartridge](lifecycle/loading.md) and
  [Harness requirements](format/harness-requirements.md).
- Want the whole normative spec? It lives in `SPEC.md` in the repository; the
  [Conformance](reference/conformance.md) page summarizes the 16 MUST items.

!!! note "Status"
    **v0.1 public draft.** The normative core, strict schemas, signed workflow profile, registry gate,
    examples, and zero-dependency reference implementation are publication-ready for review. Some
    normatively specified pieces (OCI push, live namespace-proof verification, the host handshake and
    execution runtimes) remain host-side by design and are flagged wherever they appear.
