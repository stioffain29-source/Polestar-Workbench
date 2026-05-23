import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, Database, Map as MapIcon, Clock, Flame, Droplet, Users, Zap, Ship, Package, Navigation, Target, History, Radio, FileText, Flag, Search, Bell
} from "lucide-react";
import { cn } from "@/lib/utils";
import polestarLogo from "@assets/Reverse_white_logo_vert_1779500138062.png";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navGroups = [
    {
      title: "OVERVIEW",
      items: [
        { label: "Dashboard", href: "/", icon: Activity },
        { label: "Incidents", href: "/incidents", icon: Database },
        { label: "Map", href: "/map", icon: MapIcon },
        { label: "Timeline", href: "/timeline", icon: Clock },
      ]
    },
    {
      title: "TOPICS",
      items: [
        { label: "Fuel", href: "/topics/fuel", icon: Droplet },
        { label: "Flashpoint", href: "/topics/flashpoint", icon: Flame },
        { label: "Protests & Civil Unrest", href: "/topics/protests", icon: Users },
        { label: "Fertiliser", href: "/topics/fertiliser", icon: Package },
        { label: "Energy", href: "/topics/energy", icon: Zap },
        { label: "Shipping", href: "/topics/shipping", icon: Ship },
        { label: "Cargo Watch", href: "/topics/cargo-watch", icon: Package },
      ]
    },
    {
      title: "STRIKE TRACKERS",
      items: [
        { label: "Maritime - Hormuz", href: "/strikes/maritime", icon: Navigation },
        { label: "Land - GCC", href: "/strikes/land", icon: Target },
        { label: "Backfill", href: "/strikes/backfill", icon: History },
      ]
    },
    {
      title: "COUNTRY REPORTS",
      items: [
        { label: "PNG", href: "/countries/papua-new-guinea", icon: Flag },
        { label: "Papua", href: "/countries/papua", icon: Flag },
        { label: "All Countries", href: "/countries", icon: Database },
      ]
    },
    {
      title: "OPERATIONS",
      items: [
        { label: "Source Health", href: "/sources", icon: Radio },
        { label: "Reports", href: "/reports", icon: FileText },
      ]
    }
  ];

  const now = new Date().toLocaleString('en-US', { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col no-print">
        <div className="p-6 border-b border-sidebar-border">
          <img
            src={polestarLogo}
            alt="Polestar Advisory"
            className="w-40 h-auto"
          />
          <div className="text-xs text-sidebar-foreground/60 mt-3 uppercase font-serif tracking-widest font-bold">
            Workbench
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          {navGroups.map((group, i) => (
            <div key={i} className="mb-6">
              <div className="px-6 mb-2 text-xs font-serif font-bold text-sidebar-foreground/50 tracking-wider">
                {group.title}
              </div>
              <div className="space-y-0.5 px-3">
                {group.items.map((item, j) => {
                  const isActive = location === item.href;
                  return (
                    <Link
                      key={j}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 text-sm rounded-sm transition-colors group relative",
                        isActive 
                          ? "bg-sidebar-accent/10 text-sidebar-accent" 
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/5 hover:text-sidebar-foreground"
                      )}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-sidebar-accent rounded-r" />
                      )}
                      <item.icon className={cn(
                        "w-4 h-4",
                        isActive ? "text-sidebar-accent" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70"
                      )} />
                      <span className={cn(
                        "font-medium",
                        isActive ? "font-serif tracking-wide" : "font-sans"
                      )}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        
        <div className="p-4 border-t border-sidebar-border text-xs text-sidebar-foreground/40 font-mono">
          <div className="flex items-center justify-between">
            <span>SYS.STATUS</span>
            <span className="text-accent flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              ONLINE
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 flex-shrink-0 border-b border-border bg-card flex items-center justify-between px-6 no-print">
          <div className="flex items-center gap-4">
            <div className="text-sm font-mono text-muted-foreground hidden md:block">
              {now}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative w-64 hidden sm:block">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Global search..." 
                className="w-full h-9 bg-muted/50 border border-border rounded-sm pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-all font-sans placeholder:text-muted-foreground/70"
              />
            </div>
            
            <button className="w-8 h-8 rounded-sm hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors relative">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-accent rounded-full border border-card" />
            </button>
            
            <div className="w-8 h-8 rounded-sm bg-primary text-primary-foreground flex items-center justify-center font-serif font-bold text-sm">
              JS
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-background p-6 custom-scrollbar print:p-0 print:bg-white">
          {children}
        </main>
      </div>
    </div>
  );
}
