import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";

// Layouts
import UserLayout from "./components/layout/patientLayout";
import ClinicLayout from "./components/layout/clinicLayout";
import DoctorLayout from "./components/layout/doctorLayout";
import AdminLayout from "./components/layout/adminLayout";

// Public Pages
import HomePage from "./pages/public/HomePage";
import PartnerWithUs from "./pages/public/PartnerWithUs";
import RegisterClinic from "./pages/public/RegisterClinic";
import SkinLibrary from "./pages/public/SkinLibrary";
import SkinLibraryDetail from "./pages/public/SkinLibraryDetail";
import HelpCenterPage from "./pages/public/HelpCenterPage";
import PrivacyPolicyPage from "./pages/public/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/public/TermsOfServicePage";
import ContactUsPage from "./pages/public/ContactUsPage";
import LoginPage from "./pages/public/LoginPage";
import AuthCallbackPage from "./pages/public/AuthCallbackPage";

// Patient Pages
import PatientDashboard from "./pages/patient/PatientDashboard";
import ScanSkin from "./pages/patient/ScanSkin";
import PersonalInformationPage from "./pages/patient/PersonalInformationPage";
import FindClinicsPage from "./pages/patient/FindClinicsPage";
import SkinHistoryPage from "./pages/patient/SkinHistoryPage";
import AppointmentPage from "./pages/patient/AppointmentPage";
import AppointmentStatusPage from "./pages/patient/AppointmentStatusPage";
import SubscriptionStatusPage from "./pages/patient/SubscriptionStatusPage";
import SubscriptionUpgradePage from "./pages/patient/SubscriptionUpgradePage";
import SubscriptionChoicePage from "./pages/patient/SubscriptionChoicePage";
import HelpPage from "./pages/patient/settings/HelpPage";
import BillingSettingsPage from "./pages/patient/settings/BillingSettingsPage";

// Clinic Pages
import ClinicDashboardPage from "./pages/clinic/ClinicDashboardPage";
import ClinicAppointmentsPage from "./pages/clinic/ClinicAppointmentsPage";
import ClinicPatientsPage from "./pages/clinic/ClinicPatientsPage";
import ClinicDoctorsPage from "./pages/clinic/ClinicDoctorsPage";
import ClinicSettingsPage from "./pages/clinic/ClinicSettingsPage";

// Doctor Pages
import DoctorDashboardPage from "./pages/doctor/DoctorDashboardPage";
import DoctorAppointmentsPage from "./pages/doctor/DoctorAppointmentsPage";
import DoctorScheduledAppointmentsPage from "./pages/doctor/DoctorScheduledAppointmentsPage";
import DoctorPatientHistoryPage from "./pages/doctor/DoctorPatientHistoryPage";
import DoctorSettingsPage from "./pages/doctor/DoctorSettingsPage";

// Admin Pages
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import AdminUserManagement from "./pages/admin/AdminUserManagement";
import AdminClinicManagement from "./pages/admin/AdminClinicManagement";
import AdminSubscriptionManagement from "./pages/admin/AdminSubscriptionManagement";
import AdminPlanManagement from "./pages/admin/AdminPlanManagement";
import AdminAiAnalysisManagement from "./pages/admin/AdminAiAnalysisManagement";
import AdminDoctorAiReviewPage from "./pages/admin/AdminDoctorAiReviewPage";
import AdminReportsPage from "./pages/admin/AdminReportsPage";
import AdminNotificationsPage from "./pages/admin/AdminNotificationsPage";
import AdminAuditLogsPage from "./pages/admin/AdminAuditLogsPage";
import AdminHelpdeskPage from "./pages/admin/AdminHelpdeskPage";
import AdminSystemSettingsPage from "./pages/admin/AdminSystemSettingsPage";
import AccountStatusModal from "./components/common/AccountStatusModal";

function App() {
  const location = useLocation();

  // Hide the public marketing Navbar/Footer for dashboards and fullscreen flows
  const isDashboardOrFullscreen =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/clinic") ||
    location.pathname.startsWith("/doctor") ||
    location.pathname.startsWith("/dashboard") ||
    location.pathname.startsWith("/user") ||
    location.pathname.startsWith("/auth") ||
    location.pathname === "/appointment" ||
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/subscription-choice";

  return (
    <>
      <AccountStatusModal />
      {!isDashboardOrFullscreen && <Navbar />}

      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/scan" element={<ScanSkin />} />
        <Route path="/find-clinics" element={<FindClinicsPage />} />
        <Route path="/for-clinics" element={<PartnerWithUs />} />
        <Route path="/for-clinics/register" element={<RegisterClinic />} />
        <Route path="/partner-with-us" element={<PartnerWithUs />} />
        <Route path="/register-clinic" element={<RegisterClinic />} />
        <Route path="/skin-library" element={<SkinLibrary />} />
        <Route path="/skin-library/:id" element={<SkinLibraryDetail />} />
        <Route path="/help-center" element={<HelpCenterPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/terms-of-service" element={<TermsOfServicePage />} />
        <Route path="/contact-us" element={<ContactUsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/subscription-choice" element={<SubscriptionChoicePage />} />

        {/* Patient / Dashboard Routes */}
        <Route path="/dashboard" element={<UserLayout><PatientDashboard /></UserLayout>} />
        <Route path="/dashboard/scan" element={<UserLayout><ScanSkin /></UserLayout>} />
        <Route path="/dashboard/profile" element={<UserLayout><PersonalInformationPage /></UserLayout>} />
        <Route path="/dashboard/clinics" element={<UserLayout><FindClinicsPage /></UserLayout>} />
        <Route path="/dashboard/history" element={<UserLayout><SkinHistoryPage /></UserLayout>} />
        <Route path="/dashboard/appointment" element={<UserLayout><AppointmentPage /></UserLayout>} />
        <Route path="/appointment" element={<UserLayout><AppointmentPage /></UserLayout>} />
        <Route path="/dashboard/appointment-status" element={<UserLayout><AppointmentStatusPage /></UserLayout>} />
        <Route path="/dashboard/subscription-status" element={<UserLayout><SubscriptionStatusPage /></UserLayout>} />
        <Route path="/dashboard/upgrade" element={<UserLayout><SubscriptionUpgradePage /></UserLayout>} />
        <Route path="/user/upgrade" element={<UserLayout><SubscriptionUpgradePage /></UserLayout>} />
        <Route path="/dashboard/settings/account" element={<Navigate to="/dashboard/profile" replace />} />
        <Route path="/dashboard/settings/help" element={<UserLayout><HelpPage /></UserLayout>} />
        <Route path="/dashboard/settings/billing" element={<UserLayout><BillingSettingsPage /></UserLayout>} />

        {/* Clinic Routes */}
        <Route path="/clinic" element={<ClinicLayout><ClinicDashboardPage /></ClinicLayout>} />
        <Route path="/clinic/appointments" element={<ClinicLayout><ClinicAppointmentsPage /></ClinicLayout>} />
        <Route path="/clinic/patients" element={<ClinicLayout><ClinicPatientsPage /></ClinicLayout>} />
        <Route path="/clinic/doctors" element={<ClinicLayout><ClinicDoctorsPage /></ClinicLayout>} />
        <Route path="/clinic/settings" element={<ClinicLayout><ClinicSettingsPage /></ClinicLayout>} />

        {/* Doctor Routes */}
        <Route path="/doctor" element={<DoctorLayout><DoctorDashboardPage /></DoctorLayout>} />
        <Route path="/doctor/appointments" element={<DoctorLayout><DoctorAppointmentsPage /></DoctorLayout>} />
        <Route path="/doctor/scheduled" element={<DoctorLayout><DoctorScheduledAppointmentsPage /></DoctorLayout>} />
        <Route path="/doctor/history" element={<DoctorLayout><DoctorPatientHistoryPage /></DoctorLayout>} />
        <Route path="/doctor/settings" element={<DoctorLayout><DoctorSettingsPage /></DoctorLayout>} />

        {/* Admin Routes */}
        <Route path="/admin" element={<AdminLayout><AdminDashboardPage /></AdminLayout>} />
        <Route path="/admin/users" element={<AdminLayout><AdminUserManagement /></AdminLayout>} />
        <Route path="/admin/clinics" element={<AdminLayout><AdminClinicManagement /></AdminLayout>} />
        <Route path="/admin/subscriptions" element={<AdminLayout><AdminSubscriptionManagement /></AdminLayout>} />
        <Route path="/admin/plans" element={<AdminLayout><AdminPlanManagement /></AdminLayout>} />
        <Route path="/admin/ai-analyses" element={<AdminLayout><AdminAiAnalysisManagement /></AdminLayout>} />
        <Route path="/admin/doctor-ai-review" element={<AdminLayout><AdminDoctorAiReviewPage /></AdminLayout>} />
        <Route path="/admin/reports" element={<AdminLayout><AdminReportsPage /></AdminLayout>} />
        <Route path="/admin/notifications" element={<AdminLayout><AdminNotificationsPage /></AdminLayout>} />
        <Route path="/admin/audit-logs" element={<AdminLayout><AdminAuditLogsPage /></AdminLayout>} />
        <Route path="/admin/helpdesk" element={<AdminLayout><AdminHelpdeskPage /></AdminLayout>} />
        <Route path="/admin/settings" element={<AdminLayout><AdminSystemSettingsPage /></AdminLayout>} />

        {/* Clinic and Search Aliases */}
        <Route path="/clinics" element={<Navigate to="/find-clinics" replace />} />

        {/* Patient Appointment Aliases */}
        <Route path="/patient/appointments" element={<Navigate to="/dashboard/appointment-status" replace />} />
        <Route path="/patient/appointment" element={<Navigate to="/dashboard/appointment" replace />} />

        {/* Library Aliases */}
        <Route path="/library" element={<Navigate to="/skin-library" replace />} />
        <Route path="/library/:id" element={<Navigate to="/skin-library/:id" replace />} />

        {/* Catch-all fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {!isDashboardOrFullscreen && <Footer />}
    </>
  );
}

export default App;