// 変更する値はここへ集約。時間はミリ秒。
export const VERSION = '1.2.0';
export const DB_NAME = 'yuu-memory-beat';
export const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const DIFFICULTIES = { EASY: 6000, NORMAL: 4500, HARD: 3000, EXPERT: 2000 };
export const JUDGMENT = { perfect: .35, great: .7 };
export const POINTS = { PERFECT: 100, GREAT: 80, GOOD: 50, MISS: 0 };
export const QUESTION_COUNTS = [10, 20, 30, 50];
export const TIME_OPTIONS = [2, 3, 5, 10];
export const EFFECTS = { maxParticles: 72, counts: { PERFECT: 42, GREAT: 30, GOOD: 20 }, duration: 1050 };
export const COMBO_STEPS = [3, 5, 10, 20, 30];
export const GAME_TIMING = { recognitionGrace: 1600, ttsTimeout: 18000 };
export const CHOICE_COUNT = 4;
export const DEFAULT_SETTINGS = {
  id: 'main', speechEnabled: true, speechVolume: .9, bgmVolume: .22, seVolume: .55,
  answerMode: 'choices', recognitionMode: 'off', remoteConsent: false, allowSan: true, difficulty: 'NORMAL',
  vibration: true, effects: true, bgmTrack: 'focus', favoriteMinutes: [],
  sessionMode: 'count', count: 10, minutes: 2, direction: 'forward', selectedDeckId: null
};
export const TRACKS = [
  { id: 'focus', name: 'Focus Circuit', bpm: 104, roots: [48, 53, 45, 55], notes: [0, 3, 7, 10], wave: 'triangle' },
  { id: 'pulse', name: 'Memory Pulse', bpm: 120, roots: [48, 56, 51, 58], notes: [0, 4, 7], wave: 'sine' },
  { id: 'rush', name: 'Recall Rush', bpm: 136, roots: [45, 53, 48, 55], notes: [0, 3, 7], wave: 'triangle' }
];
