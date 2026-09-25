/**
 * Fleet Duty — operational scheduling model for the agent fleet.
 *
 * Every agent is classified by duty:
 *   - always-on : running now via crons (monitors, chains, QA)
 *   - shift     : active only inside defined windows (e.g. Aetherdesk 9-5)
 *   - on-call   : triggered on demand / paged (incidents, compliance, support)
 *
 * Deterministic: on-duty status is computed from time + config, never guessed.
 */

export type Duty = 'always-on' | 'shift' | 'on-call';

export interface ShiftWindow {
  agentId: string;
  /** Days active: 1=Mon .. 7=Sun (empty = every day). */
  days: number[];
  /** Local time window "HH:MM". */
  start: string;
  end: string;
  /** IANA timezone; falls back to the server's local tz. */
  timezone: string;
  label: string;
}

export interface DutyAssignment {
  agentId: string;
  duty: Duty;
  /** Cron schedule for always-on agents (informational). */
  cron?: string;
  /** Shift window reference for shift agents. */
  shift?: ShiftWindow;
  /** Who/what pages the agent on-call (informational). */
  onCallFor?: string;
}

/** Default fleet duty map — aligned to the 90-day mission. */
export const FLEET_DUTY: DutyAssignment[] = [
  // Always-on — the autonomous business engine
  { agentId: 'draymond', duty: 'always-on', cron: '*/5 * * * *' },
  { agentId: 'big-homie', duty: 'always-on', cron: '*/5 * * * *', onCallFor: 'task quality gates' },
  { agentId: 'overlay-auditor', duty: 'always-on', cron: '0 7 * * *' },
  { agentId: 'overlay-treasurer', duty: 'always-on', cron: '0 8 * * *' },
  { agentId: 'overlay-strategist', duty: 'always-on', cron: '0 6 * * 1,4' },
  { agentId: 'litellm', duty: 'always-on', cron: '*/15 * * * *' },
  { agentId: 'deterministic-brain', duty: 'always-on', cron: '*/5 * * * *' },
  { agentId: 'bookbridge', duty: 'always-on', cron: '0 2 * * *' },
  { agentId: 'agent-browser', duty: 'always-on', cron: '0 7 * * *' },
  { agentId: 'overlay365-qa', duty: 'always-on', cron: '0 7 * * *' },
  // Shift — active in windows (Aetherdesk = business hours)
  {
    agentId: 'aetherdesk', duty: 'shift',
    shift: { agentId: 'aetherdesk', days: [], start: '09:00', end: '17:00', timezone: 'America/New_York', label: 'Business hours' },
    onCallFor: 'inbound calls',
  },
  {
    agentId: 'repair-team', duty: 'shift',
    shift: { agentId: 'repair-team', days: [], start: '18:00', end: '19:00', timezone: 'America/New_York', label: 'Daily repair shift' },
    onCallFor: 'failed jobs / weak components / service outages',
  },
  // On-call — paged on demand
  { agentId: 'overlay-guardian', duty: 'on-call', onCallFor: 'content changes / compliance' },
  { agentId: 'overlay365-qa', duty: 'on-call', onCallFor: 'deploy verification' },
  { agentId: 'support', duty: 'on-call', onCallFor: 'client escalations' },
];

/** Map weekday short name -> 1..7 (Mon=1, Sun=7). */
const WEEKDAY_NUM: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

function weekdayInTz(now: Date, tz: string): number {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
    return WEEKDAY_NUM[name] ?? (now.getDay() === 0 ? 7 : now.getDay());
  } catch {
    return now.getDay() === 0 ? 7 : now.getDay();
  }
}

/** True when the agent has a shift window and it is active at `now`. */
export function isShiftActive(shift: ShiftWindow, now: Date): boolean {
  const tz = shift.timezone;
  let hour: number;
  let minute: number;
  let day: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    hour = Number(h);
    minute = Number(m);
    day = weekdayInTz(now, tz);
  } catch {
    hour = now.getHours();
    minute = now.getMinutes();
    day = now.getDay() === 0 ? 7 : now.getDay();
  }

  if (shift.days.length > 0 && !shift.days.includes(day)) return false;

  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);
  const endMin = (eh ?? 0) * 60 + (em ?? 0);
  const curMin = hour * 60 + minute;

  if (endMin <= startMin) {
    // overnight window (e.g. 22:00 -> 06:00)
    return curMin >= startMin || curMin < endMin;
  }
  return curMin >= startMin && curMin < endMin;
}

export interface DutyStatus {
  agentId: string;
  duty: Duty;
  active: boolean;
  detail: string;
}

/** Compute the full on-duty roster for the fleet at `now`. */
export function computeFleetDuty(now = new Date()): DutyStatus[] {
  return FLEET_DUTY.map((a) => {
    if (a.duty === 'always-on') {
      return { agentId: a.agentId, duty: a.duty, active: true, detail: a.cron ? `cron ${a.cron}` : 'continuous' };
    }
    if (a.duty === 'shift' && a.shift) {
      const active = isShiftActive(a.shift, now);
      return {
        agentId: a.agentId, duty: a.duty, active,
        detail: active ? `on shift (${a.shift.start}-${a.shift.end})` : `off shift (${a.shift.label})`,
      };
    }
    return { agentId: a.agentId, duty: a.duty, active: false, detail: `on-call: ${a.onCallFor ?? 'paged'}` };
  });
}

/** Next window start (HH:MM) for the nearest active shift of an agent. */
export function nextShiftStart(shift: ShiftWindow, now = new Date()): { start: string; daysUntil: number } | null {
  const [sh, sm] = shift.start.split(':').map(Number);
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);

  // If today's window hasn't started yet (in tz), it starts today.
  const todayStart = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: shift.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
      return Number(parts.find((p) => p.type === 'hour')?.value ?? '0') * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    } catch {
      return now.getHours() * 60 + now.getMinutes();
    }
  })();

  const startOffset = todayStart < startMin ? 0 : 1;
  for (let offset = startOffset; offset < 8; offset++) {
    const probe = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    if (shift.days.length > 0) {
      const day = weekdayInTz(probe, shift.timezone);
      if (!shift.days.includes(day)) continue;
    }
    return { start: shift.start, daysUntil: offset };
  }
  return null;
}
