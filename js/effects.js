import { EFFECTS, COMBO_STEPS } from './config.js';
export function rewardEffect(grade, combo, settings) {
  if (settings.vibration && navigator.vibrate) navigator.vibrate(grade === 'PERFECT' ? [22, 25, 22] : grade === 'MISS' ? 35 : 18);
  if (!settings.effects) return;
  const root = document.querySelector('#effects'); if (!root) return; root.replaceChildren();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelector('#score-value')?.animate?.([{ transform: 'scale(1)' }, { transform: reduced ? 'scale(1)' : 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 350 });
  if (reduced || grade === 'MISS') return;
  const flash = document.createElement('div'); flash.className = `reward-flash ${grade.toLowerCase()}`; root.append(flash);
  const ring = document.createElement('div'); ring.className = `reward-ring ${grade.toLowerCase()}`; root.append(ring);
  const n = Math.min(EFFECTS.maxParticles, EFFECTS.counts[grade] || 0);
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i'), angle = i / n * Math.PI * 2, length = 75 + Math.random() * 110;
    el.className = `particle ${grade.toLowerCase()}`; el.style.setProperty('--dx', `${Math.cos(angle) * length}px`); el.style.setProperty('--dy', `${Math.sin(angle) * length}px`); el.style.setProperty('--size', `${3 + Math.random() * 5}px`); root.append(el);
  }
  if (COMBO_STEPS.includes(combo) || (combo > 30 && combo % 10 === 0)) {
    const el = document.createElement('div'); el.className = `combo-burst ${combo >= 10 ? 'big' : ''}`; el.textContent = `${combo} COMBO`; root.append(el);
  }
  setTimeout(() => root.replaceChildren(), EFFECTS.duration + 200);
}
