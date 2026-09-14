import { Mail, Phone, MapPin, Smartphone } from "lucide-react";
import contactImg from "@/assets/contact.png";

export default function ContactUsPage() {
  return (
    <section className="min-h-[calc(100vh-4rem)] bg-linear-to-br from-magenta-500 via-magenta-500 to-magenta-600 pt-16 pb-0 overflow-hidden flex items-center justify-center">
      <div className="max-w-6xl mx-auto px-4 w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {/* Left: intro, contact details, app download */}
        <div className="text-white relative z-10 py-4 flex flex-col justify-center">
          <p className="text-magenta-100 font-mono-accent text-xs tracking-[0.2em] uppercase mb-3">
            Get In Touch
          </p>
          <h1 className="text-4xl sm:text-5xl font-display font-bold mb-4">
            Contact Us
          </h1>
          <p className="text-magenta-100 text-lg leading-relaxed mb-10 max-w-md">
            Have a question or need assistance? Send us a message and our team will get back to you.
          </p>

          <ul className="border-y border-white/20 divide-y divide-white/20 mb-10">
            <li className="flex items-center gap-4 py-4">
              <MapPin className="w-5 h-5 text-magenta-100 shrink-0" />
              <div>
                <p className="text-xs text-magenta-100 uppercase tracking-wider">Address</p>
                <p className="font-semibold">Cebu City, Philippines</p>
              </div>
            </li>
            <li className="flex items-center gap-4 py-4">
              <Mail className="w-5 h-5 text-magenta-100 shrink-0" />
              <div>
                <p className="text-xs text-magenta-100 uppercase tracking-wider">Email</p>
                <p className="font-semibold">support@dermai.ph</p>
              </div>
            </li>
            <li className="flex items-center gap-4 py-4">
              <Phone className="w-5 h-5 text-magenta-100 shrink-0" />
              <div>
                <p className="text-xs text-magenta-100 uppercase tracking-wider">Phone</p>
                <p className="font-semibold">+63 32 000 0000</p>
              </div>
            </li>
          </ul>

          <div>
            <p className="text-sm text-magenta-100 mb-3">Download Our Application</p>
            <div className="flex flex-wrap gap-3">
              <a
                href="#"
                className="flex items-center gap-2 border border-white/30 rounded-xl px-4 py-2.5 text-white text-sm hover:bg-white/10 transition-colors"
              >
                <Smartphone className="w-5 h-5 shrink-0" />
                <span>
                  Get it on
                  <br />
                  <span className="font-semibold">Google Play</span>
                </span>
              </a>
            </div>
          </div>
        </div>

        {/* Right: contact.png */}
        <div className="hidden lg:flex items-end justify-end h-full self-end">
          <img
            src={contactImg}
            alt="Contact DermAI"
            width={650}
            height={650}
            className="max-w-none shrink-0 w-[650px] h-auto translate-x-16 pointer-events-none select-none" 
          />
        </div>
      </div>
    </section>
  );
}
