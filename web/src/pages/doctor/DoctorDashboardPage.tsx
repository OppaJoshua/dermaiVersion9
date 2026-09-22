import { Link } from "react-router-dom";
import { Calendar, CheckCircle2, XCircle, Clock, ChevronRight, Stethoscope, Loader2, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useDoctorAppointments } from "@/hooks/useDoctorAppointments";

export default function DoctorDashboardPage() {
  const { doctorName, doctorClinic, appointments: allAppointments, loading } = useDoctorAppointments();
  const fallbackImage = skinConditions[0]?.image;

  const pendingReview = allAppointments.filter(
    (a) =>
      a.status !== "rejected" &&
      a.status !== "cancelled" &&
      a.status !== "completed" &&
      a.doctorStatus !== "rejected" &&
      a.doctorStatus !== "approved"
  );
  const approved = allAppointments.filter(
    (a) => a.doctorStatus === "approved" && a.status !== "rejected" && a.status !== "cancelled"
  );
  const rejected = allAppointments.filter(
    (a) => a.doctorStatus === "rejected" || a.status === "rejected" || a.status === "cancelled"
  );
  const scheduledSent = allAppointments.filter(
    (a) =>
      a.status !== "rejected" &&
      a.status !== "cancelled" &&
      a.status !== "completed" &&
      !!a.date &&
      (a.scheduleSentToDoctor || a.status === "confirmed" || a.status === "scheduled")
  );

  const stats = [
    {
      label: "Awaiting Your Review",
      sublabel: "Pre-consultation triage queue",
      value: pendingReview.length,
      icon: Clock,
      color: "bg-amber-50 text-amber-700 border-amber-200",
      iconColor: "text-amber-500",
      bg: "bg-amber-100",
      href: "/doctor/appointments",
    },
    {
      label: "Approved by You",
      sublabel: "Awaiting clinic schedule lock",
      value: approved.length,
      icon: CheckCircle2,
      color: "bg-emerald-50 text-emerald-700 border-emerald-200",
      iconColor: "text-emerald-500",
      bg: "bg-emerald-100",
      href: "/doctor/appointments",
    },
    {
      label: "Declined by You",
      sublabel: "Clinic alerted to re-assign",
      value: rejected.length,
      icon: XCircle,
      color: "bg-red-50 text-red-700 border-red-200",
      iconColor: "text-red-500",
      bg: "bg-red-100",
      href: "/doctor/appointments",
    },
    {
      label: "Finalized Consultations",
      sublabel: "Confirmed & ready to conduct",
      value: scheduledSent.length,
      icon: Calendar,
      color: "bg-blue-50 text-blue-700 border-blue-200",
      iconColor: "text-blue-500",
      bg: "bg-blue-100",
      href: "/doctor/scheduled",
    },
  ];

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading doctor portal dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">
            Welcome, {doctorName || "Doctor"}
          </h1>
          {doctorClinic ? (
            <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5 font-medium">
              <Stethoscope className="w-4 h-4 text-blue-600" /> {doctorClinic}
            </p>
          ) : (
            <p className="text-sm text-gray-400 mt-0.5">Dermatology Medical Portal</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/doctor/appointments"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors shadow-xs"
          >
            <Clock className="w-4 h-4" /> Review Patient Cases
          </Link>
          <Link
            to="/doctor/scheduled"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            <Calendar className="w-4 h-4 text-gray-500" /> Scheduled Sessions
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`bg-white rounded-2xl border p-4 shadow-xs flex flex-col justify-between hover:border-gray-300 transition-all ${stat.color}`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${stat.iconColor}`} />
                  </div>
                  <span className="text-2xl font-black text-gray-900">{stat.value}</span>
                </div>
                <p className="text-sm font-bold text-gray-900">{stat.label}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{stat.sublabel}</p>
              </div>
              <Link
                to={stat.href}
                className="mt-3 text-xs font-semibold text-blue-600 flex items-center gap-1 hover:text-blue-800"
              >
                View list <ArrowRight className="w-3 h-3" />
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Pending Review Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="font-display font-bold text-gray-900 text-base">Awaiting Your Clinical Review</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Cases assigned by your clinic triage team that require your decision before scheduling.
            </p>
          </div>
          <Link
            to="/doctor/appointments"
            className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:text-blue-800"
          >
            Review All ({pendingReview.length}) <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {pendingReview.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-800">Your review queue is clear!</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Any new patient cases assigned to you by the clinic will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {pendingReview.slice(0, 5).map((appt, i) => (
              <motion.div
                key={appt.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/60 transition-colors"
              >
                <img
                  src={
                    appt.patientAvatar ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(
                      appt.patientName || "P"
                    )}&background=dbeafe&color=1d4ed8`
                  }
                  alt={appt.patientName}
                  className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {appt.patientName || "Patient"}
                  </p>
                  <p className="text-xs text-blue-600 font-semibold truncate">
                    {appt.conditionName || "Skin Assessment"}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Requested on{" "}
                    {new Date(appt.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                {appt.skinPhotoUrl ? (
                  <img
                    src={appt.skinPhotoUrl}
                    alt="Skin preview"
                    className="w-12 h-12 rounded-lg object-cover border border-gray-100 shrink-0 hidden sm:block"
                  />
                ) : appt.conditionImage ? (
                  <img
                    src={appt.conditionImage || fallbackImage}
                    alt={appt.conditionName}
                    className="w-12 h-12 rounded-lg object-cover border border-gray-100 shrink-0 hidden sm:block"
                  />
                ) : null}
                <Link
                  to="/doctor/appointments"
                  className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100 transition-colors shrink-0"
                >
                  Review Case &rarr;
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmed Schedule Section */}
      {scheduledSent.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
            <div>
              <h2 className="font-display font-bold text-gray-900 text-base">Upcoming Confirmed Sessions</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Approved appointments where the clinic has locked the consultation schedule.
              </p>
            </div>
            <Link
              to="/doctor/scheduled"
              className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:text-blue-800"
            >
              View Schedule <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {scheduledSent.slice(0, 4).map((appt, i) => (
              <motion.div
                key={appt.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="px-5 py-4 hover:bg-gray-50/60 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <img
                    src={
                      appt.patientAvatar ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        appt.patientName || "P"
                      )}&background=dbeafe&color=1d4ed8`
                    }
                    alt={appt.patientName}
                    className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{appt.patientName || "Patient"}</p>
                    <p className="text-xs text-blue-600 font-semibold truncate">{appt.conditionName || "Dermatology"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-gray-900">{appt.date}</p>
                    <p className="text-[11px] text-gray-500 font-medium">{appt.time || "Scheduled"}</p>
                  </div>
                  <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold shrink-0">
                    Confirmed
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
