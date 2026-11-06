/**
 * Snake Eye — hover explanations.
 *
 * Any element with `data-tip` gets one shared floating bubble: on mouse hover,
 * on keyboard focus, and on tap for touch screens, where there is no hover.
 * The bubble is clamped to the viewport, so a label at the right edge of the
 * page does not push its explanation off screen.
 */

import { explain } from './glossary.js';

let bubble = null;
let current = null;

function ensureBubble() {
  if (bubble) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'tip-bubble';
  bubble.id = 'tip-bubble';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  document.body.append(bubble);
  return bubble;
}

function show(target) {
  const text = target.dataset.tip;
  if (!text) return;
  const node = ensureBubble();
  current = target;
  node.textContent = text;
  node.hidden = false;
  target.setAttribute('aria-describedby', node.id);

  const gap = 8;
  const margin = 12;
  const rect = target.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;

  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - margin && rect.top - gap - height > margin) {
    top = rect.top - gap - height;
  }
  node.style.left = `${Math.round(left + window.scrollX)}px`;
  node.style.top = `${Math.round(top + window.scrollY)}px`;
}

function hide() {
  if (!bubble || !current) return;
  current.removeAttribute('aria-describedby');
  bubble.hidden = true;
  current = null;
}

/**
 * Mark `node` as explained by the glossary entry for `label` (or by `text`).
 * Returns the node, so it can wrap an `el(...)` call inline.
 */
export function withTip(node, label, text = null) {
  const tip = text || explain(label);
  if (!tip) return node;
  node.dataset.tip = tip;
  node.classList.add('has-tip');
  node.tabIndex = 0;
  return node;
}

/** Wire the page once. */
export function initTooltips() {
  const tipOf = (event) => event.target.closest?.('[data-tip]');

  document.addEventListener('mouseover', (event) => {
    const target = tipOf(event);
    if (target && target !== current) show(target);
  });
  document.addEventListener('mouseout', (event) => {
    const target = tipOf(event);
    if (target && target === current && !target.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (event) => {
    const target = tipOf(event);
    if (target) show(target);
  });
  document.addEventListener('focusout', hide);
  // Touch has no hover: a tap opens the explanation, a tap elsewhere closes it.
  document.addEventListener('click', (event) => {
    const target = tipOf(event);
    if (target) show(target);
    else hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
}
