Doctor consolidated reviews
===========================

The doctor layout owns `activeClinicId`. The reserved value `all` is the
initial selection for multiple active affiliations; a single affiliation selects
its clinic ID. Nested doctor routes preserve this context while opening reviews.

Schema mapping
--------------

These names match `supabase/schema.sql` and the existing doctor queries:

- `clinic_doctor.user_id` links the authenticated user to active clinic memberships.
- `clinic_doctor.clinic_id` references `clinic.clinic_id`.
- `patient_appointment.clinic_id` references the appointment's clinic.
- `patient_appointment.assigned_doctor_id` references `clinic_doctor.doctor_id`.
- Patient details come from appointment fields and `user` profiles.
- `patient_appointment.condition_id` references `skin_condition.condition_id`; its
  `name` supplies the consultation type, with the saved `ai_condition_name` as fallback.
- Pending review means `status = 'pending'` and `doctor_status = 'pending-review'`
  (or a null doctor status for legacy unreviewed requests). The checked-in status
  constraint does not contain `pending_review`.
- Scheduling uses `date` (timestamptz) and `time` (clinic wall time), not `scheduled_at`.

Queries and types
-----------------

`fetchDoctorBranches` queries active `clinic_doctor` records by the authenticated
user ID and joins clinic metadata. `scopeDoctorAppointments` applies either an
exact clinic filter or an `in` filter containing only those active affiliations.
It restricts assignments to this doctor's IDs or the existing unassigned clinic queue.
Supabase requests use the existing authenticated client and remain subject to RLS.

`useDoctorAppointments({ urgentOnly: true })` adds the pending status filter,
excludes approved/rejected doctor reviews in the database, bounds the query to
Manila calendar dates covering the next 48 hours, and paginates results. Because
the separate `time` field can override the time part of `date`,
`getReviewUrgency` applies the precise inclusive now-to-48-hour filter after
normalization. This prevents a midnight date with an afternoon slot being omitted.
All other doctor screens retain their full appointment queries.

`DoctorAppointmentRecord`, `AppointmentSchedule`, `ReviewUrgency`, and
`ReviewUrgencyTier` describe the normalized data and calculated tiers. The queue
uses no sample patients, branch IDs, or appointment IDs. Missing database values
are explicitly labelled unavailable.

Review interaction
------------------

`UrgentReviewsQueue` switches to the appointment's clinic and navigates to the
existing review modal using its real appointment ID. `returnTo=queue` restores
the consolidated dashboard after closing or successfully submitting. Realtime,
focus refresh, polling, and a manual retry keep the queue current.

Approval writes `status = 'confirmed'` and `doctor_status = 'approved'`.
Declining preserves the existing reassignment workflow: `status = 'pending'`
and `doctor_status = 'rejected'`, which removes the request from urgent reviews.
Review updates require the selected clinic, a matching active affiliation,
a pending appointment, and an eligible assignment. Updates return the affected
appointment ID; errors or zero visible rows cannot report success.

Verification
------------

Run `npm run build` and
`node --test tests/doctorBranches.test.mjs tests/doctorAppointmentScope.test.mjs tests/appointmentUrgency.test.mjs`
from `web`.

Live schema verification was attempted on 2026-10-24. Both the configured public
API key and the replacement supplied during implementation returned HTTP 401
`Invalid API key`. The implementation therefore matches the checked-in schema;
live joins, RLS, and a doctor-session review round trip still need verification
with a working project URL/public key pair. No live records were modified.
