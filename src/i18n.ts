/**
 * Translations (Dutch / English).
 *
 * By default the language follows Windows (Dutch → nl, anything else → en); it can be changed
 * under Options. Usage: t('key') or t('key', { n: 5 }) to fill in {n} in the text.
 */

export type Lang = 'nl' | 'en';
export type LangSetting = 'auto' | Lang;

const nl = {
  // Times and groups
  allDay: 'Hele dag',
  groupEarlier: 'Eerder — {d}',
  groupToday: 'Vandaag — {d}',
  groupTomorrow: 'Morgen — {d}',
  groupInDays: 'Over {n} dagen — {d}',
  relSnoozed: 'Gesnoozed ({n}m)',
  relLeftMin: 'Nog {n} min',
  relLeftHM: 'Nog {h}u {m}m',
  relEnded: 'Afgelopen',
  relStartsNow: 'Begint nu!',
  relInMin: 'Over {n} min',
  relInHours: 'Over {n} uur',
  relTomorrow: 'Morgen',
  relInDays: 'Over {n} dagen',
  speechNow: 'begint nu!',
  speechSoon: 'begint over {n} minuten',
  syncJustNow: 'Zojuist',

  // Messages
  icsFetchFailed: 'Kon .ics niet ophalen',
  googleOpening: 'Browser geopend: geef GMeer toestemming in Google…',
  googleConnectedMsg: '✅ Gekoppeld met Google Agenda',
  googleDisconnectedMsg: 'Ontkoppeld',
  onlyInApp: 'Alleen beschikbaar in de app',
  icsReadOnly:
    'De .ics-link kan alleen lezen. Om afspraken te verplaatsen moet GMeer eenmalig toestemming krijgen van Google.',
  notGoogleEvent: 'Geen Google-afspraak',
  movedAllDay: 'Verplaatst naar morgen (hele dag)',
  movedAt: 'Verplaatst naar morgen {t}',
  connectFirstAdd: 'Koppel eerst Google (Opties) om in deze agenda toe te voegen',
  localOnlyLocation: 'Alleen lokaal in GMeer',

  // Status labels
  badgeNow: 'Nu bezig',
  badgeSoon: 'Binnenkort',
  badgeSnoozed: '💤 Gesnoozed',
  badgePast: 'Geweest',
  badgePlanned: 'Gepland',

  // Agenda window
  syncActiveTitle: 'Offline cache & sync actief',
  myAgenda: 'Mijn Agenda',
  activeCount: '{n} actief',
  syncNowTitle: 'Nu synchroniseren',
  quickAddTitle: 'Snel afspraak toevoegen',
  newBtn: '＋ Nieuw',
  quickAddHeader: '⚡ Snel Afspraak Toevoegen',
  quickAddPlaceholder: 'Bijv. Tandarts controle...',
  adding: '⏳ Toevoegen…',
  addToGoogle: 'Toevoegen aan Google',
  addLocal: 'Toevoegen (lokaal)',
  noEvents: 'Geen openstaande afspraken!',
  noEventsHint: 'Klik met de rechtermuisknop op het tray-icoon om je .ICS-kalenders te beheren.',
  dismissTitle: 'Afspraak direct afvinken',
  dismissBtn: '✓ Dismiss',
  moveTitle: 'Verplaats deze afspraak in Google Agenda naar morgen, zelfde tijd',
  moving: '⏳ Verplaatsen…',
  toTomorrow: '➡️ Naar morgen',
  closeTitle: 'Venster sluiten (GMeer blijft actief in het systeemvak)',
  closeBtn: '✕ Sluiten',

  // Settings: header and tabs
  settingsTitle: '⚙️ GMeer Instellingen',
  quitTitle: 'GMeer volledig afsluiten',
  quitBtn: 'Afsluiten',
  tabCalendars: '🔗 .ICS Kalenders ({n})',
  tabOptions: '🔊 Opties & Geluid',

  // Settings: calendars
  yourCalendars: 'Jouw Kalenders & Privé .ICS-links',
  deleteCalendar: 'Verwijder kalender',
  icsPlaceholder: "Plak hier je Google Agenda 'Geheim adres in iCal-indeling' (.ics)...",
  syncError: '⚠️ Fout bij sync: {e}',
  lastSynced: '✓ Laatst gesynchroniseerd om {t}',
  addCalendarHeader: '＋ Extra Kalender Toevoegen',
  calNamePlaceholder: 'Naam (bijv. Werk / Privé)',
  addBtn: 'Voeg toe',
  saveSync: '🔄 Opslaan & .ICS-feeds synchroniseren',
  howToTitle: 'Hoe vind je jouw Google Agenda .ICS-link?',
  how1a: 'Open Google Agenda in je browser en klik op het tandwieltje ⚙️ → ',
  how1b: 'Instellingen',
  how2a: 'Klik links onder ',
  how2b: "Instellingen voor mijn agenda's",
  how2c: ' op jouw agenda.',
  how3a: 'Scroll naar beneden naar ',
  how3b: 'Agenda integreren',
  how4a: 'Kopieer het ',
  how4b: 'Geheim adres in iCal-indeling',
  how4c: ' (eindigt op ',
  how4d: ') en plak hem hierboven!',

  // Settings: options
  googleSection: 'Google Agenda koppeling',
  connected: 'Gekoppeld',
  notConnected: 'Niet gekoppeld',
  googleHelp:
    'Nodig voor "Naar morgen" en "+ Nieuw" in Google Agenda. Eenmalig: maak in Google Cloud Console een OAuth-client van het type "Desktop-app" (met de Google Calendar API aan) en plak hier de gegevens.',
  waitingGoogle: 'Wachten op Google…',
  connectGoogle: '🔐 Koppelen met Google',
  disconnect: 'Ontkoppelen',
  optLanguage: 'Taal',
  langAuto: 'Automatisch (Windows)',
  optHideOnBlur: 'Venster verbergen bij klikken buiten het venster',
  optSoon: 'Melding vóór aanvang ("Binnenkort")',
  minutes: '{n} minuten',
  hour1: '1 uur',
  optAutostart: 'Automatisch starten met Windows',
  optRefresh: 'Ververs-interval voor .ICS feeds',
  everyMin: 'Elke {n} min',
  optSound: 'Geluid afspelen bij herinnering',
  testSound: '🔊 Test geluid',
  optSpeech: 'Spraakherinnering (Nederlandse stem)',
  testVoice: '🗣️ Test stem',
  optAutoDismiss: 'Verlopen afspraken automatisch afvinken',
  optLoadDays: 'Aantal dagen vooruit laden (toekomst)',
  optPastDays: 'Aantal dagen terug kijken (verleden, 0 = alleen vanaf vandaag)',

  // Date/time picker
  pickDateTime: 'Datum en tijd kiezen',
  today: 'Vandaag',
  tomorrow: 'Morgen',
  plusWeek: '+1 week',
  prevMonth: 'Vorige maand',
  nextMonth: 'Volgende maand',
  time: 'Tijd',
  minus15Title: '15 minuten eerder',
  plus15Title: '15 minuten later',
  done: 'Klaar',
};

export type Key = keyof typeof nl;

const en: Record<Key, string> = {
  allDay: 'All day',
  groupEarlier: 'Earlier — {d}',
  groupToday: 'Today — {d}',
  groupTomorrow: 'Tomorrow — {d}',
  groupInDays: 'In {n} days — {d}',
  relSnoozed: 'Snoozed ({n}m)',
  relLeftMin: '{n} min left',
  relLeftHM: '{h}h {m}m left',
  relEnded: 'Ended',
  relStartsNow: 'Starting now!',
  relInMin: 'In {n} min',
  relInHours: 'In {n} h',
  relTomorrow: 'Tomorrow',
  relInDays: 'In {n} days',
  speechNow: 'starts now!',
  speechSoon: 'starts in {n} minutes',
  syncJustNow: 'Just now',

  icsFetchFailed: 'Could not fetch .ics',
  googleOpening: 'Browser opened: give GMeer permission in Google…',
  googleConnectedMsg: '✅ Connected to Google Calendar',
  googleDisconnectedMsg: 'Disconnected',
  onlyInApp: 'Only available in the app',
  icsReadOnly:
    'The .ics link is read-only. To move appointments, GMeer needs one-time permission from Google.',
  notGoogleEvent: 'Not a Google appointment',
  movedAllDay: 'Moved to tomorrow (all day)',
  movedAt: 'Moved to tomorrow {t}',
  connectFirstAdd: 'Connect Google first (Options) to add to this calendar',
  localOnlyLocation: 'Local only in GMeer',

  badgeNow: 'Now',
  badgeSoon: 'Soon',
  badgeSnoozed: '💤 Snoozed',
  badgePast: 'Past',
  badgePlanned: 'Planned',

  syncActiveTitle: 'Offline cache & sync active',
  myAgenda: 'My Calendar',
  activeCount: '{n} active',
  syncNowTitle: 'Sync now',
  quickAddTitle: 'Quickly add an appointment',
  newBtn: '＋ New',
  quickAddHeader: '⚡ Quick Add Appointment',
  quickAddPlaceholder: 'E.g. Dentist check-up...',
  adding: '⏳ Adding…',
  addToGoogle: 'Add to Google',
  addLocal: 'Add (local)',
  noEvents: 'No upcoming appointments!',
  noEventsHint: 'Right-click the tray icon to manage your .ICS calendars.',
  dismissTitle: 'Dismiss this appointment',
  dismissBtn: '✓ Dismiss',
  moveTitle: 'Move this appointment in Google Calendar to tomorrow, same time',
  moving: '⏳ Moving…',
  toTomorrow: '➡️ To tomorrow',
  closeTitle: 'Close window (GMeer keeps running in the system tray)',
  closeBtn: '✕ Close',

  settingsTitle: '⚙️ GMeer Settings',
  quitTitle: 'Quit GMeer completely',
  quitBtn: 'Quit',
  tabCalendars: '🔗 .ICS Calendars ({n})',
  tabOptions: '🔊 Options & Sound',

  yourCalendars: 'Your calendars & private .ICS links',
  deleteCalendar: 'Remove calendar',
  icsPlaceholder: "Paste your Google Calendar 'Secret address in iCal format' (.ics) here...",
  syncError: '⚠️ Sync error: {e}',
  lastSynced: '✓ Last synced at {t}',
  addCalendarHeader: '＋ Add Another Calendar',
  calNamePlaceholder: 'Name (e.g. Work / Personal)',
  addBtn: 'Add',
  saveSync: '🔄 Save & sync .ICS feeds',
  howToTitle: 'How do I find my Google Calendar .ICS link?',
  how1a: 'Open Google Calendar in your browser and click the gear ⚙️ → ',
  how1b: 'Settings',
  how2a: 'On the left, under ',
  how2b: 'Settings for my calendars',
  how2c: ', click your calendar.',
  how3a: 'Scroll down to ',
  how3b: 'Integrate calendar',
  how4a: 'Copy the ',
  how4b: 'Secret address in iCal format',
  how4c: ' (ends with ',
  how4d: ') and paste it above!',

  googleSection: 'Google Calendar connection',
  connected: 'Connected',
  notConnected: 'Not connected',
  googleHelp:
    'Needed for "To tomorrow" and "+ New" in Google Calendar. One-time: create an OAuth client of type "Desktop app" in Google Cloud Console (with the Google Calendar API enabled) and paste the details here.',
  waitingGoogle: 'Waiting for Google…',
  connectGoogle: '🔐 Connect with Google',
  disconnect: 'Disconnect',
  optLanguage: 'Language',
  langAuto: 'Automatic (Windows)',
  optHideOnBlur: 'Hide window when clicking outside it',
  optSoon: 'Alert before start ("Soon")',
  minutes: '{n} minutes',
  hour1: '1 hour',
  optAutostart: 'Start automatically with Windows',
  optRefresh: 'Refresh interval for .ICS feeds',
  everyMin: 'Every {n} min',
  optSound: 'Play sound on reminder',
  testSound: '🔊 Test sound',
  optSpeech: 'Spoken reminder (English voice)',
  testVoice: '🗣️ Test voice',
  optAutoDismiss: 'Automatically dismiss past appointments',
  optLoadDays: 'Days to load ahead (future)',
  optPastDays: 'Days to look back (past, 0 = from today only)',

  pickDateTime: 'Choose date and time',
  today: 'Today',
  tomorrow: 'Tomorrow',
  plusWeek: '+1 week',
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  time: 'Time',
  minus15Title: '15 minutes earlier',
  plus15Title: '15 minutes later',
  done: 'Done',
};

const dictionaries: Record<Lang, Record<Key, string>> = { nl, en };

/** First guess before Rust answers: the webview language follows Windows. */
export function guessSystemLang(): Lang {
  const l = (typeof navigator !== 'undefined' && navigator.language) || '';
  return l.toLowerCase().startsWith('nl') ? 'nl' : 'en';
}

let current: Lang = guessSystemLang();

export function setLang(lang: Lang) {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** Locale for dates/times (en-GB: 24-hour clock, day before month). */
export function locale(): string {
  return current === 'nl' ? 'nl-NL' : 'en-GB';
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  let text = dictionaries[current][key] ?? dictionaries.nl[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}
