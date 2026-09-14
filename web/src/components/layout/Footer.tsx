import {Link} from 'react-router-dom';
import { Facebook, Instagram, Twitter } from 'lucide-react';
import Logo from "@/assets/logo2.png";
function Footer() {
  return (
    <footer className="bg-magenta-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center mb-4">
              <img
                src={Logo}
                alt="LogDerm"
                className="h-14 w-auto object-contain"
              />
            </div>
            <p className="text-magenta-200 text-sm leading-relaxed">
              AI-powered skin condition analysis and dermatology clinic finder for Cebu City residents.
            </p>
            <div className="flex gap-3 mt-5">
              <a href="#" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors">
                <Facebook className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors">
                <Instagram className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors">
                <Twitter className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-display font-semibold text-sm uppercase tracking-wider mb-4 text-magenta-100">
              Quick Links
            </h4>
            <ul className="space-y-2.5">
              {[
                { label: "Home", path: "/" },
                { label: "Scan Skin", path: "/scan" },
                { label: "Find Clinics", path: "/find-clinics" },
              ].map((link) => (
                <li key={link.path}>
                  <Link to={link.path} className="text-sm text-magenta-200 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* For Clinics */}
          <div>
            <h4 className="font-display font-semibold text-sm uppercase tracking-wider mb-4 text-magenta-100">
              For Clinics
            </h4>
            <ul className="space-y-2.5">
              {[
                { label: "Partner With Us", path: "/partner-with-us" },
                { label: "Register Clinic", path: "/register-clinic" },
                { label: "Clinic Login", path: "/login" },
              ].map((link) => (
                <li key={link.path}>
                  <Link to={link.path} className="text-sm text-magenta-200 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="font-display font-semibold text-sm uppercase tracking-wider mb-4 text-magenta-100">
              Support
            </h4>
            <ul className="space-y-2.5">
              <li><Link to="/help-center" className="text-sm text-magenta-200 hover:text-white transition-colors">Help Center</Link></li>
              <li><Link to="/privacy-policy" className="text-sm text-magenta-200 hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms-of-service" className="text-sm text-magenta-200 hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link to="/contact-us" className="text-sm text-magenta-200 hover:text-white transition-colors">Contact Us</Link></li>
            </ul>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-12 pt-8 border-t border-white/10">
          <div className="bg-white/5 rounded-2xl p-4 mb-6">
            <p className="text-xs text-magenta-200 leading-relaxed text-center">
              <strong className="text-magenta-100">Medical Disclaimer:</strong> DERMAI provides AI-assisted preliminary skin condition assessments for educational purposes only. 
              Results are NOT a medical diagnosis. Always consult a licensed dermatologist for proper evaluation and treatment. 
              In case of emergency, call DOH Hotline 1555.
            </p>
          </div>
          <p className="text-center text-xs text-magenta-300">
            © {new Date().getFullYear()} DERMAI. All rights reserved. Made with ❤️ for Cebu City.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer
