import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReviewPatients } from '../src/lib/reviewPatientSort.ts';
const sorted = (rows, tab) => [...rows].sort((a, b) => compareReviewPatients(a, b, tab)).map(a => a.id);
test('incoming requests sort newest first, independent of visit dates', () => {
  assert.deepEqual(sorted([
    { id: 'old', createdAt: '2026-01-01', date: '2026-12-31' },
    { id: 'new', createdAt: '2026-03-01', date: '2026-01-01' },
    { id: 'requested', requestedAt: '2026-04-01', createdAt: '2025-01-01' },
  ], 'pending'), ['requested', 'new', 'old']);
});
test('review time takes priority over creation and update dates', () => {
  assert.deepEqual(sorted([
    { id: 'older-review', createdAt: '2026-06-01', doctorReviewedAt: '2026-07-01', updatedAt: '2026-12-01' },
    { id: 'recent-review', createdAt: '2026-01-01', doctorReviewedAt: '2026-08-01' },
  ], 'reviewed'), ['recent-review', 'older-review']);
});
test('review dates fall back to decision history, updatedAt, then createdAt', () => {
  assert.deepEqual(sorted([
    { id: 'created', createdAt: '2026-01-01' },
    { id: 'updated', createdAt: '', updatedAt: '2026-02-01' },
    { id: 'decision', createdAt: '', doctorReviewedAt: 'invalid', appointmentHistory: [{ action: 'doctor_rejected', timestamp: '2026-03-01' }, { action: 'doctor_assigned', timestamp: '2026-12-01' }] },
    { id: 'missing', createdAt: '' },
  ], 'reviewed'), ['decision', 'updated', 'created', 'missing']);
});
test('invalid or tied dates sort consistently without NaN comparisons', () => {
  assert.deepEqual(sorted([{ id: 'b', createdAt: 'invalid' }, { id: 'a', createdAt: '' }], 'pending'), ['a', 'b']);
  assert.equal(compareReviewPatients({ id: 'a', createdAt: '' }, { id: 'a', createdAt: '' }, 'reviewed'), 0);
});
