import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatReport, runHarness } from '../src/accuracy/harness';

describe('accuracy harness (ADR-23)', () => {
  const report = runHarness();

  it('classifier meets its accuracy bar against the labeled corpus', () => {
    // This is a real regression guard: if a classifier change misclassifies a
    // labeled real-world scenario, this fails. The bar is deliberately high —
    // the corpus is curated, so anything below near-perfect means a genuine
    // regression, not corpus noise.
    expect(report.total).toBeGreaterThanOrEqual(10);
    expect(report.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('never misclassifies a machine as a verified human open — the product-critical direction', () => {
    // Reporting a machine fetch as a verified open is the one error that
    // destroys the product's whole premise, so it's asserted separately and
    // strictly: zero tolerance, independent of the overall accuracy bar.
    const falseVerifiedOpens = report.results.filter(
      (r) => r.actual === 'verified_open' && (r.scenario.expected === 'machine_suspect' || r.scenario.expected === 'not_verifiable'),
    );
    expect(falseVerifiedOpens).toEqual([]);
  });

  it('regenerates docs/ACCURACY.md from the live run', () => {
    // The committed report is a generated artifact — regenerated every test
    // run so it can never drift from the actual classifier behavior.
    const md = formatReport(report, new Date().toISOString());
    const outPath = resolve(process.cwd(), '..', '..', 'docs', 'ACCURACY.md');
    writeFileSync(outPath, md, 'utf8');
    expect(md).toContain('Classifier accuracy against the labeled corpus');
  });
});
