import { useState, useRef, useEffect } from "react";
import { ChevronDown, X, Check, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface SpecializationOption {
  id: string;
  name: string;
}

interface SpecializationMultiSelectProps {
  options: SpecializationOption[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  theme?: "magenta" | "blue";
}

export default function SpecializationMultiSelect({
  options,
  selectedIds,
  onChange,
  placeholder = "Select specializations...",
  disabled = false,
  theme = "magenta",
}: SpecializationMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isBlue = theme === "blue";

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  }, [isOpen]);

  const toggleOption = (id: string) => {
    if (disabled) return;
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((item) => item !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const removeOption = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange(selectedIds.filter((item) => item !== id));
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange([]);
  };

  const selectAllFiltered = () => {
    if (disabled) return;
    const filteredIds = filteredOptions.map((opt) => opt.id);
    const union = Array.from(new Set([...selectedIds, ...filteredIds]));
    onChange(union);
  };

  const filteredOptions = options.filter((opt) =>
    opt.name.toLowerCase().includes(search.toLowerCase().trim())
  );

  const selectedOptions = options.filter((opt) => selectedIds.includes(opt.id));

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Selector trigger */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className={`w-full min-h-[44px] px-3.5 py-2 rounded-xl border bg-white text-sm transition-all flex items-center justify-between gap-2 select-none ${
          disabled
            ? "bg-gray-50 border-gray-200 cursor-not-allowed text-gray-400"
            : isOpen
            ? isBlue
              ? "border-blue-500 ring-2 ring-blue-500/20 shadow-sm cursor-pointer"
              : "border-[#c0166a] ring-2 ring-magenta-500/20 shadow-sm cursor-pointer"
            : "border-gray-200 hover:border-gray-300 cursor-pointer"
        }`}
      >
        {/* Selected chips or placeholder */}
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0 py-0.5">
          {selectedOptions.length === 0 ? (
            <span className="text-gray-400 text-sm">{placeholder}</span>
          ) : (
            selectedOptions.map((item) => (
              <span
                key={item.id}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all animate-fadeIn ${
                  isBlue
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-magenta-50 text-[#c0166a] border-magenta-100/80"
                }`}
              >
                <span className="truncate max-w-[180px]">{item.name}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => removeOption(item.id, e)}
                    className={`p-0.5 rounded-full transition-colors focus:outline-none ${
                      isBlue
                        ? "hover:bg-blue-200/50 text-blue-700"
                        : "hover:bg-magenta-200/50 text-[#c0166a]"
                    }`}
                    aria-label={`Remove ${item.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))
          )}
        </div>

        {/* Right action icons */}
        <div className="flex items-center gap-1.5 shrink-0 text-gray-400">
          {selectedOptions.length > 0 && !disabled && (
            <button
              type="button"
              onClick={clearAll}
              className="p-1 rounded-lg hover:text-gray-600 hover:bg-gray-100 transition-colors text-xs"
              title="Clear all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              isOpen
                ? isBlue
                  ? "rotate-180 text-blue-600"
                  : "rotate-180 text-[#c0166a]"
                : ""
            }`}
          />
        </div>
      </div>

      {/* Dropdown menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 4, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 left-0 right-0 mt-1 bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden"
          >
            {/* Search and header actions */}
            <div className="p-3 border-b border-gray-100 bg-gray-50/50 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search specialization..."
                  className={`w-full pl-9 pr-4 py-1.5 rounded-xl border border-gray-200 bg-white text-xs focus:outline-none focus:ring-2 transition-all ${
                    isBlue
                      ? "focus:ring-blue-500/20 focus:border-blue-500"
                      : "focus:ring-magenta-500/20 focus:border-[#c0166a]"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-500 px-1">
                <span>
                  {selectedIds.length} of {options.length} selected
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className={`font-medium hover:underline ${
                      isBlue ? "text-blue-600" : "text-[#c0166a]"
                    }`}
                  >
                    Select all
                  </button>
                  {selectedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onChange([])}
                      className="font-medium text-gray-500 hover:text-gray-700"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Options list */}
            <div className="max-h-60 overflow-y-auto p-1.5 divide-y divide-gray-50">
              {filteredOptions.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">
                  No specialization found.
                </div>
              ) : (
                filteredOptions.map((option) => {
                  const isChecked = selectedIds.includes(option.id);
                  return (
                    <div
                      key={option.id}
                      onClick={() => toggleOption(option.id)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? isBlue
                            ? "bg-blue-50/70 text-blue-700 font-semibold"
                            : "bg-magenta-50/60 text-[#c0166a] font-semibold"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0 pr-2">
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                            isChecked
                              ? isBlue
                                ? "bg-blue-600 border-blue-600 text-white"
                                : "bg-[#c0166a] border-[#c0166a] text-white"
                              : "border-gray-300 bg-white"
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <span className="truncate">{option.name}</span>
                      </div>
                      {isChecked && (
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            isBlue ? "text-blue-600/80" : "text-[#c0166a]/70"
                          }`}
                        >
                          Selected
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
