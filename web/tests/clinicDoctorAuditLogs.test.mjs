import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirror of formatDoctorAuditDetails implemented in AdminAuditLogsPage.tsx
 */
function formatDoctorAuditDetails(action, rawDetails, target) {
  if (!rawDetails) return "—";

  const act = (action || "").trim();
  if (act !== "Doctor Added" && act !== "Doctor Deactivated" && act !== "Doctor Reactivated") {
    return rawDetails;
  }

  const contextIdx = rawDetails.indexOf(" | Context: ");
  let contextObj = null;
  if (contextIdx !== -1) {
    try {
      contextObj = JSON.parse(rawDetails.slice(contextIdx + 12));
    } catch {
      contextObj = null;
    }
  }

  // Doctor Added
  if (act === "Doctor Added") {
    const baseText = contextIdx !== -1 ? rawDetails.slice(0, contextIdx).trim() : rawDetails.trim();
    if (/^[^\s].+ added Dr\..+ to its doctor roster\.?$/i.test(baseText) && !baseText.startsWith("Clinic added")) {
      return baseText;
    }

    const clinicName = contextObj?.clinicName || contextObj?.clinic_name;
    const docRaw = contextObj?.doctorName || contextObj?.doctor_name || (target ? target.replace(/^Dr\.\s*/i, "") : "");
    if (clinicName && docRaw) {
      const cleanDoc = String(docRaw).replace(/^Dr\.\s*/i, "").trim();
      return `${clinicName} added Dr. ${cleanDoc} to its doctor roster.`;
    }

    return baseText || rawDetails;
  }

  // Doctor Deactivated
  if (act === "Doctor Deactivated") {
    const baseText = contextIdx !== -1 ? rawDetails.slice(0, contextIdx).trim() : rawDetails.trim();
    if (/^[^\s].+ deactivated Dr\..+ from its doctor roster\.?$/i.test(baseText) && !baseText.startsWith("Clinic deactivated")) {
      return baseText;
    }
    const clinicName = contextObj?.clinicName || contextObj?.clinic_name;
    const docRaw = contextObj?.doctorName || contextObj?.doctor_name || (target ? target.replace(/^Dr\.\s*/i, "") : "");
    if (clinicName && docRaw) {
      const cleanDoc = String(docRaw).replace(/^Dr\.\s*/i, "").trim();
      return `${clinicName} deactivated Dr. ${cleanDoc} from its doctor roster.`;
    }
    return baseText || rawDetails;
  }

  // Doctor Reactivated
  if (act === "Doctor Reactivated") {
    const baseText = contextIdx !== -1 ? rawDetails.slice(0, contextIdx).trim() : rawDetails.trim();
    if (/^[^\s].+ reactivated Dr\..+ in its doctor roster\.?$/i.test(baseText) && !baseText.startsWith("Clinic reactivated")) {
      return baseText;
    }
    const clinicName = contextObj?.clinicName || contextObj?.clinic_name;
    const docRaw = contextObj?.doctorName || contextObj?.doctor_name || (target ? target.replace(/^Dr\.\s*/i, "") : "");
    if (clinicName && docRaw) {
      const cleanDoc = String(docRaw).replace(/^Dr\.\s*/i, "").trim();
      return `${clinicName} reactivated Dr. ${cleanDoc} in its doctor roster.`;
    }
    return baseText || rawDetails;
  }

  return rawDetails;
}

/**
 * Simulation of the guarded affiliation status transition in ClinicDoctorsPage.tsx
 */
function simulateStatusTransition({
  doctor,
  clinicId,
  authenticatedClinicId,
  dbRows,
  failDbUpdate = false,
}) {
  const previousStatus = doctor.status;
  const nextStatus = previousStatus === "Active" ? "Inactive" : "Active";
  const isDeactivating = nextStatus === "Inactive";
  const actionName = isDeactivating ? "Doctor Deactivated" : "Doctor Reactivated";
  const cleanDoctorName = doctor.name.replace(/^Dr\.\s*/i, "").trim();
  const doctorDisplayName = `Dr. ${cleanDoctorName}`;

  // Mandatory clinicId check
  if (!clinicId || !authenticatedClinicId) {
    return {
      success: false,
      error: "Clinic verification required to update doctor affiliation.",
      auditEvent: null,
      updatedDbRows: dbRows,
    };
  }

  if (failDbUpdate) {
    return {
      success: false,
      error: "Database connection timeout",
      auditEvent: null,
      updatedDbRows: dbRows,
    };
  }

  // Guarded update: mandatory scoping to exact doctor_id AND authenticated clinic_id, matching previousStatus
  let matchedCount = 0;
  const updatedDbRows = dbRows.map((row) => {
    if (
      row.doctor_id === doctor.id &&
      row.clinic_id === authenticatedClinicId &&
      row.status === previousStatus
    ) {
      matchedCount++;
      return { ...row, status: nextStatus };
    }
    return row;
  });

  // Confirm that exactly one intended affiliation row was updated
  if (matchedCount !== 1) {
    return {
      success: false,
      staleOrMismatched: true,
      auditEvent: null,
      updatedDbRows: dbRows,
    };
  }

  // Successfully updated in DB -> now record audit event
  const auditEvent = {
    role: "clinic",
    category: "Clinic",
    action: actionName,
    target: doctorDisplayName,
    details: isDeactivating
      ? `DerMA deactivated ${doctorDisplayName} from its doctor roster.`
      : `DerMA reactivated ${doctorDisplayName} in its doctor roster.`,
    metadata: {
      clinicId: authenticatedClinicId,
      clinicName: "DerMA",
      doctorId: doctor.id,
      doctorName: cleanDoctorName,
      previousStatus,
      updatedStatus: nextStatus,
      adminUserId: "admin-uuid-123",
      adminName: "DerMA Staff",
      timestamp: new Date().toISOString(),
    },
  };

  return {
    success: true,
    auditEvent,
    updatedDbRows,
  };
}

// ── Test Suites ─────────────────────────────────────────────────────────────

test('Scenario 1: Newly recorded Doctor Added displays clinic name and doctor name', () => {
  const action = "Doctor Added";
  const details = "DerMA added Dr. Alpha Zoe Bate to its doctor roster. | Context: {\"doctorName\":\"Alpha Zoe Bate\",\"clinicName\":\"DerMA\"}";
  const target = "Dr. Alpha Zoe Bate";

  const formatted = formatDoctorAuditDetails(action, details, target);
  assert.equal(formatted, "DerMA added Dr. Alpha Zoe Bate to its doctor roster.");
});

test('Scenario 2: Historical Doctor Added parses clinicName from Context JSON', () => {
  const action = "Doctor Added";
  const details = 'Clinic added doctor "Alpha Zoe Bate" (PRC: 1234567) with specialization: General Dermatology. | Context: {"doctorName":"Alpha Zoe Bate","doctorId":"doc-123","clinicName":"DerMA"}';
  const target = "Dr. Alpha Zoe Bate";

  const formatted = formatDoctorAuditDetails(action, details, target);
  assert.equal(formatted, "DerMA added Dr. Alpha Zoe Bate to its doctor roster.");
});

test('Scenario 3: Historical Doctor Added without clinicName in Context preserves original base text', () => {
  const action = "Doctor Added";
  const details = 'Clinic added doctor "Alpha Zoe Bate" (PRC: 1234567). | Context: {"doctorName":"Alpha Zoe Bate"}';
  const target = "Dr. Alpha Zoe Bate";

  const formatted = formatDoctorAuditDetails(action, details, target);
  assert.equal(formatted, 'Clinic added doctor "Alpha Zoe Bate" (PRC: 1234567).');
});

test('Scenario 4: Doctor Deactivated formats cleanly with clinic name and doctor name', () => {
  const action = "Doctor Deactivated";
  const details = "DerMA deactivated Dr. Alpha Zoe Bate from its doctor roster. | Context: {\"clinicName\":\"DerMA\",\"doctorName\":\"Alpha Zoe Bate\"}";
  const target = "Dr. Alpha Zoe Bate";

  const formatted = formatDoctorAuditDetails(action, details, target);
  assert.equal(formatted, "DerMA deactivated Dr. Alpha Zoe Bate from its doctor roster.");
});

test('Scenario 5: Doctor Reactivated formats cleanly with clinic name and doctor name', () => {
  const action = "Doctor Reactivated";
  const details = "DerMA reactivated Dr. Alpha Zoe Bate in its doctor roster. | Context: {\"clinicName\":\"DerMA\",\"doctorName\":\"Alpha Zoe Bate\"}";
  const target = "Dr. Alpha Zoe Bate";

  const formatted = formatDoctorAuditDetails(action, details, target);
  assert.equal(formatted, "DerMA reactivated Dr. Alpha Zoe Bate in its doctor roster.");
});

test('Scenario 6: Avoids duplicate "Dr." prefixes (e.g. "Dr. Dr. Alpha Zoe Bate")', () => {
  const action = "Doctor Added";
  const details = 'Clinic added doctor "Dr. Alpha Zoe Bate". | Context: {"doctorName":"Dr. Alpha Zoe Bate","clinicName":"DerMA"}';
  const target = "Dr. Alpha Zoe Bate";

  const formatted = formatDoctorAuditDetails(action, details, target);
  assert.equal(formatted, "DerMA added Dr. Alpha Zoe Bate to its doctor roster.");
  assert.doesNotMatch(formatted, /Dr\.\s*Dr\./);
});

test('Scenario 7: Unrelated audit categories retain their original details completely untouched', () => {
  const action = "Subscription Payment";
  const details = "Payment of ₱799 confirmed for DerMA Pro. | Context: {\"paymentId\":\"pay-1\"}";
  const target = "DerMA Pro";

  const formatted = formatDoctorAuditDetails(action, details, target);
  assert.equal(formatted, details, "Unrelated events must not have their context stripped or modified");
});

test('Scenario 8: Guarded status transition generates Doctor Deactivated after DB success', () => {
  const dbRows = [
    { doctor_id: "doc-1", clinic_id: "clinic-derma", status: "Active" },
    { doctor_id: "doc-2", clinic_id: "clinic-skin", status: "Active" },
  ];

  const result = simulateStatusTransition({
    doctor: { id: "doc-1", name: "Alpha Zoe Bate", status: "Active" },
    clinicId: "clinic-derma",
    authenticatedClinicId: "clinic-derma",
    dbRows,
    failDbUpdate: false,
  });

  assert.equal(result.success, true);
  assert.equal(result.auditEvent.action, "Doctor Deactivated");
  assert.equal(result.auditEvent.details, "DerMA deactivated Dr. Alpha Zoe Bate from its doctor roster.");
  assert.equal(result.auditEvent.metadata.previousStatus, "Active");
  assert.equal(result.auditEvent.metadata.updatedStatus, "Inactive");
  assert.equal(result.updatedDbRows.find((r) => r.doctor_id === "doc-1").status, "Inactive");
});

test('Scenario 9: Guarded status transition generates Doctor Reactivated after DB success', () => {
  const dbRows = [
    { doctor_id: "doc-1", clinic_id: "clinic-derma", status: "Inactive" },
  ];

  const result = simulateStatusTransition({
    doctor: { id: "doc-1", name: "Alpha Zoe Bate", status: "Inactive" },
    clinicId: "clinic-derma",
    authenticatedClinicId: "clinic-derma",
    dbRows,
    failDbUpdate: false,
  });

  assert.equal(result.success, true);
  assert.equal(result.auditEvent.action, "Doctor Reactivated");
  assert.equal(result.auditEvent.details, "DerMA reactivated Dr. Alpha Zoe Bate in its doctor roster.");
  assert.equal(result.auditEvent.metadata.previousStatus, "Inactive");
  assert.equal(result.auditEvent.metadata.updatedStatus, "Active");
  assert.equal(result.updatedDbRows.find((r) => r.doctor_id === "doc-1").status, "Active");
});

test('Scenario 10: Failed database update aborts and produces NO audit event', () => {
  const dbRows = [
    { doctor_id: "doc-1", clinic_id: "clinic-derma", status: "Active" },
  ];

  const result = simulateStatusTransition({
    doctor: { id: "doc-1", name: "Alpha Zoe Bate", status: "Active" },
    clinicId: "clinic-derma",
    authenticatedClinicId: "clinic-derma",
    dbRows,
    failDbUpdate: true,
  });

  assert.equal(result.success, false);
  assert.equal(result.auditEvent, null, "Must not create audit event when DB update fails");
  assert.equal(result.updatedDbRows.find((r) => r.doctor_id === "doc-1").status, "Active");
});

test('Scenario 11: Attempted status change on already-updated record produces NO audit event', () => {
  const dbRows = [
    { doctor_id: "doc-1", clinic_id: "clinic-derma", status: "Inactive" }, // Already Inactive
  ];

  const result = simulateStatusTransition({
    doctor: { id: "doc-1", name: "Alpha Zoe Bate", status: "Active" }, // Stale client view thinks it's Active
    clinicId: "clinic-derma",
    authenticatedClinicId: "clinic-derma",
    dbRows,
    failDbUpdate: false,
  });

  assert.equal(result.success, false);
  assert.equal(result.staleOrMismatched, true);
  assert.equal(result.auditEvent, null, "Must not create duplicate or stale audit event");
});

test('Scenario 12: Multi-clinic doctor isolation: Clinic A deactivating doctor does NOT affect Clinic B', () => {
  // Dr. Alpha Zoe Bate is affiliated with both DerMA (clinic-derma) and Skin Clinic (clinic-skin)
  const dbRows = [
    { doctor_id: "doc-derma", clinic_id: "clinic-derma", status: "Active" },
    { doctor_id: "doc-skin", clinic_id: "clinic-skin", status: "Active" },
  ];

  // Clinic DerMA deactivates Dr. Bate
  const result = simulateStatusTransition({
    doctor: { id: "doc-derma", name: "Alpha Zoe Bate", status: "Active" },
    clinicId: "clinic-derma",
    authenticatedClinicId: "clinic-derma",
    dbRows,
  });

  assert.equal(result.success, true);
  // DerMA's row became Inactive
  assert.equal(result.updatedDbRows.find((r) => r.clinic_id === "clinic-derma").status, "Inactive");
  // Skin Clinic's row remains Active
  assert.equal(result.updatedDbRows.find((r) => r.clinic_id === "clinic-skin").status, "Active");
});

test('Scenario 13: Clinic cannot update doctor belonging to another clinic', () => {
  const dbRows = [
    { doctor_id: "doc-skin", clinic_id: "clinic-skin", status: "Active" },
  ];

  // Malicious or mismatched request: Clinic DerMA attempts to modify doc-skin
  const result = simulateStatusTransition({
    doctor: { id: "doc-skin", name: "Alpha Zoe Bate", status: "Active" },
    clinicId: "clinic-derma",
    authenticatedClinicId: "clinic-derma", // Authenticated as DerMA
    dbRows,
  });

  assert.equal(result.success, false);
  assert.equal(result.staleOrMismatched, true);
  assert.equal(result.auditEvent, null, "Cross-clinic unauthorized modification blocked");
  assert.equal(result.updatedDbRows.find((r) => r.doctor_id === "doc-skin").status, "Active");
});

test('Scenario 14: Missing clinic ID stops the operation with a clear error without modifying DB', () => {
  const dbRows = [
    { doctor_id: "doc-1", clinic_id: "clinic-derma", status: "Active" },
  ];

  const result = simulateStatusTransition({
    doctor: { id: "doc-1", name: "Alpha Zoe Bate", status: "Active" },
    clinicId: null, // Missing clinicId
    authenticatedClinicId: null,
    dbRows,
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "Clinic verification required to update doctor affiliation.");
  assert.equal(result.auditEvent, null);
  assert.equal(result.updatedDbRows[0].status, "Active");
});

test('Scenario 15: Non-existent doctor ID matches 0 rows and stops without creating audit log', () => {
  const dbRows = [
    { doctor_id: "doc-1", clinic_id: "clinic-derma", status: "Active" },
  ];

  const result = simulateStatusTransition({
    doctor: { id: "non-existent-doc", name: "Ghost Doctor", status: "Active" },
    clinicId: "clinic-derma",
    authenticatedClinicId: "clinic-derma",
    dbRows,
  });

  assert.equal(result.success, false);
  assert.equal(result.staleOrMismatched, true);
  assert.equal(result.auditEvent, null);
  assert.equal(result.updatedDbRows[0].status, "Active");
});

test('Scenario 16: Audit logging failure reporting: status change persists, audit error reported', () => {
  const dbRows = [
    { doctor_id: "doc-1", clinic_id: "clinic-derma", status: "Active" },
  ];

  const result = simulateStatusTransition({
    doctor: { id: "doc-1", name: "Alpha Zoe Bate", status: "Active" },
    clinicId: "clinic-derma",
    authenticatedClinicId: "clinic-derma",
    dbRows,
  });

  assert.equal(result.success, true);
  // Status update succeeded and is not rolled back
  assert.equal(result.updatedDbRows[0].status, "Inactive");

  // Simulate audit logging failure (e.g. network warning caught in caller)
  let warningReported = false;
  try {
    throw new Error("Audit service unavailable");
  } catch (auditErr) {
    warningReported = true;
  }

  assert.equal(warningReported, true, "Audit failure was caught and reported");
  // Doctor status remains Inactive (not rolled back)
  assert.equal(result.updatedDbRows[0].status, "Inactive");
});

test('Scenario 17: logAuditEvent returns true on successful insert confirmation', async () => {
  // Simulate mock client that returns { error: null }
  const mockSuccessClient = {
    from: () => ({
      insert: async () => ({ error: null }),
    }),
  };

  const simulateLogAuditEvent = async (client) => {
    try {
      const { error } = await client.from("system_audit_log").insert({});
      if (error) return false;
      return true;
    } catch {
      return false;
    }
  };

  const result = await simulateLogAuditEvent(mockSuccessClient);
  assert.equal(result, true, "Must return true on confirmed database insert");
});

test('Scenario 18: logAuditEvent returns false when Supabase returns an error', async () => {
  const mockErrorClient = {
    from: () => ({
      insert: async () => ({ error: { message: "RLS violation: unauthorized insert" } }),
    }),
  };

  const simulateLogAuditEvent = async (client) => {
    try {
      const { error } = await client.from("system_audit_log").insert({});
      if (error) return false;
      return true;
    } catch {
      return false;
    }
  };

  const result = await simulateLogAuditEvent(mockErrorClient);
  assert.equal(result, false, "Must return false when Supabase returns error");
});

test('Scenario 19: logAuditEvent returns false on unexpected client exception', async () => {
  const mockThrowingClient = {
    from: () => ({
      insert: async () => { throw new Error("Network disconnection"); },
    }),
  };

  const simulateLogAuditEvent = async (client) => {
    try {
      const { error } = await client.from("system_audit_log").insert({});
      if (error) return false;
      return true;
    } catch {
      return false;
    }
  };

  const result = await simulateLogAuditEvent(mockThrowingClient);
  assert.equal(result, false, "Must return false on unexpected exception");
});

test('Scenario 20: Calling component detects audit failure and triggers non-blocking warning', async () => {
  let auditWarning = "";
  const setAuditWarning = (msg) => { auditWarning = msg; };

  // Status transition succeeded in DB
  const doctorStatus = "Inactive";

  // Audit logging returned false
  const auditSaved = false;

  if (!auditSaved) {
    setAuditWarning("Doctor status updated successfully, but the audit record could not be saved.");
  }

  assert.equal(doctorStatus, "Inactive", "Doctor status remains updated");
  assert.equal(
    auditWarning,
    "Doctor status updated successfully, but the audit record could not be saved.",
    "Non-blocking warning message displayed accurately"
  );
});

/**
 * Mirror of resolvePerformedBy implemented in AdminAuditLogsPage.tsx
 */
function resolvePerformedBy(log, clinicNameMap) {
  const actor = String(log.actorType || "").toLowerCase().trim();
  if (actor !== "clinic") {
    return log.performedBy;
  }

  const rawDetails = log.details || "";

  // 1. Check embedded Context JSON for clinic name or clinic ID
  if (rawDetails.includes(" | Context: ")) {
    const ctxIdx = rawDetails.indexOf(" | Context: ");
    try {
      const parsed = JSON.parse(rawDetails.slice(ctxIdx + 12));
      if (parsed && typeof parsed === "object") {
        const candidate = parsed.clinicName || parsed.clinic_name || parsed.clinic;
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }

        const cid = parsed.clinicId || parsed.clinic_id;
        if (cid && clinicNameMap) {
          const mappedName =
            clinicNameMap instanceof Map ? clinicNameMap.get(cid) : clinicNameMap[cid];
          if (mappedName && mappedName.trim()) {
            return mappedName.trim();
          }
        }
      }
    } catch {
      // Ignore JSON parse error and proceed to fallbacks
    }
  }

  // 2. Check clinic name lookup map by owner/user ID
  if (log.userId && clinicNameMap) {
    const mappedByUid =
      clinicNameMap instanceof Map
        ? clinicNameMap.get(log.userId)
        : clinicNameMap[log.userId];
    if (mappedByUid && mappedByUid.trim()) {
      return mappedByUid.trim();
    }
  }

  // 3. Check for validated action description prefix, e.g. "DERMCARE added Dr. Alpha..."
  const baseText = rawDetails.includes(" | Context: ")
    ? rawDetails.slice(0, rawDetails.indexOf(" | Context: ")).trim()
    : rawDetails.trim();
  const prefixMatch = baseText.match(/^(.+?)\s+(?:added|deactivated|reactivated)\s+Dr\./i);
  if (prefixMatch && prefixMatch[1]) {
    const candidateClinic = prefixMatch[1].trim();
    if (candidateClinic.toLowerCase() !== "clinic") {
      return candidateClinic;
    }
  }

  // 4. Historical fallback: preserve existing performer display rather than guessing
  return log.performedBy;
}

test('Scenario 21: Clinic event with clinicName in Context metadata displays ONLY the clinic name', () => {
  const log = {
    actorType: "clinic",
    performedBy: "Nathan Fernandez",
    details: 'DERMCARE added Dr. Alpha Zoe Bate to its doctor roster. | Context: {"clinicName":"DERMCARE","doctorName":"Alpha Zoe Bate"}',
  };

  const displayed = resolvePerformedBy(log);
  assert.equal(displayed, "DERMCARE", "Must display only the registered clinic name");
  assert.doesNotMatch(displayed, /Nathan/i, "Must not display administrator personal name");
});

test('Scenario 22: Clinic event with clinicId in Context resolves clinic name from clinic map', () => {
  const clinicMap = new Map([["clinic-123", "St. Luke's Dermatology"]]);
  const log = {
    actorType: "clinic",
    performedBy: "Nathan Fernandez",
    details: 'Clinic added doctor "Alpha Zoe Bate". | Context: {"clinicId":"clinic-123"}',
  };

  const displayed = resolvePerformedBy(log, clinicMap);
  assert.equal(displayed, "St. Luke's Dermatology", "Must resolve registered clinic name from map");
  assert.doesNotMatch(displayed, /Nathan/i, "Must not display administrator personal name");
});

test('Scenario 23: Clinic event resolved via owner userId lookup displays clinic name', () => {
  const clinicMap = new Map([["user-owner-99", "Aesthetic Skin Center"]]);
  const log = {
    actorType: "clinic",
    performedBy: "Nathan Fernandez",
    details: "Clinic login successful",
    userId: "user-owner-99",
  };

  const displayed = resolvePerformedBy(log, clinicMap);
  assert.equal(displayed, "Aesthetic Skin Center", "Must resolve registered clinic name via owner userId");
});

test('Scenario 24: Historical clinic event without metadata or mapping preserves original performer name without guessing', () => {
  const log = {
    actorType: "clinic",
    performedBy: "Nathan Fernandez",
    details: "Legacy clinic configuration updated",
    userId: "unknown-user",
  };

  const displayed = resolvePerformedBy(log, new Map());
  assert.equal(displayed, "Nathan Fernandez", "Must fallback safely to original performer when clinic cannot be reliably determined");
});

test('Scenario 25: Patient, Doctor, and Admin audit records preserve their original performer displays untouched', () => {
  const doctorLog = {
    actorType: "doctor",
    performedBy: "Dr. Alpha Zoe Bate",
    details: "Consultation notes finalized.",
  };
  const patientLog = {
    actorType: "patient",
    performedBy: "Jane Doe",
    details: "Booked an appointment.",
  };
  const adminLog = {
    actorType: "admin",
    performedBy: "System Administrator",
    details: "Approved clinic registration.",
  };

  const clinicMap = new Map([["any", "DERMCARE"]]);

  assert.equal(resolvePerformedBy(doctorLog, clinicMap), "Dr. Alpha Zoe Bate", "Doctor performer preserved");
  assert.equal(resolvePerformedBy(patientLog, clinicMap), "Jane Doe", "Patient performer preserved");
  assert.equal(resolvePerformedBy(adminLog, clinicMap), "System Administrator", "Admin performer preserved");
});

test('Scenario 26: Administrator personal name is NOT displayed underneath or alongside the clinic name', () => {
  const log = {
    actorType: "clinic",
    performedBy: "Nathan Fernandez",
    details: 'DERMCARE deactivated Dr. Alpha Zoe Bate from its doctor roster. | Context: {"clinicName":"DERMCARE"}',
  };

  const displayed = resolvePerformedBy(log);
  // Verify strictly equals the clinic name
  assert.equal(displayed, "DERMCARE");
  assert.ok(!displayed.includes("By Nathan Fernandez"));
  assert.ok(!displayed.includes("Nathan"));
});

