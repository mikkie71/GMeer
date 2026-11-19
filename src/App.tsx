import React, { useState, useEffect, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import DateTimePicker from './DateTimePicker';

// Draait de pagina binnen de Tauri-app (en niet in een gewone browser-preview)?
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Opent een link in de standaardbrowser (in Tauri via Rust, anders gewoon window.open)
const openExternal = (url: string) => {
  if (isTauri) {
    invoke('open_url', { url }).catch((err) => console.error('open_url mislukt:', err));
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
  DEFAULT_CALENDARS,
  DEFAULT_SETTINGS,
  createDemoEvents,
  playReminderSound,
  speakReminder,
} from './soundAndDemo';

const STORAGE_KEYS = {
  CALENDARS: 'gmeer_calendars_v1',
  EVENTS: 'gmeer_events_v1',
  SETTINGS: 'gmeer_settings_v1',
};

function formatTimeRange(startIso: string, endIso: string, allDay: boolean): string {
  if (allDay) return 'Hele dag';
  const s = new Date(startIso);
  const e = new Date(endIso);
  const fmt = (d: Date) =>
    d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(s)} - ${fmt(e)}`;
}

function formatDayGroup(startIso: string): string {
  const d = new Date(startIso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  const dateLabel = d.toLocaleDateString('nl-NL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  if (diffDays < 0) return `Eerder — ${dateLabel}`;
  if (diffDays === 0) return `Vandaag — ${dateLabel}`;
  if (diffDays === 1) return `Morgen — ${dateLabel}`;
  if (diffDays < 7) return `Over ${diffDays} dagen — ${dateLabel}`;
  return dateLabel;
}

function formatRelative(ev: CalendarEvent, now: Date): string {
  if (ev.status === 'SNOOZED' && ev.snoozedUntil) {
    const mins = Math.max(
      1,
      Math.round((new Date(ev.snoozedUntil).getTime() - now.getTime()) / 60000)
    );
    return `Gesnoozed (${mins}m)`;
  }

  const start = new Date(ev.start);
  const end = new Date(ev.end);

  if (now >= start && now < end) {
    const leftMins = Math.max(1, Math.round((end.getTime() - now.getTime()) / 60000));
    if (leftMins < 60) return `Nog ${leftMins} min`;
    const hrs = Math.floor(leftMins / 60);
    return `Nog ${hrs}u ${leftMins % 60}m`;
  }

  const diffMins = Math.round((start.getTime() - now.getTime()) / 60000);
  if (diffMins < 0) return 'Afgelopen';
  if (diffMins === 0) return 'Begint nu!';
  if (diffMins < 60) return `Over ${diffMins} min`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `Over ${diffHrs} uur`;
  const diffDays = Math.round(diffHrs / 24);
  return diffDays === 1 ? 'Morgen' : `Over ${diffDays} dagen`;
}

export default function App() {
  // 'agenda' = Linkermuisklik op Tray Icon (alleen de compacte agenda flyout)
  // 'settings' = Rechtermuisklik op Tray Icon (venster met .ICS Kalenders & Opties)
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
    return saved ? JSON.parse(saved) : DEFAULT_CALENDARS;
  });

  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.EVENTS);
    return saved ? JSON.parse(saved) : createDemoEvents();
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  // Standaard: morgen, op de huidige tijd (seconden op 0)
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
  // 'Naar morgen'-knop: idle | bezig | gelukt | fout (melding wordt een paar seconden getoond)
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
  const [lastSyncText, setLastSyncText] = useState('Zojuist');
  const [now, setNow] = useState(new Date());

  // New calendar form state
  const [newCalName, setNewCalName] = useState('');
  const [newCalUrl, setNewCalUrl] = useState('');
  const [newCalColor, setNewCalColor] = useState('#8b5cf6');

  // Check URL query param (?mode=settings of ?mode=agenda) zodat het lichte tray-icoon
  // met linkerklik direct Agenda opent en met rechterklik direct Instellingen opent!
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

  // Tauri: het tray-icoon stuurt 'tray-mode' (linkerklik = agenda, rechterklik = settings)
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }, [settings]);

  // Minute ticker to update NOW / SOON statuses
  useEffect(() => {
    const updateStatuses = () => {
      const current = new Date();
      setNow(current);
      setEvents((prev) =>
        prev.map((ev) => {
          const nextStatus = computeEventStatus(ev, settings.soonMinutes, current);
          if (nextStatus !== ev.status) {
            if (nextStatus === 'SOON' || nextStatus === 'NOW') {
              if (settings.soundEnabled) playReminderSound();
              if (settings.speechEnabled) {
                speakReminder(
                  ev.title,
                  nextStatus === 'NOW'
                    ? 'begint nu!'
                    : `begint over ${settings.soonMinutes} minuten`
                );
              }
            }
            if (nextStatus === 'PAST' && settings.autoDismissPast) {
              return { ...ev, status: 'DISMISSED', dismissed: true };
            }
            return { ...ev, status: nextStatus };
          }
          return ev;
        })
      );
    };

    updateStatuses();
    const timer = setInterval(updateStatuses, 15000);
    return () => clearInterval(timer);
  }, [
    settings.soonMinutes,
    settings.soundEnabled,
    settings.speechEnabled,
    settings.autoDismissPast,
  ]);

  // Fetch & parse real .ICS calendars
  const syncAllCalendars = async () => {
    setIsSyncing(true);
    const activeWithUrl = calendars.filter((c) => c.enabled && c.icsUrl.trim().length > 0);

    if (activeWithUrl.length === 0) {
      setTimeout(() => {
        setIsSyncing(false);
        setLastSyncText(
          new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
        );
      }, 450);
      return;
    }

    const fetchedEvents: CalendarEvent[] = [];
    const updatedCalendars = [...calendars];

    for (const cal of activeWithUrl) {
      try {
        let rawIcs: string;
        if (isTauri) {
          // In de app haalt Rust de feed op (geen CORS-problemen)
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
            lastSync: new Date().toLocaleTimeString('nl-NL', {
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
            error: err instanceof Error ? err.message : 'Kon .ics niet ophalen',
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

    setLastSyncText(
      new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    );
    setIsSyncing(false);
  };

  // Automatisch synchroniseren: direct bij het opstarten en daarna elke `refreshMinutes` minuten.
  // Via een ref, zodat de timer altijd de nieuwste versie (met actuele kalenders) aanroept.
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
      .filter((e) => !e.dismissed && enabledCalIds.has(e.calendarId))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [events, calendars]);

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
  }, [visibleEvents]);

  const handleDismiss = (id?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetId = id || selectedId;
    if (!targetId) return;
    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === targetId ? { ...ev, dismissed: true, status: 'DISMISSED' } : ev
      )
    );
  };

  // Google-koppeling (voor het verplaatsen van afspraken) ophalen bij het opstarten
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

  // "Starten met Windows": de echte stand staat in het Windows-register (via Rust)
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
      console.error('autostart_set mislukt:', err);
    }
  };

  const handleGoogleConnect = async () => {
    setGoogleBusy(true);
    setGoogleMessage('Browser geopend: geef GMeer toestemming in Google…');
    try {
      await invoke('google_connect', {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      });
      setGoogleClientSecret('');
      setGoogleMessage('✅ Gekoppeld met Google Agenda');
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
      setGoogleMessage('Ontkoppeld');
    } catch (err) {
      setGoogleMessage(`⚠️ ${err}`);
    }
    refreshGoogleStatus();
  };

  // Datum/tijd helpers voor de Google API (lokale tijd met offset, bv. 2026-11-19T10:15:00+01:00)
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

  // Verplaatst de geselecteerde afspraak in Google Agenda naar MORGEN (vandaag + 1 dag),
  // met behoud van de oorspronkelijke begintijd en duur.
  const handleMoveToTomorrow = async () => {
    const ev = selectedEvent;
    if (!ev || moveState.kind === 'busy') return;
    if (!isTauri) {
      showMoveResult('error', 'Alleen beschikbaar in de app');
      return;
    }
    if (!googleStatus.connected) {
      // De .ics-link kan alleen lezen; voor wijzigen is de Google-koppeling (OAuth) nodig.
      setGoogleMessage(
        'De .ics-link kan alleen lezen. Om afspraken te verplaatsen moet GMeer eenmalig toestemming krijgen van Google.'
      );
      setSettingsTab('options');
      triggerFlyoutOpen('settings');
      return;
    }
    if (!ev.googleEventId || !ev.googleCalendarId) {
      showMoveResult('error', 'Geen Google-afspraak');
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
      // Direct in de lijst bijwerken; de .ics-feed van Google loopt soms enkele minuten achter
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
          ? 'Verplaatst naar morgen (hele dag)'
          : `Verplaatst naar morgen ${pad2(newStart.getHours())}:${pad2(newStart.getMinutes())}`
      );
    } catch (err) {
      showMoveResult('error', String(err));
    }
  };

  // Google-agenda achter een kalender (uit de .ics-link), of null voor lokale/demokalenders
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
      // Echte Google-agenda: afspraak in Google aanmaken (op de achtergrond)
      if (!isTauri || !googleStatus.connected) {
        setQuickAddState({
          busy: false,
          error: 'Koppel eerst Google (Opties) om in deze agenda toe te voegen',
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
        // Zelfde ID als de .ics-sync later maakt, zodat er geen dubbele regel ontstaat
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
      location: googleCalId ? undefined : 'Alleen lokaal in GMeer',
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
            Nu bezig
          </span>
        );
      case 'SOON':
        return (
          <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
            Binnenkort
          </span>
        );
      case 'SNOOZED':
        return (
          <span className="text-xs px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
            💤 Gesnoozed
          </span>
        );
      case 'PAST':
        return (
          <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
            Geweest
          </span>
        );
      default:
        return <span className="text-xs text-slate-400">Gepland</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start">
      {/* =====================================================================
          MODUS 1: LINKERMUISKLIK -> COMPACTE TRAY FLYOUT (ALLEEN AGENDA)
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
                title="Offline Cache & Sync Actief"
              />
              <div>
                <div className="text-sm font-semibold flex items-center gap-2">
                  <span>Mijn Agenda</span>
                  {activeAlertsCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 font-medium">
                      {activeAlertsCount} actief
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {now.toLocaleDateString('nl-NL', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}{' '}
                  • Sync: {lastSyncText}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={syncAllCalendars}
                title="Nu synchroniseren"
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
                title="Snel afspraak toevoegen"
                className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-xs font-semibold transition"
              >
                ＋ Nieuw
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
                  ⚡ Snel Afspraak Toevoegen
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
                  placeholder="Bijv. Tandarts controle..."
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
                    ? '⏳ Toevoegen…'
                    : googleCalendarIdOf(calendars.find((c) => c.id === quickAddCalId))
                      ? 'Toevoegen aan Google'
                      : 'Toevoegen (lokaal)'}
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
                  Geen openstaande afspraken!
                </div>
                <p className="text-xs text-slate-400">
                  Klik met de rechtermuisknop op het tray-icoon om je .ICS-kalenders te beheren.
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

                          {/* Rechts: Normaal de status badge ("Geweest" / "Nu bezig"), maar bij hover direct de rode Dismiss knop op diezelfde plek! */}
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <div className="group-hover:hidden">
                              {renderStatusBadge(ev.status)}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleDismiss(ev.id, e)}
                              className="hidden group-hover:inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-semibold shadow-sm transition"
                              title="Afspraak direct afvinken (Dismiss)"
                            >
                              ✓ Dismiss
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

          {/* Bottom Bar: Naar morgen & Open */}
          <div className="p-3 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-2">
            <button
              onClick={handleMoveToTomorrow}
              disabled={!selectedEvent || moveState.kind === 'busy'}
              title={
                moveState.kind === 'error'
                  ? moveState.text
                  : 'Verplaats deze afspraak in Google Agenda naar morgen, zelfde tijd'
              }
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition disabled:opacity-60 max-w-[60%] truncate ${
                moveState.kind === 'done'
                  ? 'bg-emerald-600/20 border-emerald-600 text-emerald-200'
                  : moveState.kind === 'error'
                    ? 'bg-red-600/20 border-red-700 text-red-200'
                    : 'bg-slate-900 hover:bg-blue-500/20 border-slate-700'
              }`}
            >
              {moveState.kind === 'busy' && '⏳ Verplaatsen…'}
              {moveState.kind === 'done' && `✅ ${moveState.text}`}
              {moveState.kind === 'error' && `⚠️ ${moveState.text}`}
              {moveState.kind === 'idle' &&
                (selectedEvent && !selectedEvent.allDay
                  ? `➡️ Naar morgen ${new Date(selectedEvent.start).toLocaleTimeString('nl-NL', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : '➡️ Naar morgen')}
            </button>

            {/* Venster naar de tray (zelfde als het kruisje; GMeer blijft draaien) */}
            <button
              onClick={() => (isTauri ? invoke('hide_window') : undefined)}
              title="Venster sluiten (GMeer blijft actief in het systeemvak)"
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 border border-red-500 text-white text-xs font-semibold transition shadow-sm shadow-red-900/40"
            >
              ✕ Sluiten
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODUS 2: RECHTERMUISKLIK -> INSTELLINGEN (.ICS KALENDERS & OPTIES)
         ===================================================================== */}
      {isTrayVisible && windowMode === 'settings' && (
        <div
          key={`settings-${animKey}`}
          className={`w-full p-2 space-y-3 ${
            isClosingAnim ? 'tray-flyout-exit' : 'tray-flyout-enter'
          }`}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Settings Header + 2 Tabbladen */}
            <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-100">⚙️ GMeer Instellingen</span>
                {isTauri && (
                  <button
                    onClick={() => invoke('quit_app')}
                    title="GMeer volledig afsluiten"
                    className="ml-1 px-2 py-0.5 rounded-lg text-[11px] font-medium text-slate-400 border border-slate-800 hover:text-red-300 hover:border-red-800 transition"
                  >
                    Afsluiten
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setSettingsTab('calendars')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    settingsTab === 'calendars'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🔗 .ICS Kalenders ({calendars.filter((c) => c.enabled).length})
                </button>
                <button
                  onClick={() => setSettingsTab('options')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    settingsTab === 'options'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🔊 Opties & Geluid
                </button>
              </div>
            </div>

            {/* SUBTAB 1: .ICS KALENDERS */}
            {settingsTab === 'calendars' && (
              <div className="p-4 space-y-4 max-h-[430px] overflow-y-auto">
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Jouw Kalenders & Privé .ICS-links
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
                          title="Verwijder kalender"
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
                        placeholder="Plak hier je Google Agenda 'Geheim adres in iCal-indeling' (.ics)..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                      />
                      {cal.error && (
                        <div className="text-xs text-rose-400">⚠️ Fout bij sync: {cal.error}</div>
                      )}
                      {cal.lastSync && !cal.error && (
                        <div className="text-xs text-emerald-400">
                          ✓ Laatst gesynchroniseerd om {cal.lastSync}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Extra kalender toevoegen */}
                <form
                  onSubmit={handleAddCalendar}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5"
                >
                  <div className="text-xs font-semibold text-slate-300">
                    ＋ Extra Kalender Toevoegen
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCalName}
                      onChange={(e) => setNewCalName(e.target.value)}
                      placeholder="Naam (bijv. Werk / Privé)"
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
                      Voeg toe
                    </button>
                  </div>
                </form>

                <button
                  onClick={syncAllCalendars}
                  className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                >
                  🔄 Opslaan & .ICS-feeds synchroniseren
                </button>
              </div>
            )}

            {/* SUBTAB 2: OPTIES & GELUID */}
            {settingsTab === 'options' && (
              <div className="p-4 space-y-3 text-xs">
                {/* Google Agenda koppeling (nodig voor 'Naar morgen') */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">Google Agenda koppeling</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        googleStatus.connected
                          ? 'bg-emerald-600/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {googleStatus.connected ? 'Gekoppeld' : 'Niet gekoppeld'}
                    </span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Nodig om afspraken met <b>Naar morgen</b> in Google Agenda te verplaatsen.
                    Eenmalig: maak in Google Cloud Console een OAuth-client van het type
                    &quot;Desktop-app&quot; (met de Google Calendar API aan) en plak hier de
                    gegevens.
                  </p>
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
                        {googleBusy ? 'Wachten op Google…' : '🔐 Koppelen met Google'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleGoogleDisconnect}
                      className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    >
                      Ontkoppelen
                    </button>
                  )}
                  {googleMessage && <p className="text-slate-300">{googleMessage}</p>}
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>Melding vóór aanvang ("Binnenkort")</span>
                  <select
                    value={settings.soonMinutes}
                    onChange={(e) =>
                      setSettings({ ...settings, soonMinutes: Number(e.target.value) })
                    }
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1"
                  >
                    <option value={5}>5 minuten</option>
                    <option value={10}>10 minuten</option>
                    <option value={15}>15 minuten</option>
                    <option value={30}>30 minuten</option>
                    <option value={60}>1 uur</option>
                  </select>
                </div>

                {isTauri && (
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                    <span>Automatisch starten met Windows</span>
                    <input
                      type="checkbox"
                      checked={autostartOn === true}
                      disabled={autostartOn === null}
                      onChange={(e) => toggleAutostart(e.target.checked)}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>Ververs-interval voor .ICS feeds</span>
                  <select
                    value={settings.refreshMinutes}
                    onChange={(e) =>
                      setSettings({ ...settings, refreshMinutes: Number(e.target.value) })
                    }
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1"
                  >
                    <option value={5}>Elke 5 min</option>
                    <option value={10}>Elke 10 min</option>
                    <option value={30}>Elke 30 min</option>
                  </select>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>Geluid afspelen bij herinnering</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={playReminderSound}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                    >
                      🔊 Test Geluid
                    </button>
                    <input
                      type="checkbox"
                      checked={settings.soundEnabled}
                      onChange={(e) =>
                        setSettings({ ...settings, soundEnabled: e.target.checked })
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>Spraakherinnering (Nederlandse stem)</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        speakReminder('Sprint Review', 'begint over 15 minuten')
                      }
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                    >
                      🗣️ Test Stem
                    </button>
                    <input
                      type="checkbox"
                      checked={settings.speechEnabled}
                      onChange={(e) =>
                        setSettings({ ...settings, speechEnabled: e.target.checked })
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>Verlopen afspraken automatisch afvinken</span>
                  <input
                    type="checkbox"
                    checked={settings.autoDismissPast}
                    onChange={(e) =>
                      setSettings({ ...settings, autoDismissPast: e.target.checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-800">
                  <span>Aantal dagen vooruit laden (Toekomst)</span>
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
                  <span>Aantal dagen terug kijken (Verleden, 0 = alleen vanaf vandaag)</span>
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

          {/* Uitleg-vak ALLEEN zichtbaar onder het tabblad .ICS Kalenders */}
          {settingsTab === 'calendars' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400">
                Hoe vind je jouw Google Agenda .ICS-link?
              </h4>
              <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>
                  Open Google Agenda in je browser en klik op het tandwieltje ⚙️ →{' '}
                  <strong>Instellingen</strong>.
                </li>
                <li>
                  Klik links onder <em>Instellingen voor mijn agenda's</em> op jouw agenda.
                </li>
                <li>
                  Scroll naar beneden naar <strong>Agenda integreren</strong>.
                </li>
                <li>
                  Kopieer het <strong>Geheim adres in iCal-indeling</strong> (eindigt op{' '}
                  <code className="text-blue-400">basic.ics</code>) en plak hem hierboven!
                </li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
