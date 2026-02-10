import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { User, LogOut, Calendar, Sparkles, Star, CreditCard, ChevronDown, Building2, Home, Search, Handshake, DollarSign, Menu, MessageSquarePlus } from "lucide-react";
import { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const PAGE_TITLES: Record<string, string> = {
  "/stylists": "Find Your Stylist",
  "/pricing": "Plans & Pricing",
  "/business": "For Business",
  "/more": "More",
  "/book": "Book Appointment",
  "/upload": "Try New Look",
  "/survey": "Share Feedback",
};

interface NavigationProps {
  hideMobileNav?: boolean;
}

export default function Navigation({ hideMobileNav = false }: NavigationProps) {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const [showTryFree, setShowTryFree] = useState(false);
  const [showPageTitle, setShowPageTitle] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (location === "/upload") {
        setShowTryFree(false);
      } else if (location !== "/") {
        setShowTryFree(true);
      } else {
        setShowTryFree(window.scrollY > 400);
      }
      
      // Show page title in nav - always show on non-home pages, only on scroll for home
      setShowPageTitle(location !== "/" || window.scrollY > 80);
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [location]);
  
  const currentPageTitle = PAGE_TITLES[location] || null;

  // Desktop nav items - conditionally include Business based on user type
  const desktopNavItems = [
    { path: "/", label: "Home", icon: Home },
    { path: "/stylists", label: "Stylists", icon: Search },
    // Only show Business nav item for business accounts or non-logged-in users
    ...(user?.accountType === "business" ? [{ path: "/business", label: "Business", icon: Handshake }] : []),
    ...(!user ? [{ path: "/business", label: "Business", icon: Handshake }] : []),
    { path: "/pricing", label: "Plans", icon: DollarSign },
    { path: "/more", label: "More", icon: Menu },
  ];

  // Mobile nav items - Home in the middle for emphasis
  const mobileNavItems = [
    { path: "/stylists", label: "Stylists", icon: Search },
    { path: "/pricing", label: "Plans", icon: DollarSign },
    { path: "/", label: "Home", icon: Home, isCenter: true },
    { path: "/business", label: "Business", icon: Handshake },
    { path: "/more", label: "More", icon: Menu },
  ];

  const handleAuth = () => {
    setLocation("/login");
  };

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  const getUserInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.firstName) {
      return user.firstName[0].toUpperCase();
    }
    return "U";
  };

  return (
    <>
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-white dark:bg-slate-950 backdrop-blur-md border-b border-gray-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-[5vw] md:px-4">
          <div className="flex items-center justify-between pt-[2vh] pb-[1vh] md:py-0 md:h-16 gap-4">
            {/* Logo + Page Title on mobile when scrolled */}
            <div className="flex items-center gap-2">
              <Link href="/">
                <div className="flex items-center hover-elevate active-elevate-2 rounded-md cursor-pointer" data-testid="link-home">
                  <span className="font-bold text-xl tracking-tight text-black dark:text-white" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>
                    AÜREN
                  </span>
                </div>
              </Link>
              
              {/* Mobile page title - shows when scrolled */}
              {showPageTitle && currentPageTitle && (
                <div className="md:hidden flex items-center animate-in fade-in slide-in-from-left-2 duration-200">
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-sm font-medium text-foreground truncate max-w-[140px]">
                    {currentPageTitle}
                  </span>
                </div>
              )}
              
              {showTryFree && !user && !location.startsWith("/results") && (
                <Button
                  size="sm"
                  className="hidden sm:flex rounded-full shadow-md shadow-primary/20 animate-in fade-in slide-in-from-left-2 duration-300 bg-blue-900 text-white hover:bg-blue-800"
                  data-testid="button-try-free-nav"
                  onClick={() => {
                    if (location !== "/") {
                      setLocation("/");
                      setTimeout(() => {
                        document.getElementById("free-trial-generator")?.scrollIntoView({ behavior: "smooth" });
                      }, 100);
                    } else {
                      document.getElementById("free-trial-generator")?.scrollIntoView({ behavior: "smooth" });
                    }
                  }}
                >
                  Try for Free
                </Button>
              )}
              
              {user && location !== "/upload" && (
                <Link href="/upload">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full shadow-md shadow-primary/20 animate-in fade-in slide-in-from-left-2 duration-300 bg-blue-900 text-white hover:bg-blue-800"
                    data-testid="button-try-new-look-nav"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Try New Look
                  </Button>
                </Link>
              )}
            </div>

            {/* Desktop Navigation - hidden on mobile */}
            <div className="hidden md:flex items-center gap-6">
              {desktopNavItems
                .filter((item) => !(item.path === "/upload" && location === "/upload"))
                .map((item) => (
                <Link key={item.path} href={item.path}>
                  <span
                    className={`text-sm transition-all cursor-pointer relative ${
                      location === item.path 
                        ? "text-black dark:text-white font-bold after:absolute after:bottom-[-4px] after:left-0 after:right-0 after:h-[2px] after:bg-blue-900 dark:after:bg-white" 
                        : "text-black/70 dark:text-slate-300 font-medium hover:text-black dark:hover:text-white"
                    }`}
                    data-testid={`link-${item.label.toLowerCase().replace(' ', '-')}`}
                  >
                    {item.label}
                  </span>
                </Link>
              ))}
            </div>

            {/* Right side - Survey button + Login/Profile */}
            <div className="flex items-center gap-2">
              <Link href="/survey">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover-elevate"
                  data-testid="button-survey"
                  title="Share Feedback"
                >
                  <MessageSquarePlus className="h-5 w-5" />
                </Button>
              </Link>
              {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    className="flex items-center gap-2 px-2 hover-elevate"
                    data-testid="button-profile-menu"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.profileImageUrl || undefined} alt={user.firstName || "User"} />
                      <AvatarFallback className="bg-blue-900 text-white text-sm">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:inline text-sm font-medium text-foreground">
                      {user.firstName || "Account"}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none" data-testid="text-user-name">
                        {user.firstName} {user.lastName}
                      </p>
                      <p className="text-xs leading-none text-muted-foreground" data-testid="text-user-email">
                        {user.email}
                      </p>
                      <p className="text-xs text-blue-600 font-medium mt-1" data-testid="text-user-credits">
                        {user.credits} credits • {user.plan === "free" ? "Free Plan" : user.plan}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem 
                    onClick={() => setLocation("/appointments")}
                    className="cursor-pointer"
                    data-testid="menu-appointments"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    <span>My Appointments</span>
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem 
                    onClick={() => setLocation("/my-looks")}
                    className="cursor-pointer"
                    data-testid="menu-saved-looks"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    <span>Saved Looks</span>
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem 
                    onClick={() => setLocation("/my-reviews")}
                    className="cursor-pointer"
                    data-testid="menu-reviews"
                  >
                    <Star className="mr-2 h-4 w-4" />
                    <span>My Reviews</span>
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem 
                    onClick={() => setLocation("/pricing")}
                    className="cursor-pointer"
                    data-testid="menu-billing"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    <span>Credits & Plans</span>
                  </DropdownMenuItem>

                  {user.accountType === "business" && (
                    <DropdownMenuItem 
                      onClick={() => setLocation("/business/workspace")}
                      className="cursor-pointer"
                      data-testid="menu-business-workspace"
                    >
                      <Building2 className="mr-2 h-4 w-4" />
                      <span>Business Dashboard</span>
                    </DropdownMenuItem>
                  )}
                  
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem 
                    onClick={handleLogout}
                    className="cursor-pointer text-red-600 focus:text-red-600"
                    data-testid="menu-logout"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              // Beta: Login hidden for beta testing - users don't need to login
              null
            )}
          </div>
        </div>
      </div>
    </nav>

      {/* Mobile Bottom Navigation - only visible on mobile, hidden when hideMobileNav is true */}
      <nav className={`md:hidden fixed bottom-0 left-0 right-0 z-[100] h-[3.6rem] min-[390px]:h-[4.5rem] bg-white dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800 pb-safe ${hideMobileNav ? 'hidden' : ''}`}>
        <div className="flex items-center justify-around h-full">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;
            const isCenter = (item as any).isCenter;
            
            // Special styling for center Home button
            if (isCenter) {
              return (
                <Link key={item.path} href={item.path}>
                  <button
                    className={`flex items-center justify-center w-12 h-12 min-[390px]:w-[3.5rem] min-[390px]:h-[3.5rem] -mt-4 min-[390px]:-mt-5 rounded-full shadow-lg transition-all ${
                      isActive 
                        ? "bg-blue-900 text-white shadow-blue-900/40" 
                        : "bg-blue-800 text-white shadow-blue-800/30"
                    }`}
                    data-testid={`mobile-nav-${item.label.toLowerCase().replace(' ', '-')}`}
                  >
                    <Icon className="h-5 w-5 min-[390px]:h-6 min-[390px]:w-6 stroke-[2]" />
                  </button>
                </Link>
              );
            }
            
            return (
              <Link key={item.path} href={item.path}>
                <button
                  className={`flex flex-col items-center justify-center w-14 min-[390px]:w-20 h-full gap-0.5 min-[390px]:gap-1 transition-colors ${
                    isActive 
                      ? "text-blue-900 dark:text-blue-400" 
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                  data-testid={`mobile-nav-${item.label.toLowerCase().replace(' ', '-')}`}
                >
                  <Icon className={`h-4 w-4 min-[390px]:h-5 min-[390px]:w-5 ${isActive ? "stroke-[2.5]" : ""}`} />
                  <span className="text-[9px] min-[390px]:text-xs font-medium">{item.label}</span>
                </button>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Spacer for mobile bottom nav */}
      {!hideMobileNav && <div className="md:hidden h-[3.6rem] min-[390px]:h-[4.5rem]" />}
    </>
  );
}
