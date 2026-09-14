import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  CheckCircle2,
  XCircle,
  Eye,
  FileText,
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
  verified: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
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

      if (clinicRows && clinicRows.length > 0) {
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
            businessPermitName: c.business_permit_name || localMatch?.businessPermitName || "Business Permit",
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

        setApplications(dbApps);
        try {
          localStorage.setItem("dermai_cached_admin_clinics", JSON.stringify(dbApps));
        } catch { }
      } else {
        setApplications([]);
        try {
          localStorage.removeItem("dermai_cached_admin_clinics");
          localStorage.removeItem("dermai_clinic_applications");
        } catch { }
      }
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
        supabase.from("clinic").update({ status: "approved" }).eq("clinic_id", id),
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
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">
            Clinic Management
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Review and manage clinic applications & credentials</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadClinics}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
            title="Refresh clinics from database"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin text-magenta-500")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Minimal Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "mb-6 px-4 py-3 rounded-xl border flex items-center justify-between gap-4 text-xs shadow-xs transition-all",
              toast.type === "success"
                ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                : "bg-red-50/80 border-red-200 text-red-950"
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-xs",
                  toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                )}
              >
                {toast.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{toast.title}</p>
                <p className="text-gray-500 mt-0.5">{toast.description}</p>
              </div>
            </div>

            <button
              onClick={() => setToast(null)}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-black/5 transition-colors shrink-0"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs with Count Badges */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
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
              "flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold capitalize transition-all active:scale-[0.96] shrink-0",
              activeTab === tab.key
                ? "bg-magenta-500 text-white shadow-sm"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
            )}
          >
            <span>{tab.label}</span>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-bold",
                activeTab === tab.key
                  ? "bg-white/20 text-white"
                  : tab.key === "pending" && tab.count > 0
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-600"
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Clinic Name</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Location</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Doctor in Charge</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((clinic) => (
                <tr key={clinic.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {clinic.logo ? (
                        <img src={clinic.logo} alt="" className="w-10 h-10 rounded-xl object-cover border border-gray-100" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-magenta-50 flex items-center justify-center text-magenta-500 font-bold text-sm">
                          {clinic.name[0]}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{clinic.name}</p>
                          {clinic.status === "verified" && (
                            <VerifiedBadge size={15} className="w-3.5 h-3.5" title="Verified Clinic" />
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{clinic.specialization}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{clinic.location}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{clinic.doctor || "—"}</td>
                  <td className="px-6 py-4">
                    <span className={cn("px-3 py-1 rounded-full text-xs font-semibold capitalize", statusBadge[clinic.status])}>
                      {clinic.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => setReviewModal(clinic.id)}
                        className={cn(
                          "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.97]",
                          clinic.status === "pending"
                            ? "bg-magenta-50 text-magenta-700 hover:bg-magenta-100 border border-magenta-200/60 shadow-xs"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200/80"
                        )}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {clinic.status === "pending" ? "View & Review" : "View Details"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3 text-gray-400">
              <Building2 className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-gray-700">No clinics found in this category</p>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
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
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setReviewModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-[24px] p-6 sm:p-8 max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6 border-b pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-magenta-100 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-magenta-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-bold text-gray-900">
                      Clinic Application Details
                    </h2>
                    <p className="text-xs text-gray-400">Review submitted verification documents</p>
                  </div>
                </div>
                <button
                  onClick={() => setReviewModal(null)}
                  className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Verification Status</span>
                  <span className={cn("px-3 py-1 rounded-full text-xs font-semibold capitalize", statusBadge[modalClinic.status])}>
                    {modalClinic.status}
                  </span>
                </div>

                {/* Logo & Header */}
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                  {modalClinic.logo ? (
                    <img src={modalClinic.logo} alt="Clinic Logo" className="w-16 h-16 object-cover rounded-2xl border bg-white shadow-sm" />
                  ) : (
                    <div className="w-16 h-16 bg-magenta-100 rounded-2xl flex items-center justify-center text-magenta-600 font-bold text-xl border">
                      {modalClinic.name[0]}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-base font-bold text-gray-900">{modalClinic.name}</h3>
                      {modalClinic.status === "verified" && (
                        <VerifiedBadge size={16} className="w-4 h-4" title="Verified Clinic" />
                      )}
                    </div>
                    <p className="text-xs text-magenta-600 font-medium">{modalClinic.specialization}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{modalClinic.address || modalClinic.location}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-400 block mb-0.5">Email Address</span>
                    <p className="font-semibold text-gray-900 truncate">{modalClinic.email || "—"}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-400 block mb-0.5">Contact Number</span>
                    <p className="font-semibold text-gray-900">{modalClinic.phone || "—"}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-400 block mb-0.5">Doctor in Charge</span>
                    <p className="font-semibold text-gray-900">{modalClinic.doctor || "—"}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-400 block mb-0.5">PRC License #</span>
                    <p className="font-semibold text-gray-900">{modalClinic.prcLicense || "—"}</p>
                  </div>
                </div>

                {/* Services & Description */}
                <div className="p-3 bg-gray-50 rounded-xl text-xs space-y-2">
                  <div>
                    <span className="text-gray-400 font-medium">Services Offered:</span>
                    <p className="text-gray-900 font-semibold mt-0.5">{modalClinic.servicesOffered || "—"}</p>
                  </div>
                  <div>
                    <span className="text-gray-400 font-medium">Description:</span>
                    <p className="text-gray-700 mt-0.5 leading-relaxed">{modalClinic.description || "—"}</p>
                  </div>
                </div>

                {/* Uploaded Documents */}
                <div className="pt-2 border-t">
                  <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-2.5">
                    Uploaded Verification Documents
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Business Permit */}
                    <div className="bg-magenta-50/60 border border-magenta-100 rounded-2xl p-3 flex flex-col justify-between">
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-red-500 shadow-sm border border-magenta-100">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-bold text-magenta-900">Business Permit</p>
                          <p className="text-[10px] text-magenta-500 truncate">{modalClinic.businessPermitName || "Scanned copy"}</p>
                        </div>
                      </div>
                      {modalClinic.businessPermitUrl ? (
                        <button
                          type="button"
                          onClick={() => openDocument(modalClinic.businessPermitUrl!)}
                          className="w-full py-1.5 px-3 rounded-lg bg-magenta-500 text-white text-[11px] font-semibold hover:bg-magenta-600 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" /> View Document
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400 italic text-center py-1">No file attached</span>
                      )}
                    </div>

                    {/* PRC License Copy */}
                    <div className="bg-magenta-50/60 border border-magenta-100 rounded-2xl p-3 flex flex-col justify-between">
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-blue-600 shadow-sm border border-magenta-100">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-bold text-magenta-900">PRC License</p>
                          <p className="text-[10px] text-magenta-500 truncate">{modalClinic.prcLicenseFileName || "Scanned copy"}</p>
                        </div>
                      </div>
                      {modalClinic.prcLicenseFileUrl ? (
                        <button
                          type="button"
                          onClick={() => openDocument(modalClinic.prcLicenseFileUrl!)}
                          className="w-full py-1.5 px-3 rounded-lg bg-magenta-500 text-white text-[11px] font-semibold hover:bg-magenta-600 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" /> View Document
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400 italic text-center py-1">No file attached</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Clinic Photos Gallery */}
                {modalClinic.clinicPhotos && modalClinic.clinicPhotos.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-2">
                      Clinic Photos Gallery ({modalClinic.clinicPhotos.length})
                    </p>
                    <div className="grid grid-cols-4 gap-2">
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
              </div>

              {/* Rejection Reason */}
              {modalClinic.status === "pending" && (
                <div className="mb-6">
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Rejection Reason (required if rejecting)
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Expired Business Permit, invalid PRC license ID, or missing address details..."
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 resize-none"
                  />
                </div>
              )}

              {/* Action Buttons */}
              {modalClinic.status === "pending" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      approveClinic(modalClinic.id);
                      setReviewModal(null);
                    }}
                    className="flex-1 py-3 rounded-full bg-green-500 text-white font-semibold text-sm hover:bg-green-600 transition-colors active:scale-[0.96] shadow"
                  >
                    Approve & Verify
                  </button>
                  <button
                    onClick={() => {
                      rejectClinic(modalClinic.id);
                    }}
                    className="flex-1 py-3 rounded-full bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition-colors active:scale-[0.96] shadow"
                  >
                    Reject Application
                  </button>
                </div>
              )}

              {modalClinic.status !== "pending" && (
                <div className="space-y-3">
                  {modalClinic.status === "verified" && (
                    <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl px-4 py-3 text-xs text-emerald-800 flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Clinic is verified and active in the provider directory.</span>
                    </div>
                  )}
                  {modalClinic.status === "rejected" && (
                    <>
                      <div className="bg-red-50 border border-red-150 rounded-xl px-4 py-3 text-xs text-red-700">
                        <strong>Reason:</strong> {modalClinic.rejectionReason || "Incomplete or invalid requirements."}
                      </div>
                      <button
                        onClick={() => {
                          approveClinic(modalClinic.id);
                          setReviewModal(null);
                        }}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors"
                      >
                        Change Status to Verified
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setReviewModal(null)}
                    className="w-full py-2.5 rounded-xl bg-gray-900 text-white font-semibold text-xs hover:bg-black transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}
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
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewImage(null)}
          >
            <div className="relative max-w-3xl max-h-[85vh] bg-transparent rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="absolute top-4 right-4 p-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors z-10"
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
