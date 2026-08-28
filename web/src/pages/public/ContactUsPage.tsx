import { useState } from "react";
import { Mail, Phone, MapPin, Send, CheckCircle2,Instagram, Twitter, Facebook, Smartphone } from "lucide-react";

export default function ContactUsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = name.trim() && email.trim() && message.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    setSubmitted(true);
    setName("");
    setEmail("");
    setMessage("");
  };

  return (
    <div className="min-h-screen bg-magenta-50">
      <section className="min-h-screen bg-linear-to-br from-magenta-500 via-magenta-500 to-magenta-600 pt-32 pb-20">
        <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left: intro, contact details, app download */}
          <div className="text-white">
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

          {/* Right: contact form card */}
          <div className="bg-white rounded-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.45)] ring-1 ring-black/5 p-8 lg:p-10">
            {submitted ? (
              <div className="text-center py-10">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <p className="text-magenta-500 font-semibold text-xs tracking-wider uppercase mb-1">
                 Send A Message
                </p>
                <h2 className="text-2xl font-display font-bold text-gray-900 mb-2">
                 We&apos;d love to hear from you
                </h2>
                <button
                  onClick={() => setSubmitted(false)}
                  className="px-6 py-3 bg-magenta-500 text-white rounded-full font-semibold text-sm hover:bg-magenta-600 transition-colors"
                >
                  Send Another Message
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <p className="text-magenta-500 font-semibold text-xs tracking-wider uppercase mb-1">
                  Send A Message
                </p>
                <h2 className="text-2xl font-display font-bold text-gray-900 mb-2">
                  We&apos;d love to hear from you
                </h2>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full pb-2 bg-transparent border-b border-gray-300 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pb-2 bg-transparent border-b border-gray-300 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">Details</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Enter your problem details"
                    rows={3}
                    className="w-full pb-2 bg-transparent border-b border-gray-300 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 transition-colors resize-none"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold border-2 transition-colors ${
                      canSubmit
                        ? "border-magenta-500 text-magenta-500 hover:bg-magenta-500 hover:text-white"
                        : "border-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    Send Messages
                  </button>

                  <div className="flex items-center gap-3">
                    <a href="#" className="text-gray-400 hover:text-magenta-500 transition-colors">
                      <Twitter className="w-5 h-5" />
                    </a>
                    <a href="#" className="text-gray-400 hover:text-magenta-500 transition-colors">
                      <Instagram className="w-5 h-5" />
                    </a>
                    <a href="#" className="text-gray-400 hover:text-magenta-500 transition-colors">
                      <Facebook className="w-5 h-5" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
