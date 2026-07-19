---
title: Agent Graph
description: Model who owns context, who may direct or advise whom, where reports return, and where agent loops converge.
---

<div class="acx-graph-hero" markdown="1">
<span class="acx-eyebrow">ACX AGENT GRAPH · `acx.agent-graph/1`</span>

# Give the team a shared information architecture

<p class="acx-graph-lede"><strong>A CAL says what happens next. An Agent Graph says who owns the context, who can direct whom, where reports return, and where separate loops meet.</strong></p>

Describe the real shape of collaboration without turning it into another task board. Agent Graphs connect
roles, knowledge responsibilities, reporting routes, and whole workflows in one signed, portable artifact.

<div class="acx-actions">
<a class="acx-button acx-button--primary" href="#read-the-graph">Read the graph</a>
<a class="acx-button" href="#author-one-fuzzy-where-useful-strict-where-needed">Author one</a>
<a class="acx-button acx-button--quiet" href="loops-cal/">Compare with CAL</a>
</div>
</div>

## Read the graph

This example connects a Product Owner, a research council, and a developer team. The PO sends a delivery
brief to the developers; developers return status and blockers. Research evidence and delivery reality
arrive through separate loops, then converge into one product decision stewarded by the PO.

<figure class="acx-agent-graph" aria-labelledby="agent-graph-caption">
<div class="acx-agent-graph__canvas">
<svg class="acx-agent-graph__desktop" viewBox="0 0 920 560" role="img"
  aria-labelledby="agent-graph-title agent-graph-description">
  <title id="agent-graph-title">Product delivery Agent Graph</title>
  <desc id="agent-graph-description">The Product Owner directs developers and developers report status and blockers back. A research loop returns evidence. Research and delivery knowledge converge at a product decision owned by the Product Owner.</desc>
  <defs>
    <marker id="acx-graph-arrow-cyan" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" class="acx-agent-graph__marker--cyan"/>
    </marker>
    <marker id="acx-graph-arrow-teal" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" class="acx-agent-graph__marker--teal"/>
    </marker>
    <marker id="acx-graph-arrow-gold" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" class="acx-agent-graph__marker--gold"/>
    </marker>
  </defs>

  <rect x="310" y="36" width="300" height="106" rx="22" class="acx-agent-graph__actor"/>
  <text x="460" y="69" text-anchor="middle" class="acx-agent-graph__kicker">CONTEXT + DECISION STEWARD</text>
  <text x="460" y="102" text-anchor="middle" class="acx-agent-graph__title">Product Owner</text>
  <text x="460" y="126" text-anchor="middle" class="acx-agent-graph__sub">intent · priorities · acceptance</text>

  <rect x="350" y="222" width="220" height="90" rx="20" class="acx-agent-graph__decision"/>
  <text x="460" y="253" text-anchor="middle" class="acx-agent-graph__kicker">CONVERGENCE</text>
  <text x="460" y="281" text-anchor="middle" class="acx-agent-graph__title">Product decision</text>
  <text x="460" y="300" text-anchor="middle" class="acx-agent-graph__sub">bounded synthesis · owned by PO</text>

  <rect x="54" y="382" width="316" height="134" rx="24" class="acx-agent-graph__loop"/>
  <text x="82" y="411" class="acx-agent-graph__kicker">DISCOVERY LOOP</text>
  <rect x="82" y="428" width="260" height="64" rx="16" class="acx-agent-graph__actor"/>
  <text x="212" y="456" text-anchor="middle" class="acx-agent-graph__title">Researchers</text>
  <text x="212" y="479" text-anchor="middle" class="acx-agent-graph__sub">evidence · uncertainty · alternatives</text>

  <rect x="550" y="382" width="316" height="134" rx="24" class="acx-agent-graph__loop"/>
  <text x="578" y="411" class="acx-agent-graph__kicker">DELIVERY LOOP</text>
  <rect x="578" y="428" width="260" height="64" rx="16" class="acx-agent-graph__actor"/>
  <text x="708" y="456" text-anchor="middle" class="acx-agent-graph__title">Developers</text>
  <text x="708" y="479" text-anchor="middle" class="acx-agent-graph__sub">build · verify · surface blockers</text>

  <path d="M 318 83 C 112 88, 76 255, 190 382" class="acx-agent-graph__route acx-agent-graph__route--request"
    marker-end="url(#acx-graph-arrow-cyan)"/>
  <text x="105" y="183" class="acx-agent-graph__label">REQUESTS</text>
  <text x="105" y="203" class="acx-agent-graph__route-copy">decision question</text>

  <path d="M 244 382 C 92 316, 120 150, 318 116" class="acx-agent-graph__route acx-agent-graph__route--return"
    marker-end="url(#acx-graph-arrow-teal)"/>
  <text x="109" y="298" class="acx-agent-graph__label">ADVISES</text>
  <text x="109" y="318" class="acx-agent-graph__route-copy">research evidence</text>

  <path d="M 602 82 C 812 86, 850 251, 728 382" class="acx-agent-graph__route acx-agent-graph__route--direct"
    marker-end="url(#acx-graph-arrow-cyan)"/>
  <text x="752" y="183" class="acx-agent-graph__label">DIRECTS</text>
  <text x="752" y="203" class="acx-agent-graph__route-copy">delivery brief</text>

  <path d="M 674 382 C 834 318, 804 151, 602 116" class="acx-agent-graph__route acx-agent-graph__route--report"
    marker-end="url(#acx-graph-arrow-teal)"/>
  <text x="750" y="298" class="acx-agent-graph__label">REPORTS</text>
  <text x="750" y="318" class="acx-agent-graph__route-copy">status + blockers</text>

  <path d="M 342 458 C 425 432, 419 347, 435 313" class="acx-agent-graph__route acx-agent-graph__route--converge"
    marker-end="url(#acx-graph-arrow-gold)"/>
  <path d="M 578 458 C 495 432, 501 347, 485 313" class="acx-agent-graph__route acx-agent-graph__route--converge acx-agent-graph__route--delayed"
    marker-end="url(#acx-graph-arrow-gold)"/>
  <path d="M 460 222 L 460 143" class="acx-agent-graph__route acx-agent-graph__route--decision"
    marker-end="url(#acx-graph-arrow-gold)"/>
</svg>

<ol class="acx-agent-graph__mobile" aria-label="Product delivery Agent Graph as a route list">
  <li><span>Product Owner</span><strong>directs →</strong><span>Developers</span><small>carries the delivery brief</small></li>
  <li><span>Developers</span><strong>report →</strong><span>Product Owner</span><small>returns status, verification, and blockers</small></li>
  <li><span>Product Owner</span><strong>requests →</strong><span>Researchers</span><small>carries the product intent and decision question</small></li>
  <li><span>Researchers</span><strong>advise →</strong><span>Product Owner</span><small>returns evidence, uncertainty, and alternatives</small></li>
  <li class="acx-agent-graph__mobile-convergence"><span>Discovery loop + delivery loop</span><strong>converge →</strong><span>Product decision</span><small>bounded synthesis; Product Owner is steward</small></li>
</ol>
</div>
<figcaption id="agent-graph-caption">Solid responsibilities, fuzzy descriptions: the moving routes show information flow, not task execution. The complete text equivalent follows.</figcaption>
</figure>

### Text equivalent

| From | Relationship | To | Knowledge carried | Return / result |
| --- | --- | --- | --- | --- |
| Product Owner | **directs** | Developers | delivery brief | developers report through the declared return route |
| Developers | **reports to** | Product Owner | progress, verified outcomes, risks, blockers | product context stays current |
| Product Owner | **requests from** | Researchers | product intent and decision question | researchers advise through the declared return route |
| Researchers | **advises** | Product Owner | evidence, uncertainty, counterarguments | evidence becomes decision-ready |
| Discovery loop + delivery loop | **converge at** | Product decision, stewarded by PO | research evidence + delivery status | one bounded, recorded decision |

The arrows form reporting cycles on purpose. They do **not** dispatch work. A host may listen for declared
events and route messages, but the graph itself grants no tool access, permissions, budget, or runtime
authority.

## Why this is not another workflow

Task graphs are precise about execution order. Teams also need a slower-moving map of responsibility:
who should know what, who may give direction, where a response must come back, and which person or agent
reconciles conflicting signals.

| Question | CAL (`acx.cal/1`) | Agent Graph (`acx.agent-graph/1`) |
| --- | --- | --- |
| What happens next? | nodes, gateways, conditions, completion | out of scope |
| Who performs a task? | participant bound to each task node | actors describe durable team seats |
| Who owns context? | RAC says what must be available | knowledge modules name stewards and audiences |
| Who talks to whom? | handoffs implied by control flow | explicit routes with purpose, obligation, triggers, and returns |
| Where do loops meet? | inside one workflow graph | convergence joins whole CALs, external loops, or informal loops |
| Are cycles allowed? | only as bounded execution cycles | reporting cycles are expected; required direction chains stay conflict-free |

Use a CAL for a repeatable process. Use an Agent Graph for the information architecture around one or many
processes. Link them with `loops[].workflowRef` when a loop is itself a signed ACX Workflow.

## The six building blocks

<div class="acx-grid acx-graph-components" markdown="1">

<div class="acx-card" markdown="1">
### Actors
Logical seats — agent, human, group, service, or mixed. A fuzzy `selector` can describe suitable roles,
capabilities, and traits without naming a particular person or machine.
</div>

<div class="acx-card" markdown="1">
### Knowledge modules
Metadata about intent, decisions, evidence, status, risk, tacit context, or artifacts. Each module names
its stewards and audience. Actual knowledge content is invalid here.
</div>

<div class="acx-card" markdown="1">
### Routes
Typed relationships such as `direct`, `report`, `advise`, `review`, or `escalate`, plus an open
`relationship` label, prose purpose, obligation, triggers, carried knowledge, and expected return route.
</div>

<div class="acx-card" markdown="1">
### Loop bindings
Connect knowledge imports and exports to an ACX Workflow, an external process, or an informal loop.
Participant aliases can be mapped to durable actor seats.
</div>

<div class="acx-card" markdown="1">
### Convergence
At least two distinct loops meet at a named steward. A policy explains how inputs become new decision
knowledge; wait time and synthesis rounds are bounded.
</div>

<div class="acx-card" markdown="1">
### Limits
`maxPropagationHops` and `maxFanout` bound graph-wide propagation. Each convergence also declares
`maxWaitMs` and `maxRounds`.
</div>

</div>

## Author one: fuzzy where useful, strict where needed

The graph is deliberately fuzzy at the human boundary and strict at the reference boundary:

- **Fuzzy:** actor descriptions, capability selectors, relationship labels, route purpose, success,
  cadence, and the `0..1` communication `weight`.
- **Strict:** stable ids, known actor and knowledge references, structured event/interval/manual triggers,
  declared return routes, no self-routes, unambiguous participant bindings, conflict-free required
  direction, SemVer + digest-pinned ACX Workflow references in public graphs, and positive bounds.

```json title="A direction route with an explicit reporting return"
{
  "id": "po-directs-developers",
  "from": "product-owner",
  "to": ["developers"],
  "intent": "direct",
  "relationship": "directs",
  "obligation": "must",
  "authority": "delegated",
  "purpose": "Translate product intent into a clear delivery brief.",
  "carries": ["delivery-brief"],
  "returns": ["delivery-status"],
  "triggers": [{
    "type": "event",
    "events": ["work.requested", "scope.changed"]
  }],
  "expects": {
    "via": "developers-report-po",
    "withinMs": 86400000
  },
  "weight": 1
}
```

The reverse route is a separate object. That keeps “PO directs developers” distinct from “developers
report status to PO,” even though together they form a healthy communication loop.

```json title="Two loops converging into decision knowledge"
{
  "id": "product-steering",
  "inputs": [
    { "loop": "discovery-loop", "knowledge": ["research-evidence"] },
    { "loop": "delivery-loop", "knowledge": ["delivery-status"] }
  ],
  "steward": "product-owner",
  "policy": {
    "mode": "steward-synthesis",
    "description": "Reconcile evidence, delivery reality, and product intent."
  },
  "outputs": ["product-decision"],
  "trigger": "When either loop reports a material, decision-ready change.",
  "limits": { "maxWaitMs": 3600000, "maxRounds": 2 }
}
```

!!! tip "Start with sentences, then add structure"
    Write “PO directs developers with the current delivery brief; developers report progress and blockers
    back” first. Turn the nouns into actor and knowledge ids, then add triggers, a return route, and bounds.
    The prose remains valuable: it is what makes the graph understandable to a new team and matchable by
    an agent host.

## Knowledge is described, never embedded

An Agent Graph manages *implicit knowledge responsibility*, not the knowledge itself. A module may say:

> “Decision-relevant research evidence, uncertainty, counterarguments, and source-quality notes.”

It may name researchers as stewards, the PO as audience, freshness intent, sensitivity, and a metadata-only
locator. It cannot include the roadmap, source material, credentials, private messages, or decision
content. A receiving environment resolves the description through RAC, OKF, MCP, an artifact, or a human.

This keeps one signed graph reusable across organizations without turning it into a data-exfiltration
channel.

## Validate, sign, share

```bash
# Validate the graph; --publish also checks discovery metadata.
acx graph lint product-delivery.agent-graph.json --publish

# Sign the canonical graph with Ed25519 + DSSE/in-toto.
acx graph sign product-delivery.agent-graph.json \
  --publisher io.github.yourhandle \
  --out product-delivery.signed.agent-graph.json

# Verify before using or listing it.
acx graph verify product-delivery.signed.agent-graph.json
acx graph inspect product-delivery.signed.agent-graph.json

# Preview the canonical registry path, then prepare the focused diff.
acx share graph product-delivery.signed.agent-graph.json --dry-run
acx share graph product-delivery.signed.agent-graph.json
```

The public artifact media type is `application/vnd.acx.agent-graph.v1+json`. Signing excludes only the
top-level `integrity`, canonicalizes the rest with RFC 8785/JCS, hashes it with SHA-256, and binds its id,
version, publisher, and signing time in an in-toto Statement carried by a single-signature DSSE envelope.

## Guardrails worth remembering

1. **A graph does not grant authority.** `authority: delegated` describes a relationship; the host and
   operator still decide what an actor may access or change.
2. **Actors are roles, not people.** A selector describes a seat. Staffing that seat is a separate host
   decision.
3. **Reporting cycles do not auto-dispatch.** They describe expected information movement. A runtime must
   opt in to triggers and enforce graph limits.
4. **Required direction stays unambiguous.** For the same knowledge and recipient, there cannot be two
   conflicting mandatory directors or a mandatory direction cycle.
5. **Convergence fails visibly.** Missing or contradictory inputs follow the declared failure mode; bounds
   prevent silent waiting forever.
6. **Public metadata stays public.** The publish profile rejects secret-like values and private key
   material before the graph can be signed or shared.

<div class="acx-graph-share-card" markdown="1">
<span class="acx-eyebrow">SHARE THE TEAM, NOT JUST THE TASK LIST</span>

### Make the invisible reporting structure portable

Publish one signed `.agent-graph.json` beside the CALs it connects. A reviewer can understand the team in
plain language; a host can verify every reference, return route, bound, and signature.

<div class="acx-actions">
<a class="acx-button acx-button--primary" href="../share/#share-an-agent-graph">Share an Agent Graph</a>
<a class="acx-button" href="loops-cal/">Pair it with a CAL</a>
</div>
</div>

## Related

- [Conditional Agentic Loops](loops-cal.md) — signed execution order and completion contracts.
- [Loop & context policy](loop-context.md) — the bounded loop inside one cartridge.
- [Knowledge & OKF](knowledge-okf.md) — metadata-first knowledge interchange.
- [Share ACX](../share.md) — the pull-request path for agents, workflows, and Agent Graphs.
