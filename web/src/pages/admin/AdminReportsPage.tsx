
import { useMemo, useState, useEffect, useCallback } from "react";
import { RefreshCw, CalendarDays, CheckCircle2, Clock, XCircle, Building2, Download, FileText } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

type ReportType =
  | "Skin Analysis Report"
  | "Clinic Verification Report"
  | "User Activity Log"
  | "Appointment Report"
  | "Completed Consultation Report";

type Row = Record<string, string | number>;

type GeneratedReport = {
  title: string;
  rows: Row[];
  columns: string[];
  filename: string;
};

const reportTypes: ReportType[] = [
  "Skin Analysis Report",
  "Clinic Verification Report",
  "User Activity Log",
  "Appointment Report",
  "Completed Consultation Report",
];

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isWithinRange(dateValue: string, fromDate: string, toDate: string): boolean {
  if (!fromDate && !toDate) return true;
  const value = parseDate(dateValue);
  if (!value) return true;

  const from = fromDate ? parseDate(fromDate) : null;
  const to = toDate ? parseDate(toDate) : null;

  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function extractDoctorDiagnosis(doctorNote?: string | null, explicitDiagnosis?: string | null): string {
  if (explicitDiagnosis && explicitDiagnosis.trim()) {
    return explicitDiagnosis.trim();
  }
  if (!doctorNote || !doctorNote.trim()) return "";
  const match = doctorNote.match(/^Diagnosis:\s*([^|\n]+)(?:[|\n]\s*(?:Note:\s*)?(.*))?$/is);
  if (match && match[1]?.trim()) {
    return match[1].trim();
  }
  return doctorNote.trim();
}

function formatDoctorDisplayName(raw: string | null | undefined): string {
  if (!raw) return "—";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—" || trimmed.toLowerCase() === "unassigned") {
    return trimmed || "—";
  }
  if (/^dr\.?\s*/i.test(trimmed)) {
    return trimmed.replace(/^dr\.?\s*/i, "Dr. ");
  }
  return `Dr. ${trimmed}`;
}

function resolvePatientContact(appt: any, joinedUser: any, matchedUser: any): string {
  const phone =
    appt?.patient_contact ||
    appt?.patientContact ||
    joinedUser?.phone ||
    joinedUser?.phone_number ||
    joinedUser?.contact_number ||
    matchedUser?.phone ||
    matchedUser?.phone_number ||
    matchedUser?.contact_number;

  if (phone && String(phone).trim()) {
    return String(phone).trim();
  }

  const uid = appt?.user_id || joinedUser?.user_id || matchedUser?.user_id;
  if (uid) {
    try {
      const cached = localStorage.getItem(`derm_profile_${uid}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        const cp = parsed?.phone || parsed?.phoneNumber || parsed?.contactNumber;
        if (cp && String(cp).trim()) return String(cp).trim();
      }
    } catch {}
  }

  return "—";
}

function resolvePatientAddress(appt: any, joinedUser: any, matchedUser: any): string {
  const addr =
    appt?.patient_address ||
    appt?.patientAddress ||
    joinedUser?.address ||
    matchedUser?.address;

  if (addr && String(addr).trim()) {
    return String(addr).trim();
  }

  const dist = joinedUser?.district || matchedUser?.district;
  if (dist && String(dist).trim()) {
    return `${String(dist).trim()}, Cebu`;
  }

  const uid = appt?.user_id || joinedUser?.user_id || matchedUser?.user_id;
  if (uid) {
    try {
      const cached = localStorage.getItem(`derm_profile_${uid}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        const ca = parsed?.address || parsed?.district;
        if (ca && String(ca).trim()) return String(ca).trim();
      }
    } catch {}
  }

  return "—";
}

function formatAiSkinAnalysis(
  conditionName?: string | null,
  confidence?: number | string | null,
  isDirectConsultation?: boolean
): string {
  if (isDirectConsultation) return "N/A";
  const cleanedCondition = (conditionName || "").trim();
  const lower = cleanedCondition.toLowerCase();
  if (
    !cleanedCondition ||
    lower === "n/a" ||
    lower.includes("direct consultation") ||
    lower.includes("no ai") ||
    lower === "general consultation" ||
    lower === "general dermatology"
  ) {
    return "N/A";
  }

  const numericConfidence =
    confidence !== undefined && confidence !== null && confidence !== ""
      ? Number(confidence)
      : NaN;

  if (Number.isFinite(numericConfidence) && numericConfidence > 0) {
    const normalizedScore =
      numericConfidence <= 1 ? Math.round(numericConfidence * 100) : Math.round(numericConfidence);
    return `${cleanedCondition} (${normalizedScore}%)`;
  }

  return cleanedCondition;
}

function downloadCsv(filename: string, rows: Row[]) {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escapeCell = (v: string | number) => {
    const cell = String(v ?? "");
    if (cell.includes(",") || cell.includes("\n") || cell.includes('"')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h] ?? "")).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPdf(title: string, columns: string[], rows: Row[]) {
  const win = window.open("", "_blank");
  if (!win) return;
  const tableRows = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td>${row[c] ?? ""}</td>`).join("")}</tr>`
    )
    .join("");
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
    h2 { font-size: 18px; margin-bottom: 8px; color: #A0195A; }
    p { font-size: 11px; color: #6b7280; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f9fafb; text-align: left; padding: 8px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e5e7eb; }
    td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h2>${title}</h2>
  <p>Generated on ${new Date().toLocaleString("en-PH")}</p>
  <table>
    <thead><tr>${columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`);
  win.document.close();
}

export default function AdminReportsPage() {
  const [selectedReport, setSelectedReport] = useState<ReportType>(reportTypes[0]);
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [clinicError, setClinicError] = useState<string>("");
  const [generated, setGenerated] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);

  // Live data sets
  const [scanData, setScanData] = useState<any[]>([]);
  const [clinicData, setClinicData] = useState<any[]>([]);
  const [userData, setUserData] = useState<any[]>([]);
  const [appointmentData, setAppointmentData] = useState<any[]>([]);
  const [doctorMap, setDoctorMap] = useState<Record<string, string>>({});
  const [doctorReviewMap, setDoctorReviewMap] = useState<Record<string, any>>({});

  const fetchAllReportData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Scans & AI results
      const { data: dbScans } = await supabase
        .from("ai_scan_result")
        .select(`
          analysis_id,
          user_id,
          confidence_score,
          status,
          body_part,
          scanned_at,
          skin_condition:condition_id ( name ),
          user:user_id ( full_name, email )
        `)
        .order("scanned_at", { ascending: false });

      if (dbScans && dbScans.length > 0) {
        setScanData(dbScans);
      }

      // 2. Clinics
      const { data: dbClinics } = await supabase
        .from("clinic")
        .select("clinic_id, name, status, city, email, phone, created_at, owner_user_id")
        .order("created_at", { ascending: false });

      if (dbClinics && dbClinics.length > 0) {
        setClinicData(dbClinics);
      } else {
        try {
          const cached = localStorage.getItem("dermai_cached_admin_clinics");
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed)) setClinicData(parsed);
          }
        } catch { }
      }

      // 3. Users (Dynamic join source for patient contact & address)
      const { data: dbUsers } = await supabase
        .from("user")
        .select("user_id, full_name, email, role, account_status, phone, address, district, created_at")
        .order("created_at", { ascending: false });

      if (dbUsers && dbUsers.length > 0) {
        setUserData(dbUsers);
      }

      // 4. Clinic Doctors (for resolving attending doctor names)
      const { data: dbDoctors } = await supabase
        .from("clinic_doctor")
        .select("doctor_id, doctor_name");

      if (dbDoctors && dbDoctors.length > 0) {
        const dMap: Record<string, string> = {};
        for (const doc of dbDoctors) {
          if (doc.doctor_id && doc.doctor_name) {
            dMap[String(doc.doctor_id)] = formatDoctorDisplayName(doc.doctor_name);
          }
        }
        setDoctorMap(dMap);
      }

      // 5. Doctor AI Reviews / Consultation medical records (for final diagnosis & linked AI prediction)
      const reviewLookup: Record<string, any> = {};
      try {
        const { data: dbReviews } = await supabase
          .from("doctor_ai_review")
          .select(
            "appointment_id, patient_id, doctor_id, doctor_name, ai_prediction, confidence, final_diagnosis, doctor_notes, is_direct_consultation, reviewed_at"
          );

        if (dbReviews && dbReviews.length > 0) {
          for (const rev of dbReviews) {
            if (rev.appointment_id) {
              reviewLookup[String(rev.appointment_id)] = rev;
            }
          }
        }
      } catch { }

      try {
        const localReviewsStr = localStorage.getItem("dermai_doctor_ai_reviews");
        if (localReviewsStr) {
          const parsedReviews = JSON.parse(localReviewsStr);
          if (Array.isArray(parsedReviews)) {
            for (const rev of parsedReviews) {
              const apptId = String(rev.appointment_id ?? rev.appointmentId ?? "");
              if (apptId && !reviewLookup[apptId]) {
                reviewLookup[apptId] = rev;
              }
            }
          }
        }
      } catch { }
      setDoctorReviewMap(reviewLookup);

      // 6. Appointments joined with Clinic, User, and Skin Condition
      const { data: dbAppts } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          clinic_id,
          user_id,
          condition_id,
          date,
          status,
          check_in_status,
          patient_name,
          patient_email,
          patient_contact,
          patient_address,
          ai_condition_name,
          ai_confidence,
          doctor_status,
          doctor_note,
          created_at,
          assigned_doctor_id,
          clinic:clinic_id(clinic_id, name),
          condition:condition_id(name),
          user:user_id(user_id, full_name, email, phone, address, district)
        `)
        .order("created_at", { ascending: false });

      const list: any[] = dbAppts || [];

      // Merge with local appointments
      try {
        const localStr = localStorage.getItem("dermai_clinic_appointments");
        if (localStr) {
          const parsed = JSON.parse(localStr);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (!list.some((a) => a.appointment_id === item.id || a.id === item.id)) {
                list.push(item);
              }
            }
          }
        }
      } catch { }

      setAppointmentData(list);
    } catch (err) {
      console.error("[AdminReportsPage] Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllReportData();
  }, [fetchAllReportData]);

  const selectedClinicObj = useMemo(() => {
    if (!selectedClinicId) return null;
    return (
      clinicData.find(
        (c) => String(c.clinic_id ?? c.id ?? c.name) === String(selectedClinicId)
      ) || null
    );
  }, [clinicData, selectedClinicId]);

  const report = useMemo<GeneratedReport>(() => {
    if (selectedReport === "Skin Analysis Report") {
      const rows: Row[] = [];

      // Combine AI scan results and patient appointment scans
      scanData.forEach((s) => {
        const d = s.scanned_at ? s.scanned_at.slice(0, 10) : "";
        const userObj = Array.isArray(s.user) ? s.user[0] : s.user;
        const condObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
        if (isWithinRange(d, fromDate, toDate)) {
          rows.push({
            Date: d || "-",
            Patient: userObj?.full_name || userObj?.email || "Patient",
            Condition: condObj?.name || s.body_part || "General Consultation",
            Status: s.status || "Completed",
            Confidence: s.confidence_score ? `${Math.round(s.confidence_score)}%` : "—",
          });
        }
      });

      appointmentData.forEach((a) => {
        const d = (a.created_at || a.date || "").slice(0, 10);
        if (a.ai_condition_name || a.aiConditionName) {
          if (isWithinRange(d, fromDate, toDate)) {
            rows.push({
              Date: d || "-",
              Patient: a.patient_name || a.patientName || "Patient",
              Condition: a.ai_condition_name || a.aiConditionName || "Skin condition",
              Status: a.doctor_status || a.doctorStatus || a.status || "Pending",
              Confidence: (a.ai_confidence || a.aiConfidence) ? `${a.ai_confidence || a.aiConfidence}%` : "—",
            });
          }
        }
      });

      return {
        title: selectedReport,
        rows,
        columns: ["Date", "Patient", "Condition", "Status", "Confidence"],
        filename: "skin-analysis-report.csv",
      };
    }

    if (selectedReport === "Clinic Verification Report") {
      const rows: Row[] = clinicData
        .filter((c) => isWithinRange((c.created_at || "").slice(0, 10), fromDate, toDate))
        .map((c) => ({
          Clinic: c.name || "Clinic",
          City: c.city || "Cebu",
          Email: c.email || "-",
          Status: c.status || "pending",
          "Date Registered": (c.created_at || "").slice(0, 10) || "-",
        }));

      return {
        title: selectedReport,
        rows,
        columns: ["Clinic", "City", "Email", "Status", "Date Registered"],
        filename: "clinic-verification-report.csv",
      };
    }

    if (selectedReport === "User Activity Log") {
      const rows: Row[] = userData
        .filter((u) => isWithinRange((u.created_at || "").slice(0, 10), fromDate, toDate))
        .map((u) => ({
          Date: (u.created_at || "").slice(0, 10) || "-",
          User: u.full_name || "User",
          Email: u.email || "-",
          Role: u.role || "patient",
          Status: u.account_status || "active",
        }));

      return {
        title: selectedReport,
        rows,
        columns: ["Date", "User", "Email", "Role", "Status"],
        filename: "user-activity-log.csv",
      };
    }

    if (selectedReport === "Completed Consultation Report") {
      const targetClinicName = (selectedClinicObj?.name || "").trim().toLowerCase();

      const rows: Row[] = !selectedClinicId
        ? []
        : appointmentData
            .filter((a) => {
              const rawStatus = String(a.status || "").toLowerCase();
              const checkIn = String(a.check_in_status || a.checkInStatus || "").toLowerCase();
              const isCompleted = rawStatus === "completed" || checkIn === "completed";
              if (!isCompleted) return false;

              const clinicObj = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
              const apptClinicId = String(a.clinic_id ?? clinicObj?.clinic_id ?? a.clinicId ?? "");
              const apptClinicName = String(clinicObj?.name ?? a.clinicName ?? "").trim().toLowerCase();

              const matchesClinic =
                (apptClinicId && apptClinicId === String(selectedClinicId)) ||
                (targetClinicName && apptClinicName === targetClinicName);
              if (!matchesClinic) return false;

              const consultDate = (a.date || a.created_at || "").slice(0, 10);
              return isWithinRange(consultDate, fromDate, toDate);
            })
            .map((a) => {
              const apptId = String(a.appointment_id ?? a.id ?? "");
              const linkedReview = apptId ? doctorReviewMap[apptId] : undefined;

              const doctorObj = Array.isArray(a.doctor) ? a.doctor[0] : a.doctor;
              const assignedDocId = a.assigned_doctor_id ?? a.assignedDoctorId ?? linkedReview?.doctor_id;
              const rawDoctor =
                doctorObj?.doctor_name ||
                (assignedDocId && doctorMap[String(assignedDocId)]) ||
                linkedReview?.doctor_name ||
                a.assignedDoctorName ||
                a.doctor_name ||
                "Attending Dermatologist";
              const resolvedDoctor = formatDoctorDisplayName(rawDoctor);

              const userObj = Array.isArray(a.user) ? a.user[0] : a.user;
              const matchedUser = userData.find(
                (u) =>
                  (a.user_id && String(u.user_id) === String(a.user_id)) ||
                  (a.patient_email && u.email && String(u.email).toLowerCase() === String(a.patient_email).toLowerCase())
              );

              const patientName =
                a.patient_name ||
                a.patientName ||
                linkedReview?.patient_name ||
                userObj?.full_name ||
                matchedUser?.full_name ||
                a.patient_email ||
                "Patient";

              const rawPatientId =
                a.user_id ||
                userObj?.user_id ||
                linkedReview?.patient_id ||
                matchedUser?.user_id ||
                a.patient_id ||
                a.appointment_id ||
                "";
              const patientIdDisplay = rawPatientId
                ? `PT-${String(rawPatientId).slice(0, 8).toUpperCase()}`
                : "—";

              const patientContactDisplay = resolvePatientContact(a, userObj, matchedUser);
              const patientAddressDisplay = resolvePatientAddress(a, userObj, matchedUser);

              // Resolve AI Skin Analysis (from linked doctor_ai_review, patient_appointment, or ai_scan_result)
              const condObj = Array.isArray(a.condition) ? a.condition[0] : a.condition;
              let aiCondition =
                linkedReview?.ai_prediction ??
                a.ai_condition_name ??
                a.aiConditionName ??
                condObj?.name ??
                null;
              let aiConf =
                linkedReview?.confidence ??
                a.ai_confidence ??
                a.aiConfidence ??
                null;

              // If appointment has no direct AI fields, check if user has a matching AI scan record
              if (!aiCondition && a.user_id && !linkedReview?.is_direct_consultation) {
                const userScan = scanData.find((s) => String(s.user_id) === String(a.user_id));
                if (userScan) {
                  const scanCond = Array.isArray(userScan.skin_condition)
                    ? userScan.skin_condition[0]
                    : userScan.skin_condition;
                  aiCondition = scanCond?.name || null;
                  aiConf = userScan.confidence_score ?? null;
                }
              }

              const aiSkinAnalysisDisplay = formatAiSkinAnalysis(
                aiCondition,
                aiConf,
                Boolean(linkedReview?.is_direct_consultation)
              );

              // Resolve Doctor's Final Diagnosis (from consultation medical record / doctor_ai_review or doctor_note)
              const parsedDiagnosis = extractDoctorDiagnosis(
                a.doctor_note ?? a.doctorNote,
                linkedReview?.final_diagnosis ?? a.doctor_diagnosis ?? a.doctorDiagnosis
              );
              const finalDiagnosisDisplay = parsedDiagnosis || "Pending Diagnosis";

              return {
                "Patient Name": patientName,
                "Patient ID": patientIdDisplay,
                "Patient Contact": patientContactDisplay,
                "Patient Address": patientAddressDisplay,
                "Consultation Date": (a.date || a.created_at || "").slice(0, 10) || "—",
                "Attending Doctor": resolvedDoctor,
                "AI Skin Analysis": aiSkinAnalysisDisplay,
                "Doctor Final Diagnosis": finalDiagnosisDisplay,
                Status: "Completed",
              };
            });

      const clinicSlug = (selectedClinicObj?.name || "clinic")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      return {
        title: selectedClinicObj?.name
          ? `Completed Consultation Report — ${selectedClinicObj.name}`
          : "Completed Consultation Report",
        rows,
        columns: [
          "Patient Name",
          "Patient ID",
          "Patient Contact",
          "Patient Address",
          "Consultation Date",
          "Attending Doctor",
          "AI Skin Analysis",
          "Doctor Final Diagnosis",
          "Status",
        ],
        filename: `completed-consultations-${clinicSlug || "report"}.csv`,
      };
    }

    // Appointment Report
    const rows: Row[] = appointmentData
      .filter((a) => isWithinRange((a.created_at || a.date || "").slice(0, 10), fromDate, toDate))
      .map((a) => {
        const clinicObj = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
        const doctorObj = Array.isArray(a.doctor) ? a.doctor[0] : a.doctor;
        const assignedDocId = a.assigned_doctor_id ?? a.assignedDoctorId;
        const rawDoc =
          doctorObj?.doctor_name ||
          (assignedDocId && doctorMap[String(assignedDocId)]) ||
          a.assignedDoctorName ||
          "Unassigned";
        const doctorDisplay = formatDoctorDisplayName(rawDoc);

        return {
          Date: (a.date || a.created_at || "").slice(0, 10) || "TBD",
          Patient: a.patient_name || a.patientName || "Patient",
          Clinic: clinicObj?.name || a.clinicName || "Skin Clinic",
          Doctor: doctorDisplay,
          Condition: a.ai_condition_name || a.aiConditionName || "Consultation",
          Status: a.status || "pending",
          "Doctor Review": a.doctor_status || a.doctorStatus || "pending-review",
        };
      });

    return {
      title: selectedReport,
      rows,
      columns: ["Date", "Patient", "Clinic", "Doctor", "Condition", "Status", "Doctor Review"],
      filename: "appointment-report.csv",
    };
  }, [
    selectedReport,
    selectedClinicId,
    selectedClinicObj,
    scanData,
    clinicData,
    userData,
    appointmentData,
    doctorMap,
    doctorReviewMap,
    fromDate,
    toDate,
  ]);

  const totalAppointments = appointmentData.length;
  const scheduledCount = appointmentData.filter(
    (a) => a.status === "scheduled" || a.status === "confirmed" || a.status === "accepted"
  ).length;
  const pendingCount = appointmentData.filter((a) => a.status === "pending" || !a.status).length;
  const rejectionRate = totalAppointments
    ? `${Math.round((appointmentData.filter((a) => a.status === "rejected" || a.status === "cancelled").length / totalAppointments) * 100)}%`
    : "0%";

  const summary = [
    { label: "Total appointments", value: totalAppointments, hint: "All recorded bookings", Icon: CalendarDays },
    { label: "Scheduled", value: scheduledCount, hint: "Confirmed or accepted", Icon: CheckCircle2 },
    { label: "Pending", value: pendingCount, hint: "Awaiting a decision", Icon: Clock },
    { label: "Rejection rate", value: rejectionRate, hint: "Rejected or cancelled", Icon: XCircle },
  ];

  const isCompletedConsultationReport = selectedReport === "Completed Consultation Report";
  const showCompletedConsultationPreview = isCompletedConsultationReport && Boolean(selectedClinicId);

  const handleGenerateReport = () => {
    if (isCompletedConsultationReport && !selectedClinicId) {
      setClinicError("Please select a clinic to generate the Completed Consultation Report.");
      return;
    }
    setClinicError("");
    setGenerated(true);
  };

  return (
    <div className="space-y-8 w-full max-w-full overflow-x-hidden">
      <div className="flex items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-black">Reports</h1>
          <p className="text-sm text-gray-600 mt-1">Generate, filter, and export platform reports.</p>
        </div>
        <button
          type="button"
          onClick={fetchAllReportData}
          disabled={loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-black hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 text-magenta-600 ${loading ? "animate-spin" : ""}`} /> Refresh data
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-full">
        {summary.map(({ label, value, hint, Icon }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-7 min-h-[156px]">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-black">{label}</p>
              <Icon className="w-5 h-5 text-magenta-600" />
            </div>
            <p className="mt-5 text-4xl font-bold text-black tabular-nums">{value}</p>
            <p className="mt-2 text-sm text-gray-600">{hint}</p>
          </div>
        ))}
      </div>

      {/* Generator controls */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-7 w-full max-w-full">
        <h2 className="text-lg font-semibold text-black mb-5">Report parameters</h2>
        <div
          className={`grid grid-cols-1 ${
            isCompletedConsultationReport ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
          } gap-5 mb-6`}
        >
          <div>
            <label className="block text-sm font-medium text-black mb-2">Report type</label>
            <select
              value={selectedReport}
              onChange={(e) => {
                const nextType = e.target.value as ReportType;
                setSelectedReport(nextType);
                setClinicError("");
                setGenerated(false);
              }}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-black outline-none focus:border-magenta-500 bg-white cursor-pointer"
            >
              {reportTypes.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {isCompletedConsultationReport && (
            <div>
              <label className="block text-sm font-medium text-black mb-2">
                Clinic <span className="text-magenta-600">*</span>
              </label>
              <select
                required
                value={selectedClinicId}
                onChange={(e) => {
                  setSelectedClinicId(e.target.value);
                  setClinicError("");
                }}
                className={`w-full px-4 py-3 rounded-lg border ${
                  clinicError ? "border-red-500" : "border-gray-300"
                } text-sm text-black outline-none focus:border-magenta-500 bg-white cursor-pointer`}
              >
                <option value="">Select a clinic...</option>
                {clinicData.map((c) => {
                  const idVal = String(c.clinic_id ?? c.id ?? c.name);
                  return (
                    <option key={idVal} value={idVal}>
                      {c.name || "Unnamed Clinic"}
                    </option>
                  );
                })}
              </select>
              {clinicError && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{clinicError}</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-black mb-2">
              From date <span className="text-xs font-normal text-gray-500">(Optional)</span>
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setGenerated(false); }}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-black outline-none focus:border-magenta-500 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-black mb-2">
              To date <span className="text-xs font-normal text-gray-500">(Optional)</span>
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setGenerated(false); }}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-black outline-none focus:border-magenta-500 bg-white"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerateReport}
            className="px-6 py-3 rounded-lg bg-magenta-600 hover:bg-magenta-700 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            Generate report
          </button>
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setFromDate(""); setToDate(""); }}
              className="px-5 py-3 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-black hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Clear dates
            </button>
          )}
        </div>
      </div>

      {/* Dedicated Report Preview section for Completed Consultation Report */}
      {showCompletedConsultationPreview && (
        <div className="space-y-6 w-full max-w-full">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold text-black">Report Preview</h2>
              <p className="text-sm text-gray-600 mt-0.5">
                Authorized completed consultation records for{" "}
                <span className="font-semibold text-black">
                  {selectedClinicObj?.name || "Selected Clinic"}
                </span>
                {fromDate || toDate
                  ? ` (${fromDate || "Start"} to ${toDate || "Present"})`
                  : " (Full history)"}
              </p>
            </div>
          </div>

          {/* Clinic-specific metric card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-full">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-7 w-full max-w-full">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-black">Completed Consultations</p>
                <Building2 className="w-5 h-5 text-magenta-600" />
              </div>
              <p className="mt-5 text-4xl font-bold text-black tabular-nums">
                {report.rows.length}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                {selectedClinicObj?.name || "Selected clinic"} •{" "}
                {fromDate || toDate ? "Filtered date range" : "All-time completed"}
              </p>
            </div>
          </div>

          {/* Data table preview & Export actions */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden w-full max-w-full">
            <div className="px-7 py-5 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-semibold text-black">{report.title}</h3>
                <p className="text-sm text-gray-600 mt-0.5">
                  {report.rows.length} completed consultation record(s) found
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => downloadCsv(report.filename, report.rows)}
                  disabled={report.rows.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-magenta-600 hover:bg-magenta-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Export Report (CSV)
                </button>
                <button
                  type="button"
                  onClick={() => downloadPdf(report.title, report.columns, report.rows)}
                  disabled={report.rows.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-black text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-magenta-600" />
                  Export PDF
                </button>
              </div>
            </div>

            <div className="overflow-x-auto w-full max-w-full">
              <table className="w-full min-w-[1000px] text-sm text-left text-black">
                <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-black uppercase tracking-wider">
                  <tr>
                    {report.columns.map((c) => (
                      <th key={c} className="px-7 py-4 whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.rows.length === 0 ? (
                    <tr>
                      <td colSpan={report.columns.length} className="px-7 py-14 text-center text-gray-600">
                        No completed consultations found for this clinic and date range.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        {report.columns.map((col) => (
                          <td key={col} className="px-7 py-4 text-black whitespace-nowrap">
                            {col === "Status" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                {row[col]}
                              </span>
                            ) : col === "AI Skin Analysis" && row[col] === "N/A" ? (
                              <span className="text-gray-400 font-medium">N/A</span>
                            ) : col === "Doctor Final Diagnosis" ? (
                              <span className="font-medium text-gray-900">{row[col]}</span>
                            ) : (col === "Patient Contact" || col === "Patient Address") && row[col] === "—" ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              row[col]
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Standard generated report for other report types */}
      {generated && !isCompletedConsultationReport && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden w-full max-w-full">
          <div className="px-7 py-5 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold text-black">{report.title}</h2>
              <p className="text-sm text-gray-600 mt-0.5">{report.rows.length} row(s) found</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => downloadCsv(report.filename, report.rows)}
                disabled={report.rows.length === 0}
                className="px-5 py-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-black text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => downloadPdf(report.title, report.columns, report.rows)}
                disabled={report.rows.length === 0}
                className="px-5 py-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-black text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
              >
                Print / PDF
              </button>
            </div>
          </div>

          <div className="overflow-x-auto w-full max-w-full">
            <table className="w-full min-w-[1000px] text-sm text-left text-black">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-black uppercase tracking-wider">
                <tr>
                  {report.columns.map((c) => (
                    <th key={c} className="px-7 py-4 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.rows.length === 0 ? (
                  <tr>
                    <td colSpan={report.columns.length} className="px-7 py-14 text-center text-gray-600">
                      No data found for this report and date range.
                    </td>
                  </tr>
                ) : (
                  report.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      {report.columns.map((col) => (
                        <td key={col} className="px-7 py-4 text-black whitespace-nowrap">
                          {row[col]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
