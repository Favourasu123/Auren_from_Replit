import { useEffect, useState, useCallback, useRef } from "react";
import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import FeatureCarousel from "@/components/FeatureCarousel";
import Footer from "@/components/Footer";
import FreeTrialGenerator from "@/components/FreeTrialGenerator";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Calendar, Scissors, Search, Star, ArrowRight, ArrowLeft, Clock, MapPin, Store, CheckCircle2, Shield, Users, Target, DollarSign, Home as HomeIcon, Handshake, Menu, MessageSquarePlus, X, Camera, MessageCircle, Wand2, Upload, Gift, HelpCircle } from "lucide-react";
import satisfiedClientsImage from "@assets/generated_images/happy_satisfied_salon_clients.png";
import idealPhotoExample from "@assets/generated_images/ideal_photo_example.png";
import modeDescribeIt from "@/assets/images/mode_describe_it.png";
import modeUploadInspo from "@/assets/images/mode_upload_inspo.png";
import modeAurenIQ from "@/assets/images/mode_aureniq.png";
import { Skeleton } from "@/components/ui/skeleton";

const AI_INSTRUCTIONS_STORAGE_KEY = "auren_ai_instructions_hidden";
const INTRO_DISMISSED_SESSION_KEY = "auren_intro_dismissed_session";

interface CreditsInfo {
  isAuthenticated: boolean;
  anonymousCreditsRemaining?: number;
  anonymousCreditsLimit?: number;
  currentCredits?: number;
  plan?: string;
  creditsResetAt?: number;
}

function MobileAIInstructions({ onClose }: { onClose: () => void }) {
  const { data: creditsData } = useQuery<CreditsInfo>({
    queryKey: ["/api/credits"],
  });

  const handleClose = () => {
    // Mark intro as dismissed for this session (shows only once per session)
    sessionStorage.setItem(INTRO_DISMISSED_SESSION_KEY, "true");
    // Also mark as permanently seen (user can re-open via help icon)
    localStorage.setItem(AI_INSTRUCTIONS_STORAGE_KEY, "true");
    onClose();
  };

  // Calculate remaining generations
  const remainingGenerations = creditsData?.anonymousCreditsRemaining ?? creditsData?.currentCredits ?? 11;
  const totalGenerations = creditsData?.anonymousCreditsLimit ?? 11;
  
  // Calculate hours until credits reset
  const getHoursUntilReset = () => {
    if (!creditsData?.creditsResetAt) return null;
    const now = Date.now();
    const resetTime = creditsData.creditsResetAt;
    const hoursRemaining = Math.max(0, Math.ceil((resetTime - now) / (1000 * 60 * 60)));
    return hoursRemaining;
  };
  const hoursUntilReset = getHoursUntilReset();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gradient-to-b from-slate-50 via-white to-slate-100 w-full max-w-md max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-6 pb-4">
        <span className="font-bold text-xl tracking-tight text-slate-800" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>
          AÜREN
        </span>
        <button
          onClick={handleClose}
          className="p-2 rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
          data-testid="button-close-instructions"
        >
          <X className="h-5 w-5 text-slate-600" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-hide">
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">How-To-Use</h1>
          <p className="text-slate-500 text-sm">Upgrade your hair days with Auren</p>
        </div>

        {/* Combined Beta + Survey Banner */}
        <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-300">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Gift className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-amber-800 font-semibold text-sm">You're a Beta Tester!</p>
              <p className="text-amber-700/70 text-xs mt-0.5">Complete our quick survey after 2 generations for a chance to win a <span className="font-semibold text-amber-800">$25 gift card</span>.</p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {/* Section 1: Upload Photo with Example Image */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-md">
                <Camera className="h-4 w-4 text-white" />
              </div>
              <h3 className="text-slate-800 font-semibold">1. Upload Your Photo</h3>
            </div>
            <div className="flex gap-3 items-start">
              <img 
                src={idealPhotoExample} 
                alt="Ideal photo example" 
                className="w-20 h-28 object-cover rounded-lg border-2 border-slate-200 shadow-sm"
              />
              <ul className="text-slate-600 text-sm space-y-1.5 flex-1">
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span>Front-facing, looking at camera</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span>Good lighting on face</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span>Space above head for hair</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Section 2: Choose Your Style - Enhanced */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-md">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <h3 className="text-slate-800 font-semibold">2. Choose Your Style</h3>
              </div>
              <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-purple-200">
                {remainingGenerations}/{totalGenerations} left{hoursUntilReset !== null && hoursUntilReset > 0 ? ` · ${hoursUntilReset}h` : ' today'}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center gap-1.5 p-2 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200">
                <div className="w-full aspect-square rounded-lg overflow-hidden mb-1">
                  <img src={modeDescribeIt} alt="Describe your hairstyle" className="w-full h-full object-cover" />
                </div>
                <span className="text-xs text-slate-700 font-medium text-center">Describe It</span>
                <span className="text-[10px] text-slate-500 text-center leading-tight">Type your dream look</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-2 bg-gradient-to-br from-amber-50 to-orange-100 rounded-xl border border-amber-200">
                <div className="w-full aspect-square rounded-lg overflow-hidden mb-1">
                  <img src={modeUploadInspo} alt="Upload inspiration photo" className="w-full h-full object-cover" />
                </div>
                <span className="text-xs text-slate-700 font-medium text-center">Upload Inspo</span>
                <span className="text-[10px] text-slate-500 text-center leading-tight">Use a reference photo</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-2 bg-gradient-to-br from-pink-50 to-rose-100 rounded-xl border border-pink-200">
                <div className="w-full aspect-square rounded-lg overflow-hidden mb-1">
                  <img src={modeAurenIQ} alt="AurenIQ AI suggestions" className="w-full h-full object-cover" />
                </div>
                <span className="text-xs text-slate-700 font-medium text-center">AurenIQ</span>
                <span className="text-[10px] text-slate-500 text-center leading-tight">AI picks for you</span>
              </div>
            </div>
          </div>

          {/* Section 3: Book a Stylist */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md">
                <Scissors className="h-4 w-4 text-white" />
              </div>
              <h3 className="text-slate-800 font-semibold">3. Book a Trusted Stylist</h3>
            </div>
            <p className="text-slate-500 text-sm ml-10">Find verified stylists on Auren and bring your new look to life</p>
          </div>
        </div>

      </div>

      <div className="flex-shrink-0 px-5 py-4 border-t border-slate-200 bg-white/80 backdrop-blur-sm">
        <Button
          onClick={handleClose}
          className="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-6"
          data-testid="button-start-creating"
        >
          Begin Your Journey
        </Button>
        <p className="text-center text-xs text-slate-400 mt-3">
          BETA — Free to use during testing
        </p>
      </div>
      </div>
    </div>
  );
}

function MobileHomepage() {
  const [location] = useLocation();
  const [showInstructions, setShowInstructions] = useState(false);
  const [generatorStep, setGeneratorStep] = useState(1);
  const goBackFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Only show intro once per session (first visit)
    const sessionDismissed = sessionStorage.getItem(INTRO_DISMISSED_SESSION_KEY) === "true";
    if (!sessionDismissed) {
      setShowInstructions(true);
    }
  }, []);

  const handleOpenHelp = () => {
    setShowInstructions(true);
  };

  const handleStepChange = useCallback((step: number, goBack: () => void) => {
    setGeneratorStep(step);
    goBackFnRef.current = goBack;
  }, []);

  return (
    <>
      {showInstructions && (
        <MobileAIInstructions onClose={() => setShowInstructions(false)} />
      )}
      
      <div className="fixed inset-0 flex flex-col bg-gradient-to-b from-slate-100 via-slate-50 to-white dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
        <div className="flex-shrink-0 pt-[2vh] pb-[1vh] px-[5vw] flex items-center justify-between">
          <span className="font-bold text-xl tracking-tight text-black dark:text-white" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>AÜREN</span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleOpenHelp}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              data-testid="button-help-mobile"
              title="How to use"
            >
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
            </button>
            <Link href="/survey">
              <button
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                data-testid="button-survey-mobile"
                title="Share Feedback"
              >
                <MessageSquarePlus className="h-5 w-5 text-muted-foreground" />
              </button>
            </Link>
          </div>
        </div>
        
        <div className="flex-1 flex flex-col justify-center px-[4vw] py-[2vh] min-h-0 max-h-[calc(100vh-clamp(3.5rem,8vh,4.5rem)-4vh)]">
          <div className="flex-shrink-0 px-[1vw] pb-[1.5vh] flex items-center justify-center relative">
            {/* Back button inline with tagline - iPhone SE only (< 390px) */}
            {generatorStep === 2 && goBackFnRef.current && (
              <button
                onClick={() => goBackFnRef.current?.()}
                className="absolute left-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 shadow-md border border-slate-200 dark:border-slate-600 min-[390px]:hidden"
                data-testid="button-back-step-mobile"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <p className="text-muted-foreground text-[clamp(0.875rem,4vw,1.25rem)]">
              Reimagine how you do hair.
            </p>
          </div>
          
          <div className="flex-1 min-h-0 max-h-[65vh]">
            <div className="h-full bg-white dark:bg-slate-800 rounded-[clamp(1rem,4vw,1.5rem)] shadow-xl shadow-slate-200/60 dark:shadow-black/30 overflow-hidden flex flex-col">
              <FreeTrialGenerator mobileFullscreen onStepChange={handleStepChange} />
            </div>
          </div>
          
          {/* Benefits - hidden on iPhone SE (< 390px) when on step 2 to save space */}
          <div className={`flex-shrink-0 pt-[1.5vh] space-y-[0.4vh] ${generatorStep === 2 ? 'hidden min-[390px]:block' : ''}`}>
            {[
              "Clarity, not guesswork",
              "True-to-life previews",
              "Trusted stylists"
            ].map((text, i) => (
              <div key={i} className="flex items-center justify-center gap-[1.5vw]">
                <CheckCircle2 className="h-[clamp(0.875rem,3.5vw,1.25rem)] w-[clamp(0.875rem,3.5vw,1.25rem)] text-green-600 dark:text-green-500" />
                <span className="text-[clamp(0.75rem,3vw,1rem)] text-muted-foreground">{text}</span>
              </div>
            ))}
          </div>
        </div>
        
        <nav className="h-[3.6rem] min-[390px]:h-[4.5rem] flex-shrink-0 bg-white dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800 pb-safe z-50 relative">
          <div className="flex items-center justify-around h-full">
            {[
              { path: "/stylists", label: "Stylists", icon: Search },
              { path: "/pricing", label: "Plans", icon: DollarSign },
              { path: "/", label: "Home", icon: HomeIcon, isCenter: true },
              { path: "/business", label: "Business", icon: Handshake },
              { path: "/more", label: "More", icon: Menu },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = location === item.path;
              const isCenter = (item as any).isCenter;
              
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
      </div>
    </>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  
  return isMobile;
}

function useMobileState() {
  const isMobile = useIsMobile();
  return { isMobile };
}

interface UserProfile {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    profileImageUrl: string | null;
    credits: number;
    plan: string;
  };
  upcomingAppointments: Array<{
    id: string;
    date: string;
    startTime: string;
    business: { name: string };
    service: { name: string };
    stylist: { name: string };
  }>;
  savedTransformations: Array<{
    id: string;
    generatedImageUrl: string | null;
    customPrompt: string | null;
  }>;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
  }>;
}

function DashboardHome({ profile }: { profile: UserProfile }) {
  const firstName = profile.user.firstName || "there";
  const hasUpcomingAppointment = profile.upcomingAppointments.length > 0;
  const hasSavedLooks = profile.savedTransformations.length > 0;
  const nextAppointment = profile.upcomingAppointments[0];

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-welcome">
            Welcome back, {firstName}!
          </h1>
          <p className="text-muted-foreground">
            Ready to discover your next look?
          </p>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Link href="/upload">
            <Card className="hover-elevate cursor-pointer h-full border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950 dark:to-slate-900">
              <CardContent className="p-6 flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-4">
                  <Sparkles className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Try a New Look</h3>
                <p className="text-sm text-muted-foreground">AI-powered hairstyle preview</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/stylists">
            <Card className="hover-elevate cursor-pointer h-full">
              <CardContent className="p-6 flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mb-4">
                  <Search className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Find Stylists</h3>
                <p className="text-sm text-muted-foreground">Browse nearby professionals</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/appointments">
            <Card className="hover-elevate cursor-pointer h-full">
              <CardContent className="p-6 flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
                  <Calendar className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">My Appointments</h3>
                <p className="text-sm text-muted-foreground">
                  {hasUpcomingAppointment ? `${profile.upcomingAppointments.length} upcoming` : "No upcoming"}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/my-looks">
            <Card className="hover-elevate cursor-pointer h-full">
              <CardContent className="p-6 flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center mb-4">
                  <Scissors className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Saved Looks</h3>
                <p className="text-sm text-muted-foreground">
                  {hasSavedLooks ? `${profile.savedTransformations.length} saved` : "No looks yet"}
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming Appointment Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Upcoming Appointment
              </CardTitle>
              <CardDescription>
                {hasUpcomingAppointment ? "Your next scheduled visit" : "No upcoming appointments"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasUpcomingAppointment ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Scissors className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground" data-testid="text-appointment-service">
                        {nextAppointment.service.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        with {nextAppointment.stylist.name}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {new Date(nextAppointment.date).toLocaleDateString()} at {nextAppointment.startTime}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {nextAppointment.business.name}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Link href="/appointments">
                    <Button variant="outline" size="sm" className="w-full">
                      View All Appointments
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-muted-foreground mb-4">
                    Ready to book your next visit?
                  </p>
                  <Link href="/stylists">
                    <Button>
                      <Search className="mr-2 h-4 w-4" />
                      Find a Stylist
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Looks Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Recent Transformations
              </CardTitle>
              <CardDescription>
                {hasSavedLooks ? "Your AI-generated looks" : "Try on new hairstyles with AI"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasSavedLooks ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {profile.savedTransformations.slice(0, 3).map((transformation) => (
                      <div 
                        key={transformation.id} 
                        className="aspect-square rounded-lg overflow-hidden bg-muted"
                      >
                        {transformation.generatedImageUrl ? (
                          <img 
                            src={transformation.generatedImageUrl} 
                            alt="Transformation"
                            className="w-full h-full object-cover"
                            data-testid={`img-transformation-${transformation.id}`}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Sparkles className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <Link href="/my-looks">
                    <Button variant="outline" size="sm" className="w-full">
                      View All Looks
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-muted-foreground mb-4">
                    See how different hairstyles look on you before you commit
                  </p>
                  <Link href="/upload">
                    <Button>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Try a New Look
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Review Last Appointment Section */}
        {hasUpcomingAppointment && profile.upcomingAppointments.some(apt => {
          const aptDate = new Date(apt.date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return aptDate < today;
        }) && (
          <Card className="mt-6">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-yellow-100 dark:bg-yellow-900 flex items-center justify-center">
                    <Star className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Leave a Review</h3>
                    <p className="text-sm text-muted-foreground">
                      Share your experience from your recent appointment
                    </p>
                  </div>
                </div>
                <Link href="/my-reviews">
                  <Button variant="outline">
                    Write Review
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Footer />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Skeleton className="h-10 w-64 mb-2" />
        <Skeleton className="h-5 w-48 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, isLoading: authLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const { isMobile } = useMobileState();
  const [showInstructions, setShowInstructions] = useState(false);

  // Show intro slide on first visit for desktop (same logic as mobile)
  useEffect(() => {
    if (!isMobile) {
      const sessionDismissed = sessionStorage.getItem(INTRO_DISMISSED_SESSION_KEY) === "true";
      if (!sessionDismissed) {
        setShowInstructions(true);
      }
    }
  }, [isMobile]);

  // Handle redirect after login - smart redirect based on account type
  useEffect(() => {
    if (user && !authLoading) {
      const explicitRedirect = sessionStorage.getItem('loginRedirect');
      sessionStorage.removeItem('loginRedirect');
      
      // If there's an explicit redirect, use it
      if (explicitRedirect) {
        setLocation(explicitRedirect);
        return;
      }
      
      // Smart redirect based on account type
      if (user.accountType === 'business') {
        setLocation('/business/workspace');
      }
    }
  }, [user, authLoading, setLocation]);

  // Fetch profile data if user is logged in
  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/me"],
    enabled: !!user,
  });

  // Show loading state
  if (authLoading || (user && profileLoading)) {
    return <DashboardSkeleton />;
  }

  // Show dashboard for logged-in users
  if (user && profile) {
    return <DashboardHome profile={profile} />;
  }

  // Mobile users: clean, focused homepage design
  if (isMobile) {
    return <MobileHomepage />;
  }

  // Desktop: Show full landing page
  return (
    <>
      {showInstructions && (
        <MobileAIInstructions onClose={() => setShowInstructions(false)} />
      )}
      <div className="min-h-screen pb-20 md:pb-0">
      <Navigation />
      <Hero />
      <HowItWorks />
      <FeatureCarousel />
      
      {/* Rating System Section - Trendy Bento Layout */}
      <section className="py-6 md:py-20">
        <div className="max-w-7xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-4 md:mb-10">
            <h2 className="text-2xl md:text-4xl font-bold text-foreground mb-3">
              Choose with <span className="text-primary italic">confidence</span>
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Work together with your stylist to unlock your best look
            </p>
          </div>
          
          {/* Bento Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {/* Large Review Card */}
            <div className="col-span-2 row-span-2 relative bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 overflow-hidden">
              <div className="absolute inset-0 z-0">
                <img src={satisfiedClientsImage} alt="Happy clients" className="w-full h-full object-cover opacity-20" />
              </div>
              <div className="absolute top-4 right-4 flex gap-0.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className="h-4 w-4 text-amber-400 fill-amber-400" />
                ))}
              </div>
              
              <div className="relative z-10 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-12 w-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                    <Shield className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white text-lg font-bold">Verified Only</h3>
                    <p className="text-white/60 text-xs">Real clients, real results</p>
                  </div>
                </div>
                
                <div className="flex-1 space-y-2">
                  {[
                    { stars: 5, text: "Exactly what I showed them!", initials: "JM" },
                    { stars: 5, text: "Nailed my expectations", initials: "SK" },
                    { stars: 5, text: "Perfect match to the AI preview", initials: "AR" },
                  ].map((review, i) => (
                    <div key={i} className="bg-white/10 backdrop-blur-sm rounded-xl p-3 flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">{review.initials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex gap-0.5 mb-0.5">
                          {[...Array(review.stars)].map((_, j) => (
                            <Star key={j} className="h-3 w-3 text-amber-400 fill-amber-400" />
                          ))}
                        </div>
                        <p className="text-white/90 text-sm truncate">{review.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Feature Card - 5 Star Ratings */}
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-5 flex flex-col justify-between border border-slate-200 dark:border-slate-800">
              <Star className="h-8 w-8 text-amber-500 mb-3" />
              <div>
                <p className="font-semibold text-sm mb-1">5-Star Ratings</p>
                <p className="text-xs text-muted-foreground">Client satisfaction scores</p>
              </div>
            </div>
            
            {/* Feature Card - Transformations Portfolio */}
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-5 flex flex-col justify-between border border-slate-200 dark:border-slate-800">
              <Users className="h-8 w-8 text-slate-600 dark:text-slate-400 mb-3" />
              <div>
                <p className="font-semibold text-sm mb-1">Transformations</p>
                <p className="text-xs text-muted-foreground">Browse their portfolio</p>
              </div>
            </div>
            
            {/* Feature Card - Transparent Pricing */}
            <div className="bg-muted/50 rounded-2xl p-5 flex flex-col justify-between border border-border/50">
              <DollarSign className="h-7 w-7 text-green-500 mb-2" />
              <div>
                <p className="font-semibold text-sm mb-1">Transparent Pricing</p>
                <p className="text-xs text-muted-foreground">Know costs upfront</p>
              </div>
            </div>
            
            {/* Feature Card - Easy Booking */}
            <div className="bg-muted/50 rounded-2xl p-5 flex flex-col justify-between border border-border/50">
              <Calendar className="h-7 w-7 text-primary mb-2" />
              <div>
                <p className="font-semibold text-sm mb-1">Easy Booking</p>
                <p className="text-xs text-muted-foreground">Book instantly online</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Business Upgrade Section */}
      <section className="py-6 md:py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-4 md:mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4" data-testid="text-business-upgrade-title">
              Upgrade your business with Auren
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto" data-testid="text-business-upgrade-subtitle">
              Auren makes it easy to give your clients what they want
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">AI-Powered Consultations</h4>
                  <p className="text-muted-foreground">Make it easy for clients to know what they want with our ultra realistic AI-powered hairstyle previews.</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/50 flex items-center justify-center flex-shrink-0">
                  <Target className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Play to Your Strengths</h4>
                  <p className="text-muted-foreground">See what clients want before they book. Accept requests that match your expertise and focus on what you do best.</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Higher Satisfaction</h4>
                  <p className="text-muted-foreground">When expectations align with results, clients leave happy. Build loyalty and get more 5-star reviews.</p>
                </div>
              </div>
            </div>

            <div className="text-center lg:text-left">
              <Card className="border-2 border-primary/20 shadow-xl inline-block w-full max-w-md">
                <CardHeader className="text-center pb-4">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Store className="h-8 w-8 text-primary" />
                  </div>
                  <CardTitle className="text-xl">Are you a stylist or barber?</CardTitle>
                  <CardDescription>Join Auren and transform how you connect with clients</CardDescription>
                </CardHeader>
                <CardContent className="pb-6 space-y-3">
                  <p className="text-center text-sm font-semibold text-primary">First month only $30</p>
                  <Link href="/business/signup" onClick={() => window.scrollTo(0, 0)}>
                    <Button className="w-full" size="lg" data-testid="button-business-cta">
                      <Store className="mr-2 h-5 w-5" />
                      Start Free Trial
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>
      
      <Footer />
    </div>
    </>
  );
}
