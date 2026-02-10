import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { ThumbsUp, ThumbsDown, ArrowLeft, ArrowRight, Check, MessageSquare, Mail } from "lucide-react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Navigation from "@/components/Navigation";

const SURVEY_SUBMITTED_KEY = "auren_survey_submitted";

// Simple email validation
const isValidEmail = (email: string): boolean => {
  if (!email.trim()) return true; // Empty is OK (email is optional)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

const ratingEmojis = [
  { value: 1, emoji: "😔", label: "Very Poor" },
  { value: 2, emoji: "😕", label: "Poor" },
  { value: 3, emoji: "🙂", label: "Fair" },
  { value: 4, emoji: "😊", label: "Good" },
  { value: 5, emoji: "😄", label: "Very Good" },
  { value: 6, emoji: "🤩", label: "Excellent" },
  { value: 7, emoji: "🥳", label: "Amazing" },
];

const budgetOptions = [
  { value: "$1-5/month", label: "$1-5" },
  { value: "$5-10/month", label: "$5-10" },
  { value: "$10-20/month", label: "$10-20" },
  { value: "$20-30/month", label: "$20-30" },
  { value: "$30+/month", label: "$30+" },
];

const featureOptions = [
  { value: "text_mode", label: "Text Mode", desc: "Describing your style" },
  { value: "inspiration_mode", label: "Inspiration Mode", desc: "Uploading reference photos" },
  { value: "aureniq", label: "AurenIQ", desc: "AI-matched styles" },
];

export default function Survey() {
  const { toast } = useToast();
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const emailError = emailTouched && email.trim() !== "" && !isValidEmail(email);
  const [mostUsedFeature, setMostUsedFeature] = useState<string | null>(null);
  const [usabilityRating, setUsabilityRating] = useState(0);
  const [frustration, setFrustration] = useState("");
  const [missingFeature, setMissingFeature] = useState("");
  const [problemSolved, setProblemSolved] = useState("");
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [pricingPreference, setPricingPreference] = useState<string | null>(null);
  const [monthlyBudget, setMonthlyBudget] = useState<string | null>(null);
  const [favoriteFeatures, setFavoriteFeatures] = useState("");
  const [improvements, setImprovements] = useState("");
  
  const [additionalThoughts, setAdditionalThoughts] = useState("");
  const [aurenRating, setAurenRating] = useState<number | null>(null);

  const totalSteps = 9;

  useEffect(() => {
    const submitted = localStorage.getItem(SURVEY_SUBMITTED_KEY);
    if (submitted === "true") {
      setHasSubmitted(true);
    }
  }, []);

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/feedback", {
        overallRating: 0,
        email: email.trim() || null,
        usabilityRating: usabilityRating || null,
        mostUsedFeature,
        frustration: frustration.trim() || null,
        missingFeature: missingFeature.trim() || null,
        problemSolved: problemSolved.trim() || null,
        wouldRecommend,
        improvements: improvements.trim() || null,
        favoriteFeatures: favoriteFeatures.trim() || null,
        pricingPreference,
        monthlyBudget,
        aurenRating,
      });
    },
    onSuccess: () => {
      localStorage.setItem(SURVEY_SUBMITTED_KEY, "true");
      setSubmitted(true);
      setHasSubmitted(true);
      toast({
        title: "Thank you!",
        description: "Your feedback helps us make Auren better.",
      });
    },
    onError: () => {
      localStorage.setItem(SURVEY_SUBMITTED_KEY, "true");
      setSubmitted(true);
      setHasSubmitted(true);
      toast({
        title: "Thanks!",
        description: "We received your feedback.",
      });
    },
  });

  const submitAdditionalMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/feedback", {
        overallRating: 0,
        improvements: additionalThoughts.trim() || null,
        favoriteFeatures: "Additional thoughts after initial survey",
      });
    },
    onSuccess: () => {
      toast({
        title: "Thank you!",
        description: "Your additional thoughts have been recorded.",
      });
      setAdditionalThoughts("");
    },
    onError: () => {
      toast({
        title: "Thanks!",
        description: "We received your thoughts.",
      });
      setAdditionalThoughts("");
    },
  });

  const handleNext = () => {
    // Validate email on step 0 if entered
    if (step === 0 && email.trim() && !isValidEmail(email)) {
      setEmailTouched(true);
      return;
    }
    
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      submitMutation.mutate();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const EmojiRating = ({ 
    value, 
    onChange, 
    title 
  }: { 
    value: number; 
    onChange: (v: number) => void; 
    title: string;
  }) => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground text-center">{title}</h3>
      <div className="flex justify-center gap-1 sm:gap-1.5 flex-wrap">
        {ratingEmojis.map((item) => (
          <motion.button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`relative flex flex-col items-center gap-0.5 p-1.5 sm:p-2 rounded-lg transition-all hover-elevate min-w-[40px] sm:min-w-[44px] ${
              value === item.value
                ? "bg-primary/10 ring-2 ring-primary"
                : "bg-muted/30"
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span className="text-lg sm:text-xl">{item.emoji}</span>
            <span className={`text-[9px] sm:text-[10px] font-medium ${
              value === item.value ? "text-primary" : "text-muted-foreground"
            }`}>
              {item.value}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );

  if (hasSubmitted && !submitted) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Navigation />
        <div className="max-w-xl mx-auto px-4 py-4">
          <Card className="border-2">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Thanks for your feedback!</CardTitle>
              <CardDescription className="text-base">
                You've already completed the survey. If you have any additional thoughts you'd like to share, feel free to add them below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Textarea
                placeholder="Any additional thoughts, ideas, or feedback..."
                value={additionalThoughts}
                onChange={(e) => setAdditionalThoughts(e.target.value)}
                className="resize-none h-32 text-base border-2 focus:border-primary"
                data-testid="textarea-additional-thoughts"
              />
              <div className="flex gap-3">
                <Link href="/" className="flex-1">
                  <Button variant="outline" className="w-full" data-testid="button-back-home">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Home
                  </Button>
                </Link>
                <Button 
                  className="flex-1"
                  onClick={() => submitAdditionalMutation.mutate()}
                  disabled={!additionalThoughts.trim() || submitAdditionalMutation.isPending}
                  data-testid="button-submit-additional"
                >
                  {submitAdditionalMutation.isPending ? "Submitting..." : "Submit"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Navigation />
        <div className="max-w-xl mx-auto px-4 py-4">
          <Card className="border-2">
            <CardHeader className="text-center">
              <motion.div 
                className="mx-auto w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-4"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", bounce: 0.5 }}
              >
                <Check className="w-10 h-10 text-green-500" />
              </motion.div>
              <CardTitle className="text-2xl">Thank you!</CardTitle>
              <CardDescription className="text-base">
                Your feedback has been submitted. We appreciate you taking the time to help us improve Auren.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/">
                <Button className="w-full" data-testid="button-back-home-success">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                <Mail className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Enter your email for the raffle</h3>
              <p className="text-sm text-muted-foreground">
                Complete this survey for a chance to win free premium credits! We'll notify winners by email.
              </p>
            </div>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (!emailTouched) setEmailTouched(true);
              }}
              onBlur={() => setEmailTouched(true)}
              className={`text-base border-2 h-12 ${
                emailError 
                  ? "border-red-500 focus:border-red-500" 
                  : "focus:border-primary"
              }`}
              data-testid="input-survey-email"
            />
            {emailError ? (
              <p className="text-xs text-red-500 text-center">
                Please enter a valid email address
              </p>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                Your email will only be used to contact you if you win.
              </p>
            )}
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground text-center">Which feature did you use most?</h3>
            <div className="grid grid-cols-1 gap-3">
              {featureOptions.map((option) => (
                <motion.button
                  key={option.value}
                  type="button"
                  onClick={() => setMostUsedFeature(option.value)}
                  className={`w-full text-left px-5 py-4 rounded-xl transition-all hover-elevate ${
                    mostUsedFeature === option.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50"
                  }`}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  data-testid={`button-feature-${option.value}`}
                >
                  <span className="font-medium">{option.label}</span>
                  <span className={`text-sm ml-2 ${mostUsedFeature === option.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    — {option.desc}
                  </span>
                </motion.button>
              ))}
            </div>
          </div>
        );

      case 2:
        return (
          <EmojiRating
            value={usabilityRating}
            onChange={setUsabilityRating}
            title="How easy was it to use?"
          />
        );

      case 3:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground text-center">What's the most frustrating thing about the app?</h3>
            <Textarea
              placeholder="Slow loading, confusing navigation, missing features..."
              value={frustration}
              onChange={(e) => setFrustration(e.target.value)}
              className="resize-none h-32 text-base border-2 focus:border-primary"
              data-testid="textarea-frustration"
            />
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground text-center">What's one feature you expected to exist but didn't find?</h3>
            <Textarea
              placeholder="Video tutorials, color matching, AR preview..."
              value={missingFeature}
              onChange={(e) => setMissingFeature(e.target.value)}
              className="resize-none h-32 text-base border-2 focus:border-primary"
              data-testid="textarea-missing-feature"
            />
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground text-center">What problem does the app solve for you, if any?</h3>
            <Textarea
              placeholder="Visualizing new looks before committing, communicating with stylists..."
              value={problemSolved}
              onChange={(e) => setProblemSolved(e.target.value)}
              className="resize-none h-32 text-base border-2 focus:border-primary"
              data-testid="textarea-problem-solved"
            />
          </div>
        );

      case 6:
        return (
          <div className="space-y-8">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-center">Would you recommend Auren?</h3>
              <div className="flex justify-center gap-4">
                <motion.button
                  type="button"
                  onClick={() => setWouldRecommend(true)}
                  className={`flex flex-col items-center gap-2 p-5 rounded-2xl transition-all hover-elevate ${
                    wouldRecommend === true
                      ? "bg-green-500/20 ring-2 ring-green-500"
                      : "bg-muted/50"
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  data-testid="button-recommend-yes"
                >
                  <ThumbsUp className={`w-10 h-10 ${wouldRecommend === true ? "text-green-500" : "text-muted-foreground"}`} />
                  <span className="font-medium">Yes!</span>
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => setWouldRecommend(false)}
                  className={`flex flex-col items-center gap-2 p-5 rounded-2xl transition-all hover-elevate ${
                    wouldRecommend === false
                      ? "bg-red-500/20 ring-2 ring-red-500"
                      : "bg-muted/50"
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  data-testid="button-recommend-no"
                >
                  <ThumbsDown className={`w-10 h-10 ${wouldRecommend === false ? "text-red-500" : "text-muted-foreground"}`} />
                  <span className="font-medium">Not yet</span>
                </motion.button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-center">What plan would you most likely use?</h3>
              <div className="flex justify-center gap-2 flex-wrap">
                <motion.button
                  type="button"
                  onClick={() => setPricingPreference("free")}
                  className={`px-4 py-2.5 rounded-xl font-medium transition-all hover-elevate ${
                    pricingPreference === "free"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50"
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  data-testid="button-pricing-free"
                >
                  Free
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => setPricingPreference("payg")}
                  className={`px-4 py-2.5 rounded-xl font-medium transition-all hover-elevate ${
                    pricingPreference === "payg"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50"
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  data-testid="button-pricing-payg"
                >
                  Pay per use
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => setPricingPreference("subscription")}
                  className={`px-4 py-2.5 rounded-xl font-medium transition-all hover-elevate ${
                    pricingPreference === "subscription"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50"
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  data-testid="button-pricing-subscription"
                >
                  Monthly plan
                </motion.button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-center text-muted-foreground">Monthly budget?</h3>
              <div className="flex flex-wrap justify-center gap-2">
                {budgetOptions.map((option) => (
                  <motion.button
                    key={option.value}
                    type="button"
                    onClick={() => setMonthlyBudget(option.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all hover-elevate ${
                      monthlyBudget === option.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50"
                    }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    data-testid={`button-budget-${option.value.replace(/[^a-z0-9]/gi, '')}`}
                  >
                    {option.label}
                  </motion.button>
                ))}
              </div>
            </div>
          </div>
        );

      case 7:
        return (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-center">What worked well for you?</h3>
              <Textarea
                placeholder="The realistic results, easy navigation..."
                value={favoriteFeatures}
                onChange={(e) => setFavoriteFeatures(e.target.value)}
                className="resize-none h-24 text-base border-2 focus:border-primary"
                data-testid="input-favorite-features"
              />
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-center">If you could change ONE thing about this app, what would it be?</h3>
              <Textarea
                placeholder="Faster generation, more styles, better UI..."
                value={improvements}
                onChange={(e) => setImprovements(e.target.value)}
                className="resize-none h-24 text-base border-2 focus:border-primary"
                data-testid="input-improvements"
              />
            </div>
          </div>
        );

      case 8:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-center">How would you rate Auren?</h3>
              <p className="text-sm text-muted-foreground text-center">Choose a rating from 1 to 7</p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((rating) => (
                  <motion.button
                    key={rating}
                    type="button"
                    onClick={() => setAurenRating(rating)}
                    className={`w-10 h-10 rounded-full text-lg font-semibold transition-all hover-elevate ${
                      aurenRating === rating
                        ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                        : "bg-muted/50 text-foreground hover:bg-muted"
                    }`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    data-testid={`button-auren-rating-${rating}`}
                  >
                    {rating}
                  </motion.button>
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground px-2">
                <span>Not great</span>
                <span>Amazing</span>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      
      {/* Sticky back button with black background */}
      <div className="sticky top-0 z-50 bg-black">
        <div className="max-w-xl mx-auto px-4 py-2">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" data-testid="button-back">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
      </div>
      
      <div className="max-w-xl mx-auto px-4 pt-2 pb-4">
        <div className="mb-3 text-center">
          <h1 className="text-2xl font-bold">Share Your Feedback</h1>
          <p className="text-muted-foreground text-sm">Help us make Auren better for everyone</p>
        </div>

        <Card className="border-2 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardDescription className="shrink-0">Step {step + 1} of {totalSteps}</CardDescription>
              <div className="flex gap-0.5 sm:gap-1 flex-wrap justify-end">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-4 sm:w-6 rounded-full transition-colors ${
                      i <= step ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                {renderStep()}
              </motion.div>
            </AnimatePresence>

            <div className="flex gap-3 mt-8">
              {step > 0 && (
                <Button 
                  variant="outline" 
                  onClick={handleBack}
                  className="flex-1"
                  data-testid="button-prev"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}
              <Button 
                onClick={handleNext}
                className="flex-1"
                disabled={submitMutation.isPending}
                data-testid="button-next"
              >
                {submitMutation.isPending ? (
                  "Submitting..."
                ) : step === totalSteps - 1 ? (
                  <>
                    Submit
                    <Check className="w-4 h-4 ml-2" />
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
