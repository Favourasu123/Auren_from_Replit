import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { 
  Clock, DollarSign, User, Check, ArrowLeft, ArrowRight, 
  Calendar as CalendarIcon, Scissors, Sparkles, Image as ImageIcon, LogIn
} from "lucide-react";
import type { User as AuthUser } from "@shared/schema";
import { format, addDays, isBefore, startOfToday } from "date-fns";

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

interface BusinessPhoto {
  url: string;
  attribution: string;
}

interface BusinessReview {
  author: string;
  authorPhoto?: string;
  rating: number;
  text: string;
  time: string;
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
  photos?: BusinessPhoto[];
  reviews?: BusinessReview[];
  openingHours?: string[];
  isOpen?: boolean;
  website?: string;
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

type BookingStep = "service" | "stylist" | "datetime" | "details" | "confirm";

export default function BookingModal({
  open,
  onOpenChange,
  googlePlaceId,
  salonName,
  savedTransformation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  googlePlaceId: string;
  salonName: string;
  savedTransformation?: SavedTransformation | null;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<BookingStep>("service");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStylist, setSelectedStylist] = useState<Stylist | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [attachTransformation, setAttachTransformation] = useState(!!savedTransformation);

  // Check if user is authenticated
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
    enabled: open && !!googlePlaceId,
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
        desiredHairstyle: attachTransformation && savedTransformation ? savedTransformation.prompt : undefined,
        attachedImageUrl: attachTransformation && savedTransformation ? savedTransformation.imageUrl : undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ 
        title: "Booking confirmed!", 
        description: `Your appointment at ${salonName} has been scheduled.`
      });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Booking failed", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const resetForm = () => {
    setStep("service");
    setSelectedService(null);
    setSelectedStylist(null);
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setCustomerName("");
    setCustomerEmail("");
    setCustomerPhone("");
    setNotes("");
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

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
      default:
        return false;
    }
  };

  const handleNext = () => {
    const steps: BookingStep[] = ["service", "stylist", "datetime", "details", "confirm"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const steps: BookingStep[] = ["service", "stylist", "datetime", "details", "confirm"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  if (!business && !loadingBusiness) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Booking Not Available</DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center">
            <Scissors className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">
              This salon hasn't set up online booking yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Try calling them directly to schedule an appointment.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            Book at {salonName}
          </DialogTitle>
        </DialogHeader>

        {loadingBusiness ? (
          <div className="py-12 text-center">Loading...</div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              {["service", "stylist", "datetime", "details", "confirm"].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                    ${step === s ? "bg-primary text-primary-foreground" : 
                      ["service", "stylist", "datetime", "details", "confirm"].indexOf(step) > i 
                        ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground"}`}>
                    {["service", "stylist", "datetime", "details", "confirm"].indexOf(step) > i ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  {i < 4 && <div className="w-6 h-0.5 bg-muted" />}
                </div>
              ))}
            </div>

            <ScrollArea className="flex-1 pr-4">
              {step === "service" && (
                <div className="space-y-4">
                  {/* Business info header with photos */}
                  {business?.photos && business.photos.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                        {business.photos.slice(0, 4).map((photo, idx) => (
                          <div key={idx} className="shrink-0 w-24 h-24 rounded-lg overflow-hidden">
                            <img 
                              src={photo.url} 
                              alt={photo.attribution}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        {business.rating && (
                          <div className="flex items-center gap-1">
                            <span className="text-yellow-500">★</span>
                            <span className="font-medium">{business.rating}</span>
                            {business.reviewCount && (
                              <span className="text-muted-foreground">({business.reviewCount} reviews)</span>
                            )}
                          </div>
                        )}
                        {business.isOpen !== undefined && (
                          <Badge variant={business.isOpen ? "default" : "secondary"}>
                            {business.isOpen ? "Open Now" : "Closed"}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <h3 className="font-medium">Select a Service</h3>
                  {(!business?.services || business.services.length === 0) ? (
                    <p className="text-muted-foreground text-center py-8">No services available</p>
                  ) : (
                    business.services.map((service) => (
                      <Card 
                        key={service.id}
                        className={`cursor-pointer transition-all ${selectedService?.id === service.id ? "ring-2 ring-primary" : "hover-elevate"}`}
                        onClick={() => setSelectedService(service)}
                        data-testid={`card-booking-service-${service.id}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium">{service.name}</h4>
                              {service.description && (
                                <p className="text-sm text-muted-foreground">{service.description}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-semibold">${(service.price / 100).toFixed(2)}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {service.duration} min
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                  
                  {/* Reviews section */}
                  {business?.reviews && business.reviews.length > 0 && (
                    <div className="mt-6 pt-4 border-t">
                      <h4 className="font-medium mb-3">Customer Reviews</h4>
                      <div className="space-y-3">
                        {business.reviews.slice(0, 2).map((review, idx) => (
                          <div key={idx} className="flex gap-3">
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarImage src={review.authorPhoto} />
                              <AvatarFallback>{review.author.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{review.author}</span>
                                <span className="text-yellow-500 text-xs">{"★".repeat(review.rating)}</span>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2">{review.text}</p>
                              <span className="text-xs text-muted-foreground">{review.time}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === "stylist" && (
                <div className="space-y-3">
                  <h3 className="font-medium mb-2">Choose a Stylist</h3>
                  {(!business?.stylists || business.stylists.length === 0) ? (
                    <p className="text-muted-foreground text-center py-8">No stylists available</p>
                  ) : (
                    business.stylists.map((stylist) => (
                      <Card 
                        key={stylist.id}
                        className={`cursor-pointer transition-all ${selectedStylist?.id === stylist.id ? "ring-2 ring-primary" : "hover-elevate"}`}
                        onClick={() => setSelectedStylist(stylist)}
                        data-testid={`card-booking-stylist-${stylist.id}`}
                      >
                        <CardContent className="p-4 flex items-center gap-4">
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={stylist.profileImageUrl || undefined} />
                            <AvatarFallback>{stylist.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <h4 className="font-medium">{stylist.name}</h4>
                            {stylist.specialty && (
                              <Badge variant="secondary">{stylist.specialty}</Badge>
                            )}
                            {stylist.bio && (
                              <p className="text-sm text-muted-foreground mt-1">{stylist.bio}</p>
                            )}
                          </div>
                          {selectedStylist?.id === stylist.id && (
                            <Check className="h-5 w-5 text-primary" />
                          )}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              )}

              {step === "datetime" && (
                <div className="space-y-4">
                  <h3 className="font-medium mb-2">Pick Date & Time</h3>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      setSelectedSlot(null);
                    }}
                    disabled={(date) => isBefore(date, startOfToday())}
                    className="rounded-md border mx-auto"
                  />
                  
                  {selectedDate && (
                    <div className="mt-4">
                      <h4 className="font-medium mb-2">Available Times</h4>
                      {loadingSlots ? (
                        <p className="text-muted-foreground">Loading available times...</p>
                      ) : (!slots || slots.length === 0) ? (
                        <p className="text-muted-foreground">No available times on this date</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          {slots.map((slot) => (
                            <Button
                              key={slot.startTime}
                              variant={selectedSlot?.startTime === slot.startTime ? "default" : "outline"}
                              size="sm"
                              onClick={() => setSelectedSlot(slot)}
                              data-testid={`button-slot-${slot.startTime}`}
                            >
                              {formatTime(slot.startTime)}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {step === "details" && (
                <div className="space-y-4">
                  <h3 className="font-medium mb-2">Your Details</h3>
                  <div>
                    <Label>Name *</Label>
                    <Input
                      placeholder="Your name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      data-testid="input-booking-name"
                    />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      data-testid="input-booking-email"
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      placeholder="(555) 123-4567"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      data-testid="input-booking-phone"
                    />
                  </div>
                  <div>
                    <Label>Notes for stylist</Label>
                    <Textarea
                      placeholder="Any specific requests or details..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      data-testid="input-booking-notes"
                    />
                  </div>

                  {savedTransformation && (
                    <Card className={`cursor-pointer ${attachTransformation ? "ring-2 ring-primary" : ""}`}
                      onClick={() => setAttachTransformation(!attachTransformation)}>
                      <CardContent className="p-4 flex items-center gap-4">
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted">
                          <img src={savedTransformation.imageUrl} alt="Your desired style" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <span className="font-medium">Attach your AI hairstyle</span>
                          </div>
                          <p className="text-sm text-muted-foreground">Share your desired look with the stylist</p>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center
                          ${attachTransformation ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                          {attachTransformation && <Check className="h-4 w-4 text-primary-foreground" />}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {step === "confirm" && (
                <div className="space-y-4">
                  {/* Beta: Skip authentication check - allow all bookings */}
                  {false && !isAuthenticated ? (
                    <div className="text-center py-6">
                      <LogIn className="h-12 w-12 mx-auto mb-4 text-primary" />
                      <h3 className="font-heading font-semibold text-lg mb-2">Sign In to Complete Booking</h3>
                      <p className="text-muted-foreground mb-6">
                        Create an account or sign in to confirm your appointment at {salonName}.
                      </p>
                      <Button 
                        className="w-full mb-3"
                        onClick={() => window.location.href = "/api/login"}
                        data-testid="button-login-to-book"
                      >
                        <LogIn className="mr-2 h-4 w-4" />
                        Sign In with Replit
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Your booking details will be saved. You can complete the booking after signing in.
                      </p>
                    </div>
                  ) : (
                    <>
                      <h3 className="font-medium mb-2">Confirm Booking</h3>
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Service</span>
                            <span className="font-medium">{selectedService?.name}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Stylist</span>
                            <span className="font-medium">{selectedStylist?.name}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Date</span>
                            <span className="font-medium">{selectedDate && format(selectedDate, "MMMM d, yyyy")}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Time</span>
                            <span className="font-medium">{selectedSlot && formatTime(selectedSlot.startTime)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Duration</span>
                            <span className="font-medium">{selectedService?.duration} minutes</span>
                          </div>
                          <div className="border-t pt-3 flex items-center justify-between">
                            <span className="font-medium">Total</span>
                            <span className="text-lg font-bold">${selectedService && (selectedService.price / 100).toFixed(2)}</span>
                          </div>
                        </CardContent>
                      </Card>

                      {attachTransformation && savedTransformation && (
                        <Card>
                          <CardContent className="p-4 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-lg overflow-hidden">
                              <img src={savedTransformation.imageUrl} alt="Attached style" className="w-full h-full object-cover" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <ImageIcon className="h-4 w-4 text-primary" />
                                <span className="font-medium">AI hairstyle attached</span>
                              </div>
                              <p className="text-sm text-muted-foreground">Stylist will see your desired look</p>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      <div className="bg-muted/50 rounded-lg p-3 text-sm">
                        <p className="font-medium mb-1">Booking for:</p>
                        <p>{customerName}</p>
                        {customerEmail && <p className="text-muted-foreground">{customerEmail}</p>}
                        {customerPhone && <p className="text-muted-foreground">{customerPhone}</p>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </ScrollArea>

            <div className="flex items-center justify-between pt-4 border-t mt-4">
              {step !== "service" ? (
                <Button variant="outline" onClick={handleBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
              ) : (
                <div />
              )}
              
              {step === "confirm" ? (
                isAuthenticated ? (
                  <Button 
                    onClick={() => createBookingMutation.mutate()}
                    disabled={createBookingMutation.isPending}
                    data-testid="button-confirm-booking"
                  >
                    {createBookingMutation.isPending ? "Booking..." : "Confirm Booking"}
                  </Button>
                ) : (
                  <div /> 
                )
              ) : (
                <Button 
                  onClick={handleNext}
                  disabled={!canProceed()}
                  data-testid="button-booking-next"
                >
                  Next <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
