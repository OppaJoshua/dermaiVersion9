import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`${component} must be used within a <Tabs> component`);
  return ctx;
}

type TabsProps = {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
};

export function Tabs({ defaultValue = "", value: controlledValue, onValueChange, className, children }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const value = controlledValue !== undefined ? controlledValue : internalValue;
  const setValue = (newVal: string) => {
    if (controlledValue === undefined) setInternalValue(newVal);
    onValueChange?.(newVal);
  };
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

type TabsListProps = {
  className?: string;
  children: ReactNode;
};

export function TabsList({ className, children }: TabsListProps) {
  return <div className={cn("inline-flex items-center", className)}>{children}</div>;
}

type TabsTriggerProps = {
  value: string;
  className?: string;
  children: ReactNode;
};

export function TabsTrigger({ value, className, children }: TabsTriggerProps) {
  const { value: activeValue, setValue } = useTabsContext("TabsTrigger");
  const isActive = activeValue === value;
  return (
    <button
      type="button"
      onClick={() => setValue(value)}
      data-state={isActive ? "active" : "inactive"}
      className={cn(
        "transition-colors",
        isActive ? "bg-white shadow-sm text-gray-900" : "text-gray-500",
        className
      )}
    >
      {children}
    </button>
  );
}

type TabsContentProps = {
  value: string;
  className?: string;
  children: ReactNode;
};

export function TabsContent({ value, className, children }: TabsContentProps) {
  const { value: activeValue } = useTabsContext("TabsContent");
  if (activeValue !== value) return null;
  return <div className={className}>{children}</div>;
}
