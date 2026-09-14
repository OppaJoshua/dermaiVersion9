import React, { useState } from "react";
import { Trash2, Save, UserCircle } from "lucide-react";
export default function AccountSettingsPage() {
    const [saved, setSaved] = useState(false);
    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
    };
    return (<div className="max-w-2xl mx-auto py-10 px-4 sm:px-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-magenta-100 rounded-2xl text-magenta-600">
          <UserCircle className="w-6 h-6"/>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your account</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Danger Zone */}
        <div className="bg-red-50 rounded-2xl border border-red-100 p-6">
          <div className="flex items-center gap-2 mb-3">
            <Trash2 className="w-4 h-4 text-red-500"/>
            <h2 className="text-sm font-bold text-red-700 uppercase tracking-wider">Danger Zone</h2>
          </div>
          <p className="text-sm text-red-600 mb-4">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          <button type="button" className="px-5 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors">
            Delete My Account
          </button>
        </div>

        <button type="submit" className="w-full flex items-center justify-center gap-2 py-3.5 bg-magenta-500 text-white rounded-xl font-bold text-sm hover:bg-magenta-600 transition-colors shadow-lg shadow-magenta-500/20">
          <Save className="w-4 h-4"/>
          {saved ? "Saved!" : "Save Changes"}
        </button>
      </form>
    </div>);
}
