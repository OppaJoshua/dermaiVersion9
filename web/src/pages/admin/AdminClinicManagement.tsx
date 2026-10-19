import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  CheckCircle2,
  XCircle,
  FileText,
  FileCheck,
  Building2,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { sendClinicApprovalEmail, sendClinicRejectionEmail } from "@/lib/emailService";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

type ClinicStatus = "pending" | "verified" | "rejected";

interface ClinicApplication {
  id: number | string;
  logo?: string;
  name: string;
  location: string;
  address?: string;
  email?: string;
  phone?: string;
  operatingDays?: string;
  openTime?: string;
  closeTime?: string;
  doctor?: string;
  specialization?: string;
  servicesOffered?: string;
  description?: string;
  prcLicense?: string;
  businessPermitUrl?: string;
  businessPermitName?: string;
  dtiSecUrl?: string;
  dtiSecName?: string;
  birUrl?: string;
  birName?: string;
  prcLicenseFileUrl?: string;
  prcLicenseFileName?: string;
  clinicPhotos?: string[];
  latitude?: number;
  longitude?: number;
  dateApplied: string;
  status: ClinicStatus;
  rejectionReason?: string;
}

type StatusType = "all" | "pending" | "verified" | "rejected";

const statusBadge: Record<string, string> = {
  verified: "bg-gray-100 border-gray-300 text-black",
  pending: "bg-magenta-50 border-magenta-200 text-black",
  rejected: "bg-magenta-100 border-magenta-300 text-black",
};

function getInitialApplications(): ClinicApplication[] {
  try {
    const cached = localStorage.getItem("dermai_cached_admin_clinics");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function formatTime12h(timeStr?: string): string {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  const minute = isNaN(m) ? "00" : String(m).padStart(2, "0");
  return `${hour}:${minute} ${ampm}`;
}

export default function AdminClinicManagement() {
  const [applications, setApplications] = useState<ClinicApplication[]>(getInitialApplications);
  const [loading, setLoading] = useState(() => getInitialApplications().length === 0);
  const [activeTab, setActiveTab] = useState<StatusType>("all");
  const [reviewModal, setReviewModal] = useState<number | string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    title: string;
    description: string;
  } | null>(null);

  // Auto-dismiss toast notification after 4 seconds
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadClinics = async () => {
    try {
      // Direct parallel fetch across all relevant tables for ultra-fast response
      const doctorsMap = new Map<string, any>();
      const servicesMap = new Map<string, string[]>();
      const photosMap = new Map<string, string[]>();
      const hoursMap = new Map<string, any>();

      const [
        { data: flatClinics, error: clinicsError },
        { data: flatDoctors },
        { data: flatServices },
        { data: flatPhotos },
        { data: flatHours },
      ] = await Promise.all([
        supabase.from("clinic").select("*").order("name"),
        supabase.from("clinic_doctor").select("clinic_id, doctor_name, prc_license, photo_url, status"),
        supabase.from("clinic_service_offered").select("clinic_id, service_name"),
        supabase.from("clinic_photo").select("clinic_id, photo_url"),
        supabase.from("clinic_operating_hours").select("clinic_id, day_of_week, open_time, close_time"),
      ]);

      if (clinicsError) {
        console.error("Error loading clinics from Supabase:", clinicsError.message);
      }

      const clinicRows = flatClinics || [];

      (flatDoctors || []).forEach((d: any) => {
        if (d.clinic_id && !doctorsMap.has(d.clinic_id)) doctorsMap.set(d.clinic_id, d);
      });
      (flatServices || []).forEach((s: any) => {
        if (s.clinic_id) {
          const list = servicesMap.get(s.clinic_id) || [];
          list.push(s.service_name);
          servicesMap.set(s.clinic_id, list);
        }
      });
      (flatPhotos || []).forEach((p: any) => {
        if (p.clinic_id) {
          const list = photosMap.get(p.clinic_id) || [];
          list.push(p.photo_url);
          photosMap.set(p.clinic_id, list);
        }
      });
      (flatHours || []).forEach((h: any) => {
        if (h.clinic_id && !hoursMap.has(h.clinic_id)) hoursMap.set(h.clinic_id, h);
      });

      // 2. Fetch locally cached full applications
      let localApps: ClinicApplication[] = [];
      try {
        const stored = localStorage.getItem("dermai_clinic_applications");
        if (stored) localApps = JSON.parse(stored);
      } catch {
        /* ignore */
      }

      const dbApps: ClinicApplication[] = clinicRows.map((c: any) => {
        const docObj = Array.isArray(c.clinic_doctor)
          ? c.clinic_doctor[0]
          : c.clinic_doctor || doctorsMap.get(c.clinic_id);

        const schedObj = Array.isArray(c.clinic_operating_hours)
          ? c.clinic_operating_hours[0]
          : c.clinic_operating_hours || hoursMap.get(c.clinic_id);

        const services = Array.isArray(c.clinic_service_offered)
          ? c.clinic_service_offered.map((s: any) => s.service_name).join(", ")
          : (servicesMap.get(c.clinic_id) || []).join(", ");

        const photos = Array.isArray(c.clinic_photo)
          ? c.clinic_photo.map((p: any) => p.photo_url)
          : photosMap.get(c.clinic_id) || [];

        const localMatch = localApps.find(
          (l) =>
            String(l.id) === String(c.clinic_id) ||
            (l.email && c.email && l.email.toLowerCase().trim() === c.email.toLowerCase().trim())
        );

        return {
          id: c.clinic_id,
          logo: c.logo_url || localMatch?.logo || "",
          name: c.name,
          location: c.district ?? "Cebu",
          address: c.address ?? localMatch?.address ?? "",
          email: c.email ?? localMatch?.email ?? "",
          phone: c.phone ?? localMatch?.phone ?? "",
          operatingDays: schedObj?.day_of_week ?? localMatch?.operatingDays ?? "Monday - Saturday",
          openTime: schedObj?.open_time ?? localMatch?.openTime ?? "08:00",
          closeTime: schedObj?.close_time ?? localMatch?.closeTime ?? "17:00",
          doctor: docObj?.doctor_name ?? localMatch?.doctor ?? "—",
          specialization: c.specialization ?? docObj?.specialization ?? localMatch?.specialization ?? "General Dermatology",
          servicesOffered: services || localMatch?.servicesOffered || "—",
          description: c.description ?? localMatch?.description ?? "—",
          prcLicense: docObj?.prc_license ?? localMatch?.prcLicense ?? "—",
          businessPermitUrl: c.business_permit_url || localMatch?.businessPermitUrl || "",
          businessPermitName: c.business_permit_name || localMatch?.businessPermitName || "Mayor's / Business Permit",
          dtiSecUrl: c.dti_sec_url || localMatch?.dtiSecUrl || "",
          dtiSecName: c.dti_sec_name || localMatch?.dtiSecName || "DTI / SEC Certificate",
          birUrl: c.bir_url || localMatch?.birUrl || "",
          birName: c.bir_name || localMatch?.birName || "BIR 2303 Certificate",
          prcLicenseFileUrl: c.prc_license_file_url || docObj?.photo_url || localMatch?.prcLicenseFileUrl || "",
          prcLicenseFileName: c.prc_license_file_name || localMatch?.prcLicenseFileName || "PRC License Copy",
          clinicPhotos: photos.length > 0 ? photos : localMatch?.clinicPhotos || [],
          latitude: c.latitude != null ? Number(c.latitude) : localMatch?.latitude,
          longitude: c.longitude != null ? Number(c.longitude) : localMatch?.longitude,
          dateApplied: localMatch?.dateApplied || "Recent",
          status: (
            String(c.status || "").toLowerCase().trim() === "approved"
              ? "verified"
              : String(c.status || "").toLowerCase().trim() === "rejected"
                ? "rejected"
                : "pending"
          ) as ClinicStatus,
        };
      });

      // Merge local-only apps that have not yet replicated to DB
      const combinedApps = [...dbApps];
      localApps.forEach((la) => {
        if (
          !combinedApps.some(
            (ca) =>
              String(ca.id) === String(la.id) ||
              (ca.email && la.email && ca.email.toLowerCase().trim() === la.email.toLowerCase().trim())
          )
        ) {
          combinedApps.push(la);
        }
      });

      setApplications(combinedApps);
      try {
        localStorage.setItem("dermai_cached_admin_clinics", JSON.stringify(combinedApps));
      } catch { }
    } catch (err) {
      console.error("Failed to load clinics:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClinics();

    // Realtime listener for clinic database updates
    const channel = supabase
      .channel("admin-clinic-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clinic" },
        () => {
          loadClinics();
        }
      )
      .subscribe();

    const handleStorage = () => loadClinics();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("clinicRegistered", handleStorage);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("clinicRegistered", handleStorage);
    };
  }, []);

  const approveClinic = async (id: number | string) => {
    const target = applications.find((a) => a.id === id);
    if (!target || isProcessing) return;

    // 1. Instant optimistic state & cache update (0ms UI transition)
    const updatedList = applications.map((app) =>
      app.id === id
        ? { ...app, status: "verified" as ClinicStatus, rejectionReason: "" }
        : app
    );
    setApplications(updatedList);
    try {
      localStorage.setItem("dermai_cached_admin_clinics", JSON.stringify(updatedList));
      localStorage.setItem("dermai_clinic_applications", JSON.stringify(updatedList));
      window.dispatchEvent(new Event("clinicStatusUpdated"));
    } catch { }

    setToast({
      type: "success",
      title: "Clinic Verified & Approved",
      description: `${target.name} has been approved. Clinic permissions and directory listings are now active.`,
    });

    // 2. Background database synchronization
    try {
      await Promise.allSettled([
        supabase.rpc("set_clinic_status", {
          target_clinic_id: String(id),
          new_status: "approved",
        }),
        supabase.from("clinic").update({
          status: "approved",
          verified: true,
          ...(target.logo ? { logo_url: target.logo } : {})
        }).eq("clinic_id", id),
        target.email
          ? (async () => {
            await sendClinicApprovalEmail({
              clinicId: id,
              clinicName: target.name,
              recipientEmail: target.email!,
              doctorName: target.doctor,
            });
            const emailTrimmed = target.email!.toLowerCase().trim();
            const { data: matchedUser } = await supabase
              .from("user")
              .select("user_id")
              .ilike("email", emailTrimmed)
              .maybeSingle();

            if (matchedUser) {
              await Promise.allSettled([
                supabase.from("user").update({ role: "clinic" }).eq("user_id", matchedUser.user_id),
                supabase.from("clinic").update({ owner_user_id: matchedUser.user_id }).eq("clinic_id", id),
              ]);
            }
          })()
          : Promise.resolve(),
      ]);
    } catch (err: any) {
      console.warn("Background clinic status sync:", err.message);
    }
  };

  const rejectClinic = async (id: number | string) => {
    const target = applications.find((a) => a.id === id);
    if (!target || isProcessing) return;

    setIsProcessing(true);
    const reason = rejectReason.trim();
    try {
      // 1. Call database RPC function
      const { error: rpcError } = await supabase.rpc("set_clinic_status", {
        target_clinic_id: String(id),
        new_status: "rejected",
        reason,
      });

      // 2. Direct fallback if RPC fails
      if (rpcError) {
        console.warn("set_clinic_status RPC returned error, attempting direct table update:", rpcError.message);
        await supabase
          .from("clinic")
          .update({ status: "rejected" })
          .eq("clinic_id", id);
      }

      // 3. Send Rejection Email & In-App Notification
      if (target.email) {
        await sendClinicRejectionEmail({
          clinicName: target.name,
          recipientEmail: target.email,
          reason,
        });

        setToast({
          type: "error",
          title: "Clinic Application Rejected",
          description: `Application for ${target.name} has been rejected.`,
        });
      }

      setApplications((prev) =>
        prev.map((app) =>
          app.id === id
            ? {
              ...app,
              status: "rejected" as ClinicStatus,
              rejectionReason: reason || "Incomplete or invalid requirements.",
            }
            : app
        )
      );

      // Sync local storage
      try {
        const stored = localStorage.getItem("dermai_clinic_applications");
        if (stored) {
          const parsed = JSON.parse(stored);
          const updated = parsed.map((a: any) =>
            String(a.id) === String(id)
              ? { ...a, status: "rejected", rejectionReason: reason || "Incomplete or invalid requirements." }
              : a
          );
          localStorage.setItem("dermai_clinic_applications", JSON.stringify(updated));
          localStorage.setItem("dermai_cached_admin_clinics", JSON.stringify(updated));
          window.dispatchEvent(new Event("clinicStatusUpdated"));
        }
      } catch {
        /* ignore */
      }

      setReviewModal(null);
      setRejectReason("");
    } catch (err: any) {
      console.error("Failed to reject clinic:", err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const filtered = applications.filter(
    (c) => activeTab === "all" || c.status === activeTab
  );

  const modalClinic = applications.find((c) => c.id === reviewModal);

  const openDocument = (url: string) => {
    if (!url) return;
    if (
      url.startsWith("data:image/") ||
      url.match(/\.(png|jpe?g|webp|gif|svg)($|\?)/i)
    ) {
      setPreviewImage(url);
    } else if (url.startsWith("data:application/pdf")) {
      try {
        const arr = url.split(",");
        const mime = arr[0].match(/:(.*?);/)?.[1] || "application/pdf";
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank");
      } catch {
        window.open(url, "_blank");
      }
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const pendingCount = applications.filter((a) => a.status === "pending").length;
  const verifiedCount = applications.filter((a) => a.status === "verified").length;
  const rejectedCount = applications.filter((a) => a.status === "rejected").length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-black">
            Clinic Management
          </h1>
          <p className="text-sm text-gray-600 mt-1">Review and manage clinic applications and credentials.</p>
        </div>
        <button
          onClick={loadClinics}
          disabled={loading}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white border border-gray-300 text-black text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
          title="Refresh clinics from database"
        >
          <RefreshCw className={cn("w-4 h-4 text-magenta-600", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="px-6 py-4 rounded-xl border border-gray-200 border-l-4 border-l-magenta-500 bg-white shadow-sm flex items-center justify-between gap-4 text-sm"
          >
            <div className="flex items-center gap-3">
              {toast.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 text-magenta-600 shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-magenta-600 shrink-0" />
              )}
              <div>
                <p className="font-semibold text-black">{toast.title}</p>
                <p className="text-gray-700 mt-0.5">{toast.description}</p>
              </div>
            </div>

            <button
              onClick={() => setToast(null)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-black hover:bg-gray-100 transition-colors shrink-0"
              title="Dismiss"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters with counts */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-black mr-2">Status</span>
        {[
          { key: "all" as StatusType, label: "All", count: applications.length },
          { key: "pending" as StatusType, label: "Pending", count: pendingCount },
          { key: "verified" as StatusType, label: "Verified", count: verifiedCount },
          { key: "rejected" as StatusType, label: "Rejected", count: rejectedCount },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer",
              activeTab === tab.key
                ? "bg-magenta-600 text-white"
                : "bg-gray-100 text-black hover:bg-gray-200"
            )}
          >
            <span>{tab.label}</span>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs font-bold leading-none",
                activeTab === tab.key
                  ? "bg-white/20 text-white"
                  : tab.key === "pending" && tab.count > 0
                    ? "bg-magenta-50 text-black border border-magenta-200"
                    : "bg-white text-black border border-gray-200"
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-7 py-5 border-b border-gray-200 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-black">Clinic applications</h2>
          <span className="text-sm text-gray-600">{filtered.length} shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-black">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Clinic name</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Location</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Contact</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Status</th>
                <th className="text-right text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((clinic) => (
                <tr key={clinic.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-7 py-5">
                    <div className="flex items-center gap-4">
                      {clinic.logo ? (
                        <img src={clinic.logo} alt="" className="w-12 h-12 rounded-xl object-cover border border-gray-200" />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-black font-bold text-base">
                          {clinic.name[0]}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold text-black">{clinic.name}</p>
                          {clinic.status === "verified" && (
                            <VerifiedBadge size={15} className="w-3.5 h-3.5" title="Verified Clinic" />
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">{clinic.specialization}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-7 py-5 text-sm text-black">{clinic.location}</td>
                  <td className="px-7 py-5 text-xs">
                    <p className="text-sm font-semibold text-black">{clinic.phone || "—"}</p>
                    <p className="text-gray-600 truncate max-w-[180px] mt-0.5">{clinic.email || ""}</p>
                  </td>
                  <td className="px-7 py-5">
                    <span className={cn("inline-flex px-3 py-1 rounded-full border text-xs font-semibold capitalize", statusBadge[clinic.status])}>
                      {clinic.status}
                    </span>
                  </td>
                  <td className="px-7 py-5 text-right">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => setReviewModal(clinic.id)}
                        className={cn(
                          "px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer",
                          clinic.status === "pending"
                            ? "bg-magenta-600 text-white hover:bg-magenta-700"
                            : "border border-gray-300 bg-white text-black hover:bg-gray-50"
                        )}
                      >
                        {clinic.status === "pending" ? "View & review" : "View details"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="px-7 py-16 text-center">
            <Building2 className="w-8 h-8 text-magenta-600 mx-auto mb-3" />
            <p className="text-base font-semibold text-black">No clinics found in this category</p>
            <p className="text-sm text-gray-600 mt-1 max-w-sm mx-auto">
              {activeTab === "pending"
                ? "There are currently no new clinic applications waiting for verification."
                : "No registered clinics match the selected status filter."}
            </p>
          </div>
        )}
      </div>

      {/* Review Modal */}
      <AnimatePresence>
        {reviewModal && modalClinic && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setReviewModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-8 py-6 border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-3">
                  <Building2 className="w-6 h-6 text-magenta-600" />
                  <div>
                    <h2 className="text-xl font-display font-bold text-black">
                      Clinic application details
                    </h2>
                    <p className="text-sm text-gray-600">Review submitted verification documents</p>
                  </div>
                </div>
                <button
                  onClick={() => setReviewModal(null)}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-black transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-8 py-6 space-y-6 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Verification status</span>
                  <span className={cn("inline-flex px-3 py-1 rounded-full border text-xs font-semibold capitalize", statusBadge[modalClinic.status])}>
                    {modalClinic.status}
                  </span>
                </div>

                {/* Logo & Header */}
                <div className="flex items-center gap-5 p-5 rounded-xl bg-gray-50 border border-gray-200">
                  {modalClinic.logo ? (
                    <img src={modalClinic.logo} alt="Clinic Logo" className="w-16 h-16 object-cover rounded-xl border border-gray-200 bg-white" />
                  ) : (
                    <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center text-black font-bold text-xl border border-gray-200">
                      {modalClinic.name[0]}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-lg font-bold text-black">{modalClinic.name}</h3>
                      {modalClinic.status === "verified" && (
                        <VerifiedBadge size={16} className="w-4 h-4" title="Verified Clinic" />
                      )}
                    </div>
                    <p className="text-sm text-magenta-700 font-medium">{modalClinic.specialization}</p>
                    <p className="text-sm text-gray-700 mt-0.5">{modalClinic.address || modalClinic.location}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-xs text-gray-600 block mb-1">Official email</span>
                    <p className="font-semibold text-black truncate">{modalClinic.email || "—"}</p>
                  </div>
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-xs text-gray-600 block mb-1">Contact number</span>
                    <p className="font-semibold text-black">{modalClinic.phone || "—"}</p>
                  </div>
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-xs text-gray-600 block mb-1">Operating hours</span>
                    <p className="font-semibold text-black">{modalClinic.operatingDays || "Mon - Sat"} ({formatTime12h(modalClinic.openTime || "08:00")} – {formatTime12h(modalClinic.closeTime || "17:00")})</p>
                  </div>
                </div>

                {/* Services & Description */}
                <div className="p-5 bg-gray-50 border border-gray-200 rounded-xl text-sm space-y-3">
                  <div>
                    <span className="text-xs text-gray-600">Services offered</span>
                    <p className="text-black font-semibold mt-0.5">{modalClinic.servicesOffered || "—"}</p>
                  </div>
                  {modalClinic.description && modalClinic.description !== "—" && (
                    <div>
                      <span className="text-xs text-gray-600">Description</span>
                      <p className="text-black mt-0.5 leading-relaxed">{modalClinic.description}</p>
                    </div>
                  )}
                </div>

                {/* Uploaded Documents */}
                <div className="pt-5 border-t border-gray-200">
                  <p className="text-sm font-semibold text-black mb-3">
                    Legal business verification documents
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* 1. Mayor's / Business Permit */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <FileText className="w-5 h-5 text-magenta-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-black truncate">Mayor's Permit</p>
                          <p className="text-xs text-gray-600 truncate">{modalClinic.businessPermitName || "Business Permit"}</p>
                        </div>
                      </div>
                      {modalClinic.businessPermitUrl ? (
                        <button
                          type="button"
                          onClick={() => openDocument(modalClinic.businessPermitUrl!)}
                          className="w-full py-2 px-3 rounded-lg bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors cursor-pointer"
                        >
                          View permit
                        </button>
                      ) : (
                        <span className="text-xs text-gray-600 italic text-center py-2">No file attached</span>
                      )}
                    </div>

                    {/* 2. DTI Certificate / SEC Registration */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="w-5 h-5 text-magenta-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-black truncate">DTI / SEC</p>
                          <p className="text-xs text-gray-600 truncate">{modalClinic.dtiSecName || "DTI/SEC Doc"}</p>
                        </div>
                      </div>
                      {modalClinic.dtiSecUrl ? (
                        <button
                          type="button"
                          onClick={() => openDocument(modalClinic.dtiSecUrl!)}
                          className="w-full py-2 px-3 rounded-lg bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors cursor-pointer"
                        >
                          View DTI / SEC
                        </button>
                      ) : (
                        <span className="text-xs text-gray-600 italic text-center py-2">No file attached</span>
                      )}
                    </div>

                    {/* 3. BIR Form 2303 Certificate */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <FileCheck className="w-5 h-5 text-magenta-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-black truncate">BIR 2303</p>
                          <p className="text-xs text-gray-600 truncate">{modalClinic.birName || "BIR Certificate"}</p>
                        </div>
                      </div>
                      {modalClinic.birUrl ? (
                        <button
                          type="button"
                          onClick={() => openDocument(modalClinic.birUrl!)}
                          className="w-full py-2 px-3 rounded-lg bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors cursor-pointer"
                        >
                          View BIR 2303
                        </button>
                      ) : (
                        <span className="text-xs text-gray-600 italic text-center py-2">Optional / Not added</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Clinic Photos Gallery */}
                {modalClinic.clinicPhotos && modalClinic.clinicPhotos.length > 0 && (
                  <div className="pt-5 border-t border-gray-200">
                    <p className="text-sm font-semibold text-black mb-3">
                      Clinic photos ({modalClinic.clinicPhotos.length})
                    </p>
                    <div className="grid grid-cols-4 gap-3">
                      {modalClinic.clinicPhotos.map((photo, i) => (
                        <div
                          key={i}
                          onClick={() => setPreviewImage(photo)}
                          className="aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50 cursor-pointer hover:opacity-80 transition-opacity"
                        >
                          <img src={photo} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rejection Reason */}
                {modalClinic.status === "pending" && (
                  <div className="pt-5 border-t border-gray-200">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Rejection reason <span className="font-normal text-gray-600">(required if rejecting)</span>
                    </label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="e.g. Expired Business Permit, invalid PRC license ID, or missing address details..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 text-sm text-black placeholder:text-gray-500 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 resize-none"
                    />
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="px-8 py-5 border-t border-gray-200 bg-gray-50 rounded-b-2xl shrink-0">
                {modalClinic.status === "pending" && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        approveClinic(modalClinic.id);
                        setReviewModal(null);
                      }}
                      className="flex-1 py-3 rounded-lg bg-magenta-600 text-white font-semibold text-sm hover:bg-magenta-700 transition-colors cursor-pointer"
                    >
                      Approve &amp; verify
                    </button>
                    <button
                      onClick={() => {
                        rejectClinic(modalClinic.id);
                      }}
                      className="flex-1 py-3 rounded-lg border border-gray-300 bg-white text-black font-semibold text-sm hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      Reject application
                    </button>
                  </div>
                )}

                {modalClinic.status !== "pending" && (
                  <div className="space-y-3">
                    {modalClinic.status === "verified" && (
                      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-sm text-black flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-magenta-600 shrink-0" />
                        <span>Clinic is verified and active in the provider directory.</span>
                      </div>
                    )}
                    {modalClinic.status === "rejected" && (
                      <>
                        <div className="bg-magenta-50 border border-magenta-200 rounded-xl px-5 py-4 text-sm text-black">
                          <strong>Reason:</strong> {modalClinic.rejectionReason || "Incomplete or invalid requirements."}
                        </div>
                        <button
                          onClick={() => {
                            approveClinic(modalClinic.id);
                            setReviewModal(null);
                          }}
                          className="w-full py-3 rounded-lg bg-magenta-600 text-white font-semibold text-sm hover:bg-magenta-700 transition-colors cursor-pointer"
                        >
                          Change status to verified
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setReviewModal(null)}
                      className="w-full py-3 rounded-lg border border-gray-300 bg-white text-black font-semibold text-sm hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox / Image Preview Modal */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setPreviewImage(null)}
          >
            <div className="relative max-w-3xl max-h-[85vh] bg-transparent rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="absolute top-4 right-4 p-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors z-10"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
              <img
                src={previewImage}
                alt="Document Preview"
                className="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl border border-white/20"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}