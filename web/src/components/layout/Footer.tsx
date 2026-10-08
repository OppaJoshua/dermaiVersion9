import { Link } from 'react-router-dom';
import { Facebook, Instagram, Twitter, Mail, MapPin } from 'lucide-react';
import Logo from "@/assets/logo2.png";

const LINK_GROUPS = [
  {
    title: "Quick Links",
    links: [
      { label: "Home", path: "/" },
      { label: "Scan Skin", path: "/scan" },
      { label: "Find Clinics", path: "/find-clinics" },
    ],
  },
  {
    title: "For Clinics",
    links: [
      { label: "Partner With Us", path: "/partner-with-us" },
      { label: "Register Clinic", path: "/register-clinic" },
      { label: "Clinic Login", path: "/login" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help Center", path: "/help-center" },
      { label: "Contact Us", path: "/contact-us" },
    ],
  },
];

const SOCIALS = [
  { icon: Facebook, label: "Facebook" },
  { icon: Instagram, label: "Instagram" },
  { icon: Twitter, label: "Twitter" },
];

function Footer() {
  return (
    <footer className="relative overflow-hidden bg-linear-to-br from-magenta-500 to-magenta-600 text-white border-t border-white/10">
      {/* Subtle decorative shape (matches clinic CTA) */}
      <div className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full border-[40px] border-white/5" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
          {/* Brand */}
          <div className="md:col-span-4">
            <img src={Logo} alt="DERMAI" className="h-14 w-auto object-contain mb-5" />
            <p className="text-white/75 text-sm leading-relaxed max-w-xs">
              AI-powered skin condition analysis and dermatology clinic finder for Cebu City residents.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-white/75">
              <li className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-white/60" strokeWidth={1.75} />
                Cebu City, Philippines
              </li>
              <li className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-white/60" strokeWidth={1.75} />
                <Link to="/contact-us" className="hover:text-white transition-colors">Get in touch</Link>
              </li>
            </ul>
          </div>

          {/* Link groups */}
          {LINK_GROUPS.map((group) => (
            <div key={group.title} className="md:col-span-2">
              <h4 className="font-display font-semibold text-xs uppercase tracking-[0.15em] mb-5 text-white">
                {group.title}
              </h4>
              <ul className="space-y-3">
                {group.links.map((link) => (
                  <li key={link.path}>
                    <Link
                      to={link.path}
                      className="text-sm text-white/75 hover:text-white transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Socials */}
          <div className="md:col-span-2">
            <h4 className="font-display font-semibold text-xs uppercase tracking-[0.15em] mb-5 text-white">
              Follow Us
            </h4>
            <div className="flex gap-2.5">
              {SOCIALS.map(({ icon: Icon, label }) => (
                <a
                  key={label}
                  href="#"
                  aria-label={label}
                  className="w-9 h-9 rounded-full border border-white/25 flex items-center justify-center text-white/85 hover:bg-white hover:text-magenta-600 hover:border-white transition-all"
                >
                  <Icon className="w-4 h-4" strokeWidth={1.75} />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-14 pt-6 border-t border-white/15 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/70">
            © {new Date().getFullYear()} DERMAI. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-xs text-white/70">
            <Link to="/privacy-policy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link to="/terms-of-service" className="hover:text-white transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer
