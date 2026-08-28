import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import logo from "../../assets/Derma Logo.png";

const navLinks = [
  { label: "Home", path: "/" },
  { label: "Scan Skin", path: "/Scan" },
  { label: "Find Clinics", path: "/find-clinics" },
  { label : "Skin Library", path: "/skin-library" },
];

interface NavbarProps {
  /** Called when the sidebar hamburger button is clicked. Only used when isDashboard is true. */
  onMenuClick?: () => void;
  /** Renders a lightweight dashboard bar (with sidebar toggle) instead of the full public navbar. */
  isDashboard?: boolean;
}

export default function Navbar({ onMenuClick, isDashboard = false }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [clinicDropdown, setClinicDropdown] = useState(false);
  const location = useLocation();
  const isHome = location.pathname === "/";

  // Dashboard pages get a minimal top bar: just the sidebar toggle.
  // The full marketing nav (links, dropdown, login/register) doesn't apply once a user is inside the app.
  if (isDashboard) {
    return (
      <nav className="w-full bg-white border-b border-gray-100 h-16 flex items-center px-4 lg:px-6">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-magenta-900 hover:bg-gray-100 transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-6 h-6" />
        </button>
      </nav>
    );
  }

  return (
    <nav
      className={cn(
        "relative w-full z-50",
        isHome
          ? "bg-magenta-500"
          : "bg-white border-b border-magenta-100/50 shadow-sm"
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center overflow-hidden",
                isHome ? "bg-white/20" : "bg-magenta-500"
              )}
            >
              <img
                src={logo}
                alt="DERMAI logo"
                className="w-full h-full object-cover"
              />
            </div>
            <span
              className={cn(
                "text-xl font-display font-bold",
                isHome ? "text-white" : "text-magenta-900"
              )}
            >
              Derm<span className={isHome ? "text-pink-200" : "text-magenta-500"}>AI</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors",
                  isHome
                    ? location.pathname === link.path
                      ? "text-white font-bold underline underline-offset-4"
                      : "text-white/90 hover:text-white hover:bg-white/10"
                    : location.pathname === link.path
                    ? "text-magenta-500 bg-magenta-50"
                    : "text-magenta-900 hover:text-magenta-500 hover:bg-magenta-50"
                )}
              >
                {link.label}
              </Link>
            ))}

            {/* For Clinics Dropdown */}
            <div className="relative">
              <button
                onClick={() => setClinicDropdown(!clinicDropdown)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1",
                  isHome
                    ? location.pathname.startsWith("/for-clinics")
                      ? "text-white font-bold"
                      : "text-white/90 hover:text-white hover:bg-white/10"
                    : location.pathname.startsWith("/for-clinics")
                    ? "text-magenta-500 bg-magenta-50"
                    : "text-magenta-900 hover:text-magenta-500 hover:bg-magenta-50"
                )}
              >
                For Clinics
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {clinicDropdown && (
                <div className="absolute top-full mt-1 right-0 z-60 bg-white rounded-2xl shadow-lg border border-magenta-100 py-2 min-w-45">
                  <Link
                    to="/partner-with-us"
                    onClick={() => setClinicDropdown(false)}
                    className="block px-4 py-2 text-sm text-magenta-900 hover:bg-magenta-50 hover:text-magenta-500"
                  >
                    Partner With Us
                  </Link>
                  <Link
                    to="/register-clinic"
                    onClick={() => setClinicDropdown(false)}
                    className="block px-4 py-2 text-sm text-magenta-900 hover:bg-magenta-50 hover:text-magenta-500"
                  >
                    Register Clinic
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Auth Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              to="/login"
              className={cn(
                "px-5 py-2 rounded-full text-sm font-semibold border-2 transition-colors",
                isHome
                  ? "border-white text-white hover:bg-white/10"
                  : "border-magenta-500 text-magenta-500 hover:bg-magenta-50"
              )}
            >
              Login
            </Link>
            <Link
              to="/register-clinic"
              className={cn(
                "px-5 py-2 rounded-full text-sm font-semibold transition-colors shadow-md",
                isHome
                  ? "bg-white text-magenta-600 hover:bg-magenta-50 shadow-white/20"
                  : "bg-magenta-500 text-white hover:bg-magenta-600 shadow-magenta-500/20"
              )}
            >
              Register
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className={cn(
              "lg:hidden p-2 rounded-lg transition-colors",
              isHome ? "text-white hover:bg-white/10" : "text-magenta-900 hover:bg-gray-100"
            )}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div
          className={cn(
            "md:hidden border-t px-4 py-4 space-y-2",
            isHome ? "bg-magenta-500 border-white/20" : "bg-white border-magenta-100"
          )}
        >
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors",
                isHome
                  ? "text-white hover:bg-white/10"
                  : location.pathname === link.path
                  ? "text-magenta-500 bg-magenta-50"
                  : "text-magenta-900 hover:bg-magenta-50"
              )}
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/for-clinics"
            onClick={() => setMobileOpen(false)}
            className={cn(
              "block px-4 py-2.5 rounded-xl text-sm font-medium",
              isHome ? "text-white hover:bg-white/10" : "text-magenta-900 hover:bg-magenta-50"
            )}
          >
            For Clinics
          </Link>
          <div
            className={cn(
              "flex gap-3 pt-3 border-t",
              isHome ? "border-white/20" : "border-magenta-100"
            )}
          >
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex-1 text-center px-4 py-2.5 rounded-full text-sm font-semibold border-2",
                isHome ? "border-white text-white" : "border-magenta-500 text-magenta-500"
              )}
            >
              Login
            </Link>
            <Link
              to="/register"
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex-1 text-center px-4 py-2.5 rounded-full text-sm font-semibold",
                isHome
                  ? "bg-white text-magenta-600"
                  : "bg-magenta-500 text-white"
              )}
            >
              Register
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}