import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPendingAppointmentUrgency, compareAppointmentUrgency, getReviewUrgency, urgentReviewDateBounds } from '../src/lib/appointmentUrgency.ts';

const now = Date.parse('2026-10-23T08:00:00+08:00');
const hour = 60 * 60 * 1000;
const appointment = (overrides = {}) => ({ status: 'pending', date: '2026-10-24', time: '08:00', ...overrides });

test('pending appointments include now and exactly 48 hours, excluding past and later appointments', () => {
  assert.equal(getPendingAppointmentUrgency(appointment(), now), 24 * hour);
  assert.equal(getPendingAppointmentUrgency(appointment({ date: '2026-10-23' }), now), 0);
  assert.equal(getPendingAppointmentUrgency(appointment({ date: '2026-10-25' }), now), 48 * hour);
  assert.equal(getPendingAppointmentUrgency(appointment({ date: '2026-10-25', time: '08:00:01' }), now), null);
  assert.equal(getPendingAppointmentUrgency(appointment({ date: '2026-10-23', time: '07:59' }), now), null);
});

test('only pending status is eligible', () => {
  for (const status of ['confirmed', 'accepted', 'scheduled', 'completed', 'cancelled', 'rejected']) {
    assert.equal(getPendingAppointmentUrgency(appointment({ status }), now), null);
  }
});

test('parses Manila wall times, AM/PM, seconds, and ISO timestamps consistently', () => {
  for (const time of ['08:00', '08:00:00', '8:00 AM']) {
    assert.equal(getPendingAppointmentUrgency(appointment({ time }), now), 24 * hour);
  }
  assert.equal(getPendingAppointmentUrgency(appointment({ time: '8:00 PM' }), now), 36 * hour);
  assert.equal(getPendingAppointmentUrgency(appointment({ time: '12:00 AM' }), now), 16 * hour);
  assert.equal(getPendingAppointmentUrgency(appointment({ time: '12:00 PM' }), now), 28 * hour);
  assert.equal(getPendingAppointmentUrgency(appointment({ date: '2026-10-24T00:00:00Z', time: '' }), now), 24 * hour);
  assert.equal(getPendingAppointmentUrgency(appointment({ date: '2026-10-24T08:00:00', time: '' }), now), 24 * hour);
  assert.equal(getPendingAppointmentUrgency(appointment({ time: '' }), now), 16 * hour);
});

test('invalid or absent schedules do not create false alerts', () => {
  for (const overrides of [
    { date: '' }, { date: null }, { date: 'Schedule pending' }, { date: '2026-02-30' },
    { time: '25:00' }, { time: '12:60' }, { time: '0:30 AM' }, { time: 'invalid' },
  ]) assert.equal(getPendingAppointmentUrgency(appointment(overrides), now), null);
});

test('urgent requests sort ahead of others, soonest first, without mutating source order', () => {
  const rows = [
    appointment({ id: 'later', date: '2026-10-29' }),
    appointment({ id: 'urgent-later' }),
    appointment({ id: 'accepted', status: 'accepted', date: '2026-10-23', time: '09:00' }),
    appointment({ id: 'urgent-sooner', date: '2026-10-23', time: '09:00' }),
  ];
  const sorted = [...rows].sort((a, b) => compareAppointmentUrgency(a, b, now));
  assert.deepEqual(sorted.map(row => row.id), ['urgent-sooner', 'urgent-later', 'later', 'accepted']);
  assert.equal(rows[0].id, 'later');
});

test('refreshing the clock activates the alert when a request enters the window', () => {
  const row = appointment({ date: '2026-10-25', time: '08:01' });
  assert.equal(getPendingAppointmentUrgency(row, now), null);
  assert.equal(getPendingAppointmentUrgency(row, now + 60_000), 48 * hour);
});

test('review tiers handle exact 1h, 2h, 24h and 48h boundaries', () => {
  const make = milliseconds => ({ status: 'pending', date: new Date(now + milliseconds).toISOString(), time: '', doctorStatus: 'pending-review' });
  assert.equal(getReviewUrgency(make(0), now).countdown, 'Starts now');
  assert.equal(getReviewUrgency(make(45 * 60_000), now).countdown, 'Starts in 45 mins');
  assert.match(getReviewUrgency(make(hour - 1), now).label, /< 1h/);
  assert.match(getReviewUrgency(make(hour), now).label, /< 2h/);
  assert.equal(getReviewUrgency(make(2 * hour - 1), now).tier, 'critical');
  assert.equal(getReviewUrgency(make(2 * hour), now).tier, 'high');
  assert.equal(getReviewUrgency(make(24 * hour - 1), now).tier, 'high');
  assert.equal(getReviewUrgency(make(24 * hour), now).tier, 'upcoming');
  assert.equal(getReviewUrgency(make(48 * hour), now).tier, 'upcoming');
  assert.equal(getReviewUrgency(make(48 * hour + 1), now), null);
  assert.equal(getReviewUrgency(make(-1), now), null);
});

test('pending appointments already approved or rejected by the doctor do not reappear', () => {
  for (const doctorStatus of ['approved', 'rejected']) {
    assert.equal(getReviewUrgency(appointment({ doctorStatus }), now), null);
  }
  assert.equal(getReviewUrgency(appointment({ doctorStatus: 'pending-review' }), now).tier, 'upcoming');
});

test('database bounds cover Manila calendar days around the precise 48-hour window', () => {
  assert.deepEqual(urgentReviewDateBounds(now), { from: '2026-10-23T00:00:00+08:00', until: '2026-10-26T00:00:00+08:00' });
  const beforeMidnight = Date.parse('2026-12-31T23:59:00+08:00');
  assert.deepEqual(urgentReviewDateBounds(beforeMidnight), { from: '2026-12-31T00:00:00+08:00', until: '2027-01-03T00:00:00+08:00' });
});
