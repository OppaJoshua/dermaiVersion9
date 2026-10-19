import { useMemo, useState, useEffect, useCallback } from "react";
import { RefreshCw, CalendarDays, CheckCircle2, Clock, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

type ReportType =
  | "Skin Analysis Report"
  | "Clinic Verification Report"
  | "User Activity Log"
  | "Appointment Report";

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
  const [generated, setGenerated] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);

  // Live data sets
  const [scanData, setScanData] = useState<any[]>([]);
  const [clinicData, setClinicData] = useState<any[]>([]);
  const [userData, setUserData] = useState<any[]>([]);
  const [appointmentData, setAppointmentData] = useState<any[]>([]);

  const fetchAllReportData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Scans & AI results
      const { data: dbScans } = await supabase
        .from("ai_scan_result")
        .select(`
          analysis_id,
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

      // 3. Users
      const { data: dbUsers } = await supabase
        .from("user")
        .select("user_id, full_name, email, role, account_status, created_at")
        .order("created_at", { ascending: false });

      if (dbUsers && dbUsers.length > 0) {
        setUserData(dbUsers);
      }

      // 4. Appointments
      const { data: dbAppts } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          status,
          patient_name,
          patient_email,
          ai_condition_name,
          ai_confidence,
          doctor_status,
          doctor_note,
          created_at,
          assigned_doctor_id,
          clinic:clinic_id(name)
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

    // Appointment Report
    const rows: Row[] = appointmentData
      .filter((a) => isWithinRange((a.created_at || a.date || "").slice(0, 10), fromDate, toDate))
      .map((a) => {
        const clinicObj = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
        const doctorObj = Array.isArray(a.doctor) ? a.doctor[0] : a.doctor;
        return {
          Date: (a.date || a.created_at || "").slice(0, 10) || "TBD",
          Patient: a.patient_name || a.patientName || "Patient",
          Clinic: clinicObj?.name || a.clinicName || "Skin Clinic",
          Doctor: doctorObj?.doctor_name || a.assignedDoctorName || "Unassigned",
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
  }, [selectedReport, scanData, clinicData, userData, appointmentData, fromDate, toDate]);

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

  return (
    <div className="space-y-8">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-7">
        <h2 className="text-lg font-semibold text-black mb-5">Report parameters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
          <div>
            <label className="block text-sm font-medium text-black mb-2">Report type</label>
            <select
              value={selectedReport}
              onChange={(e) => {
                setSelectedReport(e.target.value as ReportType);
                setGenerated(false);
              }}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-black outline-none focus:border-magenta-500 bg-white cursor-pointer"
            >
              {reportTypes.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-black mb-2">From date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setGenerated(false); }}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-black outline-none focus:border-magenta-500 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-black mb-2">To date</label>
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
            onClick={() => setGenerated(true)}
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

      {/* Generated report */}
      {generated && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
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

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-black">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-black uppercase tracking-wider">
                <tr>
                  {report.columns.map((c) => (
                    <th key={c} className="px-7 py-4">{c}</th>
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
                        <td key={col} className="px-7 py-4 text-black">
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