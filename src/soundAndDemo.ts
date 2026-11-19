import { CalendarEvent, CalendarSource, AppSettings } from './icsParser';
import type { Lang } from './i18n';

export const DEFAULT_SETTINGS: AppSettings = {
  soonMinutes: 15,
  refreshMinutes: 10,
  loadDays: 31,
  pastDays: 0,
  remindersEnabled: false,
  soundEnabled: true,
  autoDismissPast: false,
  startWithWindows: true,
  language: 'auto',
  hideOnBlur: true,
};

// Names of the demo/default calendars per language (only used on the very first start)
const CAL_NAMES: Record<Lang, Record<string, string>> = {
  nl: { 'cal-work': 'Werk & Projecten', 'cal-personal': 'Privé & Gezin', 'cal-sport': 'Verjaardagen & Sport' },
  en: { 'cal-work': 'Work & Projects', 'cal-personal': 'Personal & Family', 'cal-sport': 'Birthdays & Sports' },
};

export function defaultCalendars(lang: Lang): CalendarSource[] {
  return [
    { id: 'cal-work', name: CAL_NAMES[lang]['cal-work'], icsUrl: '', color: '#3b82f6', enabled: true },
    { id: 'cal-personal', name: CAL_NAMES[lang]['cal-personal'], icsUrl: '', color: '#10b981', enabled: true },
    { id: 'cal-sport', name: CAL_NAMES[lang]['cal-sport'], icsUrl: '', color: '#f59e0b', enabled: true },
  ];
}

const DEMO_TEXT: Record<Lang, Record<string, string>> = {
  nl: {
    t1: 'Sprint Review & Live Demo GMeer', d1: 'Bespreken van de nieuwe Rust + Tauri v2 architectuur en live preview.', l1: 'Google Meet / Kamer 3.02',
    t2: 'Belafspraak Accountant Q4', d2: 'Kwartaalcijfers doornemen.', l2: 'Telefoon (+31 6 12345678)',
    t3: 'Pakketje ophalen & Boodschappen', l3: 'Albert Heijn XL',
    t4: 'Padel Training Baan 4', l4: 'Plaza Padel',
    t5: 'Verjaardag Sanne 🎉', l5: 'Amsterdam',
  },
  en: {
    t1: 'Sprint Review & Live Demo GMeer', d1: 'Discuss the new Rust + Tauri v2 architecture and live preview.', l1: 'Google Meet / Room 3.02',
    t2: 'Call with Accountant Q4', d2: 'Go through the quarterly figures.', l2: 'Phone (+44 20 7946 0000)',
    t3: 'Pick up parcel & groceries', l3: 'Supermarket',
    t4: 'Padel Training Court 4', l4: 'Plaza Padel',
    t5: "Sanne's Birthday 🎉", l5: 'Amsterdam',
  },
};

export function createDemoEvents(lang: Lang): CalendarEvent[] {
  const now = new Date();
  const tx = DEMO_TEXT[lang];
  const cal = CAL_NAMES[lang];

  const makeTime = (daysOffset: number, hoursOffset: number, minsOffset: number) => {
    const d = new Date(now.getTime() + (hoursOffset * 60 + minsOffset) * 60 * 1000);
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString();
  };

  const tomorrowAllDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const tomorrowAllDayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);

  return [
    {
      id: 'demo-1',
      calendarId: 'cal-work',
      calendarName: cal['cal-work'],
      color: '#3b82f6',
      title: tx.t1,
      description: tx.d1,
      location: tx.l1,
      start: makeTime(0, 0, -15), // started 15 min ago
      end: makeTime(0, 0, 30),    // 30 more minutes -> status: NOW
      allDay: false,
      url: 'https://calendar.google.com',
      status: 'NOW',
    },
    {
      id: 'demo-2',
      calendarId: 'cal-work',
      calendarName: cal['cal-work'],
      color: '#3b82f6',
      title: tx.t2,
      description: tx.d2,
      location: tx.l2,
      start: makeTime(0, 0, 10),  // starts in 10 min -> status: SOON
      end: makeTime(0, 0, 40),
      allDay: false,
      url: 'https://calendar.google.com',
      status: 'SOON',
    },
    {
      id: 'demo-3',
      calendarId: 'cal-personal',
      calendarName: cal['cal-personal'],
      color: '#10b981',
      title: tx.t3,
      location: tx.l3,
      start: makeTime(0, 3, 0),   // in 3 hours -> status: FUTURE
      end: makeTime(0, 3, 45),
      allDay: false,
      url: 'https://calendar.google.com',
      status: 'FUTURE',
    },
    {
      id: 'demo-4',
      calendarId: 'cal-sport',
      calendarName: cal['cal-sport'],
      color: '#f59e0b',
      title: tx.t4,
      location: tx.l4,
      start: makeTime(1, 2, 0),   // tomorrow
      end: makeTime(1, 3, 30),
      allDay: false,
      url: 'https://calendar.google.com',
      status: 'FUTURE',
    },
    {
      id: 'demo-5',
      calendarId: 'cal-personal',
      calendarName: cal['cal-personal'],
      color: '#10b981',
      title: tx.t5,
      location: tx.l5,
      start: tomorrowAllDayStart.toISOString(),
      end: tomorrowAllDayEnd.toISOString(),
      allDay: true,
      url: 'https://calendar.google.com',
      status: 'FUTURE',
    },
  ];
}

/**
 * Plays a modern chime using Web Audio API (no external .wav file needed, inspired by Sound.cs)
 */
export function playReminderSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 pleasant chord chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.11);

      gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + idx * 0.11 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.11 + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.11);
      osc.stop(ctx.currentTime + idx * 0.11 + 0.46);
    });
  } catch {
    // Ignore audio context restrictions if not interacted yet
  }
}
