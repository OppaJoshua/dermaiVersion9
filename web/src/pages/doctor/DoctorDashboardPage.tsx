import { Link } from "react-router-dom";
import { Calendar, CheckCircle2, XCircle, Clock, ChevronRight, Stethoscope } from "lucide-react";
import { motion } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";

type AppointmentRecord = {
  id: string;
  clinicName: string;
  patientName?: string;
  patientAge?: number;
  patientAvatar?: string;
  conditionId?: string;
  conditionName?: string;
  conditionImage?: string;
  date: string;
  time: string;
  notes: string;
  status: "pending" | "accepted" | "scheduled" | "rejected";
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  doctorStatus?: "pending-review" | "approved" | "rejected";
  doctorNote?: string;
  doctorReviewedAt?: string;
  scheduleSentToDoctor?: boolean;
  createdAt: string;
};

export default function DoctorDashboardPage() {
  // TODO: Load doctor info and appointments from Supabase using authenticated session
  const doctorName = "";
  const doctorClinic = "";
  const fallbackImage = skinConditions[0]?.image;

  const allAppointments: AppointmentRecord[] = [];

  const pendingReview = allAppointments.filter((a) => a.doctorStatus === "pending-review");
  const approved = allAppointments.filter((a) => a.doctorStatus === "approved");
  const rejected = allAppointments.filter((a) => a.doctorStatus === "rejected");
  const scheduledSent = allAppointments.filter((a) => a.scheduleSentToDoctor);

  const stats = [
    { label: "Pending Review", value: pendingReview.length, icon: Clock, color: "bg-amber-50 text-amber-600 border-amber-100", iconColor: "text-amber-500", bg: "bg-amber-100" },
    { label: "Approved", value: approved.length, icon: CheckCircle2, color: "bg-green-50 text-green-600 border-green-100", iconColor: "text-green-500", bg: "bg-green-100" },
    { label: "Rejected", value: rejected.length, icon: XCircle, color: "bg-red-50 text-red-600 border-red-100", iconColor: "text-red-500", bg: "bg-red-100" },
    { label: "Schedule Received", value: scheduledSent.length, icon: Calendar, color: "bg-blue-50 text-blue-600 border-blue-100", iconColor: "text-blue-500", bg: "bg-blue-100" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">
            Welcome, {doctorName}
          </h1>
          {doctorClinic && (
            <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-1.5">
              <Stethoscope className="w-3.5 h-3.5" /> {doctorClinic}
            </p>
          )}
        </div>
        <Link
          to="/doctor/appointments"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
        >
          <Calendar className="w-4 h-4" /> View All Appointments
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`bg-white rounded-2xl border p-4 ${stat.color}`}
            >
              <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${stat.iconColor}`} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-xs font-medium mt-0.5">{stat.label}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Pending Review */}
      <div className="bg-white rounded-2xl border border-gray-100">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-50">
          <h2 className="font-display font-bold text-gray-900">Awaiting Your Review</h2>
          <Link
            to="/doctor/appointments"
            className="text-xs text-blue-500 font-semibold flex items-center gap-1 hover:text-blue-700"
          >
            See all <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {pendingReview.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <CheckCircle2 className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No appointments pending your review.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {pendingReview.slice(0, 5).map((appt, i) => (
              <motion.div
                key={appt.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/50"
              >
                <img
                  src={appt.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=dbeafe&color=1d4ed8`}
                  alt={appt.patientName}
                  className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {appt.patientName || "Unknown Patient"}
                  </p>
                  <p className="text-xs text-blue-600 font-medium truncate">
                    {appt.conditionName || "Skin concern"}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Submitted {new Date(appt.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
                <img
                  src={appt.conditionImage || fallbackImage}
                  alt={appt.conditionName}
                  className="w-12 h-12 rounded-lg object-cover border border-gray-100 shrink-0"
                />
                <span className="text-[10px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold whitespace-nowrap">
                  Pending Review
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule Received */}
      {scheduledSent.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="px-5 pt-5 pb-4 border-b border-gray-50">
            <h2 className="font-display font-bold text-gray-900">Finalized Appointment Schedules</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {scheduledSent.map((appt, i) => (
              <motion.div
                key={appt.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="px-5 py-4"
              >
                <div className="flex items-center gap-4">
                  <img
                    src={appt.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=dbeafe&color=1d4ed8`}
                    alt={appt.patientName}
                    className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{appt.patientName || "Patient"}</p>
                    <p className="text-xs text-blue-600 font-medium">{appt.conditionName || "Skin concern"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-gray-800">{appt.date}</p>
                    <p className="text-[11px] text-gray-500">{appt.time}</p>
                  </div>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 font-semibold shrink-0">
                    Confirmed
                  </span>
                </div>
                {/* AI Analysis summary */}
                {(() => {
                  const cond = appt.conditionId ? skinConditions.find((c) => c.id === appt.conditionId) : null;
                  return cond ? (
                    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3 flex gap-3">
                      <img
                        src={appt.conditionImage || cond.image}
                        alt={cond.name}
                        className="w-12 h-12 rounded-lg object-cover border border-blue-100 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">AI Analysis</p>
                        <p className="text-xs font-semibold text-blue-800">{cond.name}</p>
                        <p className="text-[11px] text-blue-600 line-clamp-2">{cond.description}</p>
                      </div>
                    </div>
                  ) : null;
                })()}
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
