import React, { useState, useEffect, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import DateTimePicker from './DateTimePicker';
import { t, setLang, locale, guessSystemLang, Lang, LangSetting } from './i18n';

// Is the page running inside the Tauri app (rather than a plain browser preview)?
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Opens a link in the default browser (via Rust in Tauri, otherwise plain window.open)
const openExternal = (url: string) => {
  if (isTauri) {
    invoke('open_url', { url }).catch((err) => console.error('open_url failed:', err));
  } else {
    window.open(url, '_blank', 'noopener');
  }
};
import {
  CalendarEvent,
  CalendarSource,
  AppSettings,
  parseIcsFeed,
  extractCalendarAddressFromIcsUrl,
  computeEventStatus,
  EventStatus,
} from './icsParser';
import {
  defaultCalendars,
  DEFAULT_SETTINGS,
  createDemoEvents,
  playReminderSound,
} from './soundAndDemo';

const STORAGE_KEYS = {
  CALENDARS: 'gmeer_calendars_v1',
  EVENTS: 'gmeer_events_v1',
  SETTINGS: 'gmeer_settings_v1',
};

function formatTimeRange(startIso: string, endIso: string, allDay: boolean): string {
  if (allDay) return t('allDay');
  const s = new Date(startIso);
  const e = new Date(endIso);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return `${fmt(s)} - ${fmt(e)}`;
}

function formatDayGroup(startIso: string): string {
  const d = new Date(startIso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  const dateLabel = d.toLocaleDateString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  if (diffDays < 0) return t('groupEarlier', { d: dateLabel });
  if (diffDays === 0) return t('groupToday', { d: dateLabel });
  if (diffDays === 1) return t('groupTomorrow', { d: dateLabel });
  if (diffDays < 7) return t('groupInDays', { n: diffDays, d: dateLabel });
  return dateLabel;
}

function formatRelative(ev: CalendarEvent, now: Date): string {
  if (ev.status === 'SNOOZED' && ev.snoozedUntil) {
    const mins = Math.max(
      1,
      Math.round((new Date(ev.snoozedUntil).getTime() - now.getTime()) / 60000)
    );
    return t('relSnoozed', { n: mins });
  }

  const start = new Date(ev.start);
  const end = new Date(ev.end);

  if (now >= start && now < end) {
    const leftMins = Math.max(1, Math.round((end.getTime() - now.getTime()) / 60000));
    if (leftMins < 60) return t('relLeftMin', { n: leftMins });
    const hrs = Math.floor(leftMins / 60);
    return t('relLeftHM', { h: hrs, m: leftMins % 60 });
  }

  const diffMins = Math.round((start.getTime() - now.getTime()) / 60000);
  if (diffMins < 0) return t('relEnded');
  if (diffMins === 0) return t('relStartsNow');
  if (diffMins < 60) return t('relInMin', { n: diffMins });
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return t('relInHours', { n: diffHrs });
  const diffDays = Math.round(diffHrs / 24);
  return diffDays === 1 ? t('relTomorrow') : t('relInDays', { n: diffDays });
}

export default function App() {
  // 'agenda' = left-click on the tray icon (compact agenda flyout only)
  // 'settings' = right-click on the tray icon (window with .ICS calendars & options)
  const [windowMode, setWindowMode] = useState<'agenda' | 'settings'>('agenda');
  const [settingsTab, setSettingsTab] = useState<'calendars' | 'options'>('calendars');
  const [animKey, setAnimKey] = useState<number>(1);
  const [isTrayVisible, setIsTrayVisible] = useState<boolean>(true);
  const [isClosingAnim, setIsClosingAnim] = useState<boolean>(false);

  const triggerFlyoutOpen = (mode: 'agenda' | 'settings') => {
    setIsClosingAnim(false);
    setIsTrayVisible(true);
    setWindowMode(mode);
    setAnimKey((k) => k + 1);
  };

  const triggerFlyoutToggle = () => {
    if (isTrayVisible && !isClosingAnim) {
      setIsClosingAnim(true);
      setTimeout(() => {
        setIsTrayVisible(false);
        setIsClosingAnim(false);
      }, 190);
    } else {
      triggerFlyoutOpen('agenda');
    }
  };

  const [calendars, setCalendars] = useState<CalendarSource[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CALENDARS);
    return saved ? JSON.parse(saved) : defaultCalendars(guessSystemLang());
  });

  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.EVENTS);
    return saved ? JSON.parse(saved) : createDemoEvents(guessSystemLang());
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  // Language: the setting, or 'auto' = Windows language (Dutch → nl, otherwise en)
  const [systemLang, setSystemLang] = useState<Lang>(guessSystemLang);
  useEffect(() => {
    if (!isTauri) return;
    invoke<Lang>('system_language')
      .then((l) => setSystemLang(l === 'nl' ? 'nl' : 'en'))
      .catch(() => {});
  }, []);
  const langSetting: LangSetting = settings.language ?? 'auto';
  const lang: Lang = langSetting === 'auto' ? systemLang : langSetting;
  setLang(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    if (isTauri) invoke('ui_set_language', { lang }).catch(() => {});
  }, [lang]);

  // Hide the window when clicking outside it (on by default)
  const hideOnBlur = settings.hideOnBlur ?? true;
  useEffect(() => {
    if (isTauri) invoke('ui_set_hide_on_blur', { enabled: hideOnBlur }).catch(() => {});
  }, [hideOnBlur]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  // Default: tomorrow, at the current time (seconds set to 0)
  const tomorrowNow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setSeconds(0, 0);
    return d;
  };
  const [quickAddWhen, setQuickAddWhen] = useState<Date>(tomorrowNow);
  const [quickAddCalId, setQuickAddCalId] = useState('cal-work');
  const [quickAddState, setQuickAddState] = useState<{ busy: boolean; error?: string }>({
    busy: false,
  });
  // 'To tomorrow' button: idle | busy | done | error (the message is shown for a few seconds)
  const [moveState, setMoveState] = useState<{
    kind: 'idle' | 'busy' | 'done' | 'error';
    text?: string;
  }>({ kind: 'idle' });
  const [googleStatus, setGoogleStatus] = useState<{
    configured: boolean;
    connected: boolean;
    client_id: string;
  }>({ configured: false, connected: false, client_id: '' });
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleMessage, setGoogleMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());

  // New calendar form state
  const [newCalName, setNewCalName] = useState('');
  const [newCalUrl, setNewCalUrl] = useState('');
  const [newCalColor, setNewCalColor] = useState('#8b5cf6');

  // URL query param / hash (?mode=settings or ?mode=agenda) selects the view;
  // used by the browser preview.
  useEffect(() => {
    const applyHashOrQuery = () => {
      const params = new URLSearchParams(window.location.search);
      const hash = window.location.hash;
      if (params.get('mode') === 'settings' || hash === '#settings') {
        triggerFlyoutOpen('settings');
      } else if (params.get('mode') === 'agenda' || hash === '#agenda') {
        triggerFlyoutOpen('agenda');
      }
    };
    applyHashOrQuery();
    window.addEventListener('hashchange', applyHashOrQuery);
    return () => window.removeEventListener('hashchange', applyHashOrQuery);
  }, []);

  // Tauri: the tray icon sends 'tray-mode' (left-click = agenda, right-click = settings)
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<string>('tray-mode', (e) => {
      triggerFlyoutOpen(e.payload === 'settings' ? 'settings' : 'agenda');
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CALENDARS, JSON.stringify(calendars));
  }, [calendars]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(events));
  }, [events]);

  // Dismissed appointments (ID -> end time). In the app these live in their own file via Rust,
  // because localStorage changes get lost when GMeer is killed (restart, shutdown, update).
  const [dismissedMap, setDismissedMap] = useState<Record<string, string>>(() => {
    const fromEvents: Record<string, string> = {};
    for (const ev of events) if (ev.dismissed) fromEvents[ev.id] = ev.end;
    return fromEvents;
  });
  const [dismissedLoaded, setDismissedLoaded] = useState(!isTauri);
  useEffect(() => {
    if (!isTauri) return;
    invoke<Record<string, string>>('dismissed_load')
      .then((stored) => setDismissedMap((cur) => ({ ...stored, ...cur })))
      .catch((err) => console.error('dismissed_load failed:', err))
      .finally(() => setDismissedLoaded(true));
  }, []);
  useEffect(() => {
    if (!isTauri || !dismissedLoaded) return;
    // Clean up: only appointments outside the displayed window (pastDays + 7 days margin)
    const cutoff = Date.now() - ((settings.pastDays ?? 0) + 7) * 86400000;
    const pruned = Object.fromEntries(
      Object.entries(dismissedMap).filter(([, end]) => {
        const t = new Date(end).getTime();
        return isNaN(t) || t > cutoff;
      })
    );
    invoke('dismissed_save', { map: pruned }).catch((err) =>
      console.error('dismissed_save failed:', err)
    );
  }, [dismissedMap, dismissedLoaded, settings.pastDays]);
  // After startup/sync: mark appointments from the list as dismissed again
  useEffect(() => {
    if (events.some((e) => dismissedMap[e.id] && !e.dismissed)) {
      setEvents((prev) =>
        prev.map((e) =>
          dismissedMap[e.id] && !e.dismissed ? { ...e, dismissed: true, status: 'DISMISSED' } : e
        )
      );
    }
  }, [events, dismissedMap]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }, [settings]);

  // Ticker (every 15 s) that updates the NOW / SOON statuses. When an appointment changes to
  // SOON or NOW and reminders are on, the window pops up with that appointment selected
  // (plus an optional sound). With reminders off, nothing happens apart from the status update.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  useEffect(() => {
    const updateStatuses = () => {
      const current = new Date();
      setNow(current);

      const changes = new Map<string, EventStatus>();
      let remindOf: CalendarEvent | null = null;
      for (const ev of eventsRef.current) {
        if (ev.dismissed || dismissedMap[ev.id]) continue;
        const nextStatus = computeEventStatus(ev, settings.soonMinutes, current);
        if (nextStatus === ev.status) continue;
        changes.set(ev.id, nextStatus);
        if ((nextStatus === 'SOON' || nextStatus === 'NOW') && !remindOf) remindOf = ev;
      }
      if (changes.size === 0) return;

      setEvents((prev) =>
        prev.map((ev) => {
          const nextStatus = changes.get(ev.id);
          if (!nextStatus) return ev;
          if (nextStatus === 'PAST' && settings.autoDismissPast) {
            return { ...ev, status: 'DISMISSED', dismissed: true };
          }
          return { ...ev, status: nextStatus };
        })
      );

      if (remindOf && settings.remindersEnabled) {
        if (settings.soundEnabled) playReminderSound();
        setSelectedId(remindOf.id);
        if (isTauri) invoke('show_reminder').catch(() => {});
      }
    };

    updateStatuses();
    const timer = setInterval(updateStatuses, 15000);
    return () => clearInterval(timer);
  }, [
    settings.soonMinutes,
    settings.soundEnabled,
    settings.remindersEnabled,
    settings.autoDismissPast,
    dismissedMap,
  ]);

  // Fetch & parse real .ICS calendars
  const syncAllCalendars = async () => {
    setIsSyncing(true);
    const activeWithUrl = calendars.filter((c) => c.enabled && c.icsUrl.trim().length > 0);

    if (activeWithUrl.length === 0) {
      setTimeout(() => {
        setIsSyncing(false);
        setLastSyncAt(new Date());
      }, 450);
      return;
    }

    const fetchedEvents: CalendarEvent[] = [];
    const updatedCalendars = [...calendars];

    for (const cal of activeWithUrl) {
      try {
        let rawIcs: string;
        if (isTauri) {
          // In the app, Rust fetches the feed (no CORS problems)
          rawIcs = await invoke<string>('fetch_ics', { url: cal.icsUrl.trim() });
        } else {
          let fetchUrl = cal.icsUrl.trim();
          if (fetchUrl.startsWith('https://calendar.google.com')) {
            fetchUrl = fetchUrl.replace('https://calendar.google.com', '/ics-proxy');
          }
          const resp = await fetch(fetchUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          rawIcs = await resp.text();
        }
        const parsed = parseIcsFeed(rawIcs, cal, settings.loadDays, settings.pastDays ?? 0);
        fetchedEvents.push(...parsed);

        const idx = updatedCalendars.findIndex((c) => c.id === cal.id);
        if (idx !== -1) {
          updatedCalendars[idx] = {
            ...updatedCalendars[idx],
            lastSync: new Date().toLocaleTimeString(locale(), {
              hour: '2-digit',
              minute: '2-digit',
            }),
            error: undefined,
          };
        }
      } catch (err) {
        const idx = updatedCalendars.findIndex((c) => c.id === cal.id);
        if (idx !== -1) {
          updatedCalendars[idx] = {
            ...updatedCalendars[idx],
            error: err instanceof Error ? err.message : String(err || t('icsFetchFailed')),
          };
        }
      }
    }

    setCalendars(updatedCalendars);

    if (fetchedEvents.length > 0 || activeWithUrl.length > 0) {
      setEvents((prev) => {
        const stateMap = new Map(prev.map((e) => [e.id, e]));
        const localOnly = prev.filter((e) => {
          if (e.id.startsWith('demo-')) return false;
          const parentCal = updatedCalendars.find((c) => c.id === e.calendarId);
          return !parentCal || !parentCal.icsUrl.trim();
        });

        const mergedIcs = fetchedEvents.map((fe) => {
          const existing = stateMap.get(fe.id);
          const merged = existing
            ? { ...fe, dismissed: existing.dismissed, snoozedUntil: existing.snoozedUntil }
            : fe;
          return {
            ...merged,
            status: computeEventStatus(merged, settings.soonMinutes, new Date()),
          };
        });

        return [...localOnly, ...mergedIcs];
      });
    }

    setLastSyncAt(new Date());
    setIsSyncing(false);
  };

  // Automatic sync: right at startup and then every `refreshMinutes` minutes.
  // Via a ref, so the timer always calls the latest version (with the current calendars).
  const syncRef = useRef(syncAllCalendars);
  syncRef.current = syncAllCalendars;
  useEffect(() => {
    syncRef.current();
    const minutes = Math.max(1, Number(settings.refreshMinutes) || 15);
    const timer = setInterval(() => syncRef.current(), minutes * 60 * 1000);
    return () => clearInterval(timer);
  }, [settings.refreshMinutes]);

  // Visible sorted events
  const visibleEvents = useMemo(() => {
    const enabledCalIds = new Set(calendars.filter((c) => c.enabled).map((c) => c.id));
    return events
      .filter((e) => !e.dismissed && !dismissedMap[e.id] && enabledCalIds.has(e.calendarId))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [events, calendars, dismissedMap]);

  useEffect(() => {
    if (
      visibleEvents.length > 0 &&
      (!selectedId || !visibleEvents.some((e) => e.id === selectedId))
    ) {
      setSelectedId(visibleEvents[0].id);
    } else if (visibleEvents.length === 0) {
      setSelectedId(null);
    }
  }, [visibleEvents, selectedId]);

  const selectedEvent = useMemo(
    () => visibleEvents.find((e) => e.id === selectedId) || null,
    [visibleEvents, selectedId]
  );

  const activeAlertsCount = useMemo(
    () => visibleEvents.filter((e) => e.status === 'NOW' || e.status === 'SOON').length,
    [visibleEvents]
  );

  const groupedEvents = useMemo(() => {
    const groups: { label: string; items: CalendarEvent[] }[] = [];
    for (const ev of visibleEvents) {
      const label = formatDayGroup(ev.start);
      const last = groups[groups.length - 1];
      if (!last || last.label !== label) {
        groups.push({ label, items: [ev] });
      } else {
        last.items.push(ev);
      }
    }
    return groups;
  }, [visibleEvents, lang]);

  const handleDismiss = (id?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetId = id || selectedId;
    if (!targetId) return;
    const target = events.find((ev) => ev.id === targetId);
    setDismissedMap((m) => ({ ...m, [targetId]: target?.end ?? new Date().toISOString() }));
    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === targetId ? { ...ev, dismissed: true, status: 'DISMISSED' } : ev
      )
    );
  };

  // Load the Google connection status (used for moving/adding appointments) at startup
  const refreshGoogleStatus = async () => {
    if (!isTauri) return;
    try {
      const st = await invoke<{ configured: boolean; connected: boolean; client_id: string }>(
        'google_status'
      );
      setGoogleStatus(st);
      setGoogleClientId((cur) => cur || st.client_id);
    } catch (err) {
      console.error(err);
    }
  };
  useEffect(() => {
    refreshGoogleStatus();
  }, []);

  // "Start with Windows": the actual state lives in the Windows registry (via Rust)
  const [autostartOn, setAutostartOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    invoke<boolean>('autostart_get')
      .then(setAutostartOn)
      .catch(() => setAutostartOn(null));
  }, []);
  const toggleAutostart = async (enabled: boolean) => {
    try {
      setAutostartOn(await invoke<boolean>('autostart_set', { enabled }));
    } catch (err) {
      console.error('autostart_set failed:', err);
    }
  };

  const handleGoogleConnect = async () => {
    setGoogleBusy(true);
    setGoogleMessage(t('googleOpening'));
    try {
      await invoke('google_connect', {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      });
      setGoogleClientSecret('');
      setGoogleMessage(t('googleConnectedMsg'));
    } catch (err) {
      setGoogleMessage(`⚠️ ${err}`);
    } finally {
      setGoogleBusy(false);
      refreshGoogleStatus();
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      await invoke('google_disconnect');
      setGoogleMessage(t('googleDisconnectedMsg'));
    } catch (err) {
      setGoogleMessage(`⚠️ ${err}`);
    }
    refreshGoogleStatus();
  };

  // Date/time helpers for the Google API (local time with offset, e.g. 2026-11-19T10:15:00+01:00)
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const toLocalDate = (d: Date) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const toLocalRfc3339 = (d: Date) => {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return (
      `${toLocalDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
      `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
    );
  };

  const showMoveResult = (kind: 'done' | 'error', text: string) => {
    setMoveState({ kind, text });
    setTimeout(() => setMoveState({ kind: 'idle' }), kind === 'done' ? 4000 : 7000);
  };

  // Moves the selected appointment in Google Calendar to TOMORROW (today + 1 day),
  // keeping the original start time and duration.
  const handleMoveToTomorrow = async () => {
    const ev = selectedEvent;
    if (!ev || moveState.kind === 'busy') return;
    if (!isTauri) {
      showMoveResult('error', t('onlyInApp'));
      return;
    }
    if (!googleStatus.connected) {
      // The .ics link is read-only; changes need the Google connection (OAuth).
      setGoogleMessage(t('icsReadOnly'));
      setSettingsTab('options');
      triggerFlyoutOpen('settings');
      return;
    }
    if (!ev.googleEventId || !ev.googleCalendarId) {
      showMoveResult('error', t('notGoogleEvent'));
      return;
    }

    const oldStart = new Date(ev.start);
    const oldEnd = new Date(ev.end);
    const durationMs = Math.max(0, oldEnd.getTime() - oldStart.getTime());
    const today = new Date();

    let newStart: Date;
    let newEnd: Date;
    let startStr: string;
    let endStr: string;
    if (ev.allDay) {
      const days = Math.max(1, Math.round(durationMs / 86400000));
      newStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      newEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1 + days);
      startStr = toLocalDate(newStart);
      endStr = toLocalDate(newEnd);
    } else {
      newStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 1,
        oldStart.getHours(),
        oldStart.getMinutes(),
        oldStart.getSeconds()
      );
      newEnd = new Date(newStart.getTime() + durationMs);
      startStr = toLocalRfc3339(newStart);
      endStr = toLocalRfc3339(newEnd);
    }

    setMoveState({ kind: 'busy' });
    try {
      await invoke('google_move_event', {
        calendarId: ev.googleCalendarId,
        eventId: ev.googleEventId,
        start: startStr,
        end: endStr,
        allDay: ev.allDay,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      // Update the list right away; Google's .ics feed sometimes lags a few minutes behind
      setEvents((prev) =>
        prev.map((e) =>
          e.id === ev.id
            ? {
                ...e,
                start: newStart.toISOString(),
                end: newEnd.toISOString(),
                status: 'FUTURE',
                snoozedUntil: undefined,
              }
            : e
        )
      );
      showMoveResult(
        'done',
        ev.allDay
          ? t('movedAllDay')
          : t('movedAt', { t: `${pad2(newStart.getHours())}:${pad2(newStart.getMinutes())}` })
      );
    } catch (err) {
      showMoveResult('error', String(err));
    }
  };

  // Google calendar ID behind a calendar (from its .ics link), or null for local/demo calendars
  const googleCalendarIdOf = (c?: CalendarSource) =>
    c && c.icsUrl.trim() ? extractCalendarAddressFromIcsUrl(c.icsUrl) : null;

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddTitle.trim() || quickAddState.busy) return;

    const cal = calendars.find((c) => c.id === quickAddCalId) || calendars[0];
    const start = new Date(quickAddWhen);
    start.setSeconds(0, 0);
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    const title = quickAddTitle.trim();
    const googleCalId = googleCalendarIdOf(cal);

    let id = `local-${Date.now()}`;
    let url = 'https://calendar.google.com';
    let googleEventId: string | undefined;

    if (googleCalId) {
      // Real Google calendar: create the appointment in Google (in the background)
      if (!isTauri || !googleStatus.connected) {
        setQuickAddState({
          busy: false,
          error: t('connectFirstAdd'),
        });
        return;
      }
      setQuickAddState({ busy: true });
      try {
        googleEventId = await invoke<string>('google_create_event', {
          calendarId: googleCalId,
          title,
          start: toLocalRfc3339(start),
          end: toLocalRfc3339(end),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        // Same ID the .ics sync will produce later, so no duplicate row appears
        id = `${cal.id}:${googleEventId}`;
        url = `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(
          btoa(`${googleEventId} ${googleCalId}`).replace(/=+$/, '')
        )}&authuser=${encodeURIComponent(googleCalId)}`;
      } catch (err) {
        setQuickAddState({ busy: false, error: String(err) });
        return;
      }
    }

    const newEv: CalendarEvent = {
      id,
      calendarId: cal.id,
      calendarName: cal.name,
      color: cal.color,
      title,
      location: googleCalId ? undefined : t('localOnlyLocation'),
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      url,
      googleEventId,
      googleCalendarId: googleCalId ?? undefined,
      status: 'FUTURE',
    };
    newEv.status = computeEventStatus(newEv, settings.soonMinutes, new Date());

    setEvents((prev) => [newEv, ...prev.filter((p) => p.id !== newEv.id)]);
    setSelectedId(newEv.id);
    setQuickAddTitle('');
    setQuickAddState({ busy: false });
    setQuickAddOpen(false);
  };

  const handleAddCalendar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCalName.trim()) return;
    const created: CalendarSource = {
      id: `cal-${Date.now()}`,
      name: newCalName.trim(),
      icsUrl: newCalUrl.trim(),
      color: newCalColor,
      enabled: true,
    };
    setCalendars((prev) => [...prev, created]);
    setNewCalName('');
    setNewCalUrl('');
    if (created.icsUrl) {
      setTimeout(() => syncAllCalendars(), 100);
    }
  };

  const renderStatusBadge = (status: EventStatus) => {
    switch (status) {
      case 'NOW':
        return (
          <span className="text-xs px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 font-semibold animate-pulse">
            {t('badgeNow')}
          </span>
        );
      case 'SOON':
        return (
          <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
            {t('badgeSoon')}
          </span>
        );
      case 'SNOOZED':
        return (
          <span className="text-xs px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
            {t('badgeSnoozed')}
          </span>
        );
      case 'PAST':
        return (
          <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
            {t('badgePast')}
          </span>
        );
      default:
        return <span className="text-xs text-slate-400">{t('badgePlanned')}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start">
      {/* =====================================================================
          MODE 1: LEFT-CLICK -> COMPACT TRAY FLYOUT (AGENDA ONLY)
         ===================================================================== */}
      {isTrayVisible && windowMode === 'agenda' && (
        <div
          key={`agenda-${animKey}`}
          className={`w-full bg-slate-900 border-b border-slate-800 overflow-hidden flex flex-col ${
            isClosingAnim ? 'tray-flyout-exit' : 'tray-flyout-enter'
          }`}
        >
          {/* Header */}
          <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"
                title={t('syncActiveTitle')}
              />
              <div>
                <div className="text-sm font-semibold flex items-center gap-2">
                  <span>{t('myAgenda')}</span>
                  {activeAlertsCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 font-medium">
                      {t('activeCount', { n: activeAlertsCount })}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {now.toLocaleDateString(locale(), {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}{' '}
                  • Sync:{' '}
                  {lastSyncAt
                    ? lastSyncAt.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
                    : t('syncJustNow')}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={syncAllCalendars}
                title={t('syncNowTitle')}
                className={`p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 transition ${
                  isSyncing ? 'animate-spin text-blue-400' : ''
                }`}
              >
                🔄
              </button>
              <button
                onClick={() => {
                  if (!quickAddOpen) {
                    setQuickAddWhen(tomorrowNow());
                    setQuickAddState({ busy: false });
                    const current = calendars.find((c) => c.id === quickAddCalId);
                    const firstGoogle = calendars.find((c) => c.enabled && googleCalendarIdOf(c));
                    if (firstGoogle && !googleCalendarIdOf(current)) setQuickAddCalId(firstGoogle.id);
                  }
                  setQuickAddOpen((v) => !v);
                }}
                title={t('quickAddTitle')}
                className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-xs font-semibold transition"
              >
                {t('newBtn')}
              </button>
            </div>
          </div>

          {/* Collapsible Quick-Add Bar */}
          {quickAddOpen && (
            <form
              onSubmit={handleQuickAdd}
              className="p-3.5 bg-blue-950/30 border-b border-blue-500/20 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-400">
                  {t('quickAddHeader')}
                </span>
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(false)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  ✕
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quickAddTitle}
                  onChange={(e) => setQuickAddTitle(e.target.value)}
                  placeholder={t('quickAddPlaceholder')}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <DateTimePicker value={quickAddWhen} onChange={setQuickAddWhen} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <select
                  value={quickAddCalId}
                  onChange={(e) => setQuickAddCalId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300"
                >
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={quickAddState.busy}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition"
                >
                  {quickAddState.busy
                    ? t('adding')
                    : googleCalendarIdOf(calendars.find((c) => c.id === quickAddCalId))
                      ? t('addToGoogle')
                      : t('addLocal')}
                </button>
              </div>
              {quickAddState.error && (
                <p className="text-[11px] text-red-300">⚠️ {quickAddState.error}</p>
              )}
            </form>
          )}

          {/* Agenda Items List */}
          <div className="divide-y divide-slate-800/80 max-h-[430px] overflow-y-auto">
            {groupedEvents.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <div className="text-2xl">🎉</div>
                <div className="text-sm font-medium text-slate-300">
                  {t('noEvents')}
                </div>
                <p className="text-xs text-slate-400">
                  {t('noEventsHint')}
                </p>
              </div>
            ) : (
              groupedEvents.map((group) => (
                <div key={group.label}>
                  <div className="px-4 py-1.5 bg-slate-950/90 text-xs font-semibold text-slate-400 tracking-wide sticky top-0 z-10 backdrop-blur-sm">
                    {group.label}
                  </div>
                  <div className="divide-y divide-slate-800/50">
                    {group.items.map((ev) => {
                      const isSelected = ev.id === selectedId;
                      const rowStyle = isSelected
                        ? 'bg-blue-600/15 border-l-4 border-l-blue-500'
                        : ev.status === 'NOW'
                        ? 'bg-rose-500/10 hover:bg-slate-800/60'
                        : ev.status === 'SOON'
                        ? 'bg-amber-500/10 hover:bg-slate-800/60'
                        : 'hover:bg-slate-800/50';

                      return (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedId(ev.id)}
                          onDoubleClick={() =>
                            ev.url && openExternal(ev.url)
                          }
                          className={`group px-4 py-3 cursor-pointer transition flex items-start justify-between gap-3 ${rowStyle}`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                              style={{ backgroundColor: ev.color }}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-100 truncate">
                                {ev.title}
                              </div>
                              <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                                <span>🕒 {formatTimeRange(ev.start, ev.end, ev.allDay)}</span>
                                {ev.location && (
                                  <span className="truncate">• 📍 {ev.location}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Right side: normally the status badge, on hover the red Dismiss button in the same spot */}
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <div className="group-hover:hidden">
                              {renderStatusBadge(ev.status)}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleDismiss(ev.id, e)}
                              className="hidden group-hover:inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-semibold shadow-sm transition"
                              title={t('dismissTitle')}
                            >
                              {t('dismissBtn')}
                            </button>
                            <span className="text-xs text-slate-400">
                              {formatRelative(ev, now)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Bottom bar: To tomorrow & Close */}
          <div className="p-3 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-2">
            <button
              onClick={handleMoveToTomorrow}
              disabled={!selectedEvent || moveState.kind === 'busy'}
              title={
                moveState.kind === 'error'
                  ? moveState.text
                  : t('moveTitle')
              }
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition disabled:opacity-60 max-w-[60%] truncate ${
                moveState.kind === 'done'
                  ? 'bg-emerald-600/20 border-emerald-600 text-emerald-200'
                  : moveState.kind === 'error'
                    ? 'bg-red-600/20 border-red-700 text-red-200'
                    : 'bg-slate-900 hover:bg-blue-500/20 border-slate-700'
              }`}
            >
              {moveState.kind === 'busy' && t('moving')}
              {moveState.kind === 'done' && `✅ ${moveState.text}`}
              {moveState.kind === 'error' && `⚠️ ${moveState.text}`}
              {moveState.kind === 'idle' &&
                (selectedEvent && !selectedEvent.allDay
                  ? `${t('toTomorrow')} ${new Date(selectedEvent.start).toLocaleTimeString(locale(), {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : t('toTomorrow'))}
            </button>

            {/* Hide the window to the tray (same as the window's X; GMeer keeps running) */}
            <button
              onClick={() => (isTauri ? invoke('hide_window') : undefined)}
              title={t('closeTitle')}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 border border-red-500 text-white text-xs font-semibold transition shadow-sm shadow-red-900/40"
            >
              {t('closeBtn')}
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODE 2: RIGHT-CLICK -> SETTINGS (.ICS CALENDARS & OPTIONS)
         ===================================================================== */}
      {isTrayVisible && windowMode === 'settings' && (
        <div
          key={`settings-${animKey}`}
          className={`w-full p-2 space-y-3 ${
            isClosingAnim ? 'tray-flyout-exit' : 'tray-flyout-enter'
          }`}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Settings header: row 1 the title, row 2 Quit + the 2 tabs */}
            <div className="px-3 py-3 bg-slate-950 border-b border-slate-800 space-y-2">
              <div className="text-sm font-bold text-slate-100 whitespace-nowrap">{t('settingsTitle')}</div>
              <div className="flex items-center justify-between gap-2">
                {/* Also shown in the browser preview (does nothing there), so the layout matches */}
                <button
                  onClick={() => (isTauri ? invoke('quit_app') : undefined)}
                  title={t('quitTitle')}
                  className="px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap text-slate-400 border border-slate-800 hover:text-red-300 hover:border-red-800 transition"
                >
                  {t('quitBtn')}
                </button>
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => setSettingsTab('calendars')}
                    className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                      settingsTab === 'calendars'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t('tabCalendars', { n: calendars.filter((c) => c.enabled).length })}
                  </button>
                  <button
                    onClick={() => setSettingsTab('options')}
                    className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                      settingsTab === 'options'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t('tabOptions')}
                  </button>
                </div>
              </div>
            </div>

            {/* SUBTAB 1: .ICS CALENDARS */}
            {settingsTab === 'calendars' && (
              <div className="p-4 space-y-4 max-h-[430px] overflow-y-auto">
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t('yourCalendars')}
                  </div>
                  {calendars.map((cal) => (
                    <div
                      key={cal.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cal.enabled}
                            onChange={(e) =>
                              setCalendars((prev) =>
                                prev.map((c) =>
                                  c.id === cal.id ? { ...c, enabled: e.target.checked } : c
                                )
                              )
                            }
                            className="rounded"
                          />
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: cal.color }}
                          />
                          <span className="text-xs font-semibold text-slate-200">{cal.name}</span>
                        </label>
                        <button
                          onClick={() =>
                            setCalendars((prev) => prev.filter((c) => c.id !== cal.id))
                          }
                          className="text-xs text-slate-500 hover:text-rose-400"
                          title={t('deleteCalendar')}
                        >
                          🗑️
                        </button>
                      </div>
                      <input
                        type="url"
                        value={cal.icsUrl}
                        onChange={(e) =>
                          setCalendars((prev) =>
                            prev.map((c) =>
                              c.id === cal.id ? { ...c, icsUrl: e.target.value } : c
                            )
                          )
                        }
                        placeholder={t('icsPlaceholder')}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                      />
                      {cal.error && (
                        <div className="text-xs text-rose-400">{t('syncError', { e: cal.error })}</div>
                      )}
                      {cal.lastSync && !cal.error && (
                        <div className="text-xs text-emerald-400">
                          {t('lastSynced', { t: cal.lastSync })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add another calendar */}
                <form
                  onSubmit={handleAddCalendar}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5"
                >
                  <div className="text-xs font-semibold text-slate-300">
                    {t('addCalendarHeader')}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCalName}
                      onChange={(e) => setNewCalName(e.target.value)}
                      placeholder={t('calNamePlaceholder')}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="color"
                      value={newCalColor}
                      onChange={(e) => setNewCalColor(e.target.value)}
                      className="w-8 h-7 rounded bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={newCalUrl}
                      onChange={(e) => setNewCalUrl(e.target.value)}
                      placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
                    >
                      {t('addBtn')}
                    </button>
                  </div>
                </form>

                <button
                  onClick={syncAllCalendars}
                  className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                >
                  {t('saveSync')}
                </button>
              </div>
            )}

            {/* SUBTAB 2: OPTIONS & SOUND */}
            {settingsTab === 'options' && (
              <div className="p-4 space-y-3 text-xs">
                {/* Google Calendar connection (needed for 'To tomorrow' and quick add) */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">{t('googleSection')}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        googleStatus.connected
                          ? 'bg-emerald-600/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {googleStatus.connected ? t('connected') : t('notConnected')}
                    </span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">{t('googleHelp')}</p>
                  {!googleStatus.connected ? (
                    <>
                      <input
                        value={googleClientId}
                        onChange={(e) => setGoogleClientId(e.target.value)}
                        placeholder="Client ID (….apps.googleusercontent.com)"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200"
                      />
                      <input
                        type="password"
                        value={googleClientSecret}
                        onChange={(e) => setGoogleClientSecret(e.target.value)}
                        placeholder="Client secret"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={handleGoogleConnect}
                        disabled={googleBusy || !googleClientId.trim() || !googleClientSecret.trim()}
                        className="w-full px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium transition"
                      >
                        {googleBusy ? t('waitingGoogle') : t('connectGoogle')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleGoogleDisconnect}
                      className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    >
                      {t('disconnect')}
                    </button>
                  )}
                  {googleMessage && <p className="text-slate-300">{googleMessage}</p>}
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>{t('optLanguage')}</span>
                  <select
                    value={langSetting}
                    onChange={(e) =>
                      setSettings({ ...settings, language: e.target.value as LangSetting })
                    }
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1"
                  >
                    <option value="auto">{t('langAuto')}</option>
                    <option value="nl">Nederlands</option>
                    <option value="en">English</option>
                  </select>
                </div>

                {isTauri && (
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                    <span>{t('optHideOnBlur')}</span>
                    <input
                      type="checkbox"
                      checked={hideOnBlur}
                      onChange={(e) => setSettings({ ...settings, hideOnBlur: e.target.checked })}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>{t('optSoon')}</span>
                  <select
                    value={settings.soonMinutes}
                    onChange={(e) =>
                      setSettings({ ...settings, soonMinutes: Number(e.target.value) })
                    }
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1"
                  >
                    <option value={5}>{t('minutes', { n: 5 })}</option>
                    <option value={10}>{t('minutes', { n: 10 })}</option>
                    <option value={15}>{t('minutes', { n: 15 })}</option>
                    <option value={30}>{t('minutes', { n: 30 })}</option>
                    <option value={60}>{t('hour1')}</option>
                  </select>
                </div>

                {isTauri && (
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                    <span>{t('optAutostart')}</span>
                    <input
                      type="checkbox"
                      checked={autostartOn === true}
                      disabled={autostartOn === null}
                      onChange={(e) => toggleAutostart(e.target.checked)}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>{t('optRefresh')}</span>
                  <select
                    value={settings.refreshMinutes}
                    onChange={(e) =>
                      setSettings({ ...settings, refreshMinutes: Number(e.target.value) })
                    }
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1"
                  >
                    <option value={5}>{t('everyMin', { n: 5 })}</option>
                    <option value={10}>{t('everyMin', { n: 10 })}</option>
                    <option value={30}>{t('everyMin', { n: 30 })}</option>
                  </select>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>{t('optReminders')}</span>
                  <input
                    type="checkbox"
                    checked={settings.remindersEnabled ?? false}
                    onChange={(e) =>
                      setSettings({ ...settings, remindersEnabled: e.target.checked })
                    }
                  />
                </div>

                <div
                  className={`flex items-center justify-between py-1.5 pl-4 border-b border-slate-800 ${
                    settings.remindersEnabled ? '' : 'opacity-40'
                  }`}
                >
                  <span>↳ {t('optSound')}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={playReminderSound}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                    >
                      {t('testSound')}
                    </button>
                    <input
                      type="checkbox"
                      checked={settings.soundEnabled}
                      disabled={!settings.remindersEnabled}
                      onChange={(e) =>
                        setSettings({ ...settings, soundEnabled: e.target.checked })
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>{t('optAutoDismiss')}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoDismissPast}
                    onChange={(e) =>
                      setSettings({ ...settings, autoDismissPast: e.target.checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>{t('optLoadDays')}</span>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={settings.loadDays}
                    onChange={(e) =>
                      setSettings({ ...settings, loadDays: Number(e.target.value) })
                    }
                    className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-right"
                  />
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <span>{t('optPastDays')}</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={settings.pastDays ?? 0}
                    onChange={(e) =>
                      setSettings({ ...settings, pastDays: Number(e.target.value) })
                    }
                    className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-right"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Help box, only shown on the .ICS Calendars tab */}
          {settingsTab === 'calendars' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400">
                {t('howToTitle')}
              </h4>
              <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>
                  {t('how1a')}
                  <strong>{t('how1b')}</strong>.
                </li>
                <li>
                  {t('how2a')}
                  <em>{t('how2b')}</em>
                  {t('how2c')}
                </li>
                <li>
                  {t('how3a')}
                  <strong>{t('how3b')}</strong>.
                </li>
                <li>
                  {t('how4a')}
                  <strong>{t('how4b')}</strong>
                  {t('how4c')}
                  <code className="text-blue-400">basic.ics</code>
                  {t('how4d')}
                </li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
