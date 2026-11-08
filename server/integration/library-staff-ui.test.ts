import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { ReplacementCharges } from '../../../Frighton Univeristy LMS/client/src/components/staff/ReplacementCharges.js';

test('staff charge lookup failure is not an empty ledger and a successful reload clears the read error', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://library.test' });
  const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'React'] as const;
  const previous = globals.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  Object.defineProperties(globalThis, {
    window: { value: dom.window, configurable: true },
    document: { value: dom.window.document, configurable: true },
    navigator: { value: dom.window.navigator, configurable: true },
    IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true },
  });
  // Use the LMS renderer and React instance with its component; the sibling repos
  // have separate dependency installations even when the React versions match.
  const requireLms = createRequire(
    new URL('../../../Frighton Univeristy LMS/client/package.json', import.meta.url),
  );
  const React = requireLms('react');
  const { createRoot } = requireLms('react-dom/client');
  Object.defineProperty(globalThis, 'React', { value: React, configurable: true });
  let unavailable = true,
    calls = 0;
  const request = mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify(unavailable ? { error: 'Charge records unavailable' } : []), {
      status: unavailable ? 503 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await React.act(async () =>
      root.render(React.createElement(ReplacementCharges, { studentNumber: 'REVIEW-1' })),
    );
    assert.match(dom.window.document.body.textContent ?? '', /Charge records unavailable/);
    assert.doesNotMatch(dom.window.document.body.textContent ?? '', /No replacement charges recorded/);
    assert.equal((dom.window.document.querySelector('fieldset') as HTMLFieldSetElement).disabled, true);
    unavailable = false;
    const reload = [...dom.window.document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reload charges',
    )!;
    await React.act(async () => reload.click());
    assert.match(dom.window.document.body.textContent ?? '', /No replacement charges recorded/);
    assert.doesNotMatch(dom.window.document.body.textContent ?? '', /Charge records unavailable/);
    assert.equal((dom.window.document.querySelector('fieldset') as HTMLFieldSetElement).disabled, false);
    assert.equal(calls, 2);
  } finally {
    await React.act(async () => root.unmount());
    request.mock.restore();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
