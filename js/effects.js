import { EFFECTS, COMBO_STEPS } from './config.js';

function burstText(root, text, className = '') {
  const el = document.createElement('div');
  el.className = `impact-word ${className}`;
  el.textContent = text;
  root.append(el);
}
function addRing(root, grade, delay = 0) {
  const ring = document.createElement('div');
  ring.className = `reward-ring ${grade.toLowerCase()}`;
  ring.style.animationDelay = `${delay}ms`;
  root.append(ring);
}
export function rewardEffect(grade, combo, settings) {
  if (settings.vibration && navigator.vibrate) {
    navigator.vibrate(grade === 'PERFECT' ? [30, 20, 35, 20, 55] : grade === 'GREAT' ? [24, 18, 34] : grade === 'MISS' ? 38 : 22);
  }
  if (!settings.effects) return;
  const root = document.querySelector('#effects'); if (!root) return; root.replaceChildren();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelector('#score-value')?.animate?.([{ transform: 'scale(1)' }, { transform: reduced ? 'scale(1)' : 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 420 });
  document.querySelector('#combo-value')?.animate?.([{ transform: 'scale(1)' }, { transform: reduced ? 'scale(1)' : 'scale(1.38)' }, { transform: 'scale(1)' }], { duration: 500 });
  if (reduced) return;

  document.body.classList.remove('impacting'); void document.body.offsetWidth; document.body.classList.add('impacting');
  setTimeout(() => document.body.classList.remove('impacting'), grade === 'PERFECT' ? 430 : 260);

  if (grade === 'MISS') {
    burstText(root, 'RETRY', 'miss-impact');
    setTimeout(() => root.replaceChildren(), 650);
    return;
  }

  const level = grade === 'PERFECT' ? 1.5 : grade === 'GREAT' ? 1.15 : 1;
  const flash = document.createElement('div'); flash.className = `reward-flash ${grade.toLowerCase()}`; root.append(flash);
  addRing(root, grade, 0); if (grade !== 'GOOD') addRing(root, grade, 110); if (grade === 'PERFECT') addRing(root, grade, 220);

  const n = Math.min(EFFECTS.maxParticles, Math.round((EFFECTS.counts[grade] || 0) * level + Math.min(combo, 20)));
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i'), angle = i / n * Math.PI * 2 + Math.random() * .18, length = 90 + Math.random() * (grade === 'PERFECT' ? 230 : 165);
    el.className = `particle ${grade.toLowerCase()} ${i % 5 === 0 ? 'star' : ''}`;
    el.style.setProperty('--dx', `${Math.cos(angle) * length}px`);
    el.style.setProperty('--dy', `${Math.sin(angle) * length}px`);
    el.style.setProperty('--size', `${4 + Math.random() * (grade === 'PERFECT' ? 9 : 6)}px`);
    el.style.setProperty('--spin', `${Math.round((Math.random() - .5) * 900)}deg`);
    root.append(el);
  }

  burstText(root, grade, grade.toLowerCase());
  if (combo >= 10) burstText(root, 'KOHARU FEVER', 'fever-title');

  if (COMBO_STEPS.includes(combo) || (combo > 30 && combo % 10 === 0)) {
    const el = document.createElement('div');
    el.className = `combo-burst ${combo >= 10 ? 'big' : ''}`;
    el.textContent = `${combo} COMBO`;
    root.append(el);
  }
  setTimeout(() => root.replaceChildren(), EFFECTS.duration + 300);
}
