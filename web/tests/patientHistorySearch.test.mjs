import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPatientHistory, isNoShowAppointment } from '../src/lib/patientHistory.ts';

// Helper to simulate DoctorPatientHistoryPage appointment filtering pipeline
function simulateHistoryFilter({
  appointments,
  activeClinicId = 'clinic_1',
  historyTab = 'all',
  fromDate = '',
  toDate = '',
  search = '',
  doctorId = 'doc_123',
}) {
  // 1. Authorization check
  const isAuthorizedDoctorAppt = (appt) => {
    if (appt.isAssignedToMe) return true;
    if (appt.assignedDoctorId && String(appt.assignedDoctorId).toLowerCase().trim() === String(doctorId).toLowerCase().trim()) {
      return true;
    }
    return false;
  };

  const isPastHistoryRecord = (appt) => {
    if (!appt) return false;
    if (isNoShowAppointment(appt)) return true;
    const s = String(appt.status || "").trim().toLowerCase();
    return s === "completed" || s === "cancelled" || s === "canceled" || Boolean(appt.doctorDone);
  };

  // Filter for clinic scope (activeClinicId)
  const clinicScoped = appointments.filter((a) => {
    if (activeClinicId === 'all') return true;
    return a.clinicId === activeClinicId;
  });

  const authorizedHistory = clinicScoped.filter(a => isPastHistoryRecord(a) && isAuthorizedDoctorAppt(a));

  // 2. Summary cards metrics (Overall history statistics for clinic scope - unchanged by date/search filter)
  const noShowList = authorizedHistory.filter(isNoShowAppointment);
  const completedList = authorizedHistory.filter((a) => {
    if (isNoShowAppointment(a)) return false;
    const s = String(a.status || "").trim().toLowerCase();
    const c = String(a.checkInStatus || "").trim().toLowerCase();
    return s === "completed" || Boolean(a.doctorDone) || c === "completed";
  });
  const cancelledList = authorizedHistory.filter((a) => {
    if (isNoShowAppointment(a)) return false;
    const s = String(a.status || "").trim().toLowerCase();
    const c = String(a.checkInStatus || "").trim().toLowerCase();
    if (s === "completed" || Boolean(a.doctorDone) || c === "completed") return false;
    return s === "cancelled" || s === "canceled" || s === "rejected" || a.doctorStatus === "rejected";
  });
  const allPatients = groupPatientHistory(authorizedHistory);

  const stats = {
    totalAppointments: authorizedHistory.length,
    completed: completedList.length,
    cancelled: cancelledList.length,
    noShow: noShowList.length,
    totalPatients: allPatients.length,
  };

  // 3. Date filtering
  const dateFilteredHistory = authorizedHistory.filter((a) => {
    const d = String(a.date || "").trim();
    if (!d) return false;
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });

  // 4. Category / Tab filtering
  let categoryFilteredHistory = dateFilteredHistory;
  if (historyTab === 'completed') {
    categoryFilteredHistory = dateFilteredHistory.filter((a) => {
      if (isNoShowAppointment(a)) return false;
      const s = String(a.status || "").trim().toLowerCase();
      const c = String(a.checkInStatus || "").trim().toLowerCase();
      return s === "completed" || Boolean(a.doctorDone) || c === "completed";
    });
  } else if (historyTab === 'cancelled') {
    categoryFilteredHistory = dateFilteredHistory.filter((a) => {
      if (isNoShowAppointment(a)) return false;
      const s = String(a.status || "").trim().toLowerCase();
      const c = String(a.checkInStatus || "").trim().toLowerCase();
      if (s === "completed" || Boolean(a.doctorDone) || c === "completed") return false;
      return s === "cancelled" || s === "canceled" || s === "rejected" || a.doctorStatus === "rejected";
    });
  } else if (historyTab === 'no-show') {
    categoryFilteredHistory = dateFilteredHistory.filter(isNoShowAppointment);
  }

  // 5. Patient Name Only Search Filter (DoctorPatientHistoryPage logic)
  const query = search.trim().toLowerCase();
  const searchFilteredHistory = !query
    ? categoryFilteredHistory
    : categoryFilteredHistory.filter((a) =>
        Boolean(a.patientName && a.patientName.toLowerCase().includes(query))
      );

  // 6. Patient Groups
  const tabPatients = groupPatientHistory(searchFilteredHistory);

  return {
    stats,
    searchFilteredHistory,
    tabPatients,
  };
}

// Sample appointment dataset
const sampleAppts = [
  {
    id: 'appt-1',
    userId: 'user_josua',
    patientId: 'P-2026-0001',
    patientName: 'Josua Agustine Calago',
    patientEmail: 'josua@example.com',
    doctorDiagnosis: 'Acne Vulgaris',
    conditionName: 'Acne',
    clinicName: 'Skin Clinic Manila',
    clinicId: 'clinic_1',
    notes: 'Severe breakouts on cheeks',
    doctorNote: 'Prescribed topical retinoid',
    date: '2026-02-15',
    status: 'completed',
    doctorDone: true,
    assignedDoctorId: 'doc_123',
    isAssignedToMe: true,
  },
  {
    id: 'appt-2',
    userId: 'user_josua',
    patientId: 'P-2026-0001',
    patientName: 'Josua Agustine Calago',
    patientEmail: 'josua@example.com',
    doctorDiagnosis: 'Follow up Acne',
    conditionName: 'Acne',
    clinicName: 'Skin Clinic Manila',
    clinicId: 'clinic_1',
    notes: 'Skin improving',
    date: '2026-03-01',
    status: 'completed',
    doctorDone: true,
    assignedDoctorId: 'doc_123',
    isAssignedToMe: true,
  },
  {
    id: 'appt-3',
    userId: 'user_maria',
    patientId: 'P-2026-0002',
    patientName: 'Maria Santos',
    patientEmail: 'maria@example.com',
    doctorDiagnosis: 'Atopic Dermatitis',
    conditionName: 'Eczema',
    clinicName: 'Skin Clinic Manila',
    clinicId: 'clinic_1',
    notes: 'Itchy rash',
    date: '2026-02-20',
    status: 'completed',
    doctorDone: true,
    assignedDoctorId: 'doc_123',
    isAssignedToMe: true,
  },
  {
    id: 'appt-4',
    userId: 'user_carlos',
    patientId: 'P-2026-0003',
    patientName: 'Carlos D. Cruz',
    patientEmail: 'carlos@example.com',
    doctorDiagnosis: 'Vitiligo',
    conditionName: 'Vitiligo',
    clinicName: 'Skin Clinic Manila',
    clinicId: 'clinic_1',
    notes: 'Depigmented patches',
    date: '2026-02-25',
    status: 'cancelled',
    assignedDoctorId: 'doc_123',
    isAssignedToMe: true,
  },
  {
    id: 'appt-5',
    userId: 'user_elena',
    patientId: 'P-2026-0004',
    patientName: 'Elena Rostova',
    patientEmail: 'elena@example.com',
    doctorDiagnosis: 'Melasma',
    conditionName: 'Melasma',
    clinicName: 'Skin Clinic Manila',
    clinicId: 'clinic_1',
    notes: 'Facial hyperpigmentation',
    date: '2026-02-28',
    status: 'confirmed',
    checkInStatus: 'no-show',
    assignedDoctorId: 'doc_123',
    isAssignedToMe: true,
  },
  {
    // Another clinic branch for Josua
    id: 'appt-6',
    userId: 'user_josua',
    patientId: 'P-2026-0001',
    patientName: 'Josua Agustine Calago',
    clinicName: 'Skin Clinic Cebu',
    clinicId: 'clinic_2',
    date: '2026-03-10',
    status: 'completed',
    doctorDone: true,
    assignedDoctorId: 'doc_123',
    isAssignedToMe: true,
  },
  {
    // Different doctor (unauthorized)
    id: 'appt-7',
    userId: 'user_josua',
    patientId: 'P-2026-0001',
    patientName: 'Josua Agustine Calago',
    clinicName: 'Skin Clinic Manila',
    clinicId: 'clinic_1',
    date: '2026-03-12',
    status: 'completed',
    doctorDone: true,
    assignedDoctorId: 'doc_OTHER',
    isAssignedToMe: false,
  },
];

test('Scenario 1: Search by first name returns matching patients', () => {
  const result = simulateHistoryFilter({ appointments: sampleAppts, search: 'Josua' });
  assert.equal(result.tabPatients.length, 1);
  assert.equal(result.tabPatients[0].latest.patientName, 'Josua Agustine Calago');
  assert.equal(result.tabPatients[0].appointments.length, 2);
});

test('Scenario 2: Search by last name returns matching patients', () => {
  const result = simulateHistoryFilter({ appointments: sampleAppts, search: 'Calago' });
  assert.equal(result.tabPatients.length, 1);
  assert.equal(result.tabPatients[0].latest.patientName, 'Josua Agustine Calago');
});

test('Scenario 3: Search by full name returns matching patients', () => {
  const result = simulateHistoryFilter({ appointments: sampleAppts, search: 'Josua Agustine Calago' });
  assert.equal(result.tabPatients.length, 1);
  assert.equal(result.tabPatients[0].latest.patientName, 'Josua Agustine Calago');
});

test('Scenario 4: Different capitalization still matches (case-insensitive)', () => {
  assert.equal(simulateHistoryFilter({ appointments: sampleAppts, search: 'jOsUa' }).tabPatients.length, 1);
  assert.equal(simulateHistoryFilter({ appointments: sampleAppts, search: 'CALAGO' }).tabPatients.length, 1);
  assert.equal(simulateHistoryFilter({ appointments: sampleAppts, search: 'mArIa' }).tabPatients.length, 1);
});

test('Scenario 5: Extra leading and trailing spaces handled correctly', () => {
  const result = simulateHistoryFilter({ appointments: sampleAppts, search: '   Josua   ' });
  assert.equal(result.tabPatients.length, 1);
  assert.equal(result.tabPatients[0].latest.patientName, 'Josua Agustine Calago');
});

test('Scenario 6: Search by diagnosis does NOT match unless patient name contains the text', () => {
  // Maria Santos has diagnosis 'Atopic Dermatitis'
  const result = simulateHistoryFilter({ appointments: sampleAppts, search: 'Dermatitis' });
  assert.equal(result.tabPatients.length, 0);

  // Josua has diagnosis 'Acne Vulgaris'
  const result2 = simulateHistoryFilter({ appointments: sampleAppts, search: 'Acne' });
  assert.equal(result2.tabPatients.length, 0);

  const result3 = simulateHistoryFilter({ appointments: sampleAppts, search: 'Vitiligo' });
  assert.equal(result3.tabPatients.length, 0);
});

test('Scenario 7: Search by patient ID or email does NOT match', () => {
  assert.equal(simulateHistoryFilter({ appointments: sampleAppts, search: 'P-2026-0001' }).tabPatients.length, 0);
  assert.equal(simulateHistoryFilter({ appointments: sampleAppts, search: 'josua@example.com' }).tabPatients.length, 0);
});

test('Scenario 8: Empty search displays all authorized patients in clinic', () => {
  const result = simulateHistoryFilter({ appointments: sampleAppts, search: '' });
  // In clinic_1 for doc_123: Josua, Maria, Carlos, Elena (4 patients, 5 visits)
  assert.equal(result.tabPatients.length, 4);
  assert.equal(result.searchFilteredHistory.length, 5);
});

test('Scenario 9: Search while Completed tab is selected works correctly', () => {
  const result = simulateHistoryFilter({ appointments: sampleAppts, historyTab: 'completed', search: 'Carlos' });
  // Carlos has only a cancelled visit, so completed search returns 0
  assert.equal(result.tabPatients.length, 0);

  const result2 = simulateHistoryFilter({ appointments: sampleAppts, historyTab: 'completed', search: 'Josua' });
  assert.equal(result2.tabPatients.length, 1);
  assert.equal(result2.tabPatients[0].appointments.length, 2);
});

test('Scenario 10: Search while Cancelled or No-Show tab is selected works correctly', () => {
  // Cancelled tab
  const cancelledRes = simulateHistoryFilter({ appointments: sampleAppts, historyTab: 'cancelled', search: 'Carlos' });
  assert.equal(cancelledRes.tabPatients.length, 1);
  assert.equal(cancelledRes.tabPatients[0].latest.patientName, 'Carlos D. Cruz');

  // No-Show tab
  const noShowRes = simulateHistoryFilter({ appointments: sampleAppts, historyTab: 'no-show', search: 'Elena' });
  assert.equal(noShowRes.tabPatients.length, 1);
  assert.equal(noShowRes.tabPatients[0].latest.patientName, 'Elena Rostova');
});

test('Scenario 11: Search with From/To date filters works together', () => {
  // Josua has visits on 2026-02-15 and 2026-03-01
  const result = simulateHistoryFilter({
    appointments: sampleAppts,
    fromDate: '2026-02-01',
    toDate: '2026-02-28',
    search: 'Josua',
  });
  assert.equal(result.tabPatients.length, 1);
  // Only the Feb 15 visit is within range
  assert.equal(result.tabPatients[0].appointments.length, 1);
  assert.equal(result.tabPatients[0].appointments[0].date, '2026-02-15');
});

test('Scenario 12: Search across individual clinic branches respects clinic isolation', () => {
  // In clinic_2, Josua has 1 visit
  const cebuRes = simulateHistoryFilter({ appointments: sampleAppts, activeClinicId: 'clinic_2', search: 'Josua' });
  assert.equal(cebuRes.tabPatients.length, 1);
  assert.equal(cebuRes.tabPatients[0].appointments.length, 1);
  assert.equal(cebuRes.tabPatients[0].appointments[0].clinicName, 'Skin Clinic Cebu');

  // Maria has no visits in clinic_2
  const cebuMaria = simulateHistoryFilter({ appointments: sampleAppts, activeClinicId: 'clinic_2', search: 'Maria' });
  assert.equal(cebuMaria.tabPatients.length, 0);
});

test('Scenario 13: Search in All Clinics (Consolidated) respects doctor authorization', () => {
  const result = simulateHistoryFilter({
    appointments: sampleAppts,
    activeClinicId: 'all',
    search: 'Josua',
    doctorId: 'doc_123',
  });
  // Josua has 2 visits in clinic_1 and 1 visit in clinic_2 assigned to doc_123.
  // The 1 visit assigned to doc_OTHER is excluded by doctor authorization.
  assert.equal(result.tabPatients.length, 1);
  assert.equal(result.tabPatients[0].appointments.length, 3);
  assert.ok(result.tabPatients[0].appointments.every(a => a.assignedDoctorId === 'doc_123'));
});

test('Scenario 14: CSV and PDF export dataset follows name-only search', () => {
  const result = simulateHistoryFilter({ appointments: sampleAppts, search: 'Maria' });
  // searchFilteredHistory is the exact array passed to handleExportCsv and handleExportPdf
  assert.equal(result.searchFilteredHistory.length, 1);
  assert.equal(result.searchFilteredHistory[0].patientName, 'Maria Santos');
});

test('Scenario 15: Summary card metrics remain unchanged when searching', () => {
  const noSearch = simulateHistoryFilter({ appointments: sampleAppts, search: '' });
  const withSearch = simulateHistoryFilter({ appointments: sampleAppts, search: 'Josua' });

  // Overall clinic metrics must remain identical regardless of search query
  assert.deepEqual(withSearch.stats, noSearch.stats);
  assert.equal(withSearch.stats.totalAppointments, 5);
  assert.equal(withSearch.stats.completed, 3);
  assert.equal(withSearch.stats.cancelled, 1);
  assert.equal(withSearch.stats.noShow, 1);
  assert.equal(withSearch.stats.totalPatients, 4);
});
