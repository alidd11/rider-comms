import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

// Resolved from the repo root (Playwright's working directory); import.meta
// isn't available once Playwright compiles these files to CommonJS.
const resolveFromRoot = createRequire(`${process.cwd()}/`);
const axeSource = readFileSync(resolveFromRoot.resolve('axe-core/axe.min.js'), 'utf8');

// The light (Chromium) and dark (WebKit) phone projects together cover both
// palettes; running every viewport project would only repeat the same DOM.
export const AXE_PROJECTS = new Set(['phone-modern', 'iphone-17-pro-max-webkit']);

const RULE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

// meta-viewport: the PWA disables page zoom on purpose. It is a full-screen
// map whose own pinch gesture would otherwise fight page zoom; see
// ACCESSIBILITY.md.
const DISABLED_RULES = { 'meta-viewport': { enabled: false } };

/**
 * Runs axe-core against the current page and fails with a readable list of
 * violations. Waits for entry transitions first: axe samples colours, and a
 * screen that is still fading in reports blended, too-faint text.
 */
export async function expectNoAxeViolations(page, label) {
  await page.waitForTimeout(700);
  // evaluate() rather than a script tag: the pages' CSP forbids inline scripts.
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async ({ tags, rules }) => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, rules });
    return result.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.slice(0, 5).map((node) => `${node.target.join(' ')}: ${node.failureSummary.split('\n').slice(1).join(' ').trim()}`),
    }));
  }, { tags: RULE_TAGS, rules: DISABLED_RULES });
  expect(violations, `${label}: accessibility violations`).toEqual([]);
}
