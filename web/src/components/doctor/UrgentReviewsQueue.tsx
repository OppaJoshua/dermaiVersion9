import { useNavigate } from "react-router-dom";
import { useDoctorClinicContext } from "@/components/layout/doctorLayout";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";
import { useAppointmentClock } from "@/hooks/useAppointmentClock";
import { appointmentTimestamp, getReviewUrgency, type ReviewUrgencyTier } from "@/lib/appointmentUrgency";

const tiers: { tier: ReviewUrgencyTier; title: string; classes: string }[] = [
  { tier: "critical", title: "Critical · Under 2 hours", classes: "border-rose-200 bg-rose-50 text-rose-800" },
  { tier: "high", title: "High Priority · Under 24 hours", classes: "border-amber-200 bg-amber-50 text-amber-900" },
  { tier: "upcoming", title: "Upcoming · 24–48 hours", classes: "border-blue-200 bg-blue-50 text-blue-800" },
];

export function UrgentReviewsQueue() {
  const now = useAppointmentClock();
  const navigate = useNavigate();
  const { setActiveClinicId, affiliations } = useDoctorClinicContext();
  const { appointments, loading, error, refresh } = useDoctorAppointments({ urgentOnly: true });
  const queue = appointments.flatMap(appointment => {
    const urgency = getReviewUrgency(appointment, now);
    return urgency ? [{ appointment, urgency }] : [];
  }).sort((a, b) => a.urgency.remainingMs - b.urgency.remainingMs);

  const review = (appointment: DoctorAppointmentRecord) => {
    if (!appointment.clinicId || !affiliations.some(branch => branch.clinic_id === appointment.clinicId)) return;
    setActiveClinicId(appointment.clinicId);
    navigate(`/doctor/appointments?review=${encodeURIComponent(appointment.id)}&returnTo=queue`);
  };

  return (
    <section aria-labelledby="urgent-reviews-title" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="urgent-reviews-title" className="text-lg font-bold text-slate-900">Urgent Reviews Queue</h2>
          <p className="mt-1 text-sm text-slate-500">Pending requests across your clinics starting within 48 hours · Philippine time</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-50">{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error} <button type="button" onClick={() => void refresh()} className="underline">Retry</button></p>
        : loading && !queue.length ? <p role="status" className="mt-4 text-sm text-slate-500">Loading urgent requests…</p>
        : !queue.length ? <p role="status" className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No pending reviews starting in the next 48 hours.</p>
        : tiers.map(({ tier, title, classes }) => {
          const rows = queue.filter(row => row.urgency.tier === tier);
          if (!rows.length) return null;
          return <div key={tier} className="mt-5">
            <h3 className="mb-2 text-sm font-bold text-slate-700">{title} ({rows.length})</h3>
            <div className="space-y-3">
              {rows.map(({ appointment, urgency }) => <article key={appointment.id} className={`rounded-xl border p-4 ${classes}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className={`rounded-full border px-2.5 py-1 ${classes}`}>{urgency.label}</span>
                  <span>{urgency.countdown}</span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700">{appointment.clinicName}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">{appointment.patientName || "Name unavailable"} <span className="font-normal">({appointment.serviceName || "Consultation type unavailable"})</span></p>
                    <p className="mt-1 text-sm text-slate-600">{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(appointmentTimestamp(appointment)!)}</p>
                    {affiliations.find(branch => branch.clinic_id === appointment.clinicId)?.clinic?.address && <p className="mt-1 text-xs text-slate-500">{affiliations.find(branch => branch.clinic_id === appointment.clinicId)?.clinic?.address}</p>}
                  </div>
                  <button type="button" onClick={() => review(appointment)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Review &amp; Confirm →</button>
                </div>
              </article>)}
            </div>
          </div>;
        })}
    </section>
  );
}
