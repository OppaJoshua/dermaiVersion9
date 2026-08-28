import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

type AccordionContextValue = {
  openValue: string | null;
  toggle: (value: string) => void;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);

const AccordionItemContext = createContext<string | null>(null);

type AccordionProps = {
  type?: "single";
  collapsible?: boolean;
  className?: string;
  children: ReactNode;
  defaultValue?: string | null;
};

export function Accordion({ collapsible = true, className, children, defaultValue = null }: AccordionProps) {
  const [openValue, setOpenValue] = useState<string | null>(defaultValue);

  const toggle = (value: string) => {
    setOpenValue((current) => (current === value ? (collapsible ? null : current) : value));
  };

  return (
    <AccordionContext.Provider value={{ openValue, toggle }}>
      <div className={cn("divide-y divide-gray-100", className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

type AccordionItemProps = {
  value: string;
  className?: string;
  children: ReactNode;
};

export function AccordionItem({ value, className, children }: AccordionItemProps) {
  return (
    <AccordionItemContext.Provider value={value}>
      <div className={cn("py-2", className)}>{children}</div>
    </AccordionItemContext.Provider>
  );
}

type AccordionTriggerProps = {
  className?: string;
  children: ReactNode;
};

export function AccordionTrigger({ className, children }: AccordionTriggerProps) {
  const context = useContext(AccordionContext);
  const value = useContext(AccordionItemContext);
  const id = useId();
  if (!context || value === null) return null;
  const isOpen = context.openValue === value;

  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-controls={id}
      onClick={() => context.toggle(value)}
      className={cn(
        "flex w-full items-center justify-between py-4 text-left font-medium text-gray-900",
        className
      )}
    >
      {children}
      <ChevronDown
        className={cn("w-4 h-4 shrink-0 text-gray-500 transition-transform duration-200", isOpen && "rotate-180")}
      />
    </button>
  );
}

type AccordionContentProps = {
  className?: string;
  children: ReactNode;
};

export function AccordionContent({ className, children }: AccordionContentProps) {
  const context = useContext(AccordionContext);
  const value = useContext(AccordionItemContext);
  const id = useId();
  if (!context || value === null) return null;
  const isOpen = context.openValue === value;

  return (
    <div
      id={id}
      className={cn("grid overflow-hidden transition-all duration-200 ease-in-out", isOpen ? "grid-rows-[1fr] pb-4 opacity-100" : "grid-rows-[0fr] opacity-0")}
    >
      <div className={cn("min-h-0", className)}>{children}</div>
    </div>
  );
}
