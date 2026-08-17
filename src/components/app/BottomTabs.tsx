import { Link } from "@tanstack/react-router";
import { House, ListChecks, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Employee tabs. The audit trail lives in the HR Ops console at /ops, not here. */
const tabs = [
  { to: "/", label: "Home", icon: House },
  { to: "/assistant", label: "Assistant", icon: MessageCircle, hero: true },
  { to: "/requests", label: "Requests", icon: ListChecks },
] as const;


export function BottomTabs() {
  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 z-40 w-full max-w-[430px] border-t border-border bg-card/95 backdrop-blur"
    >
      <ul className="flex items-stretch justify-around px-2 pb-2 pt-2">
        {tabs.map(({ to, label, icon: Icon, ...rest }) => {
          const hero = "hero" in rest;
          return (
            <li key={to} className="flex-1">
              <Link
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="group flex flex-col items-center gap-1 rounded-lg py-1 text-muted-foreground transition-colors data-[status=active]:text-primary"
              >
                <Icon
                  className={cn(
                    "transition-transform",
                    hero ? "size-7 group-data-[status=active]:scale-105" : "size-5",
                  )}
                  strokeWidth={hero ? 2.1 : 1.8}
                  fill="none"
                />
                <span className={cn("text-[11px] font-medium", hero && "font-semibold")}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
