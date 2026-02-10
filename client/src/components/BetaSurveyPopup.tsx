import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Sparkles, ThumbsUp, ThumbsDown, ArrowRight, Check, X, Zap, Crown, Gift, Star, Rocket, MessageCircle, Lightbulb, Target, Frown, Meh, Smile, SmilePlus, Award, Trophy, PartyPopper } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface BetaSurveyPopupProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "quick" | "extended" | "followup";
}

const ratingIcons = [
  { value: 1, Icon: Frown, label: "Very Poor", color: "text-red-400" },
  { value: 2, Icon: Frown, label: "Poor", color: "text-orange-400" },
  { value: 3, Icon: Meh, label: "Fair", color: "text-amber-400" },
  { value: 4, Icon: Smile, label: "Good", color: "text-lime-400" },
  { value: 5, Icon: SmilePlus, label: "Very Good", color: "text-emerald-400" },
  { value: 6, Icon: Award, label: "Excellent", color: "text-teal-400" },
  { value: 7, Icon: Trophy, label: "Amazing", color: "text-violet-400" },
];

const planOptions = [
  { value: "free", label: "Free Plan", desc: "3 credits daily", icon: Gift, color: "from-emerald-400 to-teal-500" },
  { value: "payg", label: "Pay As You Go", desc: "Buy credits when needed", icon: Zap, color: "from-amber-400 to-orange-500" },
  { value: "monthly", label: "Monthly Plan", desc: "Unlimited generations", icon: Crown, color: "from-violet-400 to-purple-500" },
];

const stepIcons = [
  { icon: Sparkles, color: "text-amber-500" },
  { icon: Target, color: "text-blue-500" },
  { icon: MessageCircle, color: "text-rose-500" },
  { icon: Lightbulb, color: "text-violet-500" },
  { icon: Star, color: "text-emerald-500" },
  { icon: Rocket, color: "text-cyan-500" },
  { icon: Crown, color: "text-amber-500" },
  { icon: Heart, color: "text-rose-500" },
];

export function BetaSurveyPopup({ isOpen, onClose, mode = "quick" }: BetaSurveyPopupProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [overallRating, setOverallRating] = useState(0);
  const [usabilityRating, setUsabilityRating] = useState(0);
  const [likelihoodToUse, setLikelihoodToUse] = useState(0);
  const [mostUsedFeature, setMostUsedFeature] = useState<string | null>(null);
  const [frustration, setFrustration] = useState("");
  const [missingFeature, setMissingFeature] = useState("");
  const [problemSolved, setProblemSolved] = useState("");
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [improvements, setImprovements] = useState("");
  const [favoriteFeatures, setFavoriteFeatures] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const isExtended = mode === "extended";
  const isFollowup = mode === "followup";
  const totalSteps = isFollowup ? 1 : (isExtended ? 8 : 3);

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/feedback", {
        overallRating,
        usabilityRating: usabilityRating || null,
        likelihoodToUse: likelihoodToUse || null,
        mostUsedFeature,
        frustration: frustration.trim() || null,
        missingFeature: missingFeature.trim() || null,
        problemSolved: problemSolved.trim() || null,
        wouldRecommend,
        improvements: improvements.trim() || null,
        favoriteFeatures: favoriteFeatures.trim() || null,
        pricingPreference: selectedPlan,
        monthlyBudget: null,
        aurenRating: null,
      });
    },
    onSuccess: () => {
      toast({
        title: "Thank you!",
        description: "Your feedback helps us make Auren better.",
      });
      resetAndClose();
    },
    onError: () => {
      toast({
        title: "Thanks!",
        description: "We got your feedback.",
      });
      resetAndClose();
    },
  });

  const resetAndClose = () => {
    setStep(0);
    setOverallRating(0);
    setUsabilityRating(0);
    setLikelihoodToUse(0);
    setMostUsedFeature(null);
    setFrustration("");
    setMissingFeature("");
    setProblemSolved("");
    setWouldRecommend(null);
    setImprovements("");
    setFavoriteFeatures("");
    setSelectedPlan(null);
    onClose();
  };

  const handleNext = () => {
    if (step === 0 && !isExtended && overallRating === 0) {
      toast({
        title: "Rate your experience",
        description: "Tap an icon to continue",
        variant: "destructive",
      });
      return;
    }
    
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      submitMutation.mutate();
    }
  };

  const IconRating = ({ 
    value, 
    onChange, 
    title 
  }: { 
    value: number; 
    onChange: (v: number) => void; 
    title: string;
  }) => (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-foreground text-center px-2">{title}</h3>
      <div className="flex justify-center flex-wrap gap-1 max-w-[280px] mx-auto">
        {ratingIcons.map((item) => (
          <motion.button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`relative flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-all ${
              value === item.value
                ? "bg-gradient-to-br from-primary/20 to-primary/10 ring-2 ring-primary shadow-lg"
                : "hover:bg-muted/50"
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            data-testid={`rating-${title.toLowerCase().replace(/\s+/g, '-')}-${item.value}`}
          >
            <item.Icon className={`w-5 h-5 ${value === item.value ? "text-primary" : item.color}`} />
            <span className={`text-[9px] font-semibold ${
              value === item.value ? "text-primary" : "text-muted-foreground"
            }`}>
              {item.value}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );

  const featureOptions = [
    { value: "text_mode", label: "Text Mode", desc: "Describing your style", gradient: "from-blue-400 to-cyan-400" },
    { value: "inspiration_mode", label: "Inspiration Mode", desc: "Uploading reference photos", gradient: "from-purple-400 to-pink-400" },
    { value: "aureniq", label: "AurenIQ", desc: "AI-matched styles", gradient: "from-amber-400 to-orange-400" },
  ];

  const StepHeader = ({ title, subtitle, stepNum }: { title: string; subtitle?: string; stepNum: number }) => {
    const IconComponent = stepIcons[stepNum % stepIcons.length].icon;
    const iconColor = stepIcons[stepNum % stepIcons.length].color;
    
    return (
      <div className="text-center space-y-2 mb-6">
        <motion.div 
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`inline-flex p-3 rounded-2xl bg-gradient-to-br from-muted/80 to-muted/40 mb-2`}
        >
          <IconComponent className={`w-6 h-6 ${iconColor}`} />
        </motion.div>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    );
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <motion.div
            key="step-0"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {isFollowup ? (
              <>
                <StepHeader title="Any Additional Feedback?" stepNum={0} />
                <p className="text-sm text-muted-foreground text-center mb-4">
                  Thanks for being a power user! Is there anything else you'd like to share?
                </p>
                <Textarea
                  placeholder="Share any thoughts, suggestions, or feedback..."
                  value={improvements}
                  onChange={(e) => setImprovements(e.target.value)}
                  className="min-h-[120px] bg-muted/30 border-muted resize-none rounded-xl text-sm"
                  data-testid="input-followup-feedback"
                />
              </>
            ) : isExtended ? (
              <>
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-amber-500/10 border border-amber-500/20 rounded-2xl p-3 mb-2"
                >
                  <div className="flex items-center gap-2 justify-center">
                    <Gift className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium text-foreground">
                      Complete for a chance to win 1 of 3 <span className="text-amber-600 font-bold">$25 gift cards</span>
                    </span>
                  </div>
                </motion.div>
                <StepHeader title="Feature Usage" stepNum={0} />
                <p className="text-sm text-foreground font-medium text-center mb-3">Which feature did you use most?</p>
                <div className="space-y-2">
                  {featureOptions.map((option) => (
                    <motion.button
                      key={option.value}
                      type="button"
                      onClick={() => setMostUsedFeature(option.value)}
                      className={`w-full text-left px-4 py-4 rounded-2xl transition-all border-2 ${
                        mostUsedFeature === option.value
                          ? `bg-gradient-to-r ${option.gradient} text-white border-transparent shadow-lg`
                          : "bg-muted/30 border-transparent hover:border-muted-foreground/20"
                      }`}
                      whileHover={{ scale: 1.02, x: 4 }}
                      whileTap={{ scale: 0.98 }}
                      data-testid={`button-feature-${option.value}`}
                    >
                      <span className="font-semibold text-base">{option.label}</span>
                      <span className={`text-sm ml-2 ${mostUsedFeature === option.value ? "text-white/80" : "text-muted-foreground"}`}>
                        {option.desc}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <StepHeader title="Quick Feedback" stepNum={0} />
                <IconRating
                  value={overallRating}
                  onChange={setOverallRating}
                  title="How satisfied are you with the app results?"
                />
              </>
            )}
          </motion.div>
        );

      case 1:
        return (
          <motion.div
            key="step-1"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {isExtended ? (
              <>
                <StepHeader title="Ease of Use" stepNum={1} />
                <IconRating
                  value={usabilityRating}
                  onChange={setUsabilityRating}
                  title="How easy was it to use Auren?"
                />
              </>
            ) : (
              <>
                <StepHeader title="Ease of Use" stepNum={1} />
                <IconRating
                  value={usabilityRating}
                  onChange={setUsabilityRating}
                  title="How easy was it to use?"
                />
              </>
            )}
          </motion.div>
        );

      case 2:
        return (
          <motion.div
            key="step-2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {isExtended ? (
              <>
                <StepHeader title="Frustrations" stepNum={2} />
                <p className="text-sm text-foreground font-medium text-center mb-3">What's the most frustrating thing about the app?</p>
                <Textarea
                  placeholder="Slow loading, confusing navigation, missing features..."
                  value={frustration}
                  onChange={(e) => setFrustration(e.target.value)}
                  className="resize-none h-28 text-base rounded-2xl border-2 border-muted focus:border-primary bg-muted/20"
                  data-testid="textarea-frustration"
                />
              </>
            ) : (
              <>
                <StepHeader title="Future Use" stepNum={2} />
                <IconRating
                  value={likelihoodToUse}
                  onChange={setLikelihoodToUse}
                  title="How likely would you be to use Auren for your hair appointments?"
                />
              </>
            )}
          </motion.div>
        );

      case 3:
        return (
          <motion.div
            key="step-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            <StepHeader title="Missing Features" stepNum={3} />
            <p className="text-sm text-foreground font-medium text-center mb-3">What's one feature you expected to exist but didn't find?</p>
            <Textarea
              placeholder="Video tutorials, color matching, AR preview..."
              value={missingFeature}
              onChange={(e) => setMissingFeature(e.target.value)}
              className="resize-none h-28 text-base rounded-2xl border-2 border-muted focus:border-primary bg-muted/20"
              data-testid="textarea-missing-feature"
            />
          </motion.div>
        );

      case 4:
        return (
          <motion.div
            key="step-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            <StepHeader title="Problem Solved" stepNum={4} />
            <p className="text-sm text-foreground font-medium text-center mb-3">What problem does the app solve for you, if any?</p>
            <Textarea
              placeholder="Visualizing new looks before committing, communicating with stylists..."
              value={problemSolved}
              onChange={(e) => setProblemSolved(e.target.value)}
              className="resize-none h-28 text-base rounded-2xl border-2 border-muted focus:border-primary bg-muted/20"
              data-testid="textarea-problem-solved"
            />
          </motion.div>
        );

      case 5:
        return (
          <motion.div
            key="step-5"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            <StepHeader title="Plan Preference" stepNum={5} />
            <p className="text-sm text-foreground font-medium text-center mb-3">What plan would you most likely use?</p>
            <div className="space-y-3">
              {planOptions.map((plan) => {
                const IconComponent = plan.icon;
                return (
                  <motion.button
                    key={plan.value}
                    type="button"
                    onClick={() => setSelectedPlan(plan.value)}
                    className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all border-2 ${
                      selectedPlan === plan.value
                        ? `bg-gradient-to-r ${plan.color} text-white border-transparent shadow-lg`
                        : "bg-muted/30 border-transparent hover:border-muted-foreground/20"
                    }`}
                    whileHover={{ scale: 1.02, x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    data-testid={`button-plan-${plan.value}`}
                  >
                    <div className={`p-2 rounded-xl ${selectedPlan === plan.value ? "bg-white/20" : "bg-muted"}`}>
                      <IconComponent className={`w-5 h-5 ${selectedPlan === plan.value ? "text-white" : "text-muted-foreground"}`} />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold">{plan.label}</div>
                      <div className={`text-sm ${selectedPlan === plan.value ? "text-white/80" : "text-muted-foreground"}`}>
                        {plan.desc}
                      </div>
                    </div>
                    {selectedPlan === plan.value && (
                      <Check className="w-5 h-5 ml-auto" />
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        );

      case 6:
        return (
          <motion.div
            key="step-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            <StepHeader title="Overall Rating" stepNum={6} />
            <IconRating
              value={overallRating}
              onChange={setOverallRating}
              title="How would you rate Auren overall?"
            />
          </motion.div>
        );

      case 7:
        return (
          <motion.div
            key="step-7"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            <StepHeader title="Recommendation" stepNum={7} />
            <p className="text-sm text-foreground font-medium text-center mb-3">Would you recommend Auren to a friend?</p>
            <div className="flex justify-center gap-6">
              <motion.button
                type="button"
                onClick={() => setWouldRecommend(true)}
                className={`flex flex-col items-center gap-3 p-6 rounded-2xl transition-all border-2 ${
                  wouldRecommend === true
                    ? "bg-gradient-to-br from-green-400/20 to-emerald-500/20 border-green-500 shadow-lg"
                    : "bg-muted/30 border-transparent hover:border-muted-foreground/20"
                }`}
                whileHover={{ scale: 1.05, y: -4 }}
                whileTap={{ scale: 0.95 }}
                data-testid="button-recommend-yes"
              >
                <ThumbsUp className={`w-10 h-10 ${wouldRecommend === true ? "text-green-500" : "text-muted-foreground"}`} />
                <span className={`font-semibold ${wouldRecommend === true ? "text-green-600" : "text-muted-foreground"}`}>Yes!</span>
              </motion.button>
              <motion.button
                type="button"
                onClick={() => setWouldRecommend(false)}
                className={`flex flex-col items-center gap-3 p-6 rounded-2xl transition-all border-2 ${
                  wouldRecommend === false
                    ? "bg-gradient-to-br from-red-400/20 to-rose-500/20 border-red-500 shadow-lg"
                    : "bg-muted/30 border-transparent hover:border-muted-foreground/20"
                }`}
                whileHover={{ scale: 1.05, y: -4 }}
                whileTap={{ scale: 0.95 }}
                data-testid="button-recommend-no"
              >
                <ThumbsDown className={`w-10 h-10 ${wouldRecommend === false ? "text-red-500" : "text-muted-foreground"}`} />
                <span className={`font-semibold ${wouldRecommend === false ? "text-red-600" : "text-muted-foreground"}`}>Not yet</span>
              </motion.button>
            </div>
          </motion.div>
        );

      default:
        return null;
    }
  };

  const progressPercentage = ((step + 1) / totalSteps) * 100;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && resetAndClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md overflow-hidden border-0 bg-gradient-to-b from-background to-muted/30 rounded-3xl p-0 shadow-2xl [&>button]:hidden">
        <div className="relative">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-muted/50 overflow-hidden">
            <motion.div 
              className="h-full bg-gradient-to-r from-primary via-primary to-primary/80"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercentage}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
          
          <div className="p-6 pt-8">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                {isExtended ? `Step ${step + 1} of ${totalSteps}` : `${step + 1} / ${totalSteps}`}
              </span>
              <button 
                onClick={resetAndClose}
                className="p-1 rounded-full hover:bg-muted transition-colors"
                data-testid="button-close-survey"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <AnimatePresence mode="wait">
              {renderStep()}
            </AnimatePresence>

            <div className="flex gap-3 mt-6">
              {step > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setStep(step - 1)}
                  className="flex-1 rounded-xl h-12"
                  data-testid="button-survey-back"
                >
                  Back
                </Button>
              )}
              <Button
                onClick={handleNext}
                disabled={submitMutation.isPending}
                className={`flex-1 rounded-xl h-12 font-semibold ${step === 0 && !isExtended ? 'w-full' : ''} ${
                  step === totalSteps - 1 
                    ? 'bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70' 
                    : ''
                }`}
                data-testid="button-survey-next"
              >
                {submitMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <Sparkles className="w-4 h-4" />
                    </motion.div>
                    Sending...
                  </span>
                ) : step === totalSteps - 1 ? (
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Submit
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
