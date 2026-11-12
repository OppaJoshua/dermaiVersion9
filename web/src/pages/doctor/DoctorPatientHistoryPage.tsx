import { formatAppointmentTime as formatTime } from "@/lib/appointmentTime";
import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Calendar,
  User,
  X,
  FileText,
  Loader2,
  ClipboardList,
  Search,
  Phone,
  PhoneCall,
  Mail,
  MapPin,
  Stethoscope,
  CheckCircle2,
  FileCheck,
  Building2,
  CalendarX2,
  Download,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { motion, AnimatePresence } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";
import { ZoomableSkinPhoto } from "@/components/common/ZoomableSkinPhoto";
import { formatConfidencePercent, cn } from "@/lib/utils";
import { ModalPortal } from "@/components/common/ModalPortal";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { useDoctorClinicContext } from "@/components/layout/doctorLayout";
import { groupPatientHistory, historyStatus, historyStatusLabel, isNoShowAppointment, type HistoryTab } from "@/lib/patientHistory";

function formatDate(dateStr?: string, createdAt?: string): string {
  const target = dateStr || (createdAt ? createdAt.split("T")[0] : "");
  if (!target) return "—";
  try {
    const date = new Date(target.split("T")[0] + "T00:00:00");
    if (!Number.isFinite(date.getTime())) return "Not scheduled";
    return date.toLocaleDateString("en-PH", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return target;
  }
}

function formatPatientId(appt?: { id: string; patientId?: string; createdAt?: string } | null): string {
  if (!appt) return "—";
  if (appt.patientId) return appt.patientId;
  const year = appt.createdAt ? new Date(appt.createdAt).getFullYear() : 2026;
  const digits = appt.id.replace(/\D/g, "");
  const num = digits.length >= 4
    ? digits.slice(-4)
    : appt.id.slice(0, 4).toUpperCase();
  return `P-${year}-${num}`;
}

function cleanPatientNotes(notes?: string | null): string {
  if (!notes) return "";
  return notes
    .replace(/\[Payment:.*?\]/gi, "")
    .replace(/(?:^|\n)?\s*Payment:\s*Paid online[^\n\r]*/gi, "")
    .trim();
}

function isPastHistoryRecord(appt?: { status?: string | null; doctorDone?: boolean; checkInStatus?: string | null } | null): boolean {
  if (!appt) return false;
  if (isNoShowAppointment(appt)) return true;
  const s = String(appt.status || "").trim().toLowerCase();
  return s === "completed" || s === "cancelled" || s === "canceled" || Boolean(appt.doctorDone);
}

export default function DoctorPatientHistoryPage() {
  const HISTORY_STATUSES = useMemo(() => ["Completed", "Cancelled", "Canceled", "completed", "cancelled", "canceled"], []);
  const { appointments, loading, error, doctorName, doctorIds } = useDoctorAppointments({ statusIn: HISTORY_STATUSES, includeNoShow: true });
  const { activeClinicId, affiliations } = useDoctorClinicContext();
  const [viewingPatientId, setViewingPatientId] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("all");
  useEffect(() => { setViewingPatientId(null); }, [activeClinicId]);
  const [search, setSearch] = useState("");

  // Date filters: From Date & To Date
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Validation: From Date cannot be later than To Date
  const dateRangeError = useMemo(() => {
    if (fromDate && toDate && fromDate > toDate) {
      return "From Date cannot be later than To Date.";
    }
    return null;
  }, [fromDate, toDate]);

  // Derive the currently-active clinic name for contextual messages
  const activeClinicName = useMemo(() => {
    if (!activeClinicId) return null;
    if (activeClinicId === "all") return "All Clinics (Consolidated)";
    return affiliations.find((a) => a.clinic_id === activeClinicId)?.clinic?.name || "Active Branch";
  }, [activeClinicId, affiliations]);

  // Doctor authorization filter: strictly includes appointments assigned to this authenticated doctor
  const isAuthorizedDoctorAppt = useCallback((appt: DoctorAppointmentRecord): boolean => {
    if (appt.isAssignedToMe) return true;
    if (appt.assignedDoctorId && doctorIds.some(id => String(id).toLowerCase().trim() === String(appt.assignedDoctorId).toLowerCase().trim())) {
      return true;
    }
    return false;
  }, [doctorIds]);

  // 1. Authorized past history records within active clinic branch
  const authorizedHistory = useMemo(() => {
    return appointments.filter(a => isPastHistoryRecord(a) && isAuthorizedDoctorAppt(a));
  }, [appointments, isAuthorizedDoctorAppt]);

  // 2. Summary cards metrics (Overall history statistics for clinic scope - unchanged by date/search filter)
  const noShowList = useMemo(() => authorizedHistory.filter(isNoShowAppointment), [authorizedHistory]);

  const completedList = useMemo(() => authorizedHistory.filter((a) => {
    if (isNoShowAppointment(a)) return false;
    const s = String(a.status || "").trim().toLowerCase();
    const c = String(a.checkInStatus || "").trim().toLowerCase();
    return s === "completed" || Boolean(a.doctorDone) || c === "completed";
  }), [authorizedHistory]);

  const cancelledList = useMemo(() => authorizedHistory.filter((a) => {
    if (isNoShowAppointment(a)) return false;
    const s = String(a.status || "").trim().toLowerCase();
    const c = String(a.checkInStatus || "").trim().toLowerCase();
    if (s === "completed" || Boolean(a.doctorDone) || c === "completed") return false;
    return s === "cancelled" || s === "canceled" || s === "rejected" || a.doctorStatus === "rejected";
  }), [authorizedHistory]);

  const allPatients = useMemo(() => groupPatientHistory(authorizedHistory), [authorizedHistory]);

  // 3. Apply Scheduled-Date Filter to authorizedHistory
  const dateFilteredHistory = useMemo(() => {
    if (dateRangeError) return [];
    if (!fromDate && !toDate) return authorizedHistory;
    return authorizedHistory.filter((a) => {
      const d = String(a.date || "").trim();
      if (!d) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }, [authorizedHistory, fromDate, toDate, dateRangeError]);

  // Tab counts reflecting the active date filter
  const tabCounts = useMemo(() => {
    return {
      all: dateFilteredHistory.length,
      completed: dateFilteredHistory.filter(a => !isNoShowAppointment(a) && (a.status === "completed" || Boolean(a.doctorDone) || a.checkInStatus === "completed")).length,
      rejected: dateFilteredHistory.filter(a => {
        if (isNoShowAppointment(a)) return false;
        const s = String(a.status || "").trim().toLowerCase();
        const c = String(a.checkInStatus || "").trim().toLowerCase();
        if (s === "completed" || Boolean(a.doctorDone) || c === "completed") return false;
        return s === "cancelled" || s === "canceled" || s === "rejected" || a.doctorStatus === "rejected";
      }).length,
      noShow: dateFilteredHistory.filter(isNoShowAppointment).length,
    };
  }, [dateFilteredHistory]);
  void tabCounts;

  // 4. Apply Category / HistoryTab Filter
  const categoryFilteredHistory = useMemo(() => {
    if (historyTab === "completed") {
      return dateFilteredHistory.filter(a => !isNoShowAppointment(a) && (a.status === "completed" || Boolean(a.doctorDone) || a.checkInStatus === "completed"));
    }
    if (historyTab === "rejected") {
      return dateFilteredHistory.filter(a => {
        if (isNoShowAppointment(a)) return false;
        const s = String(a.status || "").trim().toLowerCase();
        const c = String(a.checkInStatus || "").trim().toLowerCase();
        if (s === "completed" || Boolean(a.doctorDone) || c === "completed") return false;
        return s === "cancelled" || s === "canceled" || s === "rejected" || a.doctorStatus === "rejected";
      });
    }
    if (historyTab === "no-show") {
      return dateFilteredHistory.filter(isNoShowAppointment);
    }
    return dateFilteredHistory;
  }, [dateFilteredHistory, historyTab]);

  // 5. Apply Patient Search Filter (Patient Name only)
  const searchFilteredHistory = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return categoryFilteredHistory;
    return categoryFilteredHistory.filter((a) =>
      Boolean(a.patientName && a.patientName.toLowerCase().includes(query))
    );
  }, [categoryFilteredHistory, search]);

  // 6. Group by patient for the UI Table
  const tabPatients = useMemo(() => groupPatientHistory(searchFilteredHistory), [searchFilteredHistory]);

  const viewingPatient = allPatients.find(patient => patient.id === viewingPatientId);
  const modalAppointments = useMemo(() => {
    return (viewingPatient?.appointments || []).filter(isPastHistoryRecord);
  }, [viewingPatient]);
  const viewingAppt = modalAppointments[0] || viewingPatient?.latest;

  // Export readiness & guards
  const isExportDisabled = loading || Boolean(error) || Boolean(dateRangeError) || searchFilteredHistory.length === 0;
  const exportDisabledTooltip = loading
    ? "Loading records, please wait..."
    : error
    ? "Unable to export due to load error"
    : dateRangeError
    ? dateRangeError
    : searchFilteredHistory.length === 0
    ? "No matching records to export"
    : "";

  // CSV Export Handler
  const handleExportCsv = useCallback(() => {
    if (isExportDisabled || searchFilteredHistory.length === 0) return;

    const sanitizeCsv = (val: unknown): string => {
      let str = String(val ?? "");
      // Neutralize formula injection including leading whitespace or control chars before dangerous prefixes
      if (/^[\s\t\r\n]*[=+\-@]/.test(str) || /^[\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    const formatContactCsv = (contact?: string): string => {
      const trimmed = String(contact ?? "").trim();
      if (!trimmed) return "Not provided";
      if (/^0/.test(trimmed) && !trimmed.startsWith("'")) {
        return `'${trimmed}`;
      }
      return trimmed;
    };

    const formatEmailCsv = (email?: string): string => {
      const trimmed = String(email ?? "").trim();
      return trimmed ? trimmed : "Not provided";
    };

    const headers = [
      "Patient ID",
      "Patient Name",
      "Contact Number",
      "Email Address",
      "Appointment Date",
      "Appointment Time",
      "Clinic Branch",
      "Appointment Status",
      "Diagnosis / Concern",
      "Clinic Remarks",
      "Emergency Contact Name",
      "Emergency Contact Relationship",
      "Emergency Contact Number",
    ];

    const rows = searchFilteredHistory.map((appt) => [
      sanitizeCsv(formatPatientId(appt)),
      sanitizeCsv(appt.patientName || "Not provided"),
      sanitizeCsv(formatContactCsv(appt.patientContact)),
      sanitizeCsv(formatEmailCsv(appt.patientEmail)),
      sanitizeCsv(appt.date || "Not scheduled"),
      sanitizeCsv(appt.time || "Time not provided"),
      sanitizeCsv(appt.clinicName || "Clinic Branch"),
      sanitizeCsv(historyStatusLabel(appt)),
      sanitizeCsv(appt.doctorDiagnosis || appt.conditionName || (isNoShowAppointment(appt) ? "Missed Appointment" : "Consultation Request")),
      sanitizeCsv(cleanPatientNotes(appt.clinicNote || "")),
      sanitizeCsv(appt.emergencyContactName?.trim() || "Not provided"),
      sanitizeCsv(appt.emergencyRelationship?.trim() || "Not provided"),
      sanitizeCsv(formatContactCsv(appt.emergencyContactPhone)),
    ]);

    const csvContent = "\uFEFF" + [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\r\n");

    const categorySlug = historyTab === "all" ? "All_Visits" : historyTab === "completed" ? "Completed_Visits" : historyTab === "no-show" ? "No_Show_Visits" : "Cancelled_Visits";
    const dateSlug = fromDate && toDate ? `${fromDate}_to_${toDate}` : fromDate ? `from_${fromDate}` : toDate ? `to_${toDate}` : "All_Dates";
    const filename = `DermAI_Patient_History_${categorySlug}_${dateSlug}.csv`;

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [isExportDisabled, searchFilteredHistory, historyTab, fromDate, toDate]);

  // PDF Export Handler using jsPDF
  const handleExportPdf = useCallback(() => {
    if (isExportDisabled || searchFilteredHistory.length === 0) return;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;

    const totalMatching = searchFilteredHistory.length;
    const completedCount = searchFilteredHistory.filter(a => !isNoShowAppointment(a) && (a.status === "completed" || a.doctorDone || a.checkInStatus === "completed")).length;
    const noShowCount = searchFilteredHistory.filter(isNoShowAppointment).length;
    const cancelledCount = totalMatching - completedCount - noShowCount;
    const uniquePatientsCount = new Set(searchFilteredHistory.map(a => a.patientId || a.userId || a.patientName || a.id)).size;

    let y = margin;

    // Header Branding
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text("DermAI", margin, y + 4);

    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text("Patient Consultation History Report", margin, y + 10);

    y += 15;

    // Metadata Block (Col 1 & Col 2)
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);

    const col1X = margin;
    const col2X = margin + 95;

    doc.text("Attending Doctor: ", col1X, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(doctorName ? `Dr. ${doctorName}` : "Attending Physician", col1X + 26, y);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Clinic Branch: ", col1X, y + 4.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(activeClinicName || "All Clinics (Consolidated)", col1X + 26, y + 4.5);

    const categoryLabel = historyTab === "all" ? "All Past Appointments" : historyTab === "completed" ? "Completed Visits" : historyTab === "no-show" ? "No-Show Visits" : "Cancelled Visits";
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("History Filter: ", col1X, y + 9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(categoryLabel, col1X + 26, y + 9);

    const dateRangeLabel = fromDate && toDate ? `${fromDate} to ${toDate}` : fromDate ? `From ${fromDate}` : toDate ? `Up to ${toDate}` : "All Historical Records";
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Scheduled Dates: ", col2X, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(dateRangeLabel, col2X + 28, y);

    const nowManila = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Generated Date: ", col2X, y + 4.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(nowManila, col2X + 28, y + 4.5);

    y += 14;

    // Divider
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, y, margin + contentWidth, y);

    y += 4;

    // Summary Metrics Banner
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, contentWidth, 13, 2, 2, "F");
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, 13, 2, 2, "D");

    const summaryItems = [
      { label: "Total Matches", value: totalMatching },
      { label: "Completed", value: completedCount },
      { label: "Cancelled", value: cancelledCount },
      { label: "No-Show", value: noShowCount },
      { label: "Unique Patients", value: uniquePatientsCount },
    ];
    const metricColWidth = contentWidth / 5;
    summaryItems.forEach((m, idx) => {
      const mx = margin + idx * metricColWidth;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(m.label, mx + 3, y + 4.5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(String(m.value), mx + 3, y + 10.5);
    });

    y += 16;

    // Table Column Headers
    const cols = [
      { header: "#", width: 10, align: "center" as const },
      { header: "Patient", width: 44, align: "left" as const },
      { header: "Schedule", width: 34, align: "left" as const },
      { header: "Clinic", width: 36, align: "left" as const },
      { header: "Status", width: 22, align: "center" as const },
      { header: "Diagnosis / Concern", width: 36, align: "left" as const },
    ];

    const renderTableHeader = (headerY: number) => {
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, headerY, contentWidth, 6.5, "F");
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.2);
      doc.line(margin, headerY + 6.5, margin + contentWidth, headerY + 6.5);

      let curX = margin;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      cols.forEach((col) => {
        if (col.align === "center") {
          doc.text(col.header, curX + col.width / 2, headerY + 4.5, { align: "center" });
        } else {
          doc.text(col.header, curX + 2, headerY + 4.5);
        }
        curX += col.width;
      });
    };

    renderTableHeader(y);
    y += 6.5;

    const maxY = pageHeight - 15;

    // Table Rows
    searchFilteredHistory.forEach((appt, rowIdx) => {
      const patientName = appt.patientName?.trim() || "Not provided";
      const pid = formatPatientId(appt);
      const phoneVal = appt.patientContact?.trim() ? appt.patientContact.trim() : "Not provided";
      const emailVal = appt.patientEmail?.trim() ? appt.patientEmail.trim() : "Not provided";
      const phoneText = `Phone: ${phoneVal}`;
      const emailText = `Email: ${emailVal}`;
      const emName = appt.emergencyContactName?.trim() || "Not provided";
      const emRel = appt.emergencyRelationship?.trim() || "Not provided";
      const emPhone = appt.emergencyContactPhone?.trim() || "Not provided";
      const emText = `Emerg. Contact: ${emName}\nEmerg. Rel: ${emRel}\nEmerg. Phone: ${emPhone}`;
      const sched = `${appt.date || "No date"}\n${appt.time || ""}`.trim();
      const clinic = appt.clinicName || "Clinic Branch";
      const statusLbl = historyStatusLabel(appt);
      const diagnosis = appt.doctorDiagnosis || appt.conditionName || (isNoShowAppointment(appt) ? "Missed Appointment" : "Consultation Request");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      const nameLines = doc.splitTextToSize(patientName, cols[1].width - 4);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      const metaLines = doc.splitTextToSize(`${pid}\n${phoneText}\n${emailText}\n${emText}`, cols[1].width - 4);

      const pTotalLines = nameLines.length + metaLines.length;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      const sLines = doc.splitTextToSize(sched, cols[2].width - 4);
      const cLines = doc.splitTextToSize(clinic, cols[3].width - 4);
      const dLines = doc.splitTextToSize(diagnosis, cols[5].width - 4);

      const maxLines = Math.max(pTotalLines, sLines.length, cLines.length, dLines.length, 1);
      const rowHeight = Math.max(maxLines * 3.1 + 2.5, 7.5);

      if (y + rowHeight > maxY) {
        doc.addPage();
        y = margin;
        renderTableHeader(y);
        y += 6.5;
      }

      if (rowIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentWidth, rowHeight, "F");
      }
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y + rowHeight, margin + contentWidth, y + rowHeight);

      let curX = margin;

      // Col 0: Index
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(String(rowIdx + 1), curX + cols[0].width / 2, y + 4.2, { align: "center" });
      curX += cols[0].width;

      // Col 1: Patient (Name, ID, Phone, Email)
      let curLineIdx = 0;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      nameLines.forEach((nLine: string) => {
        doc.text(nLine, curX + 2, y + 4 + curLineIdx * 3.1);
        curLineIdx++;
      });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      metaLines.forEach((mLine: string) => {
        doc.text(mLine, curX + 2, y + 4 + curLineIdx * 3.1);
        curLineIdx++;
      });
      curX += cols[1].width;

      // Col 2: Schedule
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      sLines.forEach((lineText: string, li: number) => {
        doc.text(lineText, curX + 2, y + 4 + li * 3.1);
      });
      curX += cols[2].width;

      // Col 3: Clinic
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      cLines.forEach((lineText: string, li: number) => {
        doc.text(lineText, curX + 2, y + 4 + li * 3.1);
      });
      curX += cols[3].width;

      // Col 4: Status
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      if (statusLbl === "No-Show") {
        doc.setTextColor(190, 18, 60);
      } else if (statusLbl === "Completed") {
        doc.setTextColor(4, 120, 87);
      } else {
        doc.setTextColor(180, 83, 9);
      }
      doc.text(statusLbl, curX + cols[4].width / 2, y + 4.2, { align: "center" });
      curX += cols[4].width;

      // Col 5: Diagnosis / Concern
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      dLines.forEach((lineText: string, li: number) => {
        doc.text(lineText, curX + 2, y + 4 + li * 3.1);
      });

      y += rowHeight;
    });

    // Footers across all pages
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(margin, pageHeight - 10, margin + contentWidth, pageHeight - 10);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text("Confidential Medical History Record — DermAI Clinical Portal. Authorized practitioner use only.", margin, pageHeight - 6);
      doc.text(`Page ${p} of ${totalPages}`, margin + contentWidth, pageHeight - 6, { align: "right" });
    }

    const categorySlug = historyTab === "all" ? "All_Visits" : historyTab === "completed" ? "Completed_Visits" : historyTab === "no-show" ? "No_Show_Visits" : "Cancelled_Visits";
    const dateSlug = fromDate && toDate ? `${fromDate}_to_${toDate}` : fromDate ? `from_${fromDate}` : toDate ? `to_${toDate}` : "All_Dates";
    const pdfFilename = `DermAI_Patient_History_${categorySlug}_${dateSlug}.pdf`;

    doc.save(pdfFilename);
  }, [isExportDisabled, searchFilteredHistory, doctorName, activeClinicName, historyTab, fromDate, toDate]);

  if (loading && !appointments.length) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading patient history records...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-gray-900">Patient History</h1>
          <p className="text-base text-slate-500 mt-1">
            Review past completed consultations, cancelled visits, and no-show records.
          </p>
          {/* Clinic branch isolation badge */}
          {activeClinicName ? (
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-xs font-semibold text-blue-700">
              <Building2 className="w-3 h-3 text-blue-500 shrink-0" />
              <span>Isolated to: {activeClinicName}</span>
            </div>
          ) : null}
        </div>
        <div className="relative w-full sm:w-auto">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search patient name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-full sm:w-64 md:w-80"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards - Framed container matching Dashboard summary cards styling */}
      <div className="rounded-2xl sm:rounded-3xl border border-slate-200/80 bg-[#F8F8FA] p-3.5 sm:p-5 lg:p-6 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
          {/* Card 1: Total Past Appointments */}
          <button
            type="button"
            onClick={() => setHistoryTab("all")}
            className={cn(
              "bg-white rounded-2xl border shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden text-left transition-all cursor-pointer",
              historyTab === "all" ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-100 hover:border-slate-200"
            )}
          >
            {/* Top row */}
            <div className="px-5 py-4 flex items-center gap-2.5">
              <Stethoscope className="w-5 h-5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-sm font-bold text-slate-800 tracking-tight truncate">
                Total Past Appointments
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-5 pt-4 pb-5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none block">
                {authorizedHistory.length}
              </span>
              <p className="text-xs text-slate-400 mt-2 font-medium tracking-tight truncate">
                All patient records
              </p>
            </div>
          </button>

          {/* Card 2: Completed Visits */}
          <button
            type="button"
            onClick={() => setHistoryTab("completed")}
            className={cn(
              "bg-white rounded-2xl border shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden text-left transition-all cursor-pointer",
              historyTab === "completed" ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-100 hover:border-slate-200"
            )}
          >
            {/* Top row */}
            <div className="px-5 py-4 flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-sm font-bold text-slate-800 tracking-tight truncate">
                Completed Visits
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-5 pt-4 pb-5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none block">
                {completedList.length}
              </span>
              <p className="text-xs text-slate-400 mt-2 font-medium tracking-tight truncate">
                Finished consultations
              </p>
            </div>
          </button>

          {/* Card 3: Cancelled Visits */}
          <button
            type="button"
            onClick={() => setHistoryTab("rejected")}
            className={cn(
              "bg-white rounded-2xl border shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden text-left transition-all cursor-pointer",
              historyTab === "rejected" ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-100 hover:border-slate-200"
            )}
          >
            {/* Top row */}
            <div className="px-5 py-4 flex items-center gap-2.5">
              <FileCheck className="w-5 h-5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-sm font-bold text-slate-800 tracking-tight truncate">
                Cancelled Visits
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-5 pt-4 pb-5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none block">
                {cancelledList.length}
              </span>
              <p className="text-xs text-slate-400 mt-2 font-medium tracking-tight truncate">
                Cancelled &amp; archived
              </p>
            </div>
          </button>

          {/* Card 4: No-Show Visits */}
          <button
            type="button"
            onClick={() => setHistoryTab("no-show")}
            className={cn(
              "bg-white rounded-2xl border shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden text-left transition-all cursor-pointer",
              historyTab === "no-show" ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-100 hover:border-slate-200"
            )}
          >
            {/* Top row */}
            <div className="px-5 py-4 flex items-center gap-2.5">
              <CalendarX2 className="w-5 h-5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-sm font-bold text-slate-800 tracking-tight truncate">
                No-Show Visits
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-5 pt-4 pb-5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none block">
                {noShowList.length}
              </span>
              <p className="text-xs text-slate-400 mt-2 font-medium tracking-tight truncate">
                Missed appointments
              </p>
            </div>
          </button>

          {/* Card 5: Total Patients */}
          <button
            type="button"
            onClick={() => setHistoryTab("all")}
            className={cn(
              "bg-white rounded-2xl border shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden text-left transition-all cursor-pointer",
              historyTab === "all" ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-100 hover:border-slate-200"
            )}
          >
            {/* Top row */}
            <div className="px-5 py-4 flex items-center gap-2.5">
              <User className="w-5 h-5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-sm font-bold text-slate-800 tracking-tight truncate">
                Total Patients
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-5 pt-4 pb-5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none block">
                {allPatients.length}
              </span>
              <p className="text-xs text-slate-400 mt-2 font-medium tracking-tight truncate">
                With past history
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200/80 overflow-x-auto whitespace-nowrap pb-px no-scrollbar scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {[
          { key: "all" as const, label: "All Past Appointments" },
          { key: "completed" as const, label: "Completed Visits" },
          { key: "rejected" as const, label: "Cancelled Visits" },
          { key: "no-show" as const, label: "No-Show Visits" },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setHistoryTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors cursor-pointer shrink-0 ${
              historyTab === key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Date Filter & Export Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-3 sm:p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Left: Date Inputs */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 text-slate-600 font-medium">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Schedule Filter:</span>
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="patient-history-from-date" className="text-slate-500 font-medium">From</label>
            <input
              id="patient-history-from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="patient-history-to-date" className="text-slate-500 font-medium">To</label>
            <input
              id="patient-history-to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setFromDate(""); setToDate(""); }}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 underline px-1 py-1 cursor-pointer"
            >
              Clear
            </button>
          )}
          {dateRangeError && (
            <span className="text-xs text-rose-600 font-medium">
              {dateRangeError}
            </span>
          )}
        </div>

        {/* Right: Export Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={isExportDisabled}
            title={exportDisabledTooltip || "Export matching records as CSV"}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer",
              isExportDisabled
                ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-60"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
            )}
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExportDisabled}
            title={exportDisabledTooltip || "Export matching records as PDF"}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer",
              isExportDisabled
                ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-60"
                : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
            )}
          >
            <FileText className="w-3.5 h-3.5 text-blue-600" />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {tabPatients.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/90 flex flex-col items-center justify-center py-20 text-center px-6 shadow-xs">
          {activeClinicName && !search && !fromDate && !toDate ? (
            <>
              <Building2 className="w-8 h-8 text-blue-200 mb-3" />
              <p className="text-base font-semibold text-gray-700">
                No patient records recorded for {activeClinicName} yet.
              </p>
              <p className="text-sm text-gray-400 max-w-sm mt-1">
                Only records from the selected clinic appear here. Select another clinic in the Branch Switcher to view its records.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-gray-700">
                {dateRangeError ? dateRangeError : search || fromDate || toDate ? "No matching records found" : "No consultation history yet"}
              </p>
              {(search || fromDate || toDate) && !dateRangeError && (
                <p className="text-sm text-gray-400 max-w-xs mt-1">
                  Try adjusting your search query or date range filters.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-xs min-w-0">
          <div className="overflow-x-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#F8F9FA] border-b border-slate-200/80 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Patient</th>
                  <th className="px-4 py-3">Latest Diagnosis / Concern</th>
                  <th className="px-4 py-3">Latest Status</th>
                  <th className="px-4 py-3">Clinic</th>
                  <th className="px-4 py-3">Latest Schedule Date</th>
                  <th className="px-4 py-3">Consultations</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tabPatients.map((patient, i) => {
                  const appt = patient.latest;
                  const status = historyStatus(appt);
                  const isCompleted = status === "completed";
                  const isApproved = status === "approved";
                  const isPending = status === "pending";
                  const isRejected = status === "rejected";

                  return (
                    <motion.tr
                      key={patient.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <PatientAvatar
                            avatarUrl={appt.patientAvatar}
                            fullName={appt.patientName}
                            sizeClass="w-9 h-9"
                            borderClass="border border-gray-200"
                            className="shrink-0"
                          />
                          <div>
                            <p className="font-semibold text-gray-900">{appt.patientName || "Not provided"}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Patient ID: {formatPatientId(appt)}
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              {appt.patientGender && (
                                <span className="text-[11px] font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.2 rounded">
                                  {appt.patientGender}
                                </span>
                              )}
                              {Number.isFinite(appt.patientAge) && (
                                <span className="text-sm text-gray-400">{appt.patientAge} yrs old</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {appt.doctorDiagnosis ? (
                          <div>
                            <p className="font-semibold text-gray-900 text-sm">{appt.doctorDiagnosis}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{cleanPatientNotes(appt.notes) || appt.conditionName || "Not provided"}</p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-blue-600 font-medium text-sm">{appt.conditionName || "Consultation Request"}</p>
                            {cleanPatientNotes(appt.notes) && (
                              <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{cleanPatientNotes(appt.notes)}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {appt.checkInStatus === "no-show" || appt.status === "no-show" ? (
                          <span className="text-sm font-semibold text-rose-700">
                            No-Show
                          </span>
                        ) : appt.checkInStatus === "arrived" || appt.status === "arrived" ? (
                          <span className="text-sm font-semibold text-emerald-800">
                            Arrived
                          </span>
                        ) : isCompleted ? (
                          <span className="text-sm font-semibold text-emerald-700">
                            Completed
                          </span>
                        ) : isApproved ? (
                          <span className="text-sm font-semibold text-blue-700">
                            Approved
                          </span>
                        ) : isPending ? (
                          <span className="text-sm font-semibold text-amber-700">
                            Pending Review
                          </span>
                        ) : isRejected ? (
                          <span className="text-sm font-semibold text-red-700">
                            Declined
                          </span>
                        ) : (
                          <span className="text-sm font-semibold text-gray-700">
                            Reviewed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-gray-500 text-xs">
                        {appt.clinicName ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100/80 max-w-40 truncate">
                            <Building2 className="w-3 h-3 text-blue-500 shrink-0" />
                            <span className="truncate">{appt.clinicName}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-gray-700 whitespace-nowrap text-xs">
                        {formatDate(appt.date, appt.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-gray-700 whitespace-nowrap text-xs">
                        {patient.appointments.length} {patient.appointments.length === 1 ? "consultation" : "consultations"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setViewingPatientId(patient.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold hover:bg-blue-100 transition-colors cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" /> View
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <ModalPortal isOpen={Boolean(viewingAppt)}>
        <AnimatePresence>
          {viewingAppt && viewingPatient && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
              onClick={() => setViewingPatientId(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ duration: 0.2 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh] relative z-[9999]"
                role="dialog"
                aria-modal="true"
                aria-label="Patient consultation history"
                onClick={(e) => e.stopPropagation()}
              >
              {/* Header */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-gray-100 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-gray-900 truncate">Patient Consultation History</h2>
                  <p className="text-sm text-gray-400 mt-0.5 truncate">{modalAppointments.length} past {modalAppointments.length === 1 ? "consultation" : "consultations"} &middot; Completed, Cancelled &amp; No-Show</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <button
                    onClick={() => setViewingPatientId(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 overflow-y-auto flex-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {/* Patient Header */}
                <div className="flex items-center gap-4">
                  <PatientAvatar
                    avatarUrl={viewingAppt.patientAvatar}
                    fullName={viewingAppt.patientName}
                    sizeClass="w-14 h-14"
                    borderClass="border border-gray-200"
                    className="shrink-0"
                  />
                  <div>
                    <p className="text-lg font-bold text-gray-900">{viewingAppt.patientName || "Not provided"}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {viewingAppt.patientGender && (
                        <span className="text-[11px] font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                          {viewingAppt.patientGender}
                        </span> 
                      )}
                      {viewingAppt.patientAge ? (
                        <span className="text-sm text-gray-400">{viewingAppt.patientAge} years old</span>
                      ) : viewingAppt.patientBirthdate ? (
                        <span className="text-sm text-gray-400">Born {viewingAppt.patientBirthdate}</span>
                      ) : null}
                      <span className="text-sm font-medium text-blue-600">
                        {viewingAppt.conditionName || "Not provided"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 border-l-2 border-blue-100 pl-3">
                {modalAppointments.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">
                    No past completed, cancelled, or no-show visits recorded for this patient.
                  </div>
                ) : (
                  modalAppointments.map((viewingAppt, index) => {
                  const viewCond = skinConditions.find(c => c.id === viewingAppt.conditionId || c.name.toLowerCase() === viewingAppt.aiConditionName?.toLowerCase());
                  const cleanNotes = cleanPatientNotes(viewingAppt.notes);
                  return (
                    <details key={viewingAppt.id} open={index === 0} className="rounded-xl border border-slate-200 p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                        {formatDate(viewingAppt.date, viewingAppt.createdAt)} &middot; {formatTime(viewingAppt.time)} &middot; {historyStatusLabel(viewingAppt)}
                        {isNoShowAppointment(viewingAppt) && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 ml-2">
                            No-Show
                          </span>
                        )}
                        <span className="block mt-1 text-xs text-slate-500">{viewingAppt.clinicName} &middot; {viewingAppt.doctorDiagnosis || viewingAppt.conditionName || (isNoShowAppointment(viewingAppt) ? "Missed Appointment" : "No diagnosis recorded")}</span>
                      </summary>
                      <div className="space-y-4 mt-4">
                {/* Doctor Diagnosis Box */}
                {(viewingAppt.doctorDiagnosis || viewingAppt.doctorNote) && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 space-y-1.5">
                    <p className="text-[11px] text-blue-600 font-bold uppercase tracking-wide">
                      Doctor's Final Diagnosis
                    </p>
                    <p className="text-base font-bold text-slate-900">{viewingAppt.doctorDiagnosis}</p>
                    {viewingAppt.doctorNote && (
                      <p className="text-sm text-blue-800 leading-relaxed pt-1 border-t border-blue-100/80">
                        <span className="font-semibold">Review Note:</span> {viewingAppt.doctorNote}
                      </p>
                    )}
                  </div>
                )}

                {/* AI Scan Analysis result preview if available */}
                {(viewingAppt.aiConditionName || viewCond) && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-blue-900 uppercase tracking-wide">
                        AI Scan Pre-Screening Result
                      </span>
                      {viewingAppt.aiConfidence !== undefined && (
                        <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                          {formatConfidencePercent(viewingAppt.aiConfidence)} AI Confidence
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-slate-900">
                      {viewingAppt.aiConditionName || viewingAppt.conditionName || viewCond?.name}
                    </p>
                    {viewCond && (
                      <p className="text-sm text-blue-700 leading-relaxed">
                        {viewCond.description}
                      </p>
                    )}
                  </div>
                )}

                {/* Personal Details */}
                {(viewingAppt.patientEmail ||
                  viewingAppt.patientAddress ||
                  viewingAppt.patientContact ||
                  viewingAppt.patientGender ||
                  viewingAppt.patientBirthdate) && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-gray-500" /> Personal Information
                    </p>
                    {viewingAppt.patientGender && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5">Gender</span>
                        <span className="text-gray-700">{viewingAppt.patientGender}</span>
                      </div>
                    )}
                    {viewingAppt.patientBirthdate && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5">Birthdate</span>
                        <span className="text-gray-700">
                          {viewingAppt.patientBirthdate}
                          {viewingAppt.patientAge ? ` (${viewingAppt.patientAge} yrs old)` : ""}
                        </span>
                      </div>
                    )}
                    {viewingAppt.patientEmail && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
                          <Mail className="w-3 h-3" /> Email
                        </span>
                        <span className="text-gray-700">{viewingAppt.patientEmail}</span>
                      </div>
                    )}
                    {viewingAppt.patientContact && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> Contact
                        </span>
                        <span className="text-gray-700">{viewingAppt.patientContact}</span>
                      </div>
                    )}
                    {viewingAppt.patientAddress && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Address
                        </span>
                        <span className="text-gray-700">{viewingAppt.patientAddress}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Emergency Contact */}
                <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    <PhoneCall className="w-3.5 h-3.5 text-gray-500" /> Emergency Contact
                  </p>
                  <div className="flex gap-2 text-sm">
                    <span className="text-sm font-semibold text-gray-400 w-28 sm:w-32 shrink-0 pt-0.5">Full Name</span>
                    <span className="text-gray-700">{viewingAppt.emergencyContactName?.trim() || "Not provided"}</span>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <span className="text-sm font-semibold text-gray-400 w-28 sm:w-32 shrink-0 pt-0.5">Relationship</span>
                    <span className="text-gray-700">{viewingAppt.emergencyRelationship?.trim() || "Not provided"}</span>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <span className="text-sm font-semibold text-gray-400 w-28 sm:w-32 shrink-0 pt-0.5 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> Contact Number
                    </span>
                    <span className="text-gray-700">{viewingAppt.emergencyContactPhone?.trim() || "Not provided"}</span>
                  </div>
                </div>

                {/* Uploaded Skin Photo */}
                {viewingAppt.skinPhotoUrl && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                        Uploaded Skin Photo
                      </p>
                    </div>
                    <ZoomableSkinPhoto
                      pathOrUrl={viewingAppt.skinPhotoUrl}
                      alt="Patient Skin"
                      className="w-full max-h-48 object-contain rounded-xl border border-gray-200 bg-gray-50 cursor-pointer hover:opacity-95 transition-opacity"
                    />
                  </div>
                )}

                {/* Questionnaire Section */}
                {viewingAppt.questionnaireAnswers && viewingAppt.questionnaireAnswers.length > 0 && (
                  <div className="rounded-xl border border-pink-200 overflow-hidden bg-white">
                    <div className="px-4 py-2.5 bg-pink-50 border-b border-pink-100 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <ClipboardList className="w-4 h-4 text-[#c0166a]" />
                        <span className="text-xs font-bold text-pink-900 uppercase tracking-wide">
                          Patient Questionnaire
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-200 text-pink-800">
                        {viewingAppt.questionnaireAnswers.length} responses
                      </span>
                    </div>
                    <div className="p-3.5 space-y-2 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                      {viewingAppt.questionnaireAnswers.map((qa, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                          <p className="font-semibold text-gray-800 mb-0.5">
                            {idx + 1}. {qa.question}
                          </p>
                          <p className="text-[#c0166a] font-medium">{qa.answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Schedule */}
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Appointment Schedule
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                      <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Date</p>
                      <p className="text-sm font-bold text-gray-800">
                        {formatDate(viewingAppt.date, viewingAppt.createdAt)}
                      </p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                      <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Time</p>
                      <p className="text-xl font-bold text-gray-800">{formatTime(viewingAppt.time)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">{viewingAppt.clinicName}</span>
                  </div>
                </div>

                {/* Notes */}
                {viewingAppt.notes && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
                      Patient Symptoms &amp; Notes
                    </p>
                    <p className="text-sm text-gray-700 italic">
                      {cleanNotes ? `"${cleanNotes}"` : "No symptoms or notes provided."}
                    </p>
                  </div>
                )}
                {viewingAppt.clinicNote && <p className="text-sm whitespace-pre-wrap"><strong>Clinic notes:</strong> {viewingAppt.clinicNote}</p>}
                      </div>
                    </details>
                  );
                }))}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-100">
                <button
                  onClick={() => setViewingPatientId(null)}
                  className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>
      </ModalPortal>

    </div>
  );
}
