import { useLocation, Link } from "react-router-dom";
import {
  UserCircle,
  CalendarDays,
  CreditCard,
  ActivitySquare,
  LayoutGrid,
  Settings,
  ScanLine,
  LogOut,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useState } from "react";
import Navbar from "./Navbar";
import Logo from "../../assets/LogoDerm.png";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/**
 * Shape of the patient profile data this layout needs to render the sidebar
 * header (avatar, name, membership tier, location).
 *
 * TODO(backend): This should ultimately come from your auth/user context
 * (e.g. a `useAuth()` or `useUser()` hook backed by Supabase), not be
 * fetched or stored locally inside this component.
 */
export interface UserProfileSummary {
  fullName: string;
  profilePictureUrl?: string;
  membershipTier?: string; // e.g. "Premium Member", "Free Plan"
  location?: string; // e.g. "Cebu City, Philippines"
}

interface UserLayoutProps {
  children: React.ReactNode;
  /** Current patient's profile summary. */
  profile?: UserProfileSummary;
  /** Called when the user clicks "Logout". */
  onLogout?: () => void;
}

// ---------------------------------------------------------------------------
// STATIC NAV CONFIG (this part is fine to hardcode — it's UI structure, not data)
// ---------------------------------------------------------------------------

const sidebarSections = [
  {
    title: "Skin Scan",
    icon: ScanLine,
    links: [{ label: "Scan Skin", path: "/dashboard/scan" }],
  },
  {
    title: "Profile Management",
    icon: UserCircle,
    links: [{ label: "Personal Information", path: "/dashboard/profile" }],
  },
  {
    title: "Appointment Booking",
    icon: CalendarDays,
    links: [{ label: "Search Clinic", path: "/dashboard/clinics" }],
  },
  {
    title: "Monitor",
    icon: ActivitySquare,
    links: [
      { label: "Skin History", path: "/dashboard/history" },
      { label: "Appointment Status", path: "/dashboard/appointment-status" },
      { label: "Subscription Status", path: "/dashboard/subscription-status" },
    ],
  },
  {
    title: "Subscription",
    icon: CreditCard,
    links: [{ label: "Upgrade Plan", path: "/dashboard/upgrade" }],
  },
  {
    title: "Settings",
    icon: Settings,
    links: [
      { label: "Account", path: "/dashboard/settings/account" },
      { label: "Help", path: "/dashboard/settings/help" },
      { label: "Billing", path: "/dashboard/settings/billing" },
    ],
  },
];

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export default function UserLayout({
  children,
  profile = { fullName: "Patient User", membershipTier: "Free Plan" },
  onLogout,
}: UserLayoutProps) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const initial = profile.fullName?.charAt(0)?.toUpperCase() ?? "P";

  return (
    <div className="min-h-screen bg-gray-50/80 flex flex-col lg:flex-row">
      {/* Backdrop Overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden transition-all duration-300 ease-in-out",
          sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col w-70 bg-white border-r border-gray-100 h-screen fixed left-0 top-0 z-50 overflow-hidden",
          "transition-transform duration-300 ease-in-out",
          "shadow-[4px_0_32px_rgba(0,0,0,0.08)] lg:shadow-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={Logo} alt="DERMAI logo" className="h-9 w-auto object-contain" />
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-magenta-50 text-magenta-600 font-semibold ml-0.5">
              Patient
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Patient Account Info — driven entirely by the `profile` prop now */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full ring-2 ring-magenta-100 bg-magenta-500 overflow-hidden flex items-center justify-center text-white text-lg font-bold">
              {profile.profilePictureUrl ? (
                <img src={profile.profilePictureUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900 leading-tight">{profile.fullName}</p>
              {profile.membershipTier && (
                <p className="text-xs text-gray-500">{profile.membershipTier}</p>
              )}
            </div>
          </div>
          {profile.location && <p className="text-xs text-gray-400">{profile.location}</p>}
        </div>

        {/* Navigation Sections */}
        <div className="flex-1 overflow-y-auto scrollbar-hide py-4 px-3 space-y-6">
          <div className="space-y-1">
            <Link
              to="/dashboard"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors",
                location.pathname === "/dashboard"
                  ? "bg-magenta-50 text-magenta-600"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <LayoutGrid className="w-5 h-5" />
              Dashboard
            </Link>
          </div>

          {sidebarSections.map((section, idx) => {
            const SectionIcon = section.icon;
            return (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2 px-3 mb-2 text-gray-400">
                  <SectionIcon className="w-4 h-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider">{section.title}</p>
                </div>
                <div className="space-y-0.5">
                  {section.links.map((link) => {
                    const isActive = location.pathname === link.path;
                    return (
                      <Link
                        key={link.path}
                        to={link.path}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "block px-3 py-2 rounded-xl text-sm font-medium pl-9 transition-colors",
                          isActive
                            ? "bg-magenta-50 text-magenta-600"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        )}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Logout — calls the onLogout prop instead of just linking to "/" */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          {onLogout ? (
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors bg-white border border-gray-200"
            >
              <LogOut className="w-4.5 h-4.5" />
              Logout
            </button>
          ) : (
            <Link
              to="/"
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors bg-white border border-gray-200"
            >
              <LogOut className="w-4.5 h-4.5" />
              Logout
            </Link>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-70 min-h-screen flex flex-col relative w-full">
        <Navbar onMenuClick={() => setSidebarOpen((prev) => !prev)} isDashboard={true} />
        <div className="flex-1 overflow-x-hidden">{children}</div>
      </main>
    </div>
  );
}