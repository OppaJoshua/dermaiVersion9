import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from '../node_modules/jspdf/dist/jspdf.es.min.js';
import { isNoShowAppointment, historyStatusLabel } from '../src/lib/patientHistory.ts';

// ── Test Helpers & Fixtures ─────────────────────────────────────────────────
const mockAppt = (id, date, status, extra = {}) => ({
  id,
  patientId: `P-2026-${id.padStart(4, '0')}`,
  patientName: `Patient ${id}`,
  date,
  time: '10:00 AM',
  clinicName: 'Metro Dermatology Clinic',
  status,
  doctorDiagnosis: status === 'completed' ? 'Eczema' : '',
  conditionName: 'Skin Check',
  clinicNote: '',
  isAssignedToMe: true,
  assignedDoctorId: 'doc-1',
  ...extra,
});

// CSV Sanitizer Function mirroring DoctorPatientHistoryPage.tsx
function sanitizeCsv(val) {
  let str = String(val ?? "");
  if (/^[\s\t\r\n]*[=+\-@]/.test(str) || /^[\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function formatContactCsv(contact) {
  const trimmed = String(contact ?? "").trim();
  if (!trimmed) return "Not provided";
  if (/^0/.test(trimmed) && !trimmed.startsWith("'")) {
    return `'${trimmed}`;
  }
  return trimmed;
}

function formatEmailCsv(email) {
  const trimmed = String(email ?? "").trim();
  return trimmed ? trimmed : "Not provided";
}

function buildCsvContent(records) {
  const headers = [
    'Patient ID',
    'Patient Name',
    'Contact Number',
    'Email Address',
    'Appointment Date',
    'Appointment Time',
    'Clinic Branch',
    'Appointment Status',
    'Diagnosis / Concern',
    'Clinic Remarks',
    'Emergency Contact Name',
    'Emergency Contact Relationship',
    'Emergency Contact Number',
  ];
  const rows = records.map(a => [
    sanitizeCsv(a.patientId),
    sanitizeCsv(a.patientName),
    sanitizeCsv(formatContactCsv(a.patientContact)),
    sanitizeCsv(formatEmailCsv(a.patientEmail)),
    sanitizeCsv(a.date),
    sanitizeCsv(a.time),
    sanitizeCsv(a.clinicName),
    sanitizeCsv(historyStatusLabel(a)),
    sanitizeCsv(a.doctorDiagnosis || a.conditionName || (isNoShowAppointment(a) ? 'Missed Appointment' : 'Consultation Request')),
    sanitizeCsv(a.clinicNote || ''),
    sanitizeCsv(a.emergencyContactName?.trim() || 'Not provided'),
    sanitizeCsv(a.emergencyRelationship?.trim() || 'Not provided'),
    sanitizeCsv(formatContactCsv(a.emergencyContactPhone)),
  ]);
  return '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('Date Filtering: correctly evaluates scheduled dates in Asia/Manila format', () => {
  const dataset = [
    mockAppt('1', '2026-01-15', 'completed'),
    mockAppt('2', '2026-02-01', 'completed'),
    mockAppt('3', '2026-02-15', 'cancelled'),
    mockAppt('4', '2026-03-01', 'confirmed', { checkInStatus: 'no-show' }),
    mockAppt('5', '2026-03-20', 'completed'),
  ];

  const filterByDate = (records, fromDate, toDate) => {
    if (fromDate && toDate && fromDate > toDate) return { error: 'From Date cannot be later than To Date.', records: [] };
    if (!fromDate && !toDate) return { error: null, records };
    return {
      error: null,
      records: records.filter(a => {
        const d = String(a.date || '').trim();
        if (!d) return false;
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      }),
    };
  };

  // 1. Both empty: all 5 records
  assert.equal(filterByDate(dataset, '', '').records.length, 5);

  // 2. From Date only: >= 2026-02-01 (4 records: Feb 1, Feb 15, Mar 1, Mar 20)
  assert.equal(filterByDate(dataset, '2026-02-01', '').records.length, 4);

  // 3. To Date only: <= 2026-02-15 (3 records: Jan 15, Feb 1, Feb 15)
  assert.equal(filterByDate(dataset, '', '2026-02-15').records.length, 3);

  // 4. Inclusive range: 2026-02-01 to 2026-03-01 (3 records: Feb 1, Feb 15, Mar 1)
  const range = filterByDate(dataset, '2026-02-01', '2026-03-01');
  assert.equal(range.records.length, 3);
  assert.deepEqual(range.records.map(a => a.id), ['2', '3', '4']);

  // 5. Invalid range: From Date > To Date
  const invalid = filterByDate(dataset, '2026-03-01', '2026-02-01');
  assert.equal(invalid.records.length, 0);
  assert.ok(invalid.error.includes('From Date cannot be later than To Date'));
});

test('CSV Export: sanitizes spreadsheet formula injection prefixes and formats correctly', () => {
  const maliciousRecords = [
    mockAppt('1', '2026-02-10', 'completed', {
      patientName: '=CMD|calc.exe!A1',
      patientContact: '09171234567',
      patientEmail: 'juan@example.com',
      clinicNote: '+123456789',
      emergencyContactName: 'Maria Santos',
      emergencyRelationship: 'Mother',
      emergencyContactPhone: '09123456789',
    }),
    mockAppt('2', '2026-02-11', 'confirmed', {
      checkInStatus: 'no-show',
      patientName: '@John Doe',
      patientContact: '+639171234567',
      patientEmail: '=malicious@domain.com',
      doctorDiagnosis: '-10% discount',
      emergencyContactName: '=Malicious Contact',
      emergencyRelationship: '@Spouse',
      emergencyContactPhone: '+639189999999',
    }),
    mockAppt('3', '2026-02-12', 'cancelled', {
      patientName: '\tTabbed Name',
      patientContact: '',
      patientEmail: '  ',
      clinicNote: 'Normal note with "quotes" and, commas',
      emergencyContactName: '',
      emergencyRelationship: undefined,
      emergencyContactPhone: '  ',
    }),
  ];

  const csv = buildCsvContent(maliciousRecords);

  // Must begin with UTF-8 BOM
  assert.ok(csv.startsWith('\uFEFF'));

  // Header verification: Contact Number and Email Address immediately after Patient Name, and Emergency Contact columns appended at end
  assert.ok(csv.includes('Patient ID,Patient Name,Contact Number,Email Address,Appointment Date,Appointment Time,Clinic Branch,Appointment Status,Diagnosis / Concern,Clinic Remarks,Emergency Contact Name,Emergency Contact Relationship,Emergency Contact Number'));

  // Phone with leading zero is text-prefixed to preserve leading zeroes in Excel
  assert.ok(csv.includes(`"'09171234567"`));

  // Emergency phone with leading zero is text-prefixed to preserve leading zeroes in Excel
  assert.ok(csv.includes(`"'09123456789"`));

  // Phone with + prefix is formula-injection protected
  assert.ok(csv.includes(`"'+639171234567"`));
  assert.ok(csv.includes(`"'+639189999999"`));

  // Email with formula injection prefix = is protected
  assert.ok(csv.includes(`"'=malicious@domain.com"`));

  // Emergency contact formula injection prefixes must be neutralized with leading single quote
  assert.ok(csv.includes(`"'=Malicious Contact"`));
  assert.ok(csv.includes(`"'@Spouse"`));

  // Normal emergency contact values are exported
  assert.ok(csv.includes(`"Maria Santos"`));
  assert.ok(csv.includes(`"Mother"`));

  // Missing phone, email, and emergency contact values fallback to "Not provided"
  assert.ok(csv.includes(`"Not provided"`));

  // Formula injection prefixes must be neutralized with leading single quote
  assert.ok(csv.includes(`"'=CMD|calc.exe!A1"`));
  assert.ok(csv.includes(`"'+123456789"`));
  assert.ok(csv.includes(`"'@John Doe"`));
  assert.ok(csv.includes(`"'-10% discount"`));
  assert.ok(csv.includes(`"'\tTabbed Name"`));

  // Quotes and commas are escaped
  assert.ok(csv.includes(`"Normal note with ""quotes"" and, commas"`));

  // Status is accurately mapped
  assert.ok(csv.includes('No-Show'));
  assert.ok(csv.includes('Completed'));
  assert.ok(csv.includes('Cancelled'));
});

test('PDF Export: generates valid binary PDF with jsPDF, wrapped text, and matching metrics', () => {
  const testAppointments = [
    mockAppt('1', '2026-01-10', 'completed', {
      patientName: 'Long Patient Name With Extended Clinical Description',
      patientContact: '09171234567',
      patientEmail: 'long.patient.email.with.extended.clinical.identifier@example.ph',
      doctorDiagnosis: 'Severe Atopic Dermatitis with Secondary Infection',
      emergencyContactName: 'Maria Consuelo De Los Santos-Rodriguez',
      emergencyRelationship: 'Mother / Guardian',
      emergencyContactPhone: '0912-345-6789',
    }),
    mockAppt('2', '2026-01-11', 'confirmed', {
      checkInStatus: 'no-show',
      patientContact: '',
      patientEmail: undefined,
      emergencyContactName: 'Pedro Santos',
      emergencyRelationship: 'Father',
      emergencyContactPhone: '0999-888-7777',
    }),
    mockAppt('3', '2026-01-12', 'cancelled'),
  ];

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 14;
  const contentWidth = 210 - margin * 2;

  // Header & Metadata
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('DermAI', margin, 20);
  doc.setFontSize(11);
  doc.text('Patient Consultation History Report', margin, 26);

  // Summary Metrics
  const total = testAppointments.length;
  const completed = testAppointments.filter(a => !isNoShowAppointment(a) && (a.status === 'completed' || a.doctorDone)).length;
  const noShow = testAppointments.filter(isNoShowAppointment).length;
  const cancelled = total - completed - noShow;
  const uniquePatients = new Set(testAppointments.map(a => a.patientId)).size;

  assert.equal(total, 3);
  assert.equal(completed, 1);
  assert.equal(noShow, 1);
  assert.equal(cancelled, 1);
  assert.equal(uniquePatients, 3);

  // Add summary text to PDF
  doc.setFontSize(8);
  doc.text(`Total: ${total} | Completed: ${completed} | Cancelled: ${cancelled} | No-Show: ${noShow} | Patients: ${uniquePatients}`, margin, 34);

  // Table rendering with Patient Column including Name, ID, Phone, Email, and Emergency Contact
  let y = 42;
  const patientColWidth = 44;
  testAppointments.forEach((appt, i) => {
    const patientName = appt.patientName?.trim() || 'Not provided';
    const phoneVal = appt.patientContact?.trim() ? appt.patientContact.trim() : 'Not provided';
    const emailVal = appt.patientEmail?.trim() ? appt.patientEmail.trim() : 'Not provided';
    const phoneText = `Phone: ${phoneVal}`;
    const emailText = `Email: ${emailVal}`;
    const emName = appt.emergencyContactName?.trim() || 'Not provided';
    const emRel = appt.emergencyRelationship?.trim() || 'Not provided';
    const emPhone = appt.emergencyContactPhone?.trim() || 'Not provided';
    const emText = `Emerg. Contact: ${emName}\nEmerg. Rel: ${emRel}\nEmerg. Phone: ${emPhone}`;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    const nameLines = doc.splitTextToSize(patientName, patientColWidth - 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    const metaLines = doc.splitTextToSize(`${appt.patientId}\n${phoneText}\n${emailText}\n${emText}`, patientColWidth - 4);

    const pTotalLines = nameLines.length + metaLines.length;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const dLines = doc.splitTextToSize(appt.doctorDiagnosis || 'Missed Appointment', 34);

    const maxLines = Math.max(pTotalLines, dLines.length, 1);
    const rowHeight = Math.max(maxLines * 3.1 + 2.5, 7.5);

    // Verify row height expands properly when emergency contact and email wrap
    if (i === 0) {
      assert.ok(metaLines.length >= 6, 'Meta lines must include PID, Phone, Email, and Emergency Contact fields');
      assert.ok(rowHeight >= 20, 'Row height must expand to accommodate emergency contact details');
    }

    doc.text(String(i + 1), margin, y);
    doc.text(nameLines[0], margin + 8, y);
    doc.text(historyStatusLabel(appt), margin + 55, y);
    doc.text(dLines[0], margin + 85, y);
    y += rowHeight;
  });

  // Footer & Page count
  const totalPages = doc.getNumberOfPages();
  assert.equal(totalPages, 1);
  doc.text(`Page 1 of ${totalPages}`, margin, 280);

  // Verify binary output is valid PDF
  const output = doc.output('arraybuffer');
  assert.ok(output.byteLength > 1000);
  const pdfHeader = Buffer.from(output.slice(0, 5)).toString('utf-8');
  assert.equal(pdfHeader, '%PDF-');
});
