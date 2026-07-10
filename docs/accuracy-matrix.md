# MailTrack Real-World Accuracy Matrix (human-run)

Status: **protocol defined, not yet executed** | Owner: Heytt Satra | PLAN.md ADR-23

The automated harness (`apps/backend/src/accuracy/harness.ts`, report in [`ACCURACY.md`](./ACCURACY.md)) measures the classifier *logic* against a hand-labeled corpus. It cannot, by itself, prove that a real Gmail-iOS open actually produces the fetch pattern the corpus assumes. That last mile — validating the assumptions against live clients — requires sending real email to real accounts and performing known actions. This document is that protocol.

It is deliberately **not automated end-to-end**: the whole point is that a human performs a *known* action (open / ignore / click / reply) so the action is genuine ground truth, not a simulated fetch. Simulating the fetch would just re-test the classifier against our own assumptions again (which the harness already does).

## Why this matters for the "accuracy %" claim

- The harness number (`ACCURACY.md`) is honest but **bounded**: "given inputs matching known patterns, the classifier is X% correct."
- This matrix produces the **complementary** number: "across N real sends to M live clients with known actions, MailTrack's verdict matched reality Y% of the time."
- Only both together justify a headline accuracy claim to a user. Until this matrix is run, the product should describe the harness number precisely ("classifier accuracy against a labeled scenario set") and never imply it is a real-world field-measured rate.

## The client matrix

Send an instrumented tracked email to a controlled account on each of these clients, then perform each action and record the observed dashboard verdict.

| Client | Open (no click) | Ignore (never open) | Click a link | Reply |
|---|---|---|---|---|
| Gmail web (Chrome desktop) | | | | |
| Gmail app (iOS) | | | | |
| Gmail app (Android) | | | | |
| Apple Mail (macOS, MPP **on**) | | | | |
| Apple Mail (iOS, MPP **on**) | | | | |
| Outlook web | | | | |
| Outlook desktop (Windows) | | | | |
| Proton/Fastmail (image-proxying) | | | | |

Expected, per the product's honesty rules:

- **Open (no click)** → `opened` / read-confidence `glanced` on direct-fetch clients; `not_verifiable` on Apple Mail with MPP on (the correct honest abstention, **not** a miss).
- **Ignore** → stays `sent`/`delivered`; must **never** reach `opened`. A false `opened` here is the single worst error and is what the harness's zero-tolerance test guards in the lab.
- **Click** → `clicked` / read-confidence `read`.
- **Reply** → `replied` / read-confidence `read` (ADR-21).

## Recording procedure

1. Sign the extension into a controlled sender account.
2. For each client row: send one tracked email to that client's inbox.
3. Perform the column action at a **noted wall-clock time**.
4. Wait for classification (seconds; the pipeline is inline — ADR-15), then record the dashboard's status + read-confidence + evidence.
5. Score each cell: does the verdict match the known action, per the expectations above? Count Apple-MPP `not_verifiable` as **correct** (honest abstention), not as a miss.
6. Field accuracy = correct cells / total cells. Record it alongside the date and client versions.

A recorder harness could automate steps 2 and 4 (create the send via the API, poll `GET /v1/messages` for the verdict) on the same disposable-test-user pattern used elsewhere in the project — but steps 1 and 3 (the actual human action on the actual device) are the irreducible manual core and are what make the result trustworthy.

## Status

Not yet executed — same category as the phone acceptance test in PLAN.md §15 and the live-Gmail confirmations left open for ADR-19/20/21. Running it is the last step to a defensible, field-measured accuracy headline.
