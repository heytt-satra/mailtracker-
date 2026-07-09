# MailTrack — "Actually Read" Detection: Research & Development Plan

Status: **Track A + E shipped (ADR-18) · Track B shipped (ADR-19) · Track C dropped, empirically · Track D dropped, architecturally** | Owner: Heytt Satra | Feature codename: **DEPTH**

> **Post-implementation update (ADR-18):** Track C (streaming/heartbeat pixel) was tested empirically before any feature code was written — deployed a real diagnostic streaming endpoint, watched live Worker logs while killing a real connection mid-stream. Result: Cloudflare Workers give **zero** observable signal on client disconnect (no `cancel()`, no thrown write, not even a completed-request log — confirmed over 5+ minutes against a live `wrangler tail` session that was actively logging other requests throughout). This is stronger and worse than this document originally assumed: it's not "Gmail's proxy defeats it," it's a platform-wide gap affecting every recipient, matching a real open `cloudflare/workerd` issue (#5611). Track C is dropped for now; reviving it would mean standing up a second, non-Workers service just for that one endpoint, which is a real infrastructure decision to make separately, not a code fix. Track A + Track E shipped instead.
>
> **Post-implementation update (ADR-19):** Track B (depth beacons) shipped — `beacon_tokens` table, `routes/beacon.ts`, `computeDepthReached()`, all gated behind a `bodyLength` threshold so the signal only ever fires for messages actually long enough to make it true (see ADR-19 for the fabrication risk this gate exists to prevent). Verified end-to-end against the live backend with a disposable test user; the exact real-Gmail clip-threshold behavior still needs a live human test (tracked as a follow-up, same category as the phone acceptance test). Track D (AMP for Email) is dropped — not merely gated behind Google's approval process as originally scoped here, but blocked by MailTrack's actual send architecture: it sends by injecting HTML into Gmail's own compose window and letting Gmail assemble/transmit the MIME message, and there is no hook anywhere in that path to attach AMP's required separate `text/x-amp-html` MIME part. Reviving it would mean switching MailTrack's entire send mechanism to the Gmail API with a hand-built MIME message (`gmail.send` OAuth scope, a materially more sensitive permission) — a new architecture, not a feature. See ADR-19 for the full detail; the "Track B" and "Track D" sections below are kept as originally written for the record, with this note as the correction.

> The ask: "tell us whether the user has *read* the mail or not — track how long it was open." This document is the researched answer to how we attack that, honestly, without faking a number. Read alongside `PLAN.md` ADR-14 (which said dwell time was out of scope) — this plan does not overturn that; it reframes the goal into something real, and pushes the boundary as far as physics actually allows.

---

## 1. The reframe (this matters more than any technique)

The request bundles two different things:

- **The goal:** "did they genuinely *read* it, or did it just get opened / auto-previewed?"
- **One proposed means:** "measure how long it was open" (dwell time in seconds).

These are not the same, and conflating them is where every competitor either lies or gives up. **The goal is achievable and valuable. The means (exact seconds-open) is bounded by hard constraints for our primary target, Gmail.** So we build toward the goal using every real signal available, treat "seconds open" as *one input among several* rather than the deliverable, and — non-negotiably — never fabricate a duration we can't actually measure.

The product we ship is a **Read Confidence verdict** per message:

| Verdict | Meaning | How we know |
|---|---|---|
| `Read` | Strong evidence a human engaged with the content | Depth beacon + dwell bracket, or click, or AMP engaged-time |
| `Likely read` | Verified human open + at least one corroborating signal | Verified open + repeat open, or long open→click gap |
| `Glanced / opened` | Opened by a human but no depth evidence | Single verified open, nothing more |
| `Auto / not verifiable` | Machine prefetch or platform blocks measurement | Existing classifier verdicts (Apple MPP, scanner, prefetch) |

Every verdict shows its evidence. That transparency **is** the product.

---

## 2. The hard constraint (why this is genuinely difficult, stated honestly)

Email clients do not execute JavaScript in the message body. Gmail, Outlook web, and Apple Mail all strip `<script>`. So you cannot run a timer inside the email. Every dwell-tracking technique is therefore *indirect* — it infers duration from the pattern of resource fetches (images) the client makes.

**Gmail specifically proxies and pre-fetches all images through `GoogleImageProxy`.** When an email is opened, Gmail's proxy fetches the referenced images *server-side, up front, and caches them*. The connection the proxy holds reflects the proxy's fetch, not the human's viewing session. This is what defeats the naive dwell techniques for our primary target — and it is the reason the honest answer for a pure-Gmail recipient is "hard," not "trivial."

**This is not speculation — it is confirmed by the market.** See §3.

---

## 3. What the research found (grounded, with sources)

- **ContactMonkey sells "Read Time Analytics" and labels it explicitly "Outlook Only."**
  ([help.contactmonkey.com](https://help.contactmonkey.com/hc/en-us/articles/360049898391-Understanding-Read-Time-Analytics-Outlook-Only)) — A real, funded commercial product that measures read *duration* — and it only works in Outlook desktop, precisely because Outlook fetches the tracking image directly and holds the connection open while the email is displayed. This is authoritative, independent confirmation of our core thesis: **duration tracking via a connection-hold / streaming pixel is real and works — on direct-fetch clients — and is defeated by Gmail's proxy.** We are not the first to hit this wall; we're the first who will be honest about which side of it each recipient is on.

- **The streaming/slow-load pixel technique is the established method.**
  ([StackOverflow: track time spent reading an email](https://stackoverflow.com/questions/56566230/track-time-spent-reading-an-email)) — The server drips the tracking image out slowly and measures how long the client keeps the connection open. Works when the client fetches directly; broken by any proxy that pre-fetches and caches.

- **AMP for Email is the one path to true engaged-time on Gmail** — but it is gated. `amp-analytics` supports visibility/timer triggers that can report genuine visible duration. Requires: registering as an AMP sender with Google, strict DKIM/SPF/DMARC alignment, sending a dedicated `text/x-amp-html` MIME part, and the recipient being on an AMP-capable Gmail client. High effort, partial coverage — but where it works, it's a *real* measured number, not an inference.

- **General email-tracking mechanics** ([Gong](https://help.gong.io/docs/how-does-email-tracking-work), [alias.email](https://alias.email/blog/how-email-tracking-works/)) confirm the whole industry runs on pixel-fetch inference and that proxying/prefetching is the universal confounder.

**Honesty note on research coverage:** the AMP capability search returned results but as one large blob I could not extract cleanly line-by-line; the AMP claims below are marked as *needs verification in Phase 0* rather than treated as settled. The ContactMonkey "Outlook Only" finding came through clearly and is treated as confirmed.

---

## 4. The technique tracks

Five tracks, ranked by realism for a Gmail recipient. We build the real ones first and treat the moonshot as a later, gated bet. **Every track begins with an empirical test against real Gmail — we measure, we do not assume.**

### Track A — Engagement-bracket dwell *(REAL, honest, ship first)*
The time between a verified-open pixel fetch and a *later* event (a link click, or a second beacon firing) is a genuine, provable **minimum** time-engaged. Open at T, click at T+40s → they demonstrably had it open and engaged for ≥40 seconds. We already log both events with timestamps. This gives a defensible lower bound with proof, today, on our existing infrastructure — no new client tricks required.
- **Coverage:** any recipient who clicks or triggers a second beacon.
- **Honesty:** we report "engaged ≥ N seconds," never "open for exactly N."

### Track B — Depth beacons, esp. the Gmail clip-fold beacon *(REAL-ish, empirically test)*
Place multiple pixels at different points in the email body: top, middle, and critically **below Gmail's ~102KB "message clipped" threshold**. Gmail truncates long messages and only loads the below-fold content when the user clicks **"View entire message."** A beacon below that fold firing is a strong "engaged enough to expand and keep reading" signal — genuine depth, not a glance.
- **Must be tested:** does Gmail's proxy pre-fetch below-clip images, or only on expand? This is the make-or-break empirical question for the track. Phase 0 answers it.
- **Coverage:** Gmail recipients on longer emails.

### Track C — Streaming / heartbeat pixel *(REAL for direct-fetch clients; test Gmail)*
The ContactMonkey technique: slow-drip the pixel, or serve a multi-frame animated resource, or force periodic re-fetch, and measure connection-hold duration / frame-arrival as a dwell proxy. **Confirmed to work on Outlook desktop and other direct-fetch clients.** For Gmail: expected to be defeated by the proxy, but this must be *measured*, not assumed — because (a) not every recipient is on Gmail, and (b) partial signal for the Outlook/Apple-Mail-direct subset is still premium data for those recipients.
- **Coverage:** Outlook desktop, some Apple Mail configs, non-proxying clients. **Not** pure-Gmail-web (pending Phase 0 confirmation).
- **This is where real seconds-level dwell actually lives — for the recipients whose clients allow it.**

### Track D — AMP for Email *(MOONSHOT, genuine engaged-time on Gmail)*
The only avenue to true, visibility-based engaged-time on Gmail. `amp-analytics` visibility/timer triggers report actual visible duration back to our endpoint. Gated behind Google AMP-sender registration, strict auth alignment, a dedicated AMP MIME part, and AMP-capable recipients. Highest effort, partial coverage, real payoff where it lands. Prototyped only after Tracks A–C ship and prove the product.
- **Coverage:** AMP-capable Gmail recipients, once we're a registered sender.

### Track E — The honesty layer *(REQUIRED, non-negotiable, ships with Track A)*
Every duration and verdict carries its **method and confidence**. Where a recipient's platform structurally blocks measurement, we say **"read-depth not measurable for this recipient"** — never a fabricated number. This is the ADR-5 / "never fabricate engagement" principle extended to the read-detection feature. It is the entire reason anyone should trust our number over a competitor's inflated one.

---

## 5. Phased roadmap (empirical-test-first)

### Phase 0 — Measurement lab *(do this before building anything)*
Stand up a test harness that sends instrumented emails to a matrix of real accounts (Gmail web, Gmail app iOS/Android, Outlook desktop, Outlook web, Apple Mail + MPP) and records exactly what each client fetches, when, and how it behaves under: slow-streamed pixels, animated multi-frame pixels, below-clip-fold pixels, and repeat-fetch beacons. **Output: a truth table of which technique yields real signal on which client.** No feature code until this exists — it converts every "expected / likely" above into "measured."

### Phase 1 — Track A (engagement-bracket dwell) + Track E (honesty layer)
Compute and surface "engaged ≥ N seconds" from existing open→click / open→beacon gaps. Ship the Read Confidence verdict with evidence. Pure win on infrastructure we already have.

### Phase 2 — Track B (depth beacons)
Inject multi-position beacons incl. the clip-fold beacon (gated on Phase 0 confirming Gmail behavior). Feed depth into the verdict.

### Phase 3 — Track C (streaming/heartbeat pixel)
Ship real dwell-seconds for direct-fetch recipients (Outlook etc.), clearly labeled by client capability. This is the "groundbreaking for the recipients it works on" milestone.

### Phase 4 — Track D (AMP for Email)
Register as AMP sender, prototype amp-analytics engaged-time, roll out to AMP-capable Gmail. The moonshot.

---

## 6. Data model changes (sketch)

- `messages`: add `read_confidence` (`read | likely_read | glanced | not_verifiable`), `min_engaged_seconds int null`, `depth_reached` (`top | mid | full | null`).
- `raw_events`: add `beacon_position` (`top | mid | clipfold | bottom | null`) so multi-pixel fetches are distinguishable; add `dwell_ms int null` for streaming-pixel connection-hold measurements.
- New `read_signals` view/table aggregating the above into the per-message verdict, consumed by the dashboard timeline.
- Dashboard: a "Read confidence" badge + an "engaged ≥ Ns (method)" line in the detail view, with an explicit "not measurable on this client" state.

*(Migrations follow the incremental `000N_*.sql` pattern — the DB has live data now, so no editing `0001_init.sql`.)*

---

## 7. Success criteria & the honest ceiling

**Success =** for every tracked message we can state, with shown evidence, one of: genuinely read / likely read / glanced / not-measurable — and for the subset of recipients whose clients allow it (Outlook direct-fetch, AMP-capable Gmail), a real dwell-seconds number.

**The ceiling we will not lie about:** for a plain-HTML email opened once in Gmail web with no click and no expand, exact seconds-open is **not** recoverable, and we will say so rather than invent it. Pushing that ceiling is exactly what Tracks C and D are for — but until they measure real signal for a given recipient, that recipient gets an honest "depth unknown," not a fabricated duration.

---

## 8. Risks

- **Phase 0 could show Gmail defeats Tracks B and C entirely** — then the honest deliverable for Gmail recipients is Track A + AMP only. That's still a real, differentiated product, and finding it out cheaply in a lab beats shipping a lie.
- **AMP sender registration is a real gate** with approval risk and ongoing auth-alignment burden.
- **Multiple beacons / streaming responses raise spam-filter and load-time risk** — must be weighed against deliverability (NFR2 spirit: never hurt the actual email).
- **Over-claiming would destroy the one thing that makes this product worth using.** The honesty layer is not optional polish; it is the moat.

---

## 9. Bottom line

We can absolutely build a **"genuinely read vs. glanced" verdict** — that's the real goal, and it's shippable starting with infrastructure we already have (Track A). We can deliver **real dwell-seconds for the recipients whose clients physically allow it** (Track C, confirmed by ContactMonkey's Outlook-only product; Track D via AMP). And for the cases where the recipient's platform structurally forbids measurement, we will do the one thing no competitor does: **say so, instead of making up a number.** That honesty, applied to the hardest signal in the category, is the groundbreaking part — not a fake seconds counter.
