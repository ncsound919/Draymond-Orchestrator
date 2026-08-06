import { describe, expect, it } from 'vitest';
import {
  computeFleetDuty,
  isShiftActive,
  nextShiftStart,
  FLEET_DUTY,
  type ShiftWindow,
} from '../src/lib/draymond/fleet-duty';

describe('fleet duty', () => {
  const alwaysOn = FLEET_DUTY.find((a) => a.agentId === 'overlay-auditor');
  const aether = FLEET_DUTY.find((a) => a.agentId === 'aetherdesk');

  it('classifies always-on agents as active', () => {
    expect(alwaysOn?.duty).toBe('always-on');
    const roster = computeFleetDuty(new Date());
    expect(roster.find((r) => r.agentId === 'overlay-auditor')?.active).toBe(true);
  });

  it('aetherdesk is a shift agent, not always-on', () => {
    expect(aether?.duty).toBe('shift');
    expect(aether?.shift?.label).toBe('Business hours');
  });

  it('shift window is active inside the window and inactive outside', () => {
    const shift: ShiftWindow = { agentId: 'x', days: [], start: '09:00', end: '17:00', timezone: 'UTC', label: 't' };
    // 10:00 UTC is inside 09:00-17:00
    expect(isShiftActive(shift, new Date('2026-08-06T10:00:00Z'))).toBe(true);
    // 20:00 UTC is outside
    expect(isShiftActive(shift, new Date('2026-08-06T20:00:00Z'))).toBe(false);
  });

  it('handles overnight shift windows', () => {
    const shift: ShiftWindow = { agentId: 'x', days: [], start: '22:00', end: '06:00', timezone: 'UTC', label: 'night' };
    expect(isShiftActive(shift, new Date('2026-08-06T23:00:00Z'))).toBe(true);
    expect(isShiftActive(shift, new Date('2026-08-06T12:00:00Z'))).toBe(false);
  });

  it('respects day filters', () => {
    const shift: ShiftWindow = { agentId: 'x', days: [1], start: '00:00', end: '23:59', timezone: 'UTC', label: 'monday' };
    // 2026-08-06 is a Thursday (4)
    expect(isShiftActive(shift, new Date('2026-08-06T10:00:00Z'))).toBe(false);
    // 2026-08-03 is a Monday (1)
    expect(isShiftActive(shift, new Date('2026-08-03T10:00:00Z'))).toBe(true);
  });

  it('nextShiftStart returns a future window', () => {
    const shift: ShiftWindow = { agentId: 'x', days: [], start: '09:00', end: '17:00', timezone: 'UTC', label: 't' };
    const next = nextShiftStart(shift, new Date('2026-08-06T20:00:00Z'));
    expect(next?.start).toBe('09:00');
    expect(next?.daysUntil).toBe(1);
  });
});
