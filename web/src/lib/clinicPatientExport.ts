import { jsPDF } from "jspdf";
import { formatConfidencePercent } from "./utils";
import { sanitizePatientSymptoms } from "./appointmentPaymentService";
import { extractConsultationQuestionnaire } from "./consultationDetailsService";

/* ── Types ────────────────────────────────────────────────────────── */

export type ExportPatientAppointment = {
  id: string;
  dateStr: string;
  rawDate?: string;
  timeStr: string;
  status: string;
  checkInStatus?: string;
  doctorStatus?: string;
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  conditionName?: string;
  confidence?: number;
  skinPhotoUrl?: string;
  primaryScanId?: string;
  questionnaireAnswers?: Array<{
    question: string;
    answer: string;
    severity?: number;
    points?: number;
  }>;
  notes?: string;
  clinicNote?: string;
  doctorNote?: string;
  doctorReviewedAt?: string;
  createdAt: string;
  queueNumber?: number;
};

export type ExportClinicPatient = {
  id: string;
  userId?: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  gender?: string;
  birthdate?: string;
  age?: number;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyRelationship?: string;
  totalAppointments: number;
  lastAppointment?: ExportPatientAppointment;
  appointments: ExportPatientAppointment[];
  assignedDoctors: Array<{ id?: string; name: string }>;
  photoUrl?: string;
};

export interface ClinicExportMeta {
  clinicName?: string;
  clinicBranch?: string;
  clinicEmail?: string;
  clinicPhone?: string;
}

/* ── Helper Functions ─────────────────────────────────────────────── */

export function sanitizeCsvField(val: unknown): string {
  let str = String(val ?? "");
  // Neutralize formula injection including leading whitespace or control characters (=, +, -, @, \t, \r)
  if (/^[\s\t\r\n]*[=+\-@]/.test(str) || /^[\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export function formatContactForCsv(contact?: string): string {
  const trimmed = String(contact ?? "").trim();
  if (!trimmed) return "Not provided";
  // Prepend single quote if starts with 0 so spreadsheet tools preserve leading zero
  if (/^0/.test(trimmed) && !trimmed.startsWith("'")) {
    return `'${trimmed}`;
  }
  return trimmed;
}

export function formatPatientDisplayId(patient: ExportClinicPatient): string {
  // 1. Primary: If patient has registered user_id, derive deterministically from the UUID primary key
  if (patient.userId) {
    const raw = patient.userId.replace(/[^a-zA-Z0-9]/g, "");
    return `REF-${raw.slice(0, 8).toUpperCase()}`;
  }
  if (patient.id.startsWith("user:")) {
    const raw = patient.id.replace("user:", "").replace(/[^a-zA-Z0-9]/g, "");
    return `REF-${raw.slice(0, 8).toUpperCase()}`;
  }
  // 2. Secondary: If patient has appointment history, derive deterministically from earliest appointment UUID
  if (patient.appointments && patient.appointments.length > 0) {
    const earliestAppt = patient.appointments[patient.appointments.length - 1];
    if (earliestAppt?.id && !earliestAppt.id.startsWith("user:") && !earliestAppt.id.startsWith("email:")) {
      const rawAppt = earliestAppt.id.replace(/[^a-zA-Z0-9]/g, "");
      if (rawAppt.length >= 6) {
        return `REF-${rawAppt.slice(0, 8).toUpperCase()}`;
      }
    }
  }
  // 3. Fallback for phone-based identity
  if (patient.phone) {
    const digits = patient.phone.replace(/\D/g, "");
    if (digits.length >= 6) {
      return `REF-P${digits.slice(-6)}`;
    }
  }
  // 4. Fallback for email-based or name-based identity
  const cleanKey = patient.id.replace(/[^a-zA-Z0-9]/g, "");
  return `REF-${(cleanKey || patient.name.replace(/[^a-zA-Z0-9]/g, "") || "PTNT").slice(0, 8).toUpperCase()}`;
}

function formatStatusDisplay(status?: string, checkInStatus?: string, doctorStatus?: string): string {
  if (checkInStatus === "no-show" || status === "no-show") return "No-Show";
  if (status === "completed" || checkInStatus === "completed") return "Completed";
  if (status === "cancelled" || status === "rejected" || doctorStatus === "rejected") return "Cancelled";
  if (status === "scheduled" || status === "confirmed" || status === "accepted") return "Scheduled";
  return "Pending Review";
}

function sanitizeFileNamePart(str?: string): string {
  if (!str) return "Patient";
  return str.trim().replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
}

/* ── 1. Individual Patient Medical Record PDF Export ──────────────── */

export async function exportIndividualPatientPdf(
  patient: ExportClinicPatient,
  meta: ClinicExportMeta = {}
): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const maxY = pageHeight - 16; // 16mm bottom reserve for footer

  let y = margin;

  // Helper to check page break and append header if needed
  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > maxY) {
      doc.addPage();
      y = margin;
      renderSubsequentPageHeader();
    }
  };

  const renderSubsequentPageHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Patient Medical Summary — ${patient.name} (${formatPatientDisplayId(patient)})`, margin, y);

    const clinicDisplayName = meta.clinicName?.trim() || "DermAI Clinical Portal";
    doc.text(clinicDisplayName, margin + contentWidth, y, { align: "right" });

    y += 3;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, y, margin + contentWidth, y);
    y += 5;
  };

  // ── Header Branding ──────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(192, 22, 106); // DermAI Magenta
  doc.text("DermAI", margin, y + 2);

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("CLINICAL PATIENT RECORD", margin + 22, y + 2);

  const clinicName = meta.clinicName?.trim() || "Affiliated Partner Clinic";
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text(clinicName, margin + contentWidth, y + 2, { align: "right" });

  y += 7;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text("Patient Medical Summary", margin, y + 2);

  const nowManila = new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${nowManila} (PHT)`, margin + contentWidth, y + 2, { align: "right" });

  y += 6;

  // Top Divider
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + contentWidth, y);
  y += 4;

  // ── Confidentiality Notice Banner ────────────────────────────────
  doc.setFillColor(254, 242, 242); // Rose-50
  doc.roundedRect(margin, y, contentWidth, 7.5, 1.5, 1.5, "F");
  doc.setDrawColor(254, 205, 211); // Rose-200
  doc.roundedRect(margin, y, contentWidth, 7.5, 1.5, 1.5, "D");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(190, 18, 60);
  doc.text("CONFIDENTIAL MEDICAL RECORD", margin + 3, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(159, 18, 57);
  doc.text(
    "— For authorized clinical staff and attending physicians only. Unauthorized distribution is prohibited.",
    margin + 49,
    y + 5
  );

  y += 11;

  // ── Section 1: Patient Profile & Demographics Card ──────────────
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentWidth, 34, 2, 2, "F");
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 34, 2, 2, "D");

  // Section Header inside card
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text("1. PATIENT DEMOGRAPHICS & CONTACT INFORMATION", margin + 3.5, y + 5);

  const col1X = margin + 3.5;
  const col2X = margin + 65;
  const col3X = margin + 125;

  let row1Y = y + 11;
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("FULL NAME:", col1X, row1Y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(patient.name || "Patient", col1X + 18, row1Y);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("DISPLAY REF:", col2X, row1Y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(192, 22, 106);
  doc.text(formatPatientDisplayId(patient), col2X + 20, row1Y);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("GENDER & AGE:", col3X, row1Y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  const genderAge = `${patient.gender || "Not specified"}${patient.age ? ` (${patient.age} yrs)` : ""}`;
  doc.text(genderAge, col3X + 22, row1Y);

  let row2Y = y + 17;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("CONTACT NO:", col1X, row2Y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(patient.phone || "Not provided", col1X + 20, row2Y);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("EMAIL ADDRESS:", col2X, row2Y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(patient.email || "Not provided", col2X + 23, row2Y);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("DATE OF BIRTH:", col3X, row2Y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  const dobStr = patient.birthdate
    ? new Date(patient.birthdate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Not provided";
  doc.text(dobStr, col3X + 22, row2Y);

  let row3Y = y + 23;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("HOME ADDRESS:", col1X, row3Y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  const addressLines = doc.splitTextToSize(patient.address || "Not provided on record", contentWidth - 30);
  doc.text(addressLines[0] || "Not provided", col1X + 23, row3Y);

  let row4Y = y + 29;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("EMERGENCY CONTACT:", col1X, row4Y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  const emContact = patient.emergencyContactName
    ? `${patient.emergencyContactName} ${patient.emergencyRelationship ? `(${patient.emergencyRelationship})` : ""} — Tel: ${patient.emergencyContactPhone || "No phone"}`
    : "No emergency contact specified";
  doc.text(emContact, col1X + 31, row4Y);

  y += 38;

  // ── Section 2: Clinic Summary Metrics ────────────────────────────
  doc.setFillColor(253, 242, 248); // Pink-50
  doc.roundedRect(margin, y, contentWidth, 12, 1.5, 1.5, "F");
  doc.setDrawColor(251, 207, 232); // Pink-200
  doc.roundedRect(margin, y, contentWidth, 12, 1.5, 1.5, "D");

  const totalVisits = patient.appointments.length;
  const firstVisitDate = patient.appointments[totalVisits - 1]?.dateStr || "—";
  const latestVisitDate = patient.lastAppointment?.dateStr || "—";
  const uniqueDocNames = patient.assignedDoctors.map((d) => d.name).filter(Boolean).join(", ") || "Unassigned";

  const metricWidth = contentWidth / 4;

  const metrics = [
    { label: "Total Appointments", val: `${totalVisits} ${totalVisits === 1 ? "Appointment" : "Appointments"}` },
    { label: "First Appointment", val: firstVisitDate },
    { label: "Latest Appointment", val: latestVisitDate },
    { label: "Attending Doctors", val: uniqueDocNames },
  ];

  metrics.forEach((m, idx) => {
    const mx = margin + idx * metricWidth + 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(m.label.toUpperCase(), mx, y + 4);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    const valLines = doc.splitTextToSize(m.val, metricWidth - 4);
    doc.text(valLines[0] || "—", mx, y + 9);
  });

  y += 16;

  // ── Section 3: Consultation & Appointment History ────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`2. CLINIC APPOINTMENT HISTORY (${totalVisits} Recorded Appointments)`, margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("Ordered chronologically (Most recent appointment first)", margin + contentWidth, y, { align: "right" });

  y += 4;

  // Render each consultation in chronological descending order
  for (let idx = 0; idx < patient.appointments.length; idx++) {
    const appt = patient.appointments[idx];
    const visitNum = totalVisits - idx;
    const statusLabel = formatStatusDisplay(appt.status, appt.checkInStatus, appt.doctorStatus);

    // Calculate approximate height for this appointment block to avoid page break mid-card
    const symptomsText = sanitizePatientSymptoms(appt.notes) || "None reported by patient.";
    const doctorNotesText = appt.doctorNote?.trim() || "";
    const clinicRemarksText = appt.clinicNote?.trim() || "";
    const rawQa = (appt as any).questionnaireAnswers || (appt as any).questionnaire_answers;
    const qaList: Array<{ question: string; answer: string; severity?: number; points?: number }> =
      Array.isArray(rawQa) && rawQa.length > 0 && typeof rawQa[0] === "object" && "question" in rawQa[0] && "answer" in rawQa[0]
        ? rawQa
        : extractConsultationQuestionnaire(rawQa);
    const hasAiScan = Boolean(appt.conditionName || appt.skinPhotoUrl || (appt as any).primaryScanId);

    // Pre-calculate text wrapping
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const symptomLines = doc.splitTextToSize(`Symptoms: ${symptomsText}`, contentWidth - 8);
    const doctorLines = doctorNotesText ? doc.splitTextToSize(`Physician Diagnosis & Notes: ${doctorNotesText}`, contentWidth - 8) : [];
    const clinicLines = clinicRemarksText ? doc.splitTextToSize(`Clinic Remarks: ${clinicRemarksText}`, contentWidth - 8) : [];

    const estHeight = 28 + (symptomLines.length * 3) + (doctorLines.length * 3) + (clinicLines.length * 3) + (qaList.length > 0 ? 10 + Math.min(qaList.length, 5) * 3 : (hasAiScan ? 6 : 0));

    ensureSpace(Math.min(estHeight, 55)); // Ensure at least the top half fits on page

    // Card Container
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);

    // Header strip for this visit
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, contentWidth, 7, 1.5, 1.5, "F");
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, 7, 1.5, 1.5, "D");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(192, 22, 106);
    doc.text(`VISIT #${visitNum}`, margin + 3, y + 4.8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Date: ${appt.dateStr}   |   Time: ${appt.timeStr}`, margin + 22, y + 4.8);

    // Status Pill on right
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    if (statusLabel === "Completed") {
      doc.setTextColor(4, 120, 87);
    } else if (statusLabel === "No-Show" || statusLabel === "Cancelled") {
      doc.setTextColor(190, 18, 60);
    } else {
      doc.setTextColor(29, 78, 216);
    }
    doc.text(`Status: ${statusLabel}`, margin + contentWidth - 3, y + 4.8, { align: "right" });

    y += 9;

    // Doctor & Review info
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text("Attending Doctor:", margin + 3, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(appt.assignedDoctorName || "Unassigned", margin + 25, y);

    if (appt.doctorStatus) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text("Doctor Review Status:", margin + 90, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      const docReviewLabel = appt.doctorStatus === "approved" ? "Approved" : appt.doctorStatus === "rejected" ? "Declined" : "Pending";
      doc.text(docReviewLabel, margin + 118, y);
    }

    y += 5;

    // AI Pre-Consultation Screening Block
    if (appt.conditionName || appt.confidence !== undefined) {
      ensureSpace(12);
      doc.setFillColor(253, 242, 248);
      doc.roundedRect(margin + 3, y, contentWidth - 6, 8, 1, 1, "F");
      doc.setDrawColor(251, 207, 232);
      doc.roundedRect(margin + 3, y, contentWidth - 6, 8, 1, 1, "D");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(192, 22, 106);
      doc.text("AI PRE-CONSULTATION SCREENING (Preliminary Screening — Not a Confirmed Medical Diagnosis):", margin + 5, y + 3.5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(30, 41, 59);
      const confStr = appt.confidence !== undefined ? ` (Confidence: ${formatConfidencePercent(appt.confidence)})` : "";
      doc.text(`Detected Condition: ${appt.conditionName || "General Dermatology Consultation"}${confStr}`, margin + 5, y + 6.5);

      y += 10;
    }

    // Questionnaire Answers Summary if available
    if (qaList.length > 0) {
      ensureSpace(8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(71, 85, 105);
      doc.text(`Pre-Screening Questionnaire Responses (${qaList.length} items):`, margin + 3, y);
      y += 3.5;

      qaList.forEach((qa) => {
        ensureSpace(4);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        const qText = doc.splitTextToSize(`• ${qa.question}: `, 95);
        doc.text(qText[0] || "", margin + 5, y);

        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        const ansText = qa.severity !== undefined ? `${qa.answer} [Sev ${qa.severity}]` : qa.answer;
        const ansLines = doc.splitTextToSize(ansText, contentWidth - 105);
        doc.text(ansLines[0] || "", margin + 102, y);
        y += 3.2;
      });
      y += 1.5;
    } else if (hasAiScan) {
      ensureSpace(6);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184); // Slate-400
      doc.text("• No pre-screening questionnaire responses are available for this appointment.", margin + 5, y);
      y += 4;
    }

    // Patient Symptoms
    ensureSpace(symptomLines.length * 3 + 3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text("PATIENT-REPORTED SYMPTOMS:", margin + 3, y);
    y += 3;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(15, 23, 42);
    symptomLines.forEach((sLine: string) => {
      doc.text(sLine, margin + 5, y);
      y += 3;
    });

    // Attending Physician Clinical Notes & Diagnosis
    if (doctorNotesText) {
      ensureSpace(doctorLines.length * 3 + 3);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(30, 58, 138); // Blue-900
      doc.text("ATTENDING PHYSICIAN CLINICAL DIAGNOSIS & NOTES:", margin + 3, y);
      y += 3;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doctorLines.forEach((dLine: string) => {
        doc.text(dLine, margin + 5, y);
        y += 3;
      });
    }

    // Clinic Remarks
    if (clinicRemarksText) {
      ensureSpace(clinicLines.length * 3 + 3);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text("CLINIC SCHEDULING REMARKS:", margin + 3, y);
      y += 3;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      clinicLines.forEach((cLine: string) => {
        doc.text(cLine, margin + 5, y);
        y += 3;
      });
    }

    // Border line between visits
    y += 2;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, y, margin + contentWidth, y);
    y += 5;
  }

  // ── Document Footers & Page Numbering across all pages ───────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    // Footer divider line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 11, margin + contentWidth, pageHeight - 11);

    // Left disclaimer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      "CONFIDENTIAL MEDICAL RECORD — Generated from DermAI Clinical Portal. Authorized clinic personnel use only.",
      margin,
      pageHeight - 6.5
    );

    // Right page number
    doc.text(`Page ${p} of ${totalPages}`, margin + contentWidth, pageHeight - 6.5, { align: "right" });
  }

  // Generate clean filename
  const patientSlug = sanitizeFileNamePart(patient.name);
  const dateSlug = new Date().toISOString().split("T")[0];
  const filename = `DermAI_Patient_Record_${patientSlug}_${dateSlug}.pdf`;

  doc.save(filename);
}

/* ── 2. Clinic Patient Directory CSV Export ────────────────────────── */

export function exportPatientDirectoryCsv(
  patients: ExportClinicPatient[],
  clinicName?: string
): void {
  if (!patients || patients.length === 0) return;

  const headers = [
    "Patient Display Reference",
    "Full Name",
    "Email Address",
    "Contact Number",
    "Gender",
    "Date of Birth",
    "Age",
    "Home Address",
    "Emergency Contact Name",
    "Emergency Contact Relationship",
    "Emergency Contact Phone",
    "Total Appointments",
    "First Appointment Date",
    "Latest Appointment Date",
    "Latest Appointment Time",
    "Latest Appointment Status",
    "Latest Attending Doctor",
    "All Attending Doctors at Clinic",
  ];

  const rows = patients.map((patient) => {
    const totalVisits = patient.appointments.length;
    const firstVisit = patient.appointments[totalVisits - 1];
    const latestVisit = patient.lastAppointment;

    const allDocs = patient.assignedDoctors.map((d) => d.name).filter(Boolean).join("; ");
    const latestStatus = latestVisit
      ? formatStatusDisplay(latestVisit.status, latestVisit.checkInStatus, latestVisit.doctorStatus)
      : "No Appointments";

    return [
      sanitizeCsvField(formatPatientDisplayId(patient)),
      sanitizeCsvField(patient.name || "Not provided"),
      sanitizeCsvField(patient.email || "Not provided"),
      sanitizeCsvField(formatContactForCsv(patient.phone)),
      sanitizeCsvField(patient.gender || "Not specified"),
      sanitizeCsvField(patient.birthdate || "Not provided"),
      sanitizeCsvField(patient.age !== undefined ? String(patient.age) : "Not specified"),
      sanitizeCsvField(patient.address || "Not provided"),
      sanitizeCsvField(patient.emergencyContactName || "Not provided"),
      sanitizeCsvField(patient.emergencyRelationship || "Not provided"),
      sanitizeCsvField(formatContactForCsv(patient.emergencyContactPhone)),
      sanitizeCsvField(String(patient.totalAppointments || totalVisits)),
      sanitizeCsvField(firstVisit?.dateStr || "—"),
      sanitizeCsvField(latestVisit?.dateStr || "—"),
      sanitizeCsvField(latestVisit?.timeStr || "—"),
      sanitizeCsvField(latestStatus),
      sanitizeCsvField(latestVisit?.assignedDoctorName || "Unassigned"),
      sanitizeCsvField(allDocs || "Unassigned"),
    ];
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");

  const clinicSlug = sanitizeFileNamePart(clinicName || "Clinic");
  const dateSlug = new Date().toISOString().split("T")[0];
  const filename = `DermAI_Patient_Directory_${clinicSlug}_${dateSlug}.csv`;

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
