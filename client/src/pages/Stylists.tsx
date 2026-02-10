import Navigation from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Star, ArrowLeft, MapPin, Phone, Instagram, Globe, Clock, DollarSign, CheckCircle, CheckCircle2, Calendar, ImagePlus, X, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";

interface SavedTransformation {
  id: string;
  imageUrl: string;
  prompt: string | null;
  originalPhoto: string | null;
  sessionId: string;
}

interface Service {
  name: string;
  price: number;
  duration: number;
}

interface Portfolio {
  id: string;
  imageUrl: string;
  description: string | null;
}

interface BetaStylist {
  id: string;
  name: string;
  bio: string | null;
  profileImageUrl: string | null;
  specialty: string | null;
  location: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  website: string | null;
  distance: number | null;
  priceRange: string | null;
  services: string | null;
  workingHours: string | null;
  rating: number;
  reviewCount: number;
  portfolio: Portfolio[];
}

interface SavedLook {
  id: number;
  imageUrl: string;
  prompt: string | null;
}

type BookingStep = "datetime" | "personalize";

export default function Stylists() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedStylist, setSelectedStylist] = useState<BetaStylist | null>(null);
  const [portfolioIndex, setPortfolioIndex] = useState(0);
  const [showBookingFlow, setShowBookingFlow] = useState(false);
  const [bookingStep, setBookingStep] = useState<BookingStep>("datetime");
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [selectedLooks, setSelectedLooks] = useState<SavedLook[]>([]);
  const [showLooksPicker, setShowLooksPicker] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [savedTransformation, setSavedTransformation] = useState<SavedTransformation | null>(null);

  // Load saved transformation from sessionStorage (from Results page)
  // and automatically pre-select it for attachment to bookings
  useEffect(() => {
    const saved = sessionStorage.getItem('savedTransformation');
    if (saved) {
      try {
        const transformation = JSON.parse(saved);
        setSavedTransformation(transformation);
        
        // Automatically pre-select this transformation for booking attachment
        // Use a special ID format to distinguish it from regular saved looks
        const preSelectedLook: SavedLook = {
          id: -1, // Use -1 to indicate this is from the current session
          imageUrl: transformation.imageUrl,
          prompt: transformation.prompt || null,
        };
        setSelectedLooks([preSelectedLook]);
      } catch (e) {
        console.error('Failed to parse saved transformation:', e);
      }
    }
  }, []);

  const { data: stylists, isLoading } = useQuery<BetaStylist[]>({
    queryKey: ["/api/beta-stylists"],
  });

  const { data: savedLooks } = useQuery<SavedLook[]>({
    queryKey: ["/api/user/favorites"],
    select: (data: any[]) => data.map(item => ({
      id: item.id,
      imageUrl: item.generatedImageUrl,
      prompt: item.customPrompt || item.sessionPrompt
    }))
  });

  const betaBookingMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/beta-booking", data);
    },
    onSuccess: () => {
      setShowBookingFlow(false);
      setShowSuccessDialog(true);
    },
    onError: () => {
      toast({
        title: "Booking failed",
        description: "Could not create demo booking. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleBooking = () => {
    if (!selectedStylist || !selectedService) return;

    const appointmentDate = bookingDate && bookingTime 
      ? new Date(`${bookingDate}T${bookingTime}:00`).toISOString()
      : null;

    betaBookingMutation.mutate({
      stylistId: selectedStylist.id,
      serviceName: selectedService.name,
      servicePrice: selectedService.price,
      appointmentDate,
      notes: bookingNotes,
      attachedLooks: selectedLooks.map(l => l.imageUrl),
    });
  };

  const parseServices = (servicesJson: string | null): Service[] => {
    if (!servicesJson) return [];
    try {
      return JSON.parse(servicesJson);
    } catch {
      return [];
    }
  };

  const parseWorkingHours = (hoursJson: string | null): Record<string, string> => {
    if (!hoursJson) return {};
    try {
      return JSON.parse(hoursJson);
    } catch {
      return {};
    }
  };

  const renderTrustedRating = (rating: number, light = false) => {
    const displayRating = Math.max(6.5, Math.min(7, rating * 1.4));
    const fullStars = Math.floor(displayRating);
    const hasHalf = displayRating - fullStars >= 0.4;
    
    return (
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5, 6, 7].map((star) => (
            <Star
              key={star}
              className={`h-3 w-3 ${
                star <= fullStars 
                  ? "text-amber-400 fill-amber-400" 
                  : star === fullStars + 1 && hasHalf
                    ? "text-amber-400 fill-amber-400/50"
                    : light ? "text-white/20" : "text-muted-foreground/30"
              }`}
            />
          ))}
        </div>
      </div>
    );
  };

  const toggleLook = (look: SavedLook) => {
    if (selectedLooks.find(l => l.id === look.id)) {
      setSelectedLooks(prev => prev.filter(l => l.id !== look.id));
    } else {
      setSelectedLooks(prev => [...prev, look]);
    }
  };

  const generateCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const days: (Date | null)[] = [];
    
    for (let i = 0; i < startPadding; i++) {
      days.push(null);
    }
    
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }
    
    return days;
  };

  const isDateSelectable = (date: Date | null) => {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  };

  const formatDateForDisplay = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const timeSlots = [
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
    "15:00", "15:30", "16:00", "16:30", "17:00"
  ];

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const h = parseInt(hours);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  useEffect(() => {
    if (selectedStylist || showBookingFlow) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedStylist, showBookingFlow]);

  const startBooking = () => {
    setBookingStep("datetime");
    setShowBookingFlow(true);
  };

  const closeBookingFlow = () => {
    setShowBookingFlow(false);
    setBookingStep("datetime");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 pb-mobile-nav">
        <Navigation />
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
        </div>
      </div>
    );
  }

  if (!stylists || stylists.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 pb-mobile-nav">
        <Navigation />
        <div className="container mx-auto px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-4 text-white">No Demo Stylists Available</h1>
          <p className="text-white/60">Check back later for beta testing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 pb-20 md:pb-0">
      <Navigation />
      
      {/* Floating generation circle - navigate back to results */}
      {savedTransformation && (
        <button
          onClick={() => setLocation(`/results/${savedTransformation.sessionId}`)}
          className="fixed bottom-24 right-4 z-50 w-14 h-14 rounded-full overflow-hidden border-2 border-white shadow-lg hover:scale-105 transition-transform md:hidden"
          title="View your generation"
          data-testid="button-view-generation"
        >
          <img
            src={savedTransformation.imageUrl}
            alt="Your generated look"
            className="w-full h-full object-cover"
          />
        </button>
      )}
      
      <div className="container mx-auto px-4 py-6 md:py-12 pb-mobile-nav">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <h1 className="text-2xl md:text-4xl font-bold text-white">Find a Stylist</h1>
            <Badge className="bg-white/10 text-white/80 border-white/20">Beta</Badge>
          </div>
          <p className="text-white/60 max-w-xl mx-auto">
            Browse our partner stylists and book an appointment
            <span className="block mt-1 text-sm italic text-white/40">
              Demo mode - no real appointments
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {stylists.map((stylist) => (
            <motion.div
              key={stylist.id}
              whileHover={{ y: -4 }}
              className="bg-white/5 backdrop-blur-sm rounded-2xl overflow-hidden border border-white/10 cursor-pointer transition-all hover:border-white/20"
              onClick={() => {
                setSelectedStylist(stylist);
                setPortfolioIndex(0);
                setSelectedService(null);
              }}
              data-testid={`card-stylist-${stylist.id}`}
            >
              <div className="aspect-video relative overflow-hidden">
                <img 
                  src={stylist.profileImageUrl || "https://images.pexels.com/photos/3993455/pexels-photo-3993455.jpeg"} 
                  alt={stylist.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent" />
                {stylist.distance && (
                  <Badge className="absolute top-3 right-3 bg-black/40 text-white backdrop-blur-sm border-0">
                    <MapPin className="h-3 w-3 mr-1" />
                    {stylist.distance} mi
                  </Badge>
                )}
                <div className="absolute bottom-3 left-4 right-4">
                  <h3 className="font-semibold text-lg text-white">{stylist.name}</h3>
                  <p className="text-sm text-white/70">{stylist.location}</p>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {renderTrustedRating(stylist.rating, true)}
                    <span className="text-xs font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                      {(Math.max(6.5, Math.min(7, stylist.rating * 1.4))).toFixed(1)}
                    </span>
                    <div className="flex items-center gap-1 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span className="text-[10px] font-medium text-emerald-400">Verified</span>
                    </div>
                  </div>
                  {stylist.priceRange && (
                    <span className="text-sm text-emerald-400 font-medium">
                      {stylist.priceRange}
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/50 mb-3 line-clamp-2">{stylist.bio}</p>
                <div className="flex flex-wrap gap-1.5">
                  {stylist.specialty?.split(", ").slice(0, 4).map((spec) => (
                    <span key={spec} className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/70">{spec}</span>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selectedStylist && !showBookingFlow && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-y-auto"
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ delay: 0.05 }}
            >
              <div className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-xl border-b border-white/10">
                <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/10"
                    onClick={() => setSelectedStylist(null)}
                    data-testid="button-back"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold truncate text-white">{selectedStylist.name}</h2>
                    <p className="text-sm text-white/60 truncate">{selectedStylist.location}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {renderTrustedRating(selectedStylist.rating, true)}
                    <span className="text-xs font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                      {(Math.max(6.5, Math.min(7, selectedStylist.rating * 1.4))).toFixed(1)}
                    </span>
                    <div className="flex items-center gap-1 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span className="text-[10px] font-medium text-emerald-400">Verified</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="aspect-[16/9] md:aspect-[21/9] overflow-hidden">
                  <img 
                    src={selectedStylist.portfolio[portfolioIndex]?.imageUrl || selectedStylist.profileImageUrl || ""} 
                    alt="Portfolio"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
                </div>
                
                {selectedStylist.portfolio.length > 1 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                    {selectedStylist.portfolio.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setPortfolioIndex(i)}
                        className={`h-2 w-2 rounded-full transition-all ${
                          i === portfolioIndex ? "bg-white w-6" : "bg-white/50"
                        }`}
                        data-testid={`button-portfolio-dot-${i}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {selectedStylist.portfolio.length > 1 && (
                <div className="container mx-auto px-4 py-4">
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {selectedStylist.portfolio.map((item, i) => (
                      <button 
                        key={item.id}
                        className={`flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${
                          i === portfolioIndex ? "border-white" : "border-transparent opacity-60"
                        }`}
                        onClick={() => setPortfolioIndex(i)}
                        data-testid={`button-portfolio-thumb-${i}`}
                      >
                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="container mx-auto px-4 py-6 space-y-6 pb-44">
                <div>
                  <p className="text-white/70 leading-relaxed">{selectedStylist.bio}</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {selectedStylist.address && (
                    <a 
                      href={`https://maps.google.com/?q=${encodeURIComponent(selectedStylist.address + ', ' + selectedStylist.city)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                    >
                      <MapPin className="h-4 w-4 text-white/60" />
                      <span className="text-sm text-white/80 truncate">{selectedStylist.city}</span>
                    </a>
                  )}
                  {selectedStylist.phone && (
                    <a 
                      href={`tel:${selectedStylist.phone}`}
                      className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                    >
                      <Phone className="h-4 w-4 text-white/60" />
                      <span className="text-sm text-white/80">Call</span>
                    </a>
                  )}
                  {selectedStylist.instagram && selectedStylist.instagram !== '#' && (
                    <a 
                      href={`https://instagram.com/${selectedStylist.instagram.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                    >
                      <Instagram className="h-4 w-4 text-white/60" />
                      <span className="text-sm text-white/80">Instagram</span>
                    </a>
                  )}
                  {selectedStylist.website && selectedStylist.website !== '#' && (
                    <a 
                      href={selectedStylist.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                    >
                      <Globe className="h-4 w-4 text-white/60" />
                      <span className="text-sm text-white/80">Website</span>
                    </a>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-white">
                    <Clock className="h-5 w-5 text-white/60" />
                    Hours
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(parseWorkingHours(selectedStylist.workingHours)).map(([day, hours]) => (
                      <div key={day} className="p-2 rounded-lg bg-white/5 border border-white/5">
                        <span className="block text-xs text-white/40 capitalize">{day}</span>
                        <span className="text-sm font-medium text-white/80">{hours}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-white">
                    <DollarSign className="h-5 w-5 text-white/60" />
                    Services
                  </h3>
                  <div className="space-y-2">
                    {parseServices(selectedStylist.services).map((service) => (
                      <button
                        type="button"
                        key={service.name} 
                        className={`w-full flex items-center justify-between p-4 rounded-xl transition-all ${
                          selectedService?.name === service.name 
                            ? "bg-white text-slate-900" 
                            : "bg-white/5 border border-white/10 hover:bg-white/10"
                        }`}
                        onClick={() => setSelectedService(service)}
                        data-testid={`button-service-${service.name.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        <div className="text-left">
                          <p className={`font-medium ${selectedService?.name === service.name ? "text-slate-900" : "text-white"}`}>{service.name}</p>
                          <p className={`text-xs ${selectedService?.name === service.name ? "text-slate-600" : "text-white/50"}`}>
                            {service.duration} min
                          </p>
                        </div>
                        <p className={`font-semibold text-lg ${selectedService?.name === service.name ? "text-slate-900" : "text-emerald-400"}`}>
                          {service.price === 0 ? "Free" : `$${service.price}`}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="fixed bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-xl border-t border-white/10">
                <div className="container mx-auto max-w-4xl p-4 pb-20 md:pb-4">
                  <Button 
                    className="w-full h-12 text-base bg-white text-slate-900 hover:bg-white/90"
                    disabled={!selectedService}
                    onClick={startBooking}
                    data-testid="button-book-appointment"
                  >
                    <Calendar className="h-5 w-5 mr-2" />
                    {selectedService ? `Book ${selectedService.name} - $${selectedService.price}` : "Select a service to book"}
                  </Button>
                  <p className="text-xs text-center text-white/40 mt-2">
                    Beta demo - no real appointments
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBookingFlow && selectedStylist && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-y-auto"
          >
            <div className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-xl border-b border-white/10">
              <div className="container mx-auto px-4 py-4 flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/10"
                  onClick={() => {
                    if (bookingStep === "datetime") {
                      closeBookingFlow();
                    } else {
                      setBookingStep("datetime");
                    }
                  }}
                  data-testid="button-booking-back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1">
                  <h2 className="font-semibold text-white text-lg">
                    {bookingStep === "datetime" ? "Choose Date & Time" : "Add Details"}
                  </h2>
                  <p className="text-sm text-white/60">
                    {selectedService?.name} · ${selectedService?.price}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {["datetime", "personalize"].map((step, i) => (
                    <div
                      key={step}
                      className={`h-1 rounded-full transition-all ${
                        (bookingStep === "datetime" && i === 0) ||
                        (bookingStep === "personalize")
                          ? "bg-white w-8"
                          : "bg-white/30 w-4"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="container mx-auto px-4 py-6 pb-36">
              <AnimatePresence mode="wait">
                {bookingStep === "datetime" && (
                  <motion.div
                    key="datetime"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="max-w-lg mx-auto space-y-6"
                  >
                    <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                      <div className="flex items-center justify-between mb-5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-white hover:bg-white/10 h-8 w-8"
                          onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
                          data-testid="button-prev-month"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <h3 className="font-medium text-white">
                          {calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                        </h3>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-white hover:bg-white/10 h-8 w-8"
                          onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}
                          data-testid="button-next-month"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-7 gap-1 mb-2">
                        {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
                          <div key={i} className="text-center text-xs font-medium text-white/40 py-2">
                            {day}
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-7 gap-1">
                        {generateCalendarDays().map((date, i) => {
                          const dateStr = date ? date.toISOString().split("T")[0] : "";
                          const isSelected = dateStr === bookingDate;
                          const isSelectable = isDateSelectable(date);
                          const isToday = date && date.toDateString() === new Date().toDateString();
                          
                          return (
                            <button
                              key={i}
                              disabled={!isSelectable}
                              onClick={() => date && setBookingDate(dateStr)}
                              className={`aspect-square flex items-center justify-center rounded-xl text-sm font-medium transition-all ${
                                !date
                                  ? ""
                                  : isSelected
                                  ? "bg-white text-slate-900 shadow-lg shadow-white/20"
                                  : isToday
                                  ? "bg-white/20 text-white"
                                  : isSelectable
                                  ? "text-white hover:bg-white/10"
                                  : "text-white/20 cursor-not-allowed"
                              }`}
                              data-testid={date ? `button-date-${dateStr}` : undefined}
                            >
                              {date?.getDate()}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {bookingDate && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-white/10" />
                          <span className="text-white/60 text-sm">{formatDateForDisplay(bookingDate)}</span>
                          <div className="h-px flex-1 bg-white/10" />
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                          {timeSlots.map((time) => (
                            <button
                              key={time}
                              onClick={() => setBookingTime(time)}
                              className={`py-3 px-2 rounded-xl text-sm font-medium transition-all ${
                                bookingTime === time
                                  ? "bg-white text-slate-900 shadow-lg shadow-white/20"
                                  : "bg-white/5 text-white border border-white/10 hover:bg-white/10"
                              }`}
                              data-testid={`button-time-${time.replace(":", "")}`}
                            >
                              {formatTime(time)}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                )}

                {bookingStep === "personalize" && (
                  <motion.div
                    key="personalize"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="max-w-lg mx-auto space-y-6"
                  >
                    <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                          <ImagePlus className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-white">Share Your Vision</h4>
                          <p className="text-sm text-white/60">Attach AI-generated looks for your stylist</p>
                        </div>
                      </div>
                      
                      {selectedLooks.length > 0 && (
                        <div className="flex gap-3 flex-wrap mb-4">
                          {selectedLooks.map((look) => (
                            <div key={look.id} className="relative group">
                              <img 
                                src={look.imageUrl} 
                                alt="Selected look" 
                                className="w-20 h-20 rounded-2xl object-cover ring-2 ring-white/20"
                              />
                              <button
                                onClick={() => toggleLook(look)}
                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                data-testid={`button-remove-look-${look.id}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <Button
                        variant="outline"
                        className="w-full bg-white/5 border-white/20 text-white hover:bg-white/10"
                        onClick={() => setShowLooksPicker(true)}
                        data-testid="button-attach-looks"
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        {selectedLooks.length > 0 ? "Add More Looks" : "Browse Your Looks"}
                      </Button>
                    </div>

                    <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                      <h4 className="font-semibold text-white mb-3">Notes for Your Stylist</h4>
                      <Textarea 
                        placeholder="Share any details about your desired style, hair concerns, or special requests..."
                        value={bookingNotes}
                        onChange={(e) => setBookingNotes(e.target.value)}
                        className="min-h-[100px] bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
                        data-testid="input-notes"
                      />
                    </div>

                    <div className="bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 rounded-2xl p-4 border border-white/10">
                      <div className="flex items-start gap-3">
                        <Calendar className="h-5 w-5 text-white/60 mt-0.5" />
                        <div>
                          <p className="font-medium text-white">{selectedService?.name}</p>
                          <p className="text-sm text-white/60">
                            {formatDateForDisplay(bookingDate)} at {formatTime(bookingTime)}
                          </p>
                          <p className="text-sm text-white/60">with {selectedStylist?.name}</p>
                        </div>
                      </div>
                    </div>

                    <p className="text-center text-white/40 text-sm">
                      This is a beta demo · No actual appointment will be made
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="fixed bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-xl border-t border-white/10">
              <div className="container mx-auto max-w-lg p-4 pb-20 md:pb-4">
                {bookingStep === "datetime" && (
                  <Button
                    className="w-full h-9 text-xs font-medium bg-white text-slate-900 hover:bg-white/90"
                    disabled={!bookingDate || !bookingTime}
                    onClick={() => setBookingStep("personalize")}
                    data-testid="button-continue-datetime"
                  >
                    Continue
                  </Button>
                )}
                {bookingStep === "personalize" && (
                  <Button
                    className="w-full h-9 text-xs font-medium bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white border-0"
                    onClick={handleBooking}
                    disabled={betaBookingMutation.isPending}
                    data-testid="button-confirm-booking"
                  >
                    {betaBookingMutation.isPending ? "Booking..." : "Confirm Booking"}
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLooksPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowLooksPicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-800 rounded-2xl shadow-2xl border border-white/10 max-w-md w-full max-h-[80vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-semibold text-lg text-white">Your Saved Looks</h3>
                <Button variant="ghost" size="icon" className="text-white/60 hover:bg-white/10" onClick={() => setShowLooksPicker(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="p-5 overflow-y-auto max-h-[60vh]">
                {savedLooks && savedLooks.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3">
                    {savedLooks.map((look) => (
                      <button
                        key={look.id}
                        onClick={() => toggleLook(look)}
                        className={`relative aspect-square rounded-xl overflow-hidden transition-all ${
                          selectedLooks.find(l => l.id === look.id)
                            ? "ring-2 ring-violet-500 ring-offset-2 ring-offset-slate-800"
                            : "hover:opacity-80"
                        }`}
                        data-testid={`button-look-${look.id}`}
                      >
                        <img 
                          src={look.imageUrl} 
                          alt="Saved look" 
                          className="w-full h-full object-cover"
                        />
                        {selectedLooks.find(l => l.id === look.id) && (
                          <div className="absolute inset-0 bg-violet-500/30 flex items-center justify-center">
                            <CheckCircle className="h-8 w-8 text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                      <Sparkles className="h-8 w-8 text-white/40" />
                    </div>
                    <p className="text-white/60 mb-2">No saved looks yet</p>
                    <p className="text-sm text-white/40">
                      Generate and save hairstyles to share with your stylist
                    </p>
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-white/10">
                <Button 
                  className="w-full bg-white text-slate-900 hover:bg-white/90" 
                  onClick={() => setShowLooksPicker(false)} 
                  data-testid="button-done-looks"
                >
                  Done ({selectedLooks.length} selected)
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSuccessDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-white/10 max-w-md w-full p-8 relative"
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 text-white/60 hover:bg-white/10"
                onClick={() => {
                  setShowSuccessDialog(false);
                  setSelectedStylist(null);
                  setSelectedService(null);
                  setBookingDate("");
                  setBookingTime("");
                  setBookingNotes("");
                  setSelectedLooks([]);
                }}
                data-testid="button-close-confirmation"
              >
                <X className="h-5 w-5" />
              </Button>
              <div className="text-center mb-8">
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring" }}
                  className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 mb-6 shadow-lg shadow-green-500/30"
                >
                  <CheckCircle className="h-10 w-10 text-white" />
                </motion.div>
                <h3 className="text-2xl font-bold text-white mb-2">Booking Confirmed!</h3>
                <p className="text-white/60">Your demo appointment has been recorded</p>
              </div>

              <div className="bg-white/5 rounded-xl p-5 mb-6 space-y-3">
                <div className="flex justify-between">
                  <span className="text-white/60">Stylist</span>
                  <span className="text-white font-medium">{selectedStylist?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Service</span>
                  <span className="text-white font-medium">{selectedService?.name}</span>
                </div>
                {bookingDate && bookingTime && (
                  <div className="flex justify-between">
                    <span className="text-white/60">When</span>
                    <span className="text-white font-medium">{formatDateForDisplay(bookingDate)} · {formatTime(bookingTime)}</span>
                  </div>
                )}
                {selectedLooks.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-white/60">Looks shared</span>
                    <span className="text-white font-medium">{selectedLooks.length}</span>
                  </div>
                )}
              </div>

              <Button 
                className="w-full h-11 text-sm font-medium bg-white text-slate-900 hover:bg-white/90"
                onClick={() => {
                  setShowSuccessDialog(false);
                  setSelectedStylist(null);
                  setSelectedService(null);
                  setBookingDate("");
                  setBookingTime("");
                  setBookingNotes("");
                  setSelectedLooks([]);
                }}
                data-testid="button-browse-more"
              >
                Browse More Stylists
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
