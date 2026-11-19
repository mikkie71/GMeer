export type EventStatus = 'NOW' | 'SOON' | 'FUTURE' | 'PAST' | 'SNOOZED' | 'DISMISSED';

export interface CalendarSource {
  id: string;
  name: string;
  icsUrl: string;
  color: string; // Tailwind color class or hex, e.g. '#3b82f6'
  enabled: boolean;
  lastSync?: string;
  error?: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string;
  title: string;
  description?: string;
  location?: string;
  start: string; // ISO string
  end: string;   // ISO string
  allDay: boolean;
  url?: string;
  status: EventStatus;
  snoozedUntil?: string; // ISO string
  dismissed?: boolean;
  googleEventId?: string; // ID in Google Agenda (voor de API), bv. abc123 of _8d34...
  googleCalendarId?: string; // Agenda-ID in Google, bv. naam@domein.nl
}

export interface AppSettings {
  soonMinutes: number;
  refreshMinutes: number;
  loadDays: number;
  pastDays: number; // Hoeveel dagen terug in het verleden meenemen (0 = alleen vandaag)
  popupOnSoon: boolean;
  popupOnNow: boolean;
  soundEnabled: boolean;
  speechEnabled: boolean;
  autoDismissPast: boolean;
  startWithWindows: boolean;
  language?: 'auto' | 'nl' | 'en'; // 'auto' = Windows-taal volgen
  hideOnBlur?: boolean; // venster verbergen bij klikken buiten het venster
}

/**
 * Unfolds RFC 5545 folded lines (lines starting with space or tab continue the previous line)
 */
function unfoldIcs(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const unfolded = normalized.replace(/\n[ \t]/g, '');
  return unfolded.split('\n');
}

/**
 * Parses an iCalendar date string (e.g. 20261117T133000Z or 20261117)
 */
function parseIcsDate(val: string, params: string): { date: Date; allDay: boolean } {
  const clean = val.trim();
  const isDateOnly = params.includes('VALUE=DATE') || clean.length === 8;

  if (isDateOnly && clean.length >= 8) {
    const year = parseInt(clean.slice(0, 4), 10);
    const month = parseInt(clean.slice(4, 6), 10) - 1;
    const day = parseInt(clean.slice(6, 8), 10);
    return { date: new Date(year, month, day, 0, 0, 0), allDay: true };
  }

  // Format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const year = parseInt(clean.slice(0, 4), 10);
  const month = parseInt(clean.slice(4, 6), 10) - 1;
  const day = parseInt(clean.slice(6, 8), 10);
  const hour = parseInt(clean.slice(9, 11) || '0', 10);
  const min = parseInt(clean.slice(11, 13) || '0', 10);
  const sec = parseInt(clean.slice(13, 15) || '0', 10);

  if (clean.endsWith('Z')) {
    return { date: new Date(Date.UTC(year, month, day, hour, min, sec)), allDay: false };
  }

  return { date: new Date(year, month, day, hour, min, sec), allDay: false };
}

function unescapeIcsText(txt: string): string {
  return txt
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Extracts the Google Calendar ID (e.g. naam@voorbeeld.nl) from the .ics URL
 */
export function extractCalendarAddressFromIcsUrl(icsUrl: string): string | null {
  const match = icsUrl.match(/\/ical\/([^/]+)\//i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return null;
}

/**
 * Formats a Date as UTC iCalendar string: YYYYMMDDTHHMMSSZ
 */
function toUtcIcsString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Formats a local Date as YYYYMMDD (used by Google Calendar for all-day recurring instance IDs)
 */
function toDateOnlyIcsString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * base32hex (RFC 4648, kleine letters, zonder '='), zoals Google gebruikt voor event-ID's
 */
function toBase32Hex(text: string): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  const bytes = new TextEncoder().encode(text);
  let out = '';
  let value = 0;
  let bits = 0;
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Builds the exact Google Calendar deep-link (HtmlLink) for a specific event UID + Calendar ID.
 */
/**
 * Zet een .ics-UID om naar het event-ID dat Google Agenda (web + API) intern gebruikt.
 * Google-ID's zijn base32hex (alleen a-v en 0-9), evt. met _<datum> voor een herhaling.
 * Afspraken van iPhone/Outlook/externe uitnodigingen (bv. 0178F91E-1535-...) krijgen bij
 * Google het ID "_" + base32hex(UID).
 */
export function toGoogleEventId(uid: string): string {
  let cleanEventId = uid.replace(/@google\.com$/i, '');
  const isGoogleEventId = /^[a-v0-9]{5,}(_[0-9]{8}(T[0-9]{6}Z)?)?$/.test(cleanEventId);
  if (cleanEventId && !isGoogleEventId) {
    const m = cleanEventId.match(/^(.*?)(_[0-9]{8}(T[0-9]{6}Z)?)?$/);
    const icalUid = m?.[1] ?? cleanEventId;
    const instanceSuffix = m?.[2] ?? '';
    cleanEventId = `_${toBase32Hex(icalUid)}${instanceSuffix}`;
  }
  return cleanEventId;
}

function buildGoogleEventUrl(uid: string, icsUrl: string, start: Date): string {
  const calAddress = extractCalendarAddressFromIcsUrl(icsUrl);
  const cleanEventId = uid ? toGoogleEventId(uid) : '';
  if (cleanEventId && calAddress) {
    const rawPair = `${cleanEventId} ${calAddress}`;
    try {
      const b64 = btoa(rawPair).replace(/=+$/, '');
      return `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(b64)}&authuser=${encodeURIComponent(calAddress)}`;
    } catch {
      // Fallback
    }
  }

  const y = start.getFullYear();
  const m = start.getMonth() + 1;
  const d = start.getDate();
  const authParam = calAddress ? `?authuser=${encodeURIComponent(calAddress)}` : '';
  return `https://calendar.google.com/calendar/r/day/${y}/${m}/${d}${authParam}`;
}

/**
 * Expands a recurring VEVENT with an RRULE (FREQ=DAILY, WEEKLY, MONTHLY, YEARLY)
 * into individual occurrences within [minDate, maxDate], attaching the exact
 * Google Calendar instance suffix `_YYYYMMDDTHHMMSSZ` so every link works!
 */
function expandRecurringInstances(
  baseStart: Date,
  durationMs: number,
  allDay: boolean,
  rruleLine: string,
  exdates: Set<string>,
  minDate: Date,
  maxDate: Date
): { start: Date; end: Date; suffix: string }[] {
  const parts: Record<string, string> = {};
  rruleLine.split(';').forEach((kv) => {
    const [k, v] = kv.split('=');
    if (k && v) parts[k.toUpperCase()] = v.toUpperCase();
  });

  const freq = parts['FREQ'];
  if (!freq) return [];

  const interval = Math.max(1, parseInt(parts['INTERVAL'] || '1', 10));
  const maxCount = parts['COUNT'] ? parseInt(parts['COUNT'], 10) : 1000;
  let untilDate: Date | null = null;
  if (parts['UNTIL']) {
    untilDate = parseIcsDate(parts['UNTIL'], '').date;
  }

  const dayMap: Record<string, number> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
  };
  const byDays = parts['BYDAY']
    ? parts['BYDAY']
        .split(',')
        .map((d) => dayMap[d.slice(-2)])
        .filter((n) => n !== undefined)
    : null;

  const results: { start: Date; end: Date; suffix: string }[] = [];
  let count = 0;

  // For WEEKLY with BYDAY (e.g. MO,WE,FR), step day-by-day from baseStart
  if (freq === 'WEEKLY' && byDays && byDays.length > 0) {
    const cursor = new Date(baseStart.getTime());
    const startOfFirstWeek = new Date(
      baseStart.getFullYear(),
      baseStart.getMonth(),
      baseStart.getDate() - baseStart.getDay()
    );

    for (let safety = 0; safety < 1500; safety++) {
      if (untilDate && cursor > untilDate) break;
      if (cursor > maxDate) break;

      const weeksDiff = Math.floor(
        (cursor.getTime() - startOfFirstWeek.getTime()) / (7 * 86400000)
      );

      if (weeksDiff >= 0 && weeksDiff % interval === 0 && byDays.includes(cursor.getDay())) {
        count++;
        if (count > maxCount) break;

        const occStart = new Date(cursor.getTime());
        const occEnd = new Date(occStart.getTime() + durationMs);
        const suffix = allDay ? toDateOnlyIcsString(occStart) : toUtcIcsString(occStart);

        if (!exdates.has(suffix) && !exdates.has(toDateOnlyIcsString(occStart))) {
          if (occEnd >= minDate && occStart <= maxDate) {
            results.push({ start: occStart, end: occEnd, suffix });
          }
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }
    return results;
  }

  // Standard stepping for DAILY, WEEKLY, MONTHLY, YEARLY
  let stepIndex = 0;
  while (stepIndex < 1000 && count < maxCount) {
    const occStart = new Date(baseStart.getTime());
    if (freq === 'DAILY') {
      occStart.setDate(baseStart.getDate() + stepIndex * interval);
    } else if (freq === 'WEEKLY') {
      occStart.setDate(baseStart.getDate() + stepIndex * 7 * interval);
    } else if (freq === 'MONTHLY') {
      occStart.setMonth(baseStart.getMonth() + stepIndex * interval);
    } else if (freq === 'YEARLY') {
      occStart.setFullYear(baseStart.getFullYear() + stepIndex * interval);
    } else {
      break;
    }

    stepIndex++;
    if (untilDate && occStart > untilDate) break;
    if (occStart > maxDate) break;

    count++;
    const occEnd = new Date(occStart.getTime() + durationMs);
    const suffix = allDay ? toDateOnlyIcsString(occStart) : toUtcIcsString(occStart);

    if (!exdates.has(suffix) && !exdates.has(toDateOnlyIcsString(occStart))) {
      if (occEnd >= minDate && occStart <= maxDate) {
        results.push({ start: occStart, end: occEnd, suffix });
      }
    }
  }

  return results;
}

/**
 * Parses raw .ICS content into CalendarEvent items within [today - pastDays, today + loadDays]
 */
export function parseIcsFeed(
  rawIcs: string,
  calendar: CalendarSource,
  loadDays: number,
  pastDays: number = 0
): CalendarEvent[] {
  const lines = unfoldIcs(rawIcs);
  const events: CalendarEvent[] = [];
  const calendarAddress = extractCalendarAddressFromIcsUrl(calendar.icsUrl) ?? undefined;

  const now = new Date();
  // Standaard pastDays = 0 -> vanaf vandaag 00:00 (net als GMinder DateTime.Today!)
  const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - pastDays, 0, 0, 0);
  const maxDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + loadDays, 23, 59, 59);

  interface RawVEvent {
    uid: string;
    summary: string;
    description: string;
    location: string;
    url: string;
    dtStart: { date: Date; allDay: boolean };
    dtEnd: { date: Date; allDay: boolean } | null;
    rrule: string;
    recurrenceIdSuffix: string;
    exdates: Set<string>;
  }

  const rawEvents: RawVEvent[] = [];

  let inEvent = false;
  let uid = '';
  let summary = '';
  let description = '';
  let location = '';
  let url = '';
  let dtStart: { date: Date; allDay: boolean } | null = null;
  let dtEnd: { date: Date; allDay: boolean } | null = null;
  let rrule = '';
  let recurrenceIdSuffix = '';
  let exdates = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      uid = '';
      summary = '';
      description = '';
      location = '';
      url = '';
      dtStart = null;
      dtEnd = null;
      rrule = '';
      recurrenceIdSuffix = '';
      exdates = new Set<string>();
      continue;
    }

    if (trimmed === 'END:VEVENT') {
      if (inEvent && dtStart && summary) {
        rawEvents.push({
          uid,
          summary,
          description,
          location,
          url,
          dtStart,
          dtEnd,
          rrule,
          recurrenceIdSuffix,
          exdates,
        });
      }
      inEvent = false;
      continue;
    }

    if (!inEvent) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const left = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1);
    const semiIdx = left.indexOf(';');
    const propName = (semiIdx === -1 ? left : left.slice(0, semiIdx)).toUpperCase();
    const propParams = semiIdx === -1 ? '' : left.slice(semiIdx + 1).toUpperCase();

    switch (propName) {
      case 'UID':
        uid = val.trim();
        break;
      case 'SUMMARY':
        summary = val.trim();
        break;
      case 'DESCRIPTION':
        description = val.trim();
        break;
      case 'LOCATION':
        location = val.trim();
        break;
      case 'URL':
        url = val.trim();
        break;
      case 'DTSTART':
        dtStart = parseIcsDate(val, propParams);
        break;
      case 'DTEND':
        dtEnd = parseIcsDate(val, propParams);
        break;
      case 'RRULE':
        rrule = val.trim();
        break;
      case 'RECURRENCE-ID': {
        const parsedRec = parseIcsDate(val, propParams);
        recurrenceIdSuffix = parsedRec.allDay
          ? toDateOnlyIcsString(parsedRec.date)
          : toUtcIcsString(parsedRec.date);
        break;
      }
      case 'EXDATE': {
        val.split(',').forEach((v) => {
          const parsedEx = parseIcsDate(v, propParams);
          exdates.add(
            parsedEx.allDay ? toDateOnlyIcsString(parsedEx.date) : toUtcIcsString(parsedEx.date)
          );
        });
        break;
      }
    }
  }

  // Track overridden instances (RECURRENCE-ID) so we don't duplicate them when expanding RRULE
  const overriddenKeys = new Set<string>();
  for (const rev of rawEvents) {
    if (rev.recurrenceIdSuffix) {
      const baseUid = rev.uid.replace(/@google\.com$/i, '');
      overriddenKeys.add(`${baseUid}_${rev.recurrenceIdSuffix}`);
    }
  }

  for (const rev of rawEvents) {
    const start = rev.dtStart.date;
    const end = rev.dtEnd
      ? rev.dtEnd.date
      : new Date(start.getTime() + (rev.dtStart.allDay ? 86400000 : 3600000));
    const durationMs = Math.max(0, end.getTime() - start.getTime());
    const baseUid = rev.uid.replace(/@google\.com$/i, '');

    if (rev.rrule && !rev.recurrenceIdSuffix) {
      // Herhalende reeks: vouw uit naar losse afspraken én plak _YYYYMMDDTHHMMSSZ achter het UID!
      const occurrences = expandRecurringInstances(
        start,
        durationMs,
        rev.dtStart.allDay,
        rev.rrule,
        rev.exdates,
        minDate,
        maxDate
      );

      for (const occ of occurrences) {
        const instanceUid = `${baseUid}_${occ.suffix}`;
        if (overriddenKeys.has(instanceUid)) continue;

        events.push({
          id: `${calendar.id}:${instanceUid}`,
          calendarId: calendar.id,
          calendarName: calendar.name,
          color: calendar.color,
          title: unescapeIcsText(rev.summary),
          description: rev.description ? unescapeIcsText(rev.description) : undefined,
          location: rev.location ? unescapeIcsText(rev.location) : undefined,
          start: occ.start.toISOString(),
          end: occ.end.toISOString(),
          allDay: rev.dtStart.allDay,
          url: rev.url || buildGoogleEventUrl(instanceUid, calendar.icsUrl, occ.start),
          googleEventId: toGoogleEventId(instanceUid),
          googleCalendarId: calendarAddress,
          status: 'FUTURE',
        });
      }
    } else {
      // Enkele afspraak of verplaatste instantie uit een reeks (met RECURRENCE-ID)
      if (end >= minDate && start <= maxDate) {
        const effectiveUid =
          rev.recurrenceIdSuffix && !baseUid.includes('_')
            ? `${baseUid}_${rev.recurrenceIdSuffix}`
            : baseUid;

        events.push({
          id: `${calendar.id}:${effectiveUid || `${rev.summary}-${start.toISOString()}`}`,
          calendarId: calendar.id,
          calendarName: calendar.name,
          color: calendar.color,
          title: unescapeIcsText(rev.summary),
          description: rev.description ? unescapeIcsText(rev.description) : undefined,
          location: rev.location ? unescapeIcsText(rev.location) : undefined,
          start: start.toISOString(),
          end: end.toISOString(),
          allDay: rev.dtStart.allDay,
          url: rev.url || buildGoogleEventUrl(effectiveUid, calendar.icsUrl, start),
          googleEventId: effectiveUid ? toGoogleEventId(effectiveUid) : undefined,
          googleCalendarId: calendarAddress,
          status: 'FUTURE',
        });
      }
    }
  }

  return events;
}

/**
 * Computes the current GMinder status (NOW, SOON, FUTURE, PAST, SNOOZED) for an event
 */
export function computeEventStatus(
  ev: CalendarEvent,
  soonMinutes: number,
  now: Date = new Date()
): EventStatus {
  if (ev.dismissed) return 'DISMISSED';

  if (ev.snoozedUntil) {
    const snoozeDate = new Date(ev.snoozedUntil);
    if (now < snoozeDate) {
      return 'SNOOZED';
    }
  }

  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const soonThreshold = new Date(now.getTime() + soonMinutes * 60 * 1000);

  if (now >= end) {
    return 'PAST';
  }
  if (now >= start && now < end) {
    return 'NOW';
  }
  if (now < start && soonThreshold >= start) {
    return 'SOON';
  }
  return 'FUTURE';
}
