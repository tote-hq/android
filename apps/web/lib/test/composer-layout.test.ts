import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { uiCopy } from '../ui-copy.ts';

/**
 * The phone composer (<=560px). iOS Safari sizes an empty textarea to one
 * line, ignoring rows=2 and the placeholder, so a two-line phone placeholder
 * was cut in half. The field's floor is two lines; the rows clear the focus
 * ring; desktop is untouched.
 */
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

function phoneBlock(marker: string): string {
  const at = css.indexOf(marker);
  assert.ok(at > 0, marker);
  const start = css.lastIndexOf('@media (max-width: 560px) {', at);
  return css.slice(start, at + 1200);
}

describe('phone composer', () => {
  it('the empty-chat field is at least two lines tall, in em', () => {
    const rule = css.slice(css.indexOf('.shell:has(.chat.is-empty) .composer-input {'));
    const body = rule.slice(0, rule.indexOf('}'));
    assert.match(body, /min-height: calc\(2\.6em \+ 18px\);/);
    assert.match(body, /line-height: 1\.3;/);
    assert.match(body, /padding: 8px 12px;/);
  });

  it('the in-conversation field is at least two lines tall too', () => {
    const block = phoneBlock('A long placeholder must not inflate the bar');
    assert.match(block, /\.composer-input \{\s*min-height: calc\(2\.7em \+ 26px\);/);
  });

  it('rows are 8px apart so the 5px focus ring does not touch the tools, and Enviar is centred', () => {
    const block = phoneBlock('A long placeholder must not inflate the bar');
    assert.match(block, /\.composer > \.btn \{ align-self: center; \}/);
    assert.match(block, /\.composer \{ row-gap: 8px; \}/);
    assert.match(block, /\.composer-tools \{ gap: 8px; \}/);
    const empty = css.slice(css.indexOf('.shell:has(.chat.is-empty) .composer {'));
    const body = empty.slice(0, empty.indexOf('}'));
    assert.match(body, /row-gap: 8px;/);
    assert.match(body, /padding: 10px 8px 8px;/);
  });

  it('the home-indicator inset stays on the footer under the composer', () => {
    assert.match(css, /\.shell:has\(\.chat\.is-empty\) \.app-footer \{\s*padding: 0 8px calc\(4px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  });

  it('desktop keeps its composer as before', () => {
    assert.match(css, /@media \(min-width: 561px\) \{\s*\.composer-input \{ min-height: 72px; \}/);
    const base = css.slice(css.indexOf('\n.composer {'));
    assert.match(base.slice(0, base.indexOf('}')), /row-gap: 6px;[\s\S]*padding: 10px 8px;/);
  });

  it('phone placeholders stay short enough for two lines at 360px', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const p of uiCopy(lang).chat.placeholders) assert.ok(p.short.length <= 40, p.short);
    }
  });
});
