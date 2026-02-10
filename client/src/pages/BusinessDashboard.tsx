import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, Plus, Trash2, Clock, DollarSign, Users, Calendar,
  Check, X, Settings, Save, ArrowRight, Store, Scissors, MapPin,
  Sparkles, TrendingUp, MessageSquare, Star, CheckCircle2, Zap,
  Shield, Heart, BarChart3
} from "lucide-react";
import salonHeroImage from "@assets/generated_images/happy_client_getting_haircut.png";
import salonInteriorImage from "@assets/generated_images/modern_salon_interior_design.png";
import stylistHandsImage from "@assets/generated_images/stylist_hands_cutting_hair.png";
import happyClientImage from "@assets/generated_images/happy_client_salon_mirror.png";
import bookingTabletImage from "@assets/generated_images/salon_booking_tablet_interface.png";
import consultationImage from "@assets/generated_images/stylist_client_consultation_tablet.png";
import increaseBookingsImage from "@assets/generated_images/busy_salon_booking_growth.png";
import happyClientMirrorImage from "@assets/generated_images/satisfied_client_mirror_moment.png";
import calendarSchedulingImage from "@assets/generated_images/salon_digital_scheduling_tablet.png";
import clientManagementImage from "@assets/generated_images/salon_client_management_desk.png";
import clientLoyaltyImage from "@assets/generated_images/loyal_client_stylist_greeting.png";
import securePaymentsImage from "@assets/generated_images/salon_secure_payment_terminal.png";
import vibrantSalonImage from "@assets/generated_images/vibrant_colorful_salon_interior.png";
import clientRequestImage from "@assets/generated_images/stylist_reviewing_client_request.png";
import collaborationImage from "@assets/generated_images/stylist_client_braids_collaboration.png";
import asianSalonImage from "@assets/generated_images/asian_client_salon_experience.png";
import blackBarberImage from "@assets/generated_images/black_barber_barbershop_experience.png";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration: number;
  category: string | null;
  isActive: number;
}

interface BusinessStylist {
  id: string;
  name: string;
  bio: string | null;
  profileImageUrl: string | null;
  specialty: string | null;
  isActive: number;
  availability?: { dayOfWeek: number; startTime: string; endTime: string; isAvailable: number }[];
}

interface Business {
  id: string;
  googlePlaceId: string | null;
  ownerId: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  imageUrl: string | null;
  isVerified: number;
  isActive: number;
  services?: Service[];
  stylists?: BusinessStylist[];
}

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function StylistBenefitsSlideshow() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    } else if (isRightSwipe) {
      setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
    }
    setTouchStart(null);
    setTouchEnd(null);
  };
  
  const slides = [
    {
      gradient: "from-violet-600 to-purple-700",
      overlayGradient: "from-violet-900/90 via-violet-800/60 to-transparent",
      image: blackBarberImage,
      icon: Zap,
      title: "Play to Your Strengths",
      description: "Review client expectations upfront and accept what fits your expertise."
    },
    {
      gradient: "from-emerald-500 to-green-600",
      overlayGradient: "from-emerald-700/90 to-emerald-500/40",
      image: increaseBookingsImage,
      icon: TrendingUp,
      title: "Increase Bookings",
      description: "Convert browsers into loyal customers with visual previews."
    },
    {
      gradient: "from-amber-500 to-orange-600",
      overlayGradient: "from-amber-700/90 to-amber-500/40",
      image: happyClientMirrorImage,
      icon: Star,
      title: "Higher Satisfaction",
      description: "Expectations align with results. More 5-star reviews."
    },
    {
      gradient: "from-blue-500 to-indigo-600",
      overlayGradient: "from-blue-700/90 to-blue-500/40",
      image: calendarSchedulingImage,
      icon: Calendar,
      title: "Easy Scheduling",
      description: "Clients book directly. Automatic reminders reduce no-shows."
    },
    {
      gradient: "from-sky-500 to-cyan-600",
      overlayGradient: "from-sky-700/90 to-sky-500/40",
      image: clientManagementImage,
      icon: Users,
      title: "Client Management",
      description: "Track preferences and keep appointments organized."
    },
    {
      gradient: "from-rose-500 to-pink-600",
      overlayGradient: "from-rose-700/90 via-rose-600/70 to-transparent",
      image: clientLoyaltyImage,
      icon: Heart,
      title: "Build Client Loyalty",
      description: "Clients save their favorite looks and keep coming back."
    },
    {
      gradient: "from-slate-700 to-slate-900",
      overlayGradient: "from-slate-900/90 via-slate-800/70 to-transparent",
      image: securePaymentsImage,
      icon: Shield,
      title: "Secure Payments",
      description: "Accept payments seamlessly with Stripe integration."
    }
  ];

  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % slides.length);
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);

  const currentCard = slides[currentSlide];
  const Icon = currentCard.icon;

  return (
    <div 
      className="relative"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Main Card */}
      <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${currentCard.gradient} min-h-[280px]`}>
        <div className="absolute inset-0 overflow-hidden">
          <img 
            src={currentCard.image} 
            alt={currentCard.title} 
            className="w-full h-full object-cover opacity-40 transition-transform duration-500" 
          />
          <div className={`absolute inset-0 bg-gradient-to-t ${currentCard.overlayGradient}`} />
        </div>
        <div className="relative h-full min-h-[280px] flex flex-col justify-end p-6">
          <div className="h-12 w-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3">
            <Icon className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">{currentCard.title}</h3>
          <p className="text-white/90 text-base leading-relaxed">{currentCard.description}</p>
        </div>
      </div>

      {/* Navigation Dots */}
      <div className="flex items-center justify-center gap-2 mt-4">
        {slides.map((_, idx) => (
          <button
            key={idx}
            onClick={() => setCurrentSlide(idx)}
            className={`w-2 h-2 rounded-full transition-all ${
              idx === currentSlide 
                ? "bg-primary w-6" 
                : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
            data-testid={`dot-slide-${idx}`}
          />
        ))}
      </div>

      {/* Swipe hint */}
      <p className="text-center text-muted-foreground text-xs mt-3">
        Tap dots or swipe to explore
      </p>
    </div>
  );
}

function BusinessLandingPage({ onSetupClick }: { onSetupClick: () => void }) {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 py-12 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Left Side - Text Content */}
            <div className="order-2 lg:order-1">
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-6" data-testid="text-business-hero-title">
                Give them the look they want, <span className="font-bold" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>AÜREN</span> makes it effortless!
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed" data-testid="text-business-hero-subtitle">
                Auren leverages AI to empower you <span className="text-foreground font-semibold italic">play to your strengths</span>. Focus on connecting with your clients, we manage the technology that keeps them happy and coming back.
              </p>
              <Button 
                size="lg" 
                className="text-lg px-8 py-6"
                onClick={onSetupClick}
                data-testid="button-setup-business"
              >
                <Sparkles className="mr-2 h-5 w-5" />
                Start your free trial
              </Button>
            </div>
            
            {/* Right Side - Image */}
            <div className="order-1 lg:order-2">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <img 
                  src={salonHeroImage} 
                  alt="Happy client getting their hair styled"
                  className="w-full h-auto object-cover"
                  data-testid="img-business-hero"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section - Trendy Bento Layout */}
      <section className="py-16 md:py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-8 md:mb-16">
            <h2 className="text-2xl md:text-4xl font-bold text-foreground mb-4">
              Why Stylists Choose Auren
            </h2>
            <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
              Join hundreds of professionals who are transforming their client experience
            </p>
          </div>

          {/* Mobile Slideshow */}
          <div className="md:hidden">
            <StylistBenefitsSlideshow />
          </div>

          {/* Desktop Bento Grid Layout */}
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Large Feature Card - Play to Your Strengths */}
            <div className="lg:col-span-2 lg:row-span-2 group relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-purple-700 p-1">
              <div className="absolute inset-0 overflow-hidden rounded-3xl">
                <img src={blackBarberImage} alt="Black barber in barbershop" className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-violet-900/90 via-violet-800/60 to-transparent" />
              </div>
              <div className="relative h-full min-h-[320px] md:min-h-[400px] flex flex-col justify-end p-6 md:p-8">
                <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-4">
                  <Zap className="h-7 w-7 text-white" />
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-3">Play to Your Strengths</h3>
                <p className="text-white/90 text-base md:text-lg leading-relaxed">
                  Review client expectations upfront and accept what fits your expertise. So you shine doing what you do best.
                </p>
              </div>
            </div>

            {/* Increase Bookings */}
            <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 to-green-600">
              <div className="absolute inset-0 overflow-hidden">
                <img src={increaseBookingsImage} alt="Business growth" className="w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-emerald-700/90 to-emerald-500/40" />
              </div>
              <div className="relative p-6 min-h-[200px] flex flex-col justify-end">
                <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Increase Bookings</h3>
                <p className="text-white/80 text-sm">Convert browsers into loyal customers with visual previews.</p>
              </div>
            </div>

            {/* Higher Satisfaction */}
            <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600">
              <div className="absolute inset-0 overflow-hidden">
                <img src={happyClientMirrorImage} alt="Happy client" className="w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-amber-700/90 to-amber-500/40" />
              </div>
              <div className="relative p-6 min-h-[200px] flex flex-col justify-end">
                <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3">
                  <Star className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Higher Satisfaction</h3>
                <p className="text-white/80 text-sm">Expectations align with results. More 5-star reviews.</p>
              </div>
            </div>

            {/* Easy Scheduling */}
            <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600">
              <div className="absolute inset-0 overflow-hidden">
                <img src={calendarSchedulingImage} alt="Scheduling" className="w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-blue-700/90 to-blue-500/40" />
              </div>
              <div className="relative p-6 min-h-[200px] flex flex-col justify-end">
                <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3">
                  <Calendar className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Easy Scheduling</h3>
                <p className="text-white/80 text-sm">Clients book directly. Automatic reminders reduce no-shows.</p>
              </div>
            </div>

            {/* Client Management */}
            <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-500 to-cyan-600">
              <div className="absolute inset-0 overflow-hidden">
                <img src={clientManagementImage} alt="Client management" className="w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-sky-700/90 to-sky-500/40" />
              </div>
              <div className="relative p-6 min-h-[200px] flex flex-col justify-end">
                <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3">
                  <Users className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Client Management</h3>
                <p className="text-white/80 text-sm">Track preferences and keep appointments organized.</p>
              </div>
            </div>

            {/* Wide Card - Client Loyalty */}
            <div className="lg:col-span-2 group relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-500 to-pink-600">
              <div className="absolute inset-0 overflow-hidden">
                <img src={clientLoyaltyImage} alt="Client loyalty" className="w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-r from-rose-700/90 via-rose-600/70 to-transparent" />
              </div>
              <div className="relative p-6 md:p-8 min-h-[180px] flex flex-col justify-center">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                    <Heart className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Build Client Loyalty</h3>
                    <p className="text-white/90 text-sm md:text-base max-w-md">Clients save their favorite looks and keep coming back. Create lasting relationships with personalized experiences.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Secure Payments */}
            <div className="lg:col-span-2 group relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-700 to-slate-900">
              <div className="absolute inset-0 overflow-hidden">
                <img src={securePaymentsImage} alt="Secure payments" className="w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-r from-slate-900/90 via-slate-800/70 to-transparent" />
              </div>
              <div className="relative p-6 md:p-8 min-h-[180px] flex flex-col justify-center">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                    <Shield className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Secure Payments</h3>
                    <p className="text-white/90 text-sm md:text-base max-w-md">Accept payments seamlessly with Stripe integration. Get paid on time, every time with secure transactions.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Creative Collaboration Feature */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* Left - Image */}
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-br from-primary/20 to-violet-500/20 rounded-3xl blur-2xl" />
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <img 
                  src={collaborationImage} 
                  alt="Stylist and client collaborating on braids hairstyle"
                  className="w-full h-auto object-cover"
                />
              </div>
            </div>
            
            {/* Right - Content */}
            <div>
              <h2 className="text-2xl md:text-4xl font-bold text-foreground mb-4">
                Your Creativity + <span className="text-primary italic">Their Vision</span>
              </h2>
              <p className="text-muted-foreground text-lg mb-6">
                Auren isn't here to replace your creativity—it's a bridge between your artistry and your client's desires.
              </p>
              
              <div className="space-y-4 mb-8">
                <div className="flex gap-4 items-start">
                  <div className="h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Sketch Your Ideas</h4>
                    <p className="text-muted-foreground text-sm">Visualize what you're thinking and share it with clients before you start cutting.</p>
                  </div>
                </div>
                
                <div className="flex gap-4 items-start">
                  <div className="h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Collaborate in Real-Time</h4>
                    <p className="text-muted-foreground text-sm">Work together with your clients to refine the look until it's perfect for them.</p>
                  </div>
                </div>
                
                <div className="flex gap-4 items-start">
                  <div className="h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0">
                    <Heart className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Build Trust & Satisfaction</h4>
                    <p className="text-muted-foreground text-sm">When clients see your vision before you start, they trust you more and leave happier.</p>
                  </div>
                </div>
              </div>
              
              <p className="text-sm text-muted-foreground italic border-l-2 border-primary pl-4">
                "Auren helps me show clients what I'm envisioning. We collaborate, they get excited, and the result is always something we're both proud of."
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works for Business - Steps Left, Image Right */}
      <section className="py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
                Get Started in Minutes
              </h2>
              <p className="text-muted-foreground mb-8">Quick setup, instant results</p>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-lg">
                    <span className="text-lg font-bold text-primary-foreground">1</span>
                  </div>
                  <div className="pt-1">
                    <h3 className="font-semibold text-lg mb-1">Register Your Business</h3>
                    <p className="text-muted-foreground">Create your profile with basic info, location, and services in just a few clicks.</p>
                  </div>
                </div>

                <div className="ml-6 h-8 w-0.5 bg-primary/20" />

                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-lg">
                    <span className="text-lg font-bold text-primary-foreground">2</span>
                  </div>
                  <div className="pt-1">
                    <h3 className="font-semibold text-lg mb-1">Add Services & Pricing</h3>
                    <p className="text-muted-foreground">Set up your service menu with prices and durations. Add your team members.</p>
                  </div>
                </div>

                <div className="ml-6 h-8 w-0.5 bg-primary/20" />

                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-lg">
                    <span className="text-lg font-bold text-primary-foreground">3</span>
                  </div>
                  <div className="pt-1">
                    <h3 className="font-semibold text-lg mb-1">Go Live & Accept Bookings</h3>
                    <p className="text-muted-foreground">Clients discover you, visualize their looks with AI, and book appointments instantly.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-2xl overflow-hidden shadow-2xl">
                <img 
                  src={asianSalonImage} 
                  alt="Asian client salon experience"
                  className="w-full h-auto object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Upgrade Section */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary/5 via-background to-purple-500/5">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4" data-testid="text-upgrade-title">
              Upgrade your business with Auren
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto" data-testid="text-upgrade-subtitle">
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
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Reduce No-Shows</h4>
                  <p className="text-muted-foreground">Automated reminders and easy rescheduling mean fewer empty chairs and more predictable income.</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Reimagine growing your clientbase</h4>
                  <p className="text-muted-foreground">Build a portfolio of transformations. When clients love their results, they share—bringing you new business organically.</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Business Analytics</h4>
                  <p className="text-muted-foreground">Track bookings, popular services, and revenue trends. Make data-driven decisions to grow your business.</p>
                </div>
              </div>
            </div>

            <div className="relative">
              <Card className="border-2 border-primary/20 shadow-xl">
                <CardHeader className="text-center pb-4">
                  <Badge className="w-fit mx-auto mb-2 bg-green-600 hover:bg-green-600">First month only $30</Badge>
                  <CardTitle className="text-2xl">Everything You Need</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">$60</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-primary" />
                    <span>AI hairstyle visualization</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-primary" />
                    <span>24/7 online booking</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-primary" />
                    <span>Client & calendar management</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-primary" />
                    <span>Confirmations & reminders</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-primary" />
                    <span>Payment processing</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-primary" />
                    <span>No-show protection</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-primary" />
                    <span>Reporting & insights</span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    className="w-full" 
                    size="lg"
                    onClick={onSetupClick}
                  >
                    Get Started Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 md:py-24 bg-primary text-primary-foreground">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Ready to Transform Your Business?
          </h2>
          <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
            Stay ahead of the competition, build lasting loyalty with your clients, and grow your business with the power of AI visualization.
          </p>
          <Button 
            size="lg" 
            variant="secondary"
            className="text-lg px-8"
            onClick={onSetupClick}
            data-testid="button-setup-business-cta"
          >
            Set Up My Business
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  );
}

export default function BusinessDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  
  const [showServiceDialog, setShowServiceDialog] = useState(false);
  const [showStylistDialog, setShowStylistDialog] = useState(false);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [showAvailabilityDialog, setShowAvailabilityDialog] = useState(false);
  const [editingStylist, setEditingStylist] = useState<BusinessStylist | null>(null);
  
  const [newService, setNewService] = useState({ name: "", description: "", price: "", duration: "30", category: "" });
  const [newStylist, setNewStylist] = useState({ name: "", bio: "", specialty: "" });
  const [availability, setAvailability] = useState<{ dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean }[]>(
    DAYS_OF_WEEK.map((_, i) => ({
      dayOfWeek: i,
      startTime: "09:00",
      endTime: "17:00",
      isAvailable: i !== 0 && i !== 6,
    }))
  );

  const [registerForm, setRegisterForm] = useState({
    googlePlaceId: "",
    name: "",
    address: "",
    city: "",
    phone: "",
    website: "",
    description: "",
  });

  const { data: authUser } = useQuery({
    queryKey: ["/api/auth/user"],
  });

  const { data: business, isLoading, refetch: refetchBusiness } = useQuery<Business | null>({
    queryKey: ["/api/business/mine"],
    enabled: !!authUser,
  });

  // Redirect business owners to workspace
  if (authUser && business && !isLoading) {
    navigate("/business/workspace");
    return null;
  }

  const registerBusinessMutation = useMutation({
    mutationFn: async (data: typeof registerForm) => {
      const response = await apiRequest("POST", "/api/business/register", data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Business registered!", description: "Now add your services and stylists." });
      setShowRegisterDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/business/mine"] });
    },
    onError: (error: Error) => {
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
    },
  });

  const addServiceMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; price: number; duration: number; category: string }) => {
      if (!business) throw new Error("No business");
      const response = await apiRequest("POST", `/api/business/${business.id}/services`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Service added" });
      setShowServiceDialog(false);
      setNewService({ name: "", description: "", price: "", duration: "30", category: "" });
      refetchBusiness();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add service", description: error.message, variant: "destructive" });
    },
  });

  const deleteServiceMutation = useMutation({
    mutationFn: async (serviceId: string) => {
      const response = await apiRequest("DELETE", `/api/services/${serviceId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Service removed" });
      refetchBusiness();
    },
  });

  const addStylistMutation = useMutation({
    mutationFn: async (data: { name: string; bio: string; specialty: string }) => {
      if (!business) throw new Error("No business");
      const response = await apiRequest("POST", `/api/business/${business.id}/stylists`, data);
      return response.json();
    },
    onSuccess: (newStylistData) => {
      toast({ title: "Stylist added" });
      setShowStylistDialog(false);
      setNewStylist({ name: "", bio: "", specialty: "" });
      refetchBusiness();
      setEditingStylist(newStylistData);
      setShowAvailabilityDialog(true);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add stylist", description: error.message, variant: "destructive" });
    },
  });

  const deleteStylistMutation = useMutation({
    mutationFn: async (stylistId: string) => {
      const response = await apiRequest("DELETE", `/api/stylists/${stylistId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Stylist removed" });
      refetchBusiness();
    },
  });

  const setAvailabilityMutation = useMutation({
    mutationFn: async ({ stylistId, availabilityData }: { stylistId: string; availabilityData: typeof availability }) => {
      const response = await apiRequest("PUT", `/api/stylists/${stylistId}/availability`, {
        availability: availabilityData.map(a => ({
          dayOfWeek: a.dayOfWeek,
          startTime: a.startTime,
          endTime: a.endTime,
          isAvailable: a.isAvailable ? 1 : 0,
        })),
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Availability saved" });
      setShowAvailabilityDialog(false);
      setEditingStylist(null);
      refetchBusiness();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save availability", description: error.message, variant: "destructive" });
    },
  });

  const handleAddService = () => {
    if (!newService.name || !newService.price) {
      toast({ title: "Please fill in name and price", variant: "destructive" });
      return;
    }
    addServiceMutation.mutate({
      name: newService.name,
      description: newService.description,
      price: parseFloat(newService.price),
      duration: parseInt(newService.duration),
      category: newService.category,
    });
  };

  const handleAddStylist = () => {
    if (!newStylist.name) {
      toast({ title: "Please enter stylist name", variant: "destructive" });
      return;
    }
    addStylistMutation.mutate(newStylist);
  };

  const handleSaveAvailability = () => {
    if (!editingStylist) return;
    setAvailabilityMutation.mutate({ stylistId: editingStylist.id, availabilityData: availability });
  };

  const openAvailabilityFor = (stylist: BusinessStylist) => {
    setEditingStylist(stylist);
    if (stylist.availability && stylist.availability.length > 0) {
      setAvailability(
        DAYS_OF_WEEK.map((_, i) => {
          const existing = stylist.availability?.find(a => a.dayOfWeek === i);
          return existing 
            ? { ...existing, isAvailable: existing.isAvailable === 1 }
            : { dayOfWeek: i, startTime: "09:00", endTime: "17:00", isAvailable: false };
        })
      );
    } else {
      setAvailability(DAYS_OF_WEEK.map((_, i) => ({
        dayOfWeek: i,
        startTime: "09:00",
        endTime: "17:00",
        isAvailable: i !== 0 && i !== 6,
      })));
    }
    setShowAvailabilityDialog(true);
  };

  const handleSetupClick = () => {
    if (!authUser) {
      navigate("/business/signup");
    } else {
      setShowRegisterDialog(true);
    }
  };

  // TEMPORARY: Allow viewing dashboard UI with ?preview=true in URL
  const urlParams = new URLSearchParams(window.location.search);
  const isPreviewMode = urlParams.get('preview') === 'true';

  // Show marketing landing page for non-authenticated users OR users without a business
  if (!isPreviewMode && (!authUser || (!isLoading && !business))) {
    return (
      <>
        <BusinessLandingPage onSetupClick={handleSetupClick} />
        
        {/* Register Dialog - shown when user clicks setup */}
        <Dialog open={showRegisterDialog} onOpenChange={setShowRegisterDialog}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Register Your Business</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="bg-muted/50 p-3 rounded-lg text-sm">
                <p className="font-medium mb-1">Tip: Claim your Google listing</p>
                <p className="text-muted-foreground">
                  If your salon is on Google Maps, customers can book directly from their search results. 
                  Enter your Google Place ID below to link your listing.
                </p>
              </div>
              <div>
                <Label>Google Place ID (optional)</Label>
                <Input 
                  placeholder="e.g., ChIJ..."
                  value={registerForm.googlePlaceId || ""}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, googlePlaceId: e.target.value }))}
                  data-testid="input-business-place-id"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Find your Place ID at{" "}
                  <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Google Place ID Finder
                  </a>
                </p>
              </div>
              <div>
                <Label>Business Name *</Label>
                <Input 
                  placeholder="e.g., Modern Cuts Barbershop"
                  value={registerForm.name}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, name: e.target.value }))}
                  data-testid="input-business-name"
                />
              </div>
              <div>
                <Label>Address</Label>
                <Input 
                  placeholder="123 Main St"
                  value={registerForm.address}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, address: e.target.value }))}
                  data-testid="input-business-address"
                />
              </div>
              <div>
                <Label>City</Label>
                <Input 
                  placeholder="San Francisco"
                  value={registerForm.city}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, city: e.target.value }))}
                  data-testid="input-business-city"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input 
                  placeholder="(555) 123-4567"
                  value={registerForm.phone}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, phone: e.target.value }))}
                  data-testid="input-business-phone"
                />
              </div>
              <div>
                <Label>Website</Label>
                <Input 
                  placeholder="https://..."
                  value={registerForm.website}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, website: e.target.value }))}
                  data-testid="input-business-website"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea 
                  placeholder="Tell customers about your salon..."
                  value={registerForm.description}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, description: e.target.value }))}
                  data-testid="input-business-description"
                  className="min-h-[80px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRegisterDialog(false)}>Cancel</Button>
              <Button 
                onClick={() => registerBusinessMutation.mutate(registerForm)}
                disabled={!registerForm.name || registerBusinessMutation.isPending}
                data-testid="button-submit-register"
              >
                {registerBusinessMutation.isPending ? "Registering..." : "Register Business"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (isLoading && !isPreviewMode) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="container mx-auto py-12 px-4">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    );
  }

  // Mock data for preview mode
  const mockBusiness: Business = {
    id: "preview-123",
    googlePlaceId: null,
    ownerId: "preview-owner",
    name: "Modern Cuts Studio",
    address: "123 Main Street",
    city: "San Francisco",
    phone: "(555) 123-4567",
    website: "https://moderncutsstudio.com",
    description: "Premier hair salon specializing in modern cuts and styling",
    imageUrl: null,
    rating: "4.8",
    isVerified: 1,
    services: [
      { id: "s1", name: "Men's Haircut", description: "Classic or modern cut", price: 35, duration: 30, category: "Cuts", isActive: 1 },
      { id: "s2", name: "Women's Haircut", description: "Precision cut & style", price: 55, duration: 45, category: "Cuts", isActive: 1 },
      { id: "s3", name: "Color & Highlights", description: "Full color or highlights", price: 120, duration: 90, category: "Color", isActive: 1 },
    ],
    stylists: [
      { id: "st1", name: "Alex Johnson", bio: "10 years experience in modern cuts", specialty: "Fades & Tapers", profileImageUrl: null, isActive: 1, availability: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isAvailable: 1 }] },
      { id: "st2", name: "Maria Garcia", bio: "Color specialist", specialty: "Balayage", profileImageUrl: null, isActive: 1, availability: [{ dayOfWeek: 1, startTime: "10:00", endTime: "18:00", isAvailable: 1 }] },
    ],
  };

  const displayBusiness = isPreviewMode ? mockBusiness : business!

  // Business Dashboard for registered business owners
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      
      {/* Preview Mode Banner */}
      {isPreviewMode && (
        <div className="bg-amber-500 text-white text-center py-2 px-4 text-sm font-medium">
          Preview Mode - This is sample data. Remove ?preview=true from URL to exit.
        </div>
      )}
      
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Scissors className="h-6 w-6" />
              {displayBusiness.name}
            </h1>
            <p className="text-muted-foreground flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {displayBusiness.city || displayBusiness.address || "No location set"}
            </p>
          </div>
          <Badge variant={displayBusiness.isVerified ? "default" : "secondary"}>
            {displayBusiness.isVerified ? "Verified" : "Pending Verification"}
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="services" data-testid="tab-services">Services</TabsTrigger>
            <TabsTrigger value="stylists" data-testid="tab-stylists">Stylists</TabsTrigger>
            <TabsTrigger value="bookings" data-testid="tab-bookings">Bookings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-6 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Services</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{displayBusiness.services?.length || 0}</div>
                  <p className="text-xs text-muted-foreground">Active services</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Team</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{displayBusiness.stylists?.length || 0}</div>
                  <p className="text-xs text-muted-foreground">Active stylists</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">Active</div>
                  <p className="text-xs text-muted-foreground">Accepting bookings</p>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Quick Setup Guide</CardTitle>
                <CardDescription>Complete these steps to start accepting bookings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${(displayBusiness.services?.length || 0) > 0 ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                    {(displayBusiness.services?.length || 0) > 0 ? <Check className="h-5 w-5" /> : "1"}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Add your services</p>
                    <p className="text-sm text-muted-foreground">List haircuts, styling, and other services with prices</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setActiveTab("services"); setShowServiceDialog(true); }}>
                    Add Service
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${(displayBusiness.stylists?.length || 0) > 0 ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                    {(displayBusiness.stylists?.length || 0) > 0 ? <Check className="h-5 w-5" /> : "2"}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Add your team</p>
                    <p className="text-sm text-muted-foreground">Add stylists and set their availability</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setActiveTab("stylists"); setShowStylistDialog(true); }}>
                    Add Stylist
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${displayBusiness.stylists?.some(s => s.availability && s.availability.length > 0) ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                    {displayBusiness.stylists?.some(s => s.availability && s.availability.length > 0) ? <Check className="h-5 w-5" /> : "3"}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Set availability</p>
                    <p className="text-sm text-muted-foreground">Configure working hours for each stylist</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="services">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Services & Pricing</h2>
              <Button onClick={() => setShowServiceDialog(true)} data-testid="button-add-service">
                <Plus className="mr-2 h-4 w-4" /> Add Service
              </Button>
            </div>

            {(!displayBusiness.services || displayBusiness.services.length === 0) ? (
              <Card className="text-center py-12">
                <CardContent>
                  <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="font-semibold mb-2">No services yet</h3>
                  <p className="text-muted-foreground mb-4">Add your first service to start accepting bookings</p>
                  <Button onClick={() => setShowServiceDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Add Service
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {displayBusiness.services.map((service) => (
                  <Card key={service.id} data-testid={`card-service-${service.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{service.name}</CardTitle>
                          {service.category && (
                            <Badge variant="secondary" className="mt-1">{service.category}</Badge>
                          )}
                        </div>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 text-destructive"
                          onClick={() => deleteServiceMutation.mutate(service.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {service.description && (
                        <p className="text-sm text-muted-foreground mb-2">{service.description}</p>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-4 w-4" />
                          ${service.price}
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          {service.duration} min
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="stylists">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Team Members</h2>
              <Button onClick={() => setShowStylistDialog(true)} data-testid="button-add-stylist">
                <Plus className="mr-2 h-4 w-4" /> Add Stylist
              </Button>
            </div>

            {(!displayBusiness.stylists || displayBusiness.stylists.length === 0) ? (
              <Card className="text-center py-12">
                <CardContent>
                  <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="font-semibold mb-2">No team members yet</h3>
                  <p className="text-muted-foreground mb-4">Add stylists to start accepting bookings</p>
                  <Button onClick={() => setShowStylistDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Add Stylist
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {displayBusiness.stylists.map((stylist) => (
                  <Card key={stylist.id} data-testid={`card-stylist-${stylist.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={stylist.profileImageUrl || undefined} />
                            <AvatarFallback>{stylist.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <CardTitle className="text-base">{stylist.name}</CardTitle>
                            {stylist.specialty && (
                              <p className="text-sm text-muted-foreground">{stylist.specialty}</p>
                            )}
                          </div>
                        </div>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 text-destructive"
                          onClick={() => deleteStylistMutation.mutate(stylist.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {stylist.bio && (
                        <p className="text-sm text-muted-foreground mb-3">{stylist.bio}</p>
                      )}
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={() => openAvailabilityFor(stylist)}
                      >
                        <Clock className="mr-2 h-4 w-4" />
                        Set Availability
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="bookings">
            <Card className="text-center py-12">
              <CardContent>
                <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-semibold mb-2">No bookings yet</h3>
                <p className="text-muted-foreground">
                  Once you have services and stylists set up, clients can start booking appointments.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Service Dialog */}
      <Dialog open={showServiceDialog} onOpenChange={setShowServiceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Service Name *</Label>
              <Input 
                placeholder="e.g., Men's Haircut"
                value={newService.name}
                onChange={(e) => setNewService(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea 
                placeholder="Describe the service..."
                value={newService.description}
                onChange={(e) => setNewService(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Price ($) *</Label>
                <Input 
                  type="number"
                  placeholder="25"
                  value={newService.price}
                  onChange={(e) => setNewService(prev => ({ ...prev, price: e.target.value }))}
                />
              </div>
              <div>
                <Label>Duration (min)</Label>
                <Input 
                  type="number"
                  placeholder="30"
                  value={newService.duration}
                  onChange={(e) => setNewService(prev => ({ ...prev, duration: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Category</Label>
              <Input 
                placeholder="e.g., Haircuts, Styling, Coloring"
                value={newService.category}
                onChange={(e) => setNewService(prev => ({ ...prev, category: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowServiceDialog(false)}>Cancel</Button>
            <Button onClick={handleAddService} disabled={addServiceMutation.isPending}>
              {addServiceMutation.isPending ? "Adding..." : "Add Service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Stylist Dialog */}
      <Dialog open={showStylistDialog} onOpenChange={setShowStylistDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Stylist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Name *</Label>
              <Input 
                placeholder="Stylist name"
                value={newStylist.name}
                onChange={(e) => setNewStylist(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Specialty</Label>
              <Input 
                placeholder="e.g., Color Specialist, Barber"
                value={newStylist.specialty}
                onChange={(e) => setNewStylist(prev => ({ ...prev, specialty: e.target.value }))}
              />
            </div>
            <div>
              <Label>Bio</Label>
              <Textarea 
                placeholder="Brief bio..."
                value={newStylist.bio}
                onChange={(e) => setNewStylist(prev => ({ ...prev, bio: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStylistDialog(false)}>Cancel</Button>
            <Button onClick={handleAddStylist} disabled={addStylistMutation.isPending}>
              {addStylistMutation.isPending ? "Adding..." : "Add Stylist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Availability Dialog */}
      <Dialog open={showAvailabilityDialog} onOpenChange={setShowAvailabilityDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Availability for {editingStylist?.name}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[400px] pr-4">
            <div className="space-y-4 py-4">
              {availability.map((day, index) => (
                <div key={day.dayOfWeek} className="flex items-center gap-4">
                  <div className="w-24">
                    <Label>{DAYS_OF_WEEK[day.dayOfWeek]}</Label>
                  </div>
                  <Switch
                    checked={day.isAvailable}
                    onCheckedChange={(checked) => {
                      const updated = [...availability];
                      updated[index].isAvailable = checked;
                      setAvailability(updated);
                    }}
                  />
                  {day.isAvailable && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={day.startTime}
                        onChange={(e) => {
                          const updated = [...availability];
                          updated[index].startTime = e.target.value;
                          setAvailability(updated);
                        }}
                        className="w-28"
                      />
                      <span>-</span>
                      <Input
                        type="time"
                        value={day.endTime}
                        onChange={(e) => {
                          const updated = [...availability];
                          updated[index].endTime = e.target.value;
                          setAvailability(updated);
                        }}
                        className="w-28"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAvailabilityDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveAvailability} disabled={setAvailabilityMutation.isPending}>
              {setAvailabilityMutation.isPending ? "Saving..." : "Save Availability"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
