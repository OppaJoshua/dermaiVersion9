import { test } from 'node:test';
import assert from 'node:assert/strict';

// Helper simulating emergency contact resolution logic from DoctorPatientHistoryPage modal
function resolveEmergencyContact(appt) {
  return {
    fullName: appt?.emergencyContactName?.trim() || "Not provided",
    relationship: appt?.emergencyRelationship?.trim() || "Not provided",
    contactNumber: appt?.emergencyContactPhone?.trim() || "Not provided",
  };
}

test('Scenario 1: Complete emergency contact displays all fields dynamically', () => {
  const appt = {
    id: 'appt-1',
    emergencyContactName: 'Maria Elena Calago',
    emergencyRelationship: 'Mother',
    emergencyContactPhone: '+63 917 123 4567',
  };

  const contact = resolveEmergencyContact(appt);
  assert.equal(contact.fullName, 'Maria Elena Calago');
  assert.equal(contact.relationship, 'Mother');
  assert.equal(contact.contactNumber, '+63 917 123 4567');
});

test('Scenario 2: Completely missing emergency contact displays "Not provided" for all fields', () => {
  const appt = {
    id: 'appt-2',
    emergencyContactName: null,
    emergencyRelationship: undefined,
    emergencyContactPhone: '',
  };

  const contact = resolveEmergencyContact(appt);
  assert.equal(contact.fullName, 'Not provided');
  assert.equal(contact.relationship, 'Not provided');
  assert.equal(contact.contactNumber, 'Not provided');
});

test('Scenario 3: Partially provided emergency contact handles missing fields gracefully', () => {
  const appt = {
    id: 'appt-3',
    emergencyContactName: 'Juan Dela Cruz',
    emergencyRelationship: 'Spouse',
    emergencyContactPhone: undefined, // Missing phone
  };

  const contact = resolveEmergencyContact(appt);
  assert.equal(contact.fullName, 'Juan Dela Cruz');
  assert.equal(contact.relationship, 'Spouse');
  assert.equal(contact.contactNumber, 'Not provided');
});

test('Scenario 4: Whitespace-only fields resolve to "Not provided"', () => {
  const appt = {
    id: 'appt-4',
    emergencyContactName: '   ',
    emergencyRelationship: '  \t  ',
    emergencyContactPhone: '',
  };

  const contact = resolveEmergencyContact(appt);
  assert.equal(contact.fullName, 'Not provided');
  assert.equal(contact.relationship, 'Not provided');
  assert.equal(contact.contactNumber, 'Not provided');
});

test('Scenario 5: Multiple consultations for same patient preserve their respective historical emergency contact', () => {
  // Historical consultation from 2025
  const appt2025 = {
    id: 'appt-old',
    date: '2025-06-15',
    emergencyContactName: 'Old Guardian Name',
    emergencyRelationship: 'Guardian',
    emergencyContactPhone: '09181112222',
  };

  // Recent consultation from 2026 with updated emergency contact
  const appt2026 = {
    id: 'appt-new',
    date: '2026-03-01',
    emergencyContactName: 'New Contact Name',
    emergencyRelationship: 'Sibling',
    emergencyContactPhone: '09193334444',
  };

  const contactOld = resolveEmergencyContact(appt2025);
  const contactNew = resolveEmergencyContact(appt2026);

  assert.equal(contactOld.fullName, 'Old Guardian Name');
  assert.equal(contactOld.relationship, 'Guardian');
  assert.equal(contactOld.contactNumber, '09181112222');

  assert.equal(contactNew.fullName, 'New Contact Name');
  assert.equal(contactNew.relationship, 'Sibling');
  assert.equal(contactNew.contactNumber, '09193334444');
});

test('Scenario 6: Different patients do not leak or share emergency contact data', () => {
  const patientAAppt = {
    id: 'appt-patient-a',
    patientName: 'Patient Alpha',
    emergencyContactName: 'Alpha Contact',
    emergencyRelationship: 'Parent',
    emergencyContactPhone: '09170000001',
  };

  const patientBAppt = {
    id: 'appt-patient-b',
    patientName: 'Patient Beta',
    // Missing emergency contact
  };

  const contactA = resolveEmergencyContact(patientAAppt);
  const contactB = resolveEmergencyContact(patientBAppt);

  assert.equal(contactA.fullName, 'Alpha Contact');
  assert.equal(contactB.fullName, 'Not provided');
});

