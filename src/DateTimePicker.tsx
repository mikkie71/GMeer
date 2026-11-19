import { useEffect, useMemo, useRef, useState } from 'react';
import { t, locale, getLang } from './i18n';

/**
 * Compacte datum + tijd kiezer: één knop (bv. "📅 do 19 nov · 14:32") die een klein
 * uitklapscherm opent met snelkeuzes, een maandkalender en een tijdveld.
 */

interface Props {
  value: Date;
  onChange: (d: Date) => void;
}

const WEEKDAYS = {
  nl: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatShort(d: Date): string {
  const day = d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day.replace(/\./g, '')} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function DateTimePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(
    () => new Date(value.getFullYear(), value.getMonth(), 1)
  );
  const rootRef = useRef<HTMLDivElement>(null);

  // Bij openen: kalender op de maand van de gekozen datum zetten
  useEffect(() => {
    if (open) setViewMonth(new Date(value.getFullYear(), value.getMonth(), 1));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Klik buiten het scherm of Escape sluit het
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const today = new Date();

  // 6 weken x 7 dagen, beginnend op maandag
  const days = useMemo(() => {
    const first = new Date(viewMonth);
    const offset = (first.getDay() + 6) % 7; // maandag = 0
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [viewMonth]);

  const setDate = (d: Date) => {
    const next = new Date(value);
    next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    onChange(next);
  };

  const setDaysFromToday = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    setDate(d);
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  const setTime = (hhmm: string) => {
    const [hh, mm] = hhmm.split(':').map((n) => parseInt(n, 10));
    if (isNaN(hh) || isNaN(mm)) return;
    const next = new Date(value);
    next.setHours(hh, mm, 0, 0);
    onChange(next);
  };

  const shiftMinutes = (delta: number) => onChange(new Date(value.getTime() + delta * 60000));

  const monthLabel = viewMonth.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('pickDateTime')}
        className={`whitespace-nowrap bg-slate-950 border rounded-lg px-2 py-1.5 text-xs transition ${
          open ? 'border-blue-500 text-blue-200' : 'border-slate-700 text-slate-200 hover:border-slate-500'
        }`}
      >
        📅 {formatShort(value)}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-[236px] p-2.5 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl space-y-2">
          {/* Snelkeuzes */}
          <div className="flex gap-1">
            {[
              { label: t('today'), n: 0 },
              { label: t('tomorrow'), n: 1 },
              { label: t('plusWeek'), n: 7 },
            ].map((q) => {
              const target = new Date();
              target.setDate(target.getDate() + q.n);
              const active = sameDay(target, value);
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setDaysFromToday(q.n)}
                  className={`flex-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition ${
                    active ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {q.label}
                </button>
              );
            })}
          </div>

          {/* Maandnavigatie */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              className="w-6 h-6 rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label={t('prevMonth')}
            >
              ‹
            </button>
            <span className="text-xs font-semibold text-slate-200 capitalize">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              className="w-6 h-6 rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label={t('nextMonth')}
            >
              ›
            </button>
          </div>

          {/* Kalender */}
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS[getLang()].map((w) => (
              <span key={w} className="text-[10px] text-slate-500 py-0.5">
                {w}
              </span>
            ))}
            {days.map((d) => {
              const inMonth = d.getMonth() === viewMonth.getMonth();
              const selected = sameDay(d, value);
              const isToday = sameDay(d, today);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => setDate(d)}
                  className={`h-7 rounded-md text-[11px] transition ${
                    selected
                      ? 'bg-blue-600 text-white font-semibold'
                      : isToday
                        ? 'text-blue-300 ring-1 ring-blue-500/60 hover:bg-slate-800'
                        : inMonth
                          ? 'text-slate-200 hover:bg-slate-800'
                          : 'text-slate-600 hover:bg-slate-800'
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Tijd */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800">
            <span className="text-[11px] text-slate-400">{t('time')}</span>
            <button
              type="button"
              onClick={() => shiftMinutes(-15)}
              className="px-1.5 py-1 rounded-md bg-slate-800 text-[11px] text-slate-300 hover:bg-slate-700"
              title={t('minus15Title')}
            >
              −15
            </button>
            <input
              type="time"
              value={`${pad2(value.getHours())}:${pad2(value.getMinutes())}`}
              onChange={(e) => setTime(e.target.value)}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-md px-1.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500 [color-scheme:dark]"
            />
            <button
              type="button"
              onClick={() => shiftMinutes(15)}
              className="px-1.5 py-1 rounded-md bg-slate-800 text-[11px] text-slate-300 hover:bg-slate-700"
              title={t('plus15Title')}
            >
              +15
            </button>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
          >
            {t('done')}
          </button>
        </div>
      )}
    </div>
  );
}
