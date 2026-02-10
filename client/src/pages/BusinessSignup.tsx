import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Scissors, ArrowLeft, ArrowRight, Check, Building2, User, Clock, MapPin, Phone, Mail, DollarSign, Camera, AlertCircle, Bookmark, CreditCard, Shield, Lock } from "lucide-react";
import { Link, useLocation } from "wouter";

type Step = 1 | 2 | 3 | 4 | 5;

interface ServiceItem {
  name: string;
  duration: string;
  price: string;
}

interface BusinessFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  businessName: string;
  businessType: string;
  yearsExperience: string;
  specialties: string[];
  bio: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  workDays: string[];
  openTime: string;
  closeTime: string;
  services: ServiceItem[];
  acceptsWalkIns: boolean;
  portfolioUrl: string;
  instagramHandle: string;
}

const SPECIALTIES = [
  "Men's Cuts",
  "Women's Cuts",
  "Kids' Cuts",
  "Fades & Tapers",
  "Beard Styling",
  "Color & Highlights",
  "Balayage",
  "Perms & Relaxers",
  "Extensions",
  "Braiding",
  "Updos & Styling",
  "Keratin Treatments",
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAYS: Record<string, string> = {
  "Mon": "Monday",
  "Tue": "Tuesday", 
  "Wed": "Wednesday",
  "Thu": "Thursday",
  "Fri": "Friday",
  "Sat": "Saturday",
  "Sun": "Sunday"
};

export default function BusinessSignup() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>(1);
  const [formData, setFormData] = useState<BusinessFormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    businessName: "",
    businessType: "",
    yearsExperience: "",
    specialties: [],
    bio: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    workDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    openTime: "09:00",
    closeTime: "18:00",
    services: [{ name: "", duration: "30", price: "" }],
    acceptsWalkIns: false,
    portfolioUrl: "",
    instagramHandle: "",
  });

  const updateField = (field: keyof BusinessFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleSpecialty = (specialty: string) => {
    const current = formData.specialties;
    if (current.includes(specialty)) {
      updateField("specialties", current.filter(s => s !== specialty));
    } else {
      updateField("specialties", [...current, specialty]);
    }
  };

  const toggleDay = (day: string) => {
    const current = formData.workDays;
    if (current.includes(day)) {
      updateField("workDays", current.filter(d => d !== day));
    } else {
      updateField("workDays", [...current, day]);
    }
  };

  const addService = () => {
    updateField("services", [...formData.services, { name: "", duration: "30", price: "" }]);
  };

  const updateService = (index: number, field: string, value: string) => {
    const services = [...formData.services];
    services[index] = { ...services[index], [field]: value };
    updateField("services", services);
  };

  const removeService = (index: number) => {
    if (formData.services.length > 1) {
      updateField("services", formData.services.filter((_, i) => i !== index));
    }
  };

  const isProfileComplete = () => {
    const hasBasicInfo = formData.firstName && formData.lastName && formData.email;
    const hasBusinessInfo = formData.businessName && formData.businessType;
    const hasLocation = formData.address && formData.city && formData.state && formData.zipCode;
    const hasHours = formData.workDays.length > 0 && formData.openTime && formData.closeTime;
    const hasServices = formData.services.some(s => s.name && s.price);
    return hasBasicInfo && hasBusinessInfo && hasLocation && hasHours && hasServices;
  };

  const handleSubmit = (saveForLater: boolean = false) => {
    const dataToSave = {
      ...formData,
      profileComplete: !saveForLater && isProfileComplete(),
      canAcceptBookings: !saveForLater && isProfileComplete(),
    };
    sessionStorage.setItem('businessSignupData', JSON.stringify(dataToSave));
    sessionStorage.setItem('loginRedirect', '/business/workspace');
    window.location.href = '/api/login';
  };

  const canProceedStep = () => {
    switch (step) {
      case 1:
        return formData.firstName && formData.lastName && formData.email;
      case 2:
        return formData.businessName && formData.businessType;
      case 3:
        return formData.city && formData.state && formData.workDays.length > 0;
      case 4:
        return formData.services.some(s => s.name && s.price);
      case 5:
        return true;
      default:
        return false;
    }
  };

  const getCompletionStatus = () => {
    let completed = 0;
    let total = 5;
    
    if (formData.firstName && formData.lastName && formData.email) completed++;
    if (formData.businessName && formData.businessType) completed++;
    if (formData.address && formData.city && formData.state && formData.zipCode) completed++;
    if (formData.workDays.length > 0 && formData.openTime && formData.closeTime) completed++;
    if (formData.services.some(s => s.name && s.price)) completed++;
    
    return { completed, total, percentage: Math.round((completed / total) * 100) };
  };

  const stepTitles = [
    { num: 1, title: "About You", icon: User },
    { num: 2, title: "Business", icon: Building2 },
    { num: 3, title: "Location", icon: MapPin },
    { num: 4, title: "Services", icon: DollarSign },
    { num: 5, title: "Payment", icon: CreditCard },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/business">
              <Button variant="ghost" size="icon" data-testid="button-back-signup">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <Link href="/" className="flex items-center">
              <span className="font-bold text-xl tracking-tight text-black dark:text-white" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>AÜREN</span>
            </Link>
          </div>
          <Badge variant="outline" className="text-primary border-primary">
            First month $30
          </Badge>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-1">Create Your Business Account</h1>
          <p className="text-sm text-muted-foreground">Complete your profile to start accepting bookings</p>
        </div>

        <div className="flex justify-center items-center gap-1 mb-6">
          {stepTitles.map((s, index) => (
            <div key={s.num} className="flex items-center">
              <button
                onClick={() => step > s.num && setStep(s.num as Step)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  step === s.num 
                    ? 'bg-primary text-primary-foreground' 
                    : step > s.num 
                      ? 'bg-primary/20 text-primary cursor-pointer hover:bg-primary/30' 
                      : 'bg-muted text-muted-foreground'
                }`}
                disabled={step < s.num}
                data-testid={`step-${s.num}`}
              >
                {step > s.num ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <s.icon className="h-4 w-4" />
                )}
                <span className="text-sm font-medium hidden sm:inline">{s.title}</span>
              </button>
              {index < stepTitles.length - 1 && (
                <div className={`w-4 md:w-8 h-0.5 mx-1 ${step > s.num ? 'bg-primary' : 'bg-muted'}`} />
              )}
            </div>
          ))}
        </div>

        {step === 1 && (
          <Card className="shadow-lg border-0">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Tell us about yourself
              </CardTitle>
              <CardDescription>Your contact information for clients and account access</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => updateField("firstName", e.target.value)}
                    placeholder="John"
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => updateField("lastName", e.target.value)}
                    placeholder="Smith"
                    data-testid="input-last-name"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">Email Address <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    className="pl-10"
                    value={formData.email}
                    onChange={(e) => updateField("email", e.target.value)}
                    placeholder="john@example.com"
                    data-testid="input-email"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    className="pl-10"
                    value={formData.phone}
                    onChange={(e) => updateField("phone", e.target.value)}
                    placeholder="(555) 123-4567"
                    data-testid="input-phone"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="shadow-lg border-0">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Your Business
              </CardTitle>
              <CardDescription>Information about your salon or barbershop</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="businessName">Business Name <span className="text-destructive">*</span></Label>
                <Input
                  id="businessName"
                  value={formData.businessName}
                  onChange={(e) => updateField("businessName", e.target.value)}
                  placeholder="John's Barbershop"
                  data-testid="input-business-name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Business Type <span className="text-destructive">*</span></Label>
                  <Select value={formData.businessType} onValueChange={(v) => updateField("businessType", v)}>
                    <SelectTrigger data-testid="select-business-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="barbershop">Barbershop</SelectItem>
                      <SelectItem value="salon">Hair Salon</SelectItem>
                      <SelectItem value="independent">Independent Stylist</SelectItem>
                      <SelectItem value="booth_rental">Booth Rental</SelectItem>
                      <SelectItem value="mobile">Mobile Stylist</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Years of Experience</Label>
                  <Select value={formData.yearsExperience} onValueChange={(v) => updateField("yearsExperience", v)}>
                    <SelectTrigger data-testid="select-experience">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0-2">0-2 years</SelectItem>
                      <SelectItem value="3-5">3-5 years</SelectItem>
                      <SelectItem value="5-10">5-10 years</SelectItem>
                      <SelectItem value="10+">10+ years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Specialties</Label>
                <div className="flex flex-wrap gap-2">
                  {SPECIALTIES.map((specialty) => (
                    <Badge
                      key={specialty}
                      variant={formData.specialties.includes(specialty) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleSpecialty(specialty)}
                      data-testid={`badge-specialty-${specialty.toLowerCase().replace(/[^a-z]/g, '-')}`}
                    >
                      {specialty}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Bio / About You</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => updateField("bio", e.target.value)}
                  placeholder="Tell clients about your style and experience..."
                  rows={3}
                  data-testid="textarea-bio"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="instagramHandle">Instagram Handle</Label>
                  <Input
                    id="instagramHandle"
                    value={formData.instagramHandle}
                    onChange={(e) => updateField("instagramHandle", e.target.value)}
                    placeholder="@yourbusiness"
                    data-testid="input-instagram"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="portfolioUrl">Website / Portfolio</Label>
                  <Input
                    id="portfolioUrl"
                    value={formData.portfolioUrl}
                    onChange={(e) => updateField("portfolioUrl", e.target.value)}
                    placeholder="https://..."
                    data-testid="input-portfolio"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card className="shadow-lg border-0">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Location & Hours
              </CardTitle>
              <CardDescription>Where and when clients can find you</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="address">Street Address <span className="text-destructive">*</span></Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => updateField("address", e.target.value)}
                  placeholder="123 Main Street, Suite 100"
                  data-testid="input-address"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="city">City <span className="text-destructive">*</span></Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => updateField("city", e.target.value)}
                    placeholder="Los Angeles"
                    data-testid="input-city"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State <span className="text-destructive">*</span></Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => updateField("state", e.target.value)}
                    placeholder="CA"
                    data-testid="input-state"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zipCode">ZIP Code <span className="text-destructive">*</span></Label>
                  <Input
                    id="zipCode"
                    value={formData.zipCode}
                    onChange={(e) => updateField("zipCode", e.target.value)}
                    placeholder="90001"
                    data-testid="input-zip"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label>Working Days <span className="text-destructive">*</span></Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <Button
                      key={day}
                      type="button"
                      variant={formData.workDays.includes(day) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleDay(day)}
                      data-testid={`button-day-${day.toLowerCase()}`}
                    >
                      {day}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="openTime">Opening Time <span className="text-destructive">*</span></Label>
                  <Input
                    id="openTime"
                    type="time"
                    value={formData.openTime}
                    onChange={(e) => updateField("openTime", e.target.value)}
                    data-testid="input-open-time"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="closeTime">Closing Time <span className="text-destructive">*</span></Label>
                  <Input
                    id="closeTime"
                    type="time"
                    value={formData.closeTime}
                    onChange={(e) => updateField("closeTime", e.target.value)}
                    data-testid="input-close-time"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <Checkbox
                  id="walkIns"
                  checked={formData.acceptsWalkIns}
                  onCheckedChange={(checked) => updateField("acceptsWalkIns", !!checked)}
                  data-testid="checkbox-walk-ins"
                />
                <Label htmlFor="walkIns" className="cursor-pointer text-sm">
                  I accept walk-in appointments
                </Label>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card className="shadow-lg border-0">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                Services & Pricing
              </CardTitle>
              <CardDescription>Add at least one service to accept bookings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {formData.services.map((service, index) => (
                <div key={index} className="flex items-end gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="flex-1 space-y-2">
                    <Label>Service Name <span className="text-destructive">*</span></Label>
                    <Input
                      value={service.name}
                      onChange={(e) => updateService(index, "name", e.target.value)}
                      placeholder="e.g., Men's Haircut"
                      data-testid={`input-service-name-${index}`}
                    />
                  </div>
                  <div className="w-24 space-y-2">
                    <Label>Duration</Label>
                    <Select value={service.duration} onValueChange={(v) => updateService(index, "duration", v)}>
                      <SelectTrigger data-testid={`select-duration-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 min</SelectItem>
                        <SelectItem value="30">30 min</SelectItem>
                        <SelectItem value="45">45 min</SelectItem>
                        <SelectItem value="60">1 hour</SelectItem>
                        <SelectItem value="90">1.5 hrs</SelectItem>
                        <SelectItem value="120">2 hrs</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-20 space-y-2">
                    <Label>Price <span className="text-destructive">*</span></Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        type="number"
                        className="pl-7"
                        value={service.price}
                        onChange={(e) => updateService(index, "price", e.target.value)}
                        placeholder="25"
                        data-testid={`input-service-price-${index}`}
                      />
                    </div>
                  </div>
                  {formData.services.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeService(index)}
                      className="text-destructive hover:text-destructive"
                      data-testid={`button-remove-service-${index}`}
                    >
                      ×
                    </Button>
                  )}
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                onClick={addService}
                className="w-full"
                data-testid="button-add-service"
              >
                + Add Another Service
              </Button>

              {!formData.services.some(s => s.name && s.price) && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-amber-800 dark:text-amber-200">
                    Add at least one service with a name and price to accept bookings.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between mt-6 gap-3">
          {step > 1 ? (
            <Button
              variant="outline"
              onClick={() => setStep((step - 1) as Step)}
              data-testid="button-back-step"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          ) : (
            <div />
          )}

          {/* DEBUG: Continue/Submit buttons hidden for beta testing */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Business signup coming soon</span>
          </div>
        </div>

        {step === 4 && (
          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Profile Completion</span>
              <span className="text-sm text-muted-foreground">{getCompletionStatus().percentage}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${getCompletionStatus().percentage}%` }}
              />
            </div>
            {!isProfileComplete() && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Complete all required fields to accept bookings
              </p>
            )}
          </div>
        )}

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">First month $30, then $60/month</p>
          <p className="mt-1">Cancel anytime. No credit card required to start.</p>
        </div>
      </div>
    </div>
  );
}
