import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { 
  Clock, DollarSign, User, Check, ArrowLeft, ArrowRight, 
  Calendar as CalendarIcon, Scissors, Sparkles, Image as ImageIcon, LogIn, Loader2,
  CreditCard, AlertTriangle, Shield, Search, X, Plus, Camera
} from "lucide-react";
import type { User as AuthUser } from "@shared/schema";
import { format, addDays, isBefore, startOfToday } from "date-fns";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration: number;
  category: string | null;
}

interface Stylist {
  id: string;
  name: string;
  bio: string | null;
  profileImageUrl: string | null;
  specialty: string | null;
}

interface Business {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  services?: Service[];
  stylists?: Stylist[];
  rating?: number;
  reviewCount?: number;
}

interface TimeSlot {
  startTime: string;
  endTime: string;
}

interface SavedTransformation {
  id: string;
  imageUrl: string;
  prompt: string;
  originalPhoto: string;
  sessionId: string;
}

type BookingStep = "service" | "stylist" | "datetime" | "details" | "payment" | "confirm";

// Beta mode - all bookings are free during beta testing
const BETA_MODE = true;

// Payment form component that uses Stripe hooks
function PaymentForm({ 
  clientSecret, 
  onPaymentSuccess, 
  onPaymentError,
  isProcessing,
  setIsProcessing
}: {
  clientSecret: string;
  onPaymentSuccess: (confirmedPaymentIntentId: string) => void;
  onPaymentError: (error: string) => void;
  isProcessing: boolean;
  setIsProcessing: (val: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async () => {
    if (!stripe || !elements) return;

    setIsProcessing(true);
    const cardElement = elements.getElement(CardElement);
    
    if (!cardElement) {
      onPaymentError("Card element not found");
      setIsProcessing(false);
      return;
    }

    try {
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement }
      });

      if (error) {
        onPaymentError(error.message || "Payment failed");
        setIsProcessing(false);
        return;
      }
      
      // Check payment intent status
      if (paymentIntent?.status === "succeeded") {
        // Payment confirmed - pass back the verified payment intent ID
        onPaymentSuccess(paymentIntent.id);
      } else if (paymentIntent?.status === "requires_action") {
        // Additional authentication required - handle 3D Secure etc.
        onPaymentError("Additional authentication required. Please try again.");
        setIsProcessing(false);
      } else if (paymentIntent?.status === "processing") {
        // Payment is still processing
        onPaymentError("Payment is processing. Please wait and try again.");
        setIsProcessing(false);
      } else {
        // Unexpected status
        onPaymentError(`Payment status: ${paymentIntent?.status || "unknown"}`);
        setIsProcessing(false);
      }
    } catch (err: any) {
      onPaymentError(err.message || "An error occurred during payment");
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 border rounded-lg bg-card">
        <CardElement 
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#424770',
                '::placeholder': { color: '#aab7c4' },
              },
              invalid: { color: '#9e2146' },
            },
          }}
        />
      </div>
      <Button 
        onClick={handleSubmit} 
        disabled={!stripe || isProcessing}
        className="w-full"
        data-testid="button-pay-now"
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <CreditCard className="h-4 w-4 mr-2" />
        )}
        {isProcessing ? "Processing..." : "Pay Now"}
      </Button>
    </div>
  );
}

export default function Booking() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/booking/:placeId");
  const { toast } = useToast();
  
  const googlePlaceId = params?.placeId || "";
  const salonName = new URLSearchParams(window.location.search).get("name") || "Salon";
  
  const [step, setStep] = useState<BookingStep>("service");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStylist, setSelectedStylist] = useState<Stylist | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [savedTransformation, setSavedTransformation] = useState<SavedTransformation | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [paymentCompleted, setPaymentCompleted] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  
  // Share Your Look state - uses saved/favorited images
  const [attachedImages, setAttachedImages] = useState<Array<{ id: string; imageUrl: string; prompt: string }>>([]);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  // Load Stripe publishable key
  useEffect(() => {
    fetch("/api/stripe/publishable-key")
      .then(res => res.json())
      .then(data => {
        if (data.publishableKey) {
          setStripePromise(loadStripe(data.publishableKey));
        }
      })
      .catch(err => console.error("Failed to load Stripe:", err));
  }, []);

  // Fetch user's saved/favorited looks
  const { data: savedLooks = [], isLoading: loadingSavedLooks } = useQuery<Array<{ id: string; generatedImageUrl: string; hairstylePrompt: string }>>({
    queryKey: ['/api/user/favorites'],
  });
  
  useEffect(() => {
    const saved = sessionStorage.getItem("savedTransformation");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSavedTransformation(parsed);
      } catch (e) {
        console.error("Failed to parse saved transformation:", e);
      }
    }
  }, []);

  const { data: authUser, isLoading: isCheckingAuth } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      const response = await fetch("/api/auth/user");
      if (!response.ok) return null;
      return response.json();
    },
  });
  
  const isAuthenticated = !!authUser;

  const { data: business, isLoading: loadingBusiness } = useQuery<Business | null>({
    queryKey: ["/api/business", googlePlaceId],
    queryFn: async () => {
      const response = await fetch(`/api/business/${encodeURIComponent(googlePlaceId)}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!googlePlaceId,
  });

  const { data: slots, isLoading: loadingSlots } = useQuery<TimeSlot[]>({
    queryKey: ["/api/stylists", selectedStylist?.id, "slots", selectedDate ? format(selectedDate, "yyyy-MM-dd") : null, selectedService?.duration],
    queryFn: async () => {
      if (!selectedStylist || !selectedDate || !selectedService) return [];
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const response = await fetch(`/api/stylists/${selectedStylist.id}/slots?date=${dateStr}&duration=${selectedService.duration}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedStylist && !!selectedDate && !!selectedService,
  });

  const createBookingMutation = useMutation({
    mutationFn: async () => {
      if (!business || !selectedService || !selectedStylist || !selectedDate || !selectedSlot) {
        throw new Error("Missing required booking information");
      }

      if (!paymentCompleted || !paymentIntentId) {
        throw new Error("Payment must be completed before booking");
      }

      const response = await apiRequest("POST", "/api/bookings", {
        businessId: business.id,
        stylistId: selectedStylist.id,
        serviceId: selectedService.id,
        date: format(selectedDate, "yyyy-MM-dd"),
        startTime: selectedSlot.startTime,
        customerName,
        customerEmail: customerEmail || undefined,
        customerPhone: customerPhone || undefined,
        notes: notes || undefined,
        desiredHairstyle: attachedImages.map(img => img.prompt).join('; ') || undefined,
        attachedImageUrl: attachedImages.length > 0 ? attachedImages.map(img => img.imageUrl).join(',') : undefined,
        paymentIntentId,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ 
        title: "Booking confirmed!", 
        description: `Your appointment at ${salonName} has been scheduled.`
      });
      sessionStorage.removeItem("savedTransformation");
      setLocation("/stylists");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Booking failed", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const canProceed = () => {
    switch (step) {
      case "service":
        return !!selectedService;
      case "stylist":
        return !!selectedStylist;
      case "datetime":
        return !!selectedDate && !!selectedSlot;
      case "details":
        return !!customerName.trim();
      case "payment":
        return paymentCompleted;
      default:
        return false;
    }
  };

  const createPaymentIntent = async () => {
    if (!selectedService) return;
    
    try {
      const response = await fetch("/api/stripe/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: selectedService.price,
          currency: "usd",
          metadata: {
            service: selectedService.name,
            stylist: selectedStylist?.name || "Any",
          }
        })
      });
      
      const data = await response.json();
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setPaymentIntentId(data.paymentIntentId);
      }
    } catch (err) {
      console.error("Failed to create payment intent:", err);
      toast({
        title: "Payment setup failed",
        description: "Please try again",
        variant: "destructive"
      });
    }
  };

  const handleNext = async () => {
    // In beta mode, skip the payment step entirely
    const steps: BookingStep[] = BETA_MODE 
      ? ["service", "stylist", "datetime", "details", "confirm"]
      : ["service", "stylist", "datetime", "details", "payment", "confirm"];
    const currentIndex = steps.indexOf(step);
    
    // Create payment intent when moving to payment step (only if not in beta mode)
    if (!BETA_MODE && steps[currentIndex + 1] === "payment") {
      await createPaymentIntent();
    }
    
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const steps: BookingStep[] = BETA_MODE 
      ? ["service", "stylist", "datetime", "details", "confirm"]
      : ["service", "stylist", "datetime", "details", "payment", "confirm"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const stepTitles: Record<BookingStep, string> = {
    service: "Select a Service",
    stylist: "Choose Your Stylist",
    datetime: "Pick Date & Time",
    details: "Your Details",
    payment: "Payment",
    confirm: "Confirm Booking",
  };

  const handleGoBack = () => {
    window.history.back();
  };

  if (loadingBusiness) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <div className="sticky top-0 z-50 bg-background border-b">
          <div className="flex items-center gap-4 p-4 max-w-4xl mx-auto">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleGoBack}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Skeleton className="h-6 w-48" />
          </div>
        </div>
        <div className="p-4 max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <div className="sticky top-0 z-50 bg-background border-b">
          <div className="flex items-center gap-4 p-4 max-w-4xl mx-auto">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleGoBack}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="font-semibold">Back</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-96 text-center px-4">
          <p className="text-lg text-muted-foreground mb-4">Unable to load business information</p>
          <Button onClick={handleGoBack}>Go Back</Button>
        </div>
      </div>
    );
  }

  const services = business.services || [];
  const stylists = business.stylists || [];

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <div className="sticky top-0 z-50 bg-background border-b">
        <div className="flex items-center gap-4 p-4 max-w-4xl mx-auto">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleGoBack}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="font-heading font-bold text-lg">{salonName}</h1>
            <p className="text-sm text-muted-foreground">{stepTitles[step]}</p>
          </div>
        </div>
        
        <div className="flex gap-1 px-4 pb-3 max-w-4xl mx-auto">
          {(["service", "stylist", "datetime", "details", "payment", "confirm"] as BookingStep[]).map((s, idx) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                idx <= ["service", "stylist", "datetime", "details", "payment", "confirm"].indexOf(step)
                  ? "bg-primary"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="p-4 max-w-4xl mx-auto pb-24">
        {step === "service" && (
          <div className="space-y-3">
            {services.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Scissors className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No services available</p>
              </div>
            ) : (
              services.map((service) => (
                <Card
                  key={service.id}
                  className={`cursor-pointer transition-all ${
                    selectedService?.id === service.id
                      ? "ring-2 ring-primary"
                      : "hover-elevate"
                  }`}
                  onClick={() => setSelectedService(service)}
                  data-testid={`card-service-${service.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <h3 className="font-semibold">{service.name}</h3>
                        {service.description && (
                          <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-sm">
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {service.duration} min
                          </span>
                          <span className="flex items-center gap-1 font-semibold">
                            <DollarSign className="h-4 w-4" />
                            {service.price}
                          </span>
                        </div>
                      </div>
                      {selectedService?.id === service.id && (
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {step === "stylist" && (
          <div className="space-y-3">
            {stylists.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No stylists available</p>
              </div>
            ) : (
              stylists.map((stylist) => (
                <Card
                  key={stylist.id}
                  className={`cursor-pointer transition-all ${
                    selectedStylist?.id === stylist.id
                      ? "ring-2 ring-primary"
                      : "hover-elevate"
                  }`}
                  onClick={() => setSelectedStylist(stylist)}
                  data-testid={`card-stylist-${stylist.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-14 w-14">
                        <AvatarImage src={stylist.profileImageUrl || undefined} />
                        <AvatarFallback>{stylist.name[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <h3 className="font-semibold">{stylist.name}</h3>
                        {stylist.specialty && (
                          <Badge variant="secondary" className="mt-1">{stylist.specialty}</Badge>
                        )}
                        {stylist.bio && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{stylist.bio}</p>
                        )}
                      </div>
                      {selectedStylist?.id === stylist.id && (
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {step === "datetime" && (
          <div className="space-y-6">
            <div>
              <Label className="text-base font-semibold mb-3 block">Select Date</Label>
              <Card>
                <CardContent className="p-3">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      setSelectedSlot(null);
                    }}
                    disabled={(date) => isBefore(date, startOfToday()) || isBefore(addDays(new Date(), 60), date)}
                    className="mx-auto"
                  />
                </CardContent>
              </Card>
            </div>

            {selectedDate && (
              <div>
                <Label className="text-base font-semibold mb-3 block">Available Times</Label>
                {loadingSlots ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : slots && slots.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map((slot, idx) => (
                      <Button
                        key={idx}
                        variant={selectedSlot?.startTime === slot.startTime ? "default" : "outline"}
                        className="w-full"
                        onClick={() => setSelectedSlot(slot)}
                        data-testid={`button-slot-${idx}`}
                      >
                        {slot.startTime}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No available slots for this date</p>
                )}
              </div>
            )}
          </div>
        )}

        {step === "details" && (
          <div className="space-y-6">
            {/* Beta: Login prompt hidden for beta testing */}

            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Your Name *</Label>
                <Input
                  id="name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter your full name"
                  data-testid="input-name"
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="your@email.com"
                  data-testid="input-email"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  data-testid="input-phone"
                />
              </div>
              <div>
                <Label htmlFor="notes">Notes for stylist</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any special requests or preferences..."
                  rows={3}
                  data-testid="input-notes"
                />
              </div>
            </div>

            {/* Share Your Look Section */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Share Your Look</h3>
                  <span className="text-xs text-muted-foreground ml-auto">Up to 3 images</span>
                </div>
                
                {/* Selected Images Grid */}
                {attachedImages.length > 0 && (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {attachedImages.map((img) => (
                      <div 
                        key={img.id} 
                        className="relative group"
                      >
                        <div 
                          className="aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer border-2 border-primary"
                          onClick={() => setExpandedImage(img.imageUrl)}
                          data-testid={`attached-image-${img.id}`}
                        >
                          <img 
                            src={img.imageUrl} 
                            alt="Saved hairstyle" 
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="absolute top-1 left-1">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                            <Sparkles className="h-2.5 w-2.5 mr-0.5" />Look
                          </Badge>
                        </div>
                        <button
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAttachedImages(prev => prev.filter(i => i.id !== img.id));
                          }}
                          data-testid={`remove-image-${img.id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    
                    {/* Add more button (inline with images) */}
                    {attachedImages.length < 3 && savedLooks.length > attachedImages.length && (
                      <button
                        className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                        onClick={() => setShowImagePicker(true)}
                        data-testid="button-add-more-images"
                      >
                        <Plus className="h-6 w-6" />
                        <span className="text-xs">Add</span>
                      </button>
                    )}
                  </div>
                )}
                
                {/* Browse Saved Looks Button */}
                {attachedImages.length === 0 && (
                  <div className="space-y-4">
                    <Button
                      variant="outline"
                      className="w-full py-6"
                      onClick={() => setShowImagePicker(true)}
                      disabled={loadingSavedLooks}
                      data-testid="button-browse-saved-looks"
                    >
                      {loadingSavedLooks ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          Loading saved looks...
                        </>
                      ) : (
                        <>
                          <ImageIcon className="h-5 w-5 mr-2" />
                          Browse Your Saved Looks
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Select up to 3 saved hairstyles to share with your stylist
                    </p>
                  </div>
                )}
                
                {attachedImages.length > 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    Tap any image to view full size
                  </p>
                )}
              </CardContent>
            </Card>
            
            {/* Saved Looks Picker Dialog */}
            <Dialog open={showImagePicker} onOpenChange={setShowImagePicker}>
              <DialogContent className="max-w-md">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Your Saved Looks</h3>
                  <span className="text-xs text-muted-foreground ml-auto">{attachedImages.length}/3 selected</span>
                </div>
                
                {loadingSavedLooks ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : savedLooks.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto">
                    {savedLooks.map((look) => {
                      const isSelected = attachedImages.some(img => img.id === look.id);
                      const canAdd = attachedImages.length < 3;
                      return (
                        <button
                          key={look.id}
                          className={`aspect-square rounded-lg overflow-hidden relative ${isSelected ? 'ring-2 ring-primary' : ''} ${!isSelected && !canAdd ? 'opacity-50' : ''}`}
                          onClick={() => {
                            if (isSelected) {
                              setAttachedImages(prev => prev.filter(img => img.id !== look.id));
                            } else if (canAdd) {
                              setAttachedImages(prev => [...prev, { 
                                id: look.id, 
                                imageUrl: look.generatedImageUrl, 
                                prompt: look.hairstylePrompt || 'Saved look'
                              }]);
                            }
                          }}
                          disabled={!isSelected && !canAdd}
                          data-testid={`pick-saved-look-${look.id}`}
                        >
                          <img src={look.generatedImageUrl} alt="Saved look" className="w-full h-full object-cover" />
                          {isSelected && (
                            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                              <Check className="h-6 w-6 text-primary" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="font-medium mb-1">No saved looks yet</p>
                    <p className="text-sm">Generate hairstyles and save your favorites to share with stylists</p>
                  </div>
                )}
                
                <Button 
                  onClick={() => setShowImagePicker(false)} 
                  className="w-full mt-4"
                  data-testid="button-done-picking"
                >
                  Done
                </Button>
              </DialogContent>
            </Dialog>
            
            {/* Expanded Image Dialog */}
            <Dialog open={!!expandedImage} onOpenChange={() => setExpandedImage(null)}>
              <DialogContent className="max-w-lg p-2">
                {expandedImage && (
                  <img 
                    src={expandedImage} 
                    alt="Expanded view" 
                    className="w-full h-auto rounded-lg"
                    data-testid="expanded-image"
                  />
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}

        {step === "payment" && (
          <div className="space-y-6">
            {/* Order Summary */}
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3">Order Summary</h3>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">{selectedService?.name}</span>
                  <span className="font-medium">${selectedService?.price}</span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">Total</span>
                    <span className="font-bold text-lg">${selectedService?.price}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cancellation Policy */}
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-amber-800 dark:text-amber-200 mb-1">Cancellation Policy</h4>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      Appointments cancelled less than 3 hours before the scheduled time will incur a 20% cancellation fee. 
                      Full refund available for cancellations made with more than 3 hours notice.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payment Form */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-semibold">Payment Details</h3>
                </div>
                
                {stripePromise && clientSecret ? (
                  <Elements stripe={stripePromise} options={{ clientSecret }}>
                    <PaymentForm
                      clientSecret={clientSecret}
                      onPaymentSuccess={(confirmedPaymentIntentId) => {
                        // Update with the confirmed payment intent ID from Stripe
                        setPaymentIntentId(confirmedPaymentIntentId);
                        setPaymentCompleted(true);
                        toast({ title: "Payment successful!", description: "Proceeding to confirmation..." });
                        setStep("confirm");
                      }}
                      onPaymentError={(error) => {
                        toast({ title: "Payment failed", description: error, variant: "destructive" });
                      }}
                      isProcessing={isProcessingPayment}
                      setIsProcessing={setIsProcessingPayment}
                    />
                  </Elements>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Security Badge */}
                <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
                  <Shield className="h-4 w-4" />
                  <span>Secured by Stripe</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-6">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <Scissors className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Service</p>
                    <p className="font-semibold">{selectedService?.name}</p>
                    <p className="text-sm">${selectedService?.price} • {selectedService?.duration} min</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Stylist</p>
                    <p className="font-semibold">{selectedStylist?.name}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Date & Time</p>
                    <p className="font-semibold">
                      {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
                    </p>
                    <p className="text-sm">{selectedSlot?.startTime} - {selectedSlot?.endTime}</p>
                  </div>
                </div>

                {attachedImages.length > 0 && (
                  <div className="flex items-start gap-3">
                    <ImageIcon className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Attached Images ({attachedImages.length})</p>
                      <div className="flex gap-2">
                        {attachedImages.map((img) => (
                          <div 
                            key={img.id} 
                            className="w-12 h-12 rounded overflow-hidden cursor-pointer relative"
                            onClick={() => setExpandedImage(img.imageUrl)}
                          >
                            <img 
                              src={img.imageUrl} 
                              alt="Saved hairstyle" 
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2">Your Information</h3>
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Name:</span> {customerName}</p>
                  {customerEmail && <p><span className="text-muted-foreground">Email:</span> {customerEmail}</p>}
                  {customerPhone && <p><span className="text-muted-foreground">Phone:</span> {customerPhone}</p>}
                  {notes && <p><span className="text-muted-foreground">Notes:</span> {notes}</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4">
        <div className="max-w-4xl mx-auto flex gap-3">
          {step !== "service" && step !== "payment" && (
            <Button 
              variant="outline" 
              onClick={handleBack}
              className="flex-1"
              data-testid="button-step-back"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
          
          {step === "confirm" ? (
            <Button
              onClick={() => createBookingMutation.mutate()}
              disabled={createBookingMutation.isPending}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-white"
              data-testid="button-confirm-booking"
            >
              {createBookingMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Confirm Booking
            </Button>
          ) : step === "payment" ? (
            <div className="flex-1 text-center text-sm text-muted-foreground py-2">
              Complete payment above to proceed
            </div>
          ) : (
            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              className="flex-1"
              data-testid="button-step-next"
            >
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
