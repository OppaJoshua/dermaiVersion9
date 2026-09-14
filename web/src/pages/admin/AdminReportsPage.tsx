import { useMemo, useState, useEffect, useCallback } from "react";
import { Download, FileText, RefreshCw, Printer } from "lucide-react";
import { motion } from "framer-motion";
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
        } catch {}
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
          clinic:clinic_id(name),
          doctor:assigned_doctor_id(doctor_name)
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
      } catch {}

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
          Doctor: doctorObj?.doctor_name || a.assignedDoctorName || "Resident Doctor",
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-400 mt-0.5">Generate, filter, and export platform analytics reports.</p>
        </div>
        <button
          type="button"
          onClick={fetchAllReportData}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh Data
        </button>
      </div>

      {/* Metric summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs">
          <p className="text-2xl font-display font-bold text-gray-900">{totalAppointments}</p>
          <p className="text-xs text-gray-400 mt-0.5">Total Appointments</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs">
          <p className="text-2xl font-display font-bold text-emerald-600">{scheduledCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Scheduled Appointments</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs">
          <p className="text-2xl font-display font-bold text-amber-600">{pendingCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Pending Appointments</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs">
          <p className="text-2xl font-display font-bold text-red-600">{rejectionRate}</p>
          <p className="text-xs text-gray-400 mt-0.5">Rejection Rate</p>
        </div>
      </div>

      {/* Generator controls */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Report Type</label>
            <select
              value={selectedReport}
              onChange={(e) => {
                setSelectedReport(e.target.value as ReportType);
                setGenerated(false);
              }}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-magenta-500 bg-white cursor-pointer"
            >
              {reportTypes.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setGenerated(false); }}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-magenta-500 bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setGenerated(false); }}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-magenta-500 bg-white"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setGenerated(true)}
            className="px-5 py-2.5 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer"
          >
            Generate Report
          </button>
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setFromDate(""); setToDate(""); }}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Generated Report Table */}
      {generated && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-xs"
        >
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-bold text-gray-900 text-base">{report.title}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{report.rows.length} row(s) found</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => downloadCsv(report.filename, report.rows)}
                disabled={report.rows.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
              <button
                type="button"
                onClick={() => downloadPdf(report.title, report.columns, report.rows)}
                disabled={report.rows.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> Print / PDF
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50/70 border-b border-gray-100 text-gray-500 uppercase font-bold text-[10px] tracking-wider">
                <tr>
                  {report.columns.map((c) => (
                    <th key={c} className="px-6 py-3.5">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {report.rows.length === 0 ? (
                  <tr>
                    <td colSpan={report.columns.length} className="px-6 py-12 text-center text-gray-400 italic">
                      <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                      No data found for this report and date range.
                    </td>
                  </tr>
                ) : (
                  report.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                      {report.columns.map((col) => (
                        <td key={col} className="px-6 py-3.5 font-medium text-gray-800">
                          {row[col]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
