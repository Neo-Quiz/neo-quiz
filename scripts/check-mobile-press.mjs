import assert from 'node:assert/strict';
import { withSrcModule } from './lib/load-src.mjs';
class Surface {
  constructor(parent = null, enabled = true) { this.parent = parent; this.enabled = enabled; this.dataset = {}; this.isConnected = true; }
  closest(selector) { if (selector.includes('button,')) return this; if (selector.includes(':disabled')) return this.enabled ? null : this; return null; }
  matches() { return false; }
}
const listeners = new Map();
globalThis.Element = Surface;
globalThis.HTMLElement = Surface;
globalThis.document = { body: { classList: { contains: () => true } }, hidden: false, addEventListener(type, fn) { listeners.set(type, fn); } };
globalThis.window = { matchMedia: () => ({ matches: true }), addEventListener(type, fn) { listeners.set(type, fn); } };
const emit = (type, extra = {}) => listeners.get(type)?.({ pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10, ...extra });
await withSrcModule('apps/windows/src/ui/ripple.ts', ({ installRipple, pressFamily }) => {
  const fixture = (token, text = 'Action', modal = false) => ({
    textContent: text,
    closest: () => modal ? {} : null,
    matches: selector => selector === "button, [role='button']" ? token === 'button' : selector.split(',').some(part => part.trim() === token),
  });
  for (const token of ['.qbd-nav-item', '.qbd-quizzes-node-head', '.nq-set-ligne-lien', '.nq-set-onglet', '.qb-toggle-wrap', "[role='tab']", 'summary', '.qbd-model-picker-row']) {
    assert.equal(pressFamily(fixture(token), false), 'layer', `${token} stays still`);
  }
  assert.equal(pressFamily(fixture('button', ''), false), 'layer', 'icon-only button stays still');
  assert.equal(pressFamily(fixture('button'), false), 'scale', 'text button scales');
  assert.equal(pressFamily(fixture('.qbd-quiz-card'), false), 'scale', 'card scales');
  for (const token of ['.quiz-option', '.quiz-possibility', '.quiz-slot.filled', 'button.quiz-fc-card', '.qbd-cta3d']) {
    assert.equal(pressFamily(fixture(token), false), 'depth', `${token} retains its raised face`);
    assert.equal(pressFamily(fixture(token), true), 'layer', `${token} becomes a veil with reduced motion`);
    assert.equal(pressFamily(fixture(token, 'Action', true), false), 'layer', `${token} is flat inside a modal`);
  }
  assert.equal(pressFamily(fixture('.quiz-fc-card'), false), 'layer', 'already-flipped flashcard does not move its rotating inner card');
  installRipple();
  const target = new Surface();
  emit('pointerdown', { target });
  assert.equal(target.dataset.nqPressed, 'true', 'feedback begins on pointerdown');
  assert.equal(target.dataset.nqPressFamily, 'layer', 'reduced motion retains a state layer');
  const parent = new Surface(); target.parent = parent;
  assert.equal(parent.dataset.nqPressed, undefined, 'nested action never presses its parent');
  emit('pointermove', { clientX: 21 });
  assert.equal(target.dataset.nqPressed, undefined, 'movement cancels a visible press');
  emit('pointerdown', { target }); emit('pointerup');
  assert.equal(target.dataset.nqPressed, undefined, 'release clears feedback');
  for (const type of ['pointercancel', 'scroll', 'blur', 'contextmenu']) {
    emit('pointerdown', { target }); emit(type);
    assert.equal(target.dataset.nqPressed, undefined, `${type} clears feedback`);
  }
  emit('pointerdown', { target }); document.hidden = true; emit('visibilitychange'); document.hidden = false;
  assert.equal(target.dataset.nqPressed, undefined, 'hidden document clears feedback');
  emit('pointerdown', { target }); emit('pointerdown', { target, pointerId: 2, isPrimary: false });
  assert.equal(target.dataset.nqPressed, undefined, 'second finger cancels feedback');
  emit('pointerup', { pointerId: 2 }); emit('pointerup');
  const disabled = new Surface(null, false); emit('pointerdown', { target: disabled });
  assert.equal(disabled.dataset.nqPressed, undefined, 'disabled target never reacts');
  console.log('Mobile press lifecycle: passed');
});
