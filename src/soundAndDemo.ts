import { CalendarEvent, CalendarSource, AppSettings } from './icsParser';

export const DEFAULT_SETTINGS: AppSettings = {
  soonMinutes: 15,
  refreshMinutes: 10,
  loadDays: 31,
  pastDays: 0,
  popupOnSoon: true,
  popupOnNow: true,
  soundEnabled: true,
  speechEnabled: false,
  autoDismissPast: false,
  startWithWindows: true,
};

export const DEFAULT_CALENDARS: CalendarSource[] = [
  {
    id: 'cal-work',
    name: 'Werk & Projecten',
    icsUrl: '',
    color: '#3b82f6', // blue-500
    enabled: true,
  },
  {
    id: 'cal-personal',
    name: 'Privé & Gezin',
    icsUrl: '',
    color: '#10b981', // emerald-500
    enabled: true,
  },
  {
    id: 'cal-sport',
    name: 'Verjaardagen & Sport',
    icsUrl: '',
    color: '#f59e0b', // amber-500
    enabled: true,
  },
];

export function createDemoEvents(): CalendarEvent[] {
  const now = new Date();

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
      calendarName: 'Werk & Projecten',
      color: '#3b82f6',
      title: 'Sprint Review & Live Demo GMeer',
      description: 'Bespreken van de nieuwe Rust + Tauri v2 architectuur en live preview.',
      location: 'Google Meet / Kamer 3.02',
      start: makeTime(0, 0, -15), // 15 min geleden gestart
      end: makeTime(0, 0, 30),    // duurt nog 30 min -> Status: NOW
      allDay: false,
      url: 'https://calendar.google.com',
      status: 'NOW',
    },
    {
      id: 'demo-2',
      calendarId: 'cal-work',
      calendarName: 'Werk & Projecten',
      color: '#3b82f6',
      title: 'Belafspraak Accountant Q4',
      description: 'Kwartaalcijfers doornemen.',
      location: 'Telefoon (+31 6 12345678)',
      start: makeTime(0, 0, 10),  // begint over 10 min -> Status: SOON
      end: makeTime(0, 0, 40),
      allDay: false,
      url: 'https://calendar.google.com',
      status: 'SOON',
    },
    {
      id: 'demo-3',
      calendarId: 'cal-personal',
      calendarName: 'Privé & Gezin',
      color: '#10b981',
      title: 'Pakketje ophalen & Boodschappen',
      location: 'Albert Heijn XL',
      start: makeTime(0, 3, 0),   // over 3 uur -> Status: FUTURE
      end: makeTime(0, 3, 45),
      allDay: false,
      url: 'https://calendar.google.com',
      status: 'FUTURE',
    },
    {
      id: 'demo-4',
      calendarId: 'cal-sport',
      calendarName: 'Verjaardagen & Sport',
      color: '#f59e0b',
      title: 'Padel Training Baan 4',
      location: 'Plaza Padel',
      start: makeTime(1, 2, 0),   // morgen
      end: makeTime(1, 3, 30),
      allDay: false,
      url: 'https://calendar.google.com',
      status: 'FUTURE',
    },
    {
      id: 'demo-5',
      calendarId: 'cal-personal',
      calendarName: 'Privé & Gezin',
      color: '#10b981',
      title: 'Verjaardag Sanne 🎉',
      location: 'Amsterdam',
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

/**
 * Speaks the event reminder aloud using Web Speech API (inspired by Sound.Speak in GMinder)
 */
export function speakReminder(title: string, relativeText: string) {
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(`${title}, ${relativeText}`);
      utterance.lang = 'nl-NL';
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    }
  } catch {
    // Ignore if speech synthesis is unavailable
  }
}
