import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { motion } from "framer-motion";

type ReportType =
  | "Skin Analysis Report"
  | "Clinic Verification Report"
  | "User Activity Log"
  | "Appointment Report";

type AppointmentRecord = {
  id: string;
  clinicId: number;
  clinicName: string;
  consultationType: "face-to-face";
  date: string;
  time: string;
  notes: string;
  status: "pending" | "accepted" | "scheduled" | "rejected";
  meetingLink?: string;
  clinicNote?: string;
  createdAt: string;
};

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

const sampleSkinAnalyses: Array<{ id: number; date: string; user: string; condition: string; category: string; confidence: number; severity: string }> = [];

const sampleClinicVerification: Array<{ clinic: string; district: string; status: string; reviewedBy: string; reviewedDate: string }> = [];

function parseDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isWithinRange(dateValue: string, fromDate: string, toDate: string): boolean {
  const value = parseDate(dateValue);
  if (!value) return false;

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
    h2 { font-size: 16px; margin-bottom: 12px; color: #A0195A; }
    p { font-size: 11px; color: #9ca3af; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f9fafb; text-align: left; padding: 8px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb; }
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

  // TODO: Load appointments from Supabase for reports
  const appointments = useMemo<AppointmentRecord[]>(() => [], []);

  const report = useMemo<GeneratedReport>(() => {
    if (selectedReport === "Skin Analysis Report") {
      const filtered = sampleSkinAnalyses.filter((r) => isWithinRange(r.date, fromDate, toDate));
      const rows: Row[] = filtered.map((r) => ({
        Date: r.date,
        User: r.user,
        Condition: r.condition,
        Category: r.category,
        Confidence: `${r.confidence}%`,
        Severity: r.severity,
      }));
      return {
        title: selectedReport,
        rows,
        columns: ["Date", "User", "Condition", "Category", "Confidence", "Severity"],
        filename: "skin-analysis-report.csv",
      };
    }

    if (selectedReport === "Clinic Verification Report") {
      const rows: Row[] = sampleClinicVerification.map((r) => ({
        Clinic: r.clinic,
        District: r.district,
        Status: r.status,
        "Reviewed By": r.reviewedBy,
        "Reviewed Date": r.reviewedDate,
      }));
      return {
        title: selectedReport,
        rows,
        columns: ["Clinic", "District", "Status", "Reviewed By", "Reviewed Date"],
        filename: "clinic-verification-report.csv",
      };
    }

    if (selectedReport === "User Activity Log") {
      const activityRows: Row[] = appointments
        .filter((a) => isWithinRange(a.createdAt, fromDate, toDate))
        .map((a) => ({
          Date: a.createdAt.slice(0, 10),
          Activity: `Appointment ${a.status}`,
          Clinic: a.clinicName,
          Type: "Face-to-Face",
          Note: a.clinicNote || "-",
        }));
      return {
        title: selectedReport,
        rows: activityRows,
        columns: ["Date", "Activity", "Clinic", "Type", "Note"],
        filename: "user-activity-log.csv",
      };
    }

    const appointmentRows: Row[] = appointments
      .filter((a) => isWithinRange(a.createdAt, fromDate, toDate))
      .map((a) => ({
        Date: a.date,
        Time: a.time,
        Clinic: a.clinicName,
        Type: "Face-to-Face",
        Status: a.status,
        "Meeting Link": a.meetingLink || "-",
      }));

    return {
      title: selectedReport,
      rows: appointmentRows,
      columns: ["Date", "Time", "Clinic", "Type", "Status", "Meeting Link"],
      filename: "appointment-report.csv",
    };
  }, [selectedReport, appointments, fromDate, toDate]);

  const totalAppointments = appointments.length;
  const acceptedCount = appointments.filter((a) => a.status === "accepted" || a.status === "scheduled").length;
  const pendingCount = appointments.filter((a) => a.status === "pending").length;
  const rejectionRate = totalAppointments
    ? `${Math.round((appointments.filter((a) => a.status === "rejected").length / totalAppointments) * 100)}%`
    : "0%";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-400 mt-0.5">Generate and export platform reports</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xl font-display font-bold text-gray-900">{totalAppointments}</p>
          <p className="text-xs text-gray-400">Appointment Requests</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xl font-display font-bold text-green-700">{acceptedCount}</p>
          <p className="text-xs text-gray-400">Scheduled Requests</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xl font-display font-bold text-amber-700">{pendingCount}</p>
          <p className="text-xs text-gray-400">Pending Requests</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xl font-display font-bold text-red-700">{rejectionRate}</p>
          <p className="text-xs text-gray-400">Rejection Rate</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Report Type</label>
            <select
              value={selectedReport}
              onChange={(e) => setSelectedReport(e.target.value as ReportType)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 appearance-none bg-white"
            >
              {reportTypes.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500"
            />
          </div>
        </div>

        <button
          onClick={() => setGenerated(true)}
          className="px-6 py-2.5 rounded-full bg-magenta-500 text-white font-semibold text-sm hover:bg-magenta-600 transition-colors shadow-md shadow-magenta-500/20 active:scale-[0.96]"
        >
          Generate Report
        </button>
      </div>

      {generated && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
        >
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h3 className="font-display font-bold text-gray-900">{report.title}</h3>
            <button
              onClick={() => downloadCsv(report.filename, report.rows)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-green-50 text-green-600 text-xs font-semibold hover:bg-green-100 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button
              onClick={() => downloadPdf(report.title, report.columns, report.rows)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-blue-50 text-blue-600 text-xs font-semibold hover:bg-blue-100 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" /> Export PDF
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {report.columns.map((column) => (
                    <th
                      key={column}
                      className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.length === 0 && (
                  <tr>
                    <td colSpan={report.columns.length} className="px-6 py-6 text-sm text-gray-400 text-center">
                      No rows found for the selected date range.
                    </td>
                  </tr>
                )}
                {report.rows.map((row, idx) => (
                  <tr key={idx} className="border-t border-gray-50 hover:bg-gray-50/50">
                    {report.columns.map((column) => (
                      <td key={column} className="px-6 py-3 text-sm text-gray-700">
                        {String(row[column] ?? "-")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
