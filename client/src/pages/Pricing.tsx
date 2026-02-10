import { Button } from "@/components/ui/button";
import { Check, Sparkles, Zap, Crown, Building2, Eye, MessageSquare, ThumbsUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/Navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import barbershopHeroImage from "@assets/generated_images/happy_man_getting_barbershop_haircut.png";
import appMockupImage from "@assets/generated_images/ai_hairstyle_app_phone_mockup.png";
import takeControlImage from "@assets/generated_images/confident_woman_new_hairstyle_mirror.png";

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

// Beta mode - all features are free during beta testing
const BETA_MODE = true;

const tierIcons = {
  free: Sparkles,
  payg: Zap,
  monthly: Crown,
  business: Building2,
};

const pricingTiers = [
  {
    name: "Free",
    price: "$0",
    period: "",
    description: "Perfect for trying out the app",
    features: [
      "3 daily AI hairstyle generations",
      "Book trusted stylists",
      "Save transformation history",
    ],
    cta: "Get Started",
    plan: "free",
    highlighted: false,
  },
  {
    name: "Only Pay for What You Use",
    price: "$0.25",
    period: "per credit",
    description: "No commitment, no subscription",
    features: [
      "Only pay for what you use",
      "No monthly fees",
      "Credits never expire",
      "Book trusted stylists",
      "Save transformation history",
    ],
    cta: "Buy Credits",
    plan: "payg",
    highlighted: false,
  },
  {
    name: "Unlimited",
    price: "$10.99",
    period: "/month",
    description: "Unlimited generations, one flat rate",
    features: [
      "Unlimited AI hairstyle generations",
      "No per-generation costs",
      "Priority processing",
      "Book trusted stylists",
      "Save transformation history",
      "Cancel anytime",
    ],
    cta: "Subscribe",
    plan: "monthly",
    highlighted: true,
  },
  {
    name: "Business",
    price: "$60",
    period: "/month",
    description: "For salons and professionals",
    badge: "First month only $30",
    features: [
      "AI hairstyle visualization",
      "24/7 online booking",
      "Client & calendar management",
      "Confirmations & reminders",
      "Payment processing",
      "No-show protection",
      "Reporting & insights",
      "Auren verified badge",
    ],
    cta: "Start Free Trial",
    plan: "business",
    highlighted: false,
  },
];

export default function Pricing() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast, dismiss } = useToast();
  const isMobile = useIsMobile();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const { data: savedPreference } = useQuery<{ plan: string | null }>({
    queryKey: ["/api/plan-preference"],
    staleTime: 0, // Always refetch when component mounts to get latest preference
  });

  useEffect(() => {
    if (savedPreference?.plan && !selectedPlan) {
      setSelectedPlan(savedPreference.plan);
    }
  }, [savedPreference, selectedPlan]);

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % pricingTiers.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + pricingTiers.length) % pricingTiers.length);
  };

  const handlePlanSelect = async (plan: string) => {
    try {
      await apiRequest("POST", "/api/plan-preference", { plan });
      setSelectedPlan(plan);
      queryClient.invalidateQueries({ queryKey: ["/api/plan-preference"] });
      const { id } = toast({
        title: "Thanks for your feedback!",
        description: `You selected the ${plan === "payg" ? "Pay as you go" : plan === "monthly" ? "Unlimited" : plan.charAt(0).toUpperCase() + plan.slice(1)} plan. Try the app free during beta!`,
      });
      
      setTimeout(() => {
        dismiss(id);
      }, 3000);
    } catch (error) {
      console.error("Failed to record plan preference:", error);
    }

    if (BETA_MODE) {
      if (plan === "business") {
        setTimeout(() => {
          setLocation("/business/signup");
        }, 1500);
      }
      return;
    }

    if (plan === "business") {
      setLocation("/business/signup");
      return;
    }

    if (!user) {
      setLocation("/");
      return;
    }

    if (plan === "free") {
      setLocation("/dashboard");
    } else if (plan === "payg") {
      setLocation("/buy-credits");
    } else {
      setLocation(`/subscribe?plan=${plan}`);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      
      {/* Hero with Background Image */}
      <section className="relative pt-6 pb-6 md:pt-24 md:pb-16 overflow-hidden">
        {/* Background Image */}
        <div className="absolute inset-0 z-0">
          <img 
            src={barbershopHeroImage} 
            alt="Happy client at barbershop" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/80" />
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl md:text-5xl font-bold mb-4 text-white"
          >
            Simple, Transparent Pricing
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto"
          >
            Reimagine your next hair day with Auren—your hair will thank you.
          </motion.p>
        </div>
      </section>

      {/* Minimal Pricing Cards */}
      <section className="pt-6 md:pt-16 pb-8 md:pb-24">
        <div className="max-w-6xl mx-auto px-4">
          {/* Mobile Slideshow */}
          {isMobile ? (
            <div className="relative">
              {/* Slide Container - pt-4 to make room for badges */}
              <div className="overflow-visible pt-4">
                <AnimatePresence mode="wait">
                  {pricingTiers.map((tier, index) => {
                    if (index !== currentSlide) return null;
                    const IconComponent = tierIcons[tier.plan as keyof typeof tierIcons];
                    return (
                      <motion.div
                        key={tier.name}
                        initial={{ opacity: 0, x: 50 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -50 }}
                        transition={{ duration: 0.2 }}
                        className={`relative rounded-2xl p-6 ${
                          tier.highlighted
                            ? "bg-primary text-primary-foreground ring-2 ring-primary"
                            : "bg-card border"
                        }`}
                        data-testid={`card-pricing-${tier.plan}`}
                      >
                        {tier.highlighted && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-foreground text-background px-3 py-1 rounded-full text-xs font-medium">
                            Most Popular
                          </div>
                        )}
                        {(tier as any).badge && !tier.highlighted && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap">
                            {(tier as any).badge}
                          </div>
                        )}
                        
                        <div className="mb-6">
                          <div className={`h-10 w-10 rounded-xl flex items-center justify-center mb-4 ${
                            tier.highlighted ? "bg-primary-foreground/20" : "bg-primary/10"
                          }`}>
                            {IconComponent && (
                              <IconComponent className={`h-5 w-5 ${tier.highlighted ? "text-primary-foreground" : "text-primary"}`} />
                            )}
                          </div>
                          <h3 className="text-lg font-semibold mb-1" data-testid={`text-plan-name-${tier.plan}`}>
                            {tier.name}
                          </h3>
                          <p className={`text-sm ${tier.highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`} data-testid={`text-description-${tier.plan}`}>
                            {tier.description}
                          </p>
                        </div>

                        <div className="mb-6">
                          <span className="text-3xl font-bold" data-testid={`text-price-${tier.plan}`}>{tier.price}</span>
                          {tier.period && (
                            <span className={`text-sm ${tier.highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                              {tier.period}
                            </span>
                          )}
                        </div>

                        <ul className="space-y-3 mb-6">
                          {tier.features.map((feature, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm" data-testid={`text-feature-${tier.plan}-${idx}`}>
                              <Check className={`h-4 w-4 shrink-0 mt-0.5 ${tier.highlighted ? "text-primary-foreground" : "text-primary"}`} />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>

                        <Button
                          className="w-full"
                          variant={tier.highlighted ? "secondary" : "default"}
                          onClick={() => handlePlanSelect(tier.plan)}
                          disabled={selectedPlan === tier.plan}
                          data-testid={`button-select-${tier.plan}`}
                        >
                          {selectedPlan === tier.plan ? "Selected!" : (BETA_MODE ? "I'd Choose This" : tier.cta)}
                        </Button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Navigation Arrows */}
              <button
                onClick={prevSlide}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 w-10 h-10 rounded-full bg-white dark:bg-slate-800 shadow-lg flex items-center justify-center hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                data-testid="button-prev-plan"
              >
                <ChevronLeft className="w-5 h-5 text-foreground" />
              </button>
              <button
                onClick={nextSlide}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 w-10 h-10 rounded-full bg-white dark:bg-slate-800 shadow-lg flex items-center justify-center hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                data-testid="button-next-plan"
              >
                <ChevronRight className="w-5 h-5 text-foreground" />
              </button>

              {/* Dots Indicator */}
              <div className="flex justify-center gap-2 mt-4">
                {pricingTiers.map((tier, index) => (
                  <button
                    key={tier.plan}
                    onClick={() => setCurrentSlide(index)}
                    className={`w-2 h-2 rounded-full transition-all ${
                      index === currentSlide
                        ? "bg-primary w-6"
                        : "bg-gray-300 dark:bg-gray-600"
                    }`}
                    data-testid={`dot-plan-${tier.plan}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* Desktop Grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              {pricingTiers.map((tier, index) => {
                const IconComponent = tierIcons[tier.plan as keyof typeof tierIcons];
                return (
                  <motion.div
                    key={tier.name}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`relative rounded-2xl p-6 ${
                      tier.highlighted
                        ? "bg-primary text-primary-foreground ring-2 ring-primary"
                        : "bg-card border"
                    }`}
                    data-testid={`card-pricing-${tier.plan}`}
                  >
                    {tier.highlighted && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-foreground text-background px-3 py-1 rounded-full text-xs font-medium">
                        Most Popular
                      </div>
                    )}
                    {(tier as any).badge && !tier.highlighted && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap">
                        {(tier as any).badge}
                      </div>
                    )}
                    
                    <div className="mb-6">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center mb-4 ${
                        tier.highlighted ? "bg-primary-foreground/20" : "bg-primary/10"
                      }`}>
                        {IconComponent && (
                          <IconComponent className={`h-5 w-5 ${tier.highlighted ? "text-primary-foreground" : "text-primary"}`} />
                        )}
                      </div>
                      <h3 className="text-lg font-semibold mb-1" data-testid={`text-plan-name-${tier.plan}`}>
                        {tier.name}
                      </h3>
                      <p className={`text-sm ${tier.highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`} data-testid={`text-description-${tier.plan}`}>
                        {tier.description}
                      </p>
                    </div>

                    <div className="mb-6">
                      <span className="text-3xl font-bold" data-testid={`text-price-${tier.plan}`}>{tier.price}</span>
                      {tier.period && (
                        <span className={`text-sm ${tier.highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {tier.period}
                        </span>
                      )}
                    </div>

                    <ul className="space-y-3 mb-6">
                      {tier.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm" data-testid={`text-feature-${tier.plan}-${idx}`}>
                          <Check className={`h-4 w-4 shrink-0 mt-0.5 ${tier.highlighted ? "text-primary-foreground" : "text-primary"}`} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      className="w-full"
                      variant={tier.highlighted ? "secondary" : "default"}
                      onClick={() => handlePlanSelect(tier.plan)}
                      disabled={selectedPlan === tier.plan}
                      data-testid={`button-select-${tier.plan}`}
                    >
                      {selectedPlan === tier.plan ? "Selected!" : (BETA_MODE ? "I'd Choose This" : tier.cta)}
                    </Button>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Take Control CTA - Empowering Layout */}
      <section className="py-16 md:py-20 bg-gradient-to-br from-primary/5 via-background to-violet-500/5">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Left - Empowering Visual */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-br from-primary/20 to-violet-500/20 rounded-3xl blur-2xl" />
                <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-white/10 max-w-[320px]">
                  <img 
                    src={takeControlImage} 
                    alt="Confident woman with new hairstyle" 
                    className="w-full h-auto"
                  />
                </div>
              </div>
            </div>
            
            {/* Right - Text Content */}
            <div>
              <h2 className="text-2xl md:text-4xl font-bold mb-4">
                Take <span className="text-primary italic">Control</span> of Your Hair Journey
              </h2>
              <p className="text-muted-foreground text-lg mb-6">
                No more walking into salons hoping for the best. Visualize your new look, find the right stylist, and walk in knowing you'll get what you want.
              </p>
              
              <div className="space-y-4 mb-8">
                <div className="flex gap-3 items-start">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Eye className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">See it first</p>
                    <p className="text-xs text-muted-foreground">Preview any style on your own photo</p>
                  </div>
                </div>
                
                <div className="flex gap-3 items-start">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Communicate clearly</p>
                    <p className="text-xs text-muted-foreground">Show your stylist exactly what you mean</p>
                  </div>
                </div>
                
                <div className="flex gap-3 items-start">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <ThumbsUp className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Leave happy</p>
                    <p className="text-xs text-muted-foreground">End the guesswork and disappointment</p>
                  </div>
                </div>
              </div>
              
              <Button size="lg" onClick={() => setLocation("/")} data-testid="button-try-now">
                <Sparkles className="mr-2 h-5 w-5" />
                Start Exploring
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
