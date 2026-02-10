import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Upload as UploadIcon, Sparkles, Image, Check, AlertCircle, Loader2, X, ArrowRight, ArrowLeft, Lock, MessageSquare, ChevronRight, History, HelpCircle, ZoomIn } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RecentGeneration {
  id: string;
  photoUrl: string;
  createdAt: string;
  variantCount: number;
  previewImage: string;
  prompt: string | null;
}

interface CreditsResponse {
  isAuthenticated: boolean;
  currentCredits?: number;
  plan?: string;
  unlimitedCredits?: boolean;
  anonymousCreditsRemaining?: number;
  anonymousCreditsLimit?: number;
  requiresSignup?: boolean;
  creditsResetAt?: number;
}

const AI_MATCH_PROMPT = "__AURENIQ__";

// Simple hash function for photo validation tracking (avoids sessionStorage quota issues)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

type InputMode = "describe" | "inspiration";

interface FreeTrialGeneratorProps {
  mobileFullscreen?: boolean;
  onHelpClick?: () => void;
  onStepChange?: (step: number, goBack: () => void) => void;
}

export default function FreeTrialGenerator({ mobileFullscreen = false, onHelpClick, onStepChange }: FreeTrialGeneratorProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [photoUrl, setPhotoUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [hairstylePrompt, setHairstylePrompt] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("describe");
  const [inspirationPhotoUrl, setInspirationPhotoUrl] = useState("");
  const [inspirationPreviewUrl, setInspirationPreviewUrl] = useState("");
  const [inspirationPreviewOpen, setInspirationPreviewOpen] = useState(false);
  const [photoValidationError, setPhotoValidationError] = useState<string | null>(null);
  const [photoValidated, setPhotoValidated] = useState(false);
  const [pendingValidation, setPendingValidation] = useState<string | null>(null);

  const { data: creditsData } = useQuery<CreditsResponse>({
    queryKey: ["/api/credits"],
  });

  const { data: recentGenerations } = useQuery<{ sessions: RecentGeneration[] }>({
    queryKey: ["/api/my-generations"],
  });

  // Check sessionStorage for lastViewedSessionId as a fallback
  const [lastViewedSessionId, setLastViewedSessionId] = useState<string | null>(null);
  
  useEffect(() => {
    const savedSessionId = sessionStorage.getItem('lastViewedSessionId');
    if (savedSessionId) {
      setLastViewedSessionId(savedSessionId);
    }
  }, []);

  const hasRecentGenerations = (recentGenerations?.sessions?.length ?? 0) > 0 || !!lastViewedSessionId;
  
  // Get the session ID to navigate to - prefer API data, fallback to sessionStorage
  const recentSessionId = recentGenerations?.sessions?.[0]?.id || lastViewedSessionId;

  const remainingCredits = creditsData?.isAuthenticated 
    ? (creditsData?.unlimitedCredits ? Infinity : (creditsData?.currentCredits ?? 0))
    : (creditsData?.anonymousCreditsRemaining ?? 3);
  
  const hasCredits = remainingCredits > 0;
  const isUnlimited = creditsData?.unlimitedCredits;
  
  // Calculate hours until credits reset
  const getHoursUntilReset = () => {
    if (!creditsData?.creditsResetAt) return null;
    const now = Date.now();
    const resetTime = creditsData.creditsResetAt;
    const hoursRemaining = Math.max(0, Math.ceil((resetTime - now) / (1000 * 60 * 60)));
    return hoursRemaining;
  };
  const hoursUntilReset = getHoursUntilReset();

  const validatePhotoMutation = useMutation({
    mutationFn: async (data: { photoUrl: string }) => {
      const response = await apiRequest("POST", "/api/validate-photo", data);
      return await response.json();
    },
    onSuccess: (data, variables) => {
      console.log("[VALIDATE] onSuccess called with data:", data);
      console.log("[VALIDATE] PhotoUrl length:", variables.photoUrl?.length || 0);
      if (data.valid) {
        console.log("[VALIDATE] Setting photoValidated=true");
        setPhotoValidated(true);
        setPhotoValidationError(null);
        
        // Store a hash of the validated photo URL (avoids quota issues with large base64)
        try {
          const photoHash = simpleHash(variables.photoUrl);
          sessionStorage.setItem('lastValidatedPhotoHash', photoHash);
        } catch (e) {
          console.warn("[VALIDATE] sessionStorage failed:", e);
        }
        
        fetch('/api/preprocess-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoUrl: variables.photoUrl })
        }).catch(() => {});
      } else {
        console.log("[VALIDATE] API returned 200 but valid is not true:", data);
        const guidance = data.guidance || data.qualityIssues?.[0] || "Photo doesn't meet quality requirements.";
        setPhotoValidated(false);
        setPhotoValidationError(guidance);
        sessionStorage.removeItem('lastValidatedPhotoHash');
      }
    },
    onError: (error: any) => {
      console.log("[VALIDATE] onError called with error:", error);
      let guidance = "Photo doesn't meet quality requirements. Please try a different photo.";
      try {
        const message = error?.message || "";
        const colonIndex = message.indexOf(":");
        if (colonIndex > 0) {
          const jsonPart = message.slice(colonIndex + 1).trim();
          const errorData = JSON.parse(jsonPart);
          if (errorData?.guidance) {
            guidance = errorData.guidance;
          }
        }
      } catch {}
      
      setPhotoValidated(false);
      setPhotoValidationError(guidance);
      sessionStorage.removeItem('lastValidatedPhotoHash');
    }
  });

  useEffect(() => {
    const saved = sessionStorage.getItem('lastUploadedPhoto');
    const savedValidatedHash = sessionStorage.getItem('lastValidatedPhotoHash');
    
    if (saved) {
      setPhotoUrl(saved);
      setPreviewUrl(saved);
      // Compare hash of current photo with stored validated hash
      const currentHash = simpleHash(saved);
      if (savedValidatedHash && currentHash === savedValidatedHash) {
        // Photo was already validated - no need to re-validate
        setPhotoValidated(true);
      } else {
        setPhotoValidated(false);
        setPendingValidation(saved);
      }
    }
  }, []);

  useEffect(() => {
    if (pendingValidation) {
      validatePhotoMutation.mutate({ photoUrl: pendingValidation });
      setPendingValidation(null);
    }
  }, [pendingValidation]);

  useEffect(() => {
    if (photoUrl) {
      sessionStorage.setItem('lastUploadedPhoto', photoUrl);
    }
  }, [photoUrl]);

  const uploadMutation = useMutation({
    mutationFn: async (data: { 
      photoUrl: string; 
      hairstylePrompt?: string;
      inspirationPhotoUrl?: string;
      styleType: string;
      numImages?: number;
    }) => {
      const response = await apiRequest("POST", "/api/upload-photo", data);
      const result = await response.json();
      return result as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-generations"] });
      
      // Navigate directly to results page for initial generation
      sessionStorage.setItem('lastViewedSessionId', data.id);
      const isAurenIQ = hairstylePrompt === AI_MATCH_PROMPT;
      setLocation(`/results/${data.id}${isAurenIQ ? '?aureniq=true' : ''}`);
    },
    onError: (error: any) => {
      const errorStatus = error?.status;
      const errorData = error?.data;

      if (errorStatus === 402) {
        if (errorData?.isAuthenticated) {
          toast({ title: "Out of Credits", description: "Visit the pricing page to get more.", variant: "destructive" });
        } else if (errorData?.requiresSignup) {
          toast({ title: "Free Trial Used Up", description: "Create an account for 3 free daily generations!", variant: "destructive" });
        }
      } else if (errorData?.qualityIssues) {
        toast({ title: "Photo Quality Issue", description: errorData?.guidance || "Please upload a clearer photo.", variant: "destructive", duration: 3000 });
      } else {
        toast({ title: "Upload Failed", description: "Please try again.", variant: "destructive" });
      }
    },
  });

  const handleSubmit = () => {
    if (!photoUrl.trim()) {
      toast({ title: "Photo Required", description: "Please upload your photo first.", variant: "destructive" });
      return;
    }
    if (validatePhotoMutation.isPending) {
      toast({ title: "Please Wait", description: "Your photo is still being checked.", variant: "destructive" });
      return;
    }
    if (!photoValidated) {
      toast({ title: "Photo Validation Required", description: "Please try a different photo.", variant: "destructive" });
      return;
    }
    if (inputMode === "describe" && !hairstylePrompt.trim()) {
      toast({ title: "Style Description Required", description: "Please describe the style you want.", variant: "destructive" });
      return;
    }
    if (inputMode === "inspiration" && !inspirationPhotoUrl.trim()) {
      toast({ title: "Inspiration Photo Required", description: "Please upload an inspiration photo.", variant: "destructive" });
      return;
    }

    uploadMutation.mutate({ 
      photoUrl, 
      hairstylePrompt: inputMode === "describe" ? hairstylePrompt : undefined,
      inspirationPhotoUrl: inputMode === "inspiration" ? inspirationPhotoUrl : undefined,
      styleType: "hairstyle",
      numImages: 1
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoValidationError(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setPreviewUrl(result);
        setPhotoUrl(result);
        // Compare hash of new photo with stored validated hash
        const savedValidatedHash = sessionStorage.getItem('lastValidatedPhotoHash');
        const currentHash = simpleHash(result);
        if (savedValidatedHash && currentHash === savedValidatedHash) {
          setPhotoValidated(true);
        } else {
          setPhotoValidated(false);
          validatePhotoMutation.mutate({ photoUrl: result });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleInspirationFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setInspirationPreviewUrl(result);
        setInspirationPhotoUrl(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearPhoto = () => {
    setPreviewUrl("");
    setPhotoUrl("");
    setPhotoValidated(false);
    setPhotoValidationError(null);
  };

  const goToNextStep = () => {
    if (currentStep === 1 && photoValidated) {
      setCurrentStep(2);
    }
  };

  const goToPrevStep = useCallback(() => {
    setCurrentStep(prev => prev > 1 ? prev - 1 : prev);
  }, []);

  // Track last notified step to prevent unnecessary re-renders
  const lastNotifiedStep = useRef(currentStep);

  // Notify parent about step changes for external back button
  useEffect(() => {
    if (onStepChange && lastNotifiedStep.current !== currentStep) {
      lastNotifiedStep.current = currentStep;
      onStepChange(currentStep, goToPrevStep);
    }
  }, [currentStep, onStepChange, goToPrevStep]);

  const isGenerating = uploadMutation.isPending;
  const canProceedToStep2 = photoUrl && photoValidated && !validatePhotoMutation.isPending;
  const canGenerate = canProceedToStep2 && (inputMode === "describe" ? hairstylePrompt : inspirationPhotoUrl);

  const slideVariants = {
    enter: () => ({ opacity: 0 }),
    center: { opacity: 1 },
    exit: () => ({ opacity: 0 })
  };

  return (
    <section 
      id="free-trial-generator" 
      className={`relative overflow-hidden ${
        mobileFullscreen 
          ? "h-full flex flex-col px-3 py-2" 
          : "py-4 md:py-14 px-4"
      } ${mobileFullscreen && currentStep === 2 
          ? "bg-gradient-to-br from-slate-100 via-blue-50/50 to-slate-100 dark:from-slate-800 dark:via-slate-800 dark:to-slate-900" 
          : "bg-[#e5eaf1] dark:bg-slate-800"
      }`}
    >
      {/* Subtle ambient glow for step 2 - premium feel */}
      {mobileFullscreen && currentStep === 2 && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-48 h-48 bg-blue-200/20 dark:bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-slate-300/30 dark:bg-slate-600/20 rounded-full blur-3xl" />
        </div>
      )}
      <div className={`relative ${mobileFullscreen ? "flex-1 flex flex-col min-h-0" : "max-w-2xl mx-auto"}`}>
        {!mobileFullscreen && (
          <div className="text-center mb-6 relative">
            {onHelpClick && (
              <button
                onClick={onHelpClick}
                className="absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                data-testid="button-help-desktop"
                title="How to use"
              >
                <HelpCircle className="h-5 w-5 text-muted-foreground" />
              </button>
            )}
            <h2 className="font-heading font-bold text-2xl md:text-4xl text-foreground">
              See the look you want in{" "}
              <span className="relative">
                <span className="text-blue-500">seconds</span>
                <span className="absolute -right-6 -top-2">
                  <Sparkles className="w-5 h-5 text-blue-500" />
                </span>
              </span>
            </h2>
          </div>
        )}

        {/* Step Indicator with View Results */}
        <div className={`flex items-center justify-center ${mobileFullscreen ? "pb-1" : "mb-4"}`}>
          {/* Step text indicator for mobile */}
          {mobileFullscreen ? (
            <div className="text-center">
              <p className="text-[10px] min-[375px]:text-xs text-muted-foreground font-medium">Step {currentStep} of 2</p>
              <h3 className="text-base min-[375px]:text-lg font-bold text-foreground mt-0.5">
                {currentStep === 1 ? "Upload your photo" : "Choose your style"}
              </h3>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-1.5 ${currentStep === 1 ? "text-blue-600" : "text-blue-400"}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-sm ${
                  currentStep === 1 
                    ? "bg-blue-500 text-white" 
                    : photoValidated 
                      ? "bg-green-500 text-white" 
                      : "bg-muted text-muted-foreground"
                }`}>
                  {photoValidated && currentStep > 1 ? <Check className="w-4 h-4" /> : "1"}
                </div>
                <span className="text-sm font-medium">Upload Photo</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
              <div className={`flex items-center gap-1.5 ${currentStep === 2 ? "text-blue-600" : "text-blue-400"}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-sm ${
                  currentStep === 2 
                    ? "bg-blue-500 text-white" 
                    : "bg-muted text-muted-foreground"
                }`}>
                  2
                </div>
                <span className="text-sm font-medium">Choose Style</span>
              </div>
            </div>
          )}
        </div>
        
        {/* View Results link - shows on both mobile and desktop */}
        {hasRecentGenerations && recentSessionId && (
          <div className={`flex justify-center ${mobileFullscreen ? "pb-2" : "pb-3"}`}>
            <button
              onClick={() => setLocation(`/results/${recentSessionId}`)}
              className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium"
              data-testid="button-view-results"
            >
              <History className="w-4 h-4" />
              <span>View Results</span>
            </button>
          </div>
        )}

        {/* Main Card */}
        <div
          className={`overflow-hidden ${
            mobileFullscreen 
              ? "flex-1 flex flex-col min-h-0" 
              : "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl"
          }`}
        >
          <div className={`${mobileFullscreen ? "flex-1 flex flex-col min-h-0 overflow-hidden" : "min-h-[420px]"}`}>
              {currentStep === 1 && (
                <div
                  className={`flex flex-col h-full overflow-hidden ${mobileFullscreen ? "flex-1 p-4" : "p-8"}`}
                >
                  {/* Title - hidden on mobile since it's in the step indicator */}
                  {!mobileFullscreen && (
                    <div className="text-center flex-shrink-0">
                      <h3 className="font-bold text-white text-xl mb-2">Upload Your Photo</h3>
                      <p className="text-white/60">Take or upload a clear front-facing photo</p>
                    </div>
                  )}
                  
                  {/* Main content area - grows to fill available space */}
                  <div className="flex-1 flex flex-col justify-center py-4 min-h-0">
                      {!previewUrl ? (
                        <label
                          className="block cursor-pointer group mx-auto"
                        >
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileUpload}
                            data-testid="input-file-landing"
                          />
                          <div className={`relative mx-auto rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-all group-hover:border-blue-400 ${
                            mobileFullscreen 
                              ? "w-44 h-44 min-[375px]:w-56 min-[375px]:h-56 min-[390px]:w-72 min-[390px]:h-72 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30" 
                              : "w-56 h-56 border-white/30 bg-white/5"
                          }`}>
                            <div className="rounded-full bg-blue-500 flex items-center justify-center w-11 h-11 min-[375px]:w-14 min-[375px]:h-14 min-[390px]:w-[72px] min-[390px]:h-[72px] mb-3 min-[375px]:mb-4">
                              <UploadIcon className="text-white h-5 w-5 min-[375px]:h-6 min-[375px]:w-6 min-[390px]:h-8 min-[390px]:w-8" />
                            </div>
                            <p className={`font-medium text-sm min-[375px]:text-base ${mobileFullscreen ? "text-foreground" : "text-white"}`}>Tap to Upload</p>
                            <p className={`text-xs min-[375px]:text-sm mt-1 ${mobileFullscreen ? "text-muted-foreground" : "text-white/50"}`}>JPG, PNG up to 10MB</p>
                          </div>
                        </label>
                      ) : (
                        <div
                          className={`relative mx-auto ${mobileFullscreen ? "w-44 h-44 min-[375px]:w-56 min-[375px]:h-56 min-[390px]:w-72 min-[390px]:h-72" : "w-56 h-56"}`}
                        >
                          <img 
                            src={previewUrl} 
                            alt="Your photo" 
                            className="w-full h-full object-cover rounded-2xl shadow-lg"
                            data-testid="img-preview-landing"
                          />
                          
                          {validatePhotoMutation.isPending && (
                            <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center">
                              <div className="text-center">
                                <Loader2 className="w-10 h-10 text-white animate-spin mx-auto mb-2" />
                                <p className="text-white text-sm font-medium">Analyzing photo...</p>
                              </div>
                            </div>
                          )}
                          
                          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2">
                            {photoValidated ? (
                              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-green-500 text-white text-sm font-medium shadow-lg">
                                <Check className="w-4 h-4" />
                                Photo Ready
                              </span>
                            ) : photoValidationError ? (
                              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-red-500 text-white text-sm font-medium shadow-lg">
                                <AlertCircle className="w-4 h-4" />
                                Issue Found
                              </span>
                            ) : null}
                          </div>
                          
                          <button
                            onClick={clearPhoto}
                            className={`absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                              mobileFullscreen 
                                ? "bg-slate-600 text-white hover:bg-slate-500" 
                                : "bg-slate-700 text-white hover:bg-slate-600"
                            }`}
                            data-testid="button-clear-photo-landing"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    
                    {photoValidationError && (
                      <div className="mt-6 p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-center max-w-sm mx-auto" data-testid="alert-photo-validation-error-landing">
                        <p className="text-red-600 dark:text-red-400 text-sm">{photoValidationError}</p>
                      </div>
                    )}
                  </div>

                  {/* Next Button - stays at bottom */}
                  <div className="flex-shrink-0 mt-auto pt-4 w-full max-w-sm mx-auto">
                    <Button 
                      onClick={goToNextStep}
                      disabled={!canProceedToStep2}
                      className={`w-full rounded-xl font-semibold h-12 text-base ${
                        canProceedToStep2 
                          ? "bg-blue-500 hover:bg-blue-600 text-white" 
                          : mobileFullscreen ? "bg-blue-100 dark:bg-blue-900/30 text-blue-300 dark:text-blue-700" : "bg-white/10 text-white/50"
                      }`}
                      data-testid="button-next-step"
                    >
                      Continue to Style Selection
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div
                  className={`flex flex-col h-full relative ${mobileFullscreen ? "flex-1 p-3 pt-2 overflow-y-auto" : "p-4 md:p-8 overflow-hidden"}`}
                >
                  {/* Header with Back Button - desktop and mobile >= 390px */}
                  {!mobileFullscreen ? (
                    <div className="flex items-center flex-shrink-0">
                      <button
                        onClick={goToPrevStep}
                        className="w-9 h-9 rounded-full flex items-center justify-center transition-colors bg-white/10 text-white hover:bg-white/20"
                        data-testid="button-back-step"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    /* Mobile back button - only for screens >= 390px (iPhone SE uses external back button) */
                    <div className="hidden min-[390px]:flex items-center flex-shrink-0 mb-1">
                      <button
                        onClick={goToPrevStep}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 shadow-sm border border-slate-200 dark:border-slate-600"
                        data-testid="button-back-step"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Title - shown only on desktop */}
                  {!mobileFullscreen && (
                    <div className="text-center flex-shrink-0 mt-3">
                      <h3 className="font-bold text-xl mb-1 text-white">Choose Your Style</h3>
                      <p className="text-sm text-white/60">How would you like to find your new look?</p>
                    </div>
                  )}

                  {/* Main content area - grows to fill available space */}
                  <div className={`flex flex-col ${mobileFullscreen ? "py-1" : "flex-1 justify-center py-2 min-h-0"}`}>
                    {/* AurenIQ Option */}
                    <button
                      onClick={() => {
                        setHairstylePrompt(AI_MATCH_PROMPT);
                      }}
                      className={`w-full rounded-xl transition-all p-2 min-[375px]:p-3 relative overflow-hidden border-2 ${
                        hairstylePrompt === AI_MATCH_PROMPT
                          ? 'bg-gradient-to-r from-blue-600 to-blue-500 border-blue-400 shadow-lg shadow-blue-500/30 scale-[1.02]' 
                          : mobileFullscreen 
                            ? 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-500 hover:border-blue-400 shadow-md' 
                            : 'bg-white/5 border-white/20 hover:border-blue-400/50'
                      }`}
                      data-testid="suggestion-ai-match-landing"
                    >
                      {hairstylePrompt === AI_MATCH_PROMPT && (
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.15),transparent_50%)]"></div>
                      )}
                      <div className="flex items-center justify-center xs:justify-start gap-2 min-[375px]:gap-2.5 relative">
                        <div className={`w-7 h-7 min-[375px]:w-9 min-[375px]:h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                          hairstylePrompt === AI_MATCH_PROMPT
                            ? "bg-white/20 backdrop-blur-sm"
                            : "bg-blue-500"
                        }`}>
                          <Sparkles className="w-3.5 h-3.5 min-[375px]:w-4 min-[375px]:h-4 text-white" />
                        </div>
                        <div className="min-w-0">
                          <span className={`font-semibold text-xs min-[375px]:text-sm xs:text-base block ${
                            hairstylePrompt === AI_MATCH_PROMPT 
                              ? "text-white" 
                              : mobileFullscreen 
                                ? "text-foreground" 
                                : "text-white"
                          }`}>AurenIQ - AI Match</span>
                          <p className={`text-[10px] min-[375px]:text-xs xs:text-sm hidden xs:block ${
                            hairstylePrompt === AI_MATCH_PROMPT 
                              ? "text-white/80" 
                              : mobileFullscreen 
                                ? "text-muted-foreground" 
                                : "text-white/60"
                          }`}>Let AI find your perfect look</p>
                        </div>
                        {hairstylePrompt === AI_MATCH_PROMPT && (
                          <div className="w-5 h-5 min-[375px]:w-6 min-[375px]:h-6 rounded-full bg-white flex items-center justify-center ml-auto">
                            <Check className="w-3 h-3 min-[375px]:w-4 min-[375px]:h-4 text-blue-500" />
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Divider */}
                    <div className="flex items-center gap-2 min-[375px]:gap-3 my-1.5 min-[375px]:my-2 xs:my-3">
                      <div className={`flex-1 h-px ${mobileFullscreen ? "bg-slate-200 dark:bg-slate-600" : "bg-white/20"}`}></div>
                      <span className={`text-[10px] min-[375px]:text-xs font-medium ${mobileFullscreen ? "text-slate-400" : "text-white/50"}`}>or</span>
                      <div className={`flex-1 h-px ${mobileFullscreen ? "bg-slate-200 dark:bg-slate-600" : "bg-white/20"}`}></div>
                    </div>

                    {/* Mode Toggle - Two distinct buttons */}
                    <div className="flex gap-1 min-[375px]:gap-2 xs:gap-2">
                      <Button
                        onClick={() => {
                          setInputMode("describe");
                          if (hairstylePrompt === AI_MATCH_PROMPT) {
                            setHairstylePrompt("");
                          }
                        }}
                        variant={inputMode === "describe" && hairstylePrompt !== AI_MATCH_PROMPT ? "default" : "outline"}
                        className={`flex-1 gap-1 min-[375px]:gap-1.5 xs:gap-2 py-1.5 min-[375px]:py-2 xs:py-2.5 px-1.5 min-[375px]:px-2 xs:px-3 ${
                          inputMode === "describe" && hairstylePrompt !== AI_MATCH_PROMPT
                            ? "bg-blue-600 text-white border-blue-600"
                            : mobileFullscreen 
                              ? "bg-white dark:bg-slate-700 border-blue-400 dark:border-blue-500 text-blue-600 dark:text-blue-400"
                              : "bg-white/10 border-white/40 text-white"
                        }`}
                        data-testid="tab-describe-landing"
                      >
                        <MessageSquare className="w-3 h-3 min-[375px]:w-3.5 min-[375px]:h-3.5 xs:w-4 xs:h-4" />
                        <span className="text-[10px] min-[375px]:text-xs xs:text-sm">Describe Style</span>
                      </Button>
                      <Button
                        onClick={() => {
                          setInputMode("inspiration");
                          if (hairstylePrompt === AI_MATCH_PROMPT) {
                            setHairstylePrompt("");
                          }
                        }}
                        variant={inputMode === "inspiration" && hairstylePrompt !== AI_MATCH_PROMPT ? "default" : "outline"}
                        className={`flex-1 gap-1 min-[375px]:gap-1.5 xs:gap-2 py-1.5 min-[375px]:py-2 xs:py-2.5 px-1.5 min-[375px]:px-2 xs:px-3 ${
                          inputMode === "inspiration" && hairstylePrompt !== AI_MATCH_PROMPT
                            ? "bg-purple-600 text-white border-purple-600"
                            : mobileFullscreen 
                              ? "bg-white dark:bg-slate-700 border-purple-400 dark:border-purple-500 text-purple-600 dark:text-purple-400"
                              : "bg-white/10 border-white/40 text-white"
                        }`}
                        data-testid="tab-inspiration-landing"
                      >
                        <Image className="w-3 h-3 min-[375px]:w-3.5 min-[375px]:h-3.5 xs:w-4 xs:h-4" />
                        <span className="text-[10px] min-[375px]:text-xs xs:text-sm">Upload Inspo</span>
                      </Button>
                    </div>

                    {/* Input area - fixed height container to prevent layout shift */}
                    <div className="mt-1.5 min-[375px]:mt-2 xs:mt-3 h-[32px] min-[375px]:h-[40px] xs:h-[68px]">
                      {inputMode === "describe" ? (
                        <div className="h-full">
                          <textarea
                            placeholder="Enter a hairstyle name or describe the look you want..."
                            value={hairstylePrompt === AI_MATCH_PROMPT ? "" : hairstylePrompt}
                            onChange={(e) => setHairstylePrompt(e.target.value)}
                            className={`w-full h-full rounded-lg min-[375px]:rounded-xl px-2 min-[375px]:px-3 xs:px-4 py-1.5 min-[375px]:py-2 xs:py-3 text-xs min-[375px]:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 ${
                              mobileFullscreen 
                                ? "bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-500 text-foreground placeholder:text-slate-400 shadow-md"
                                : "bg-white/10 border border-white/20 text-white placeholder:text-white/50"
                            }`}
                            data-testid="input-prompt-landing"
                          />
                        </div>
                      ) : (
                        <div
                          className="h-full"
                        >
                          {inspirationPreviewUrl ? (
                            <div className={`flex items-center gap-2 min-[375px]:gap-4 px-2 min-[375px]:px-4 h-full rounded-lg min-[375px]:rounded-xl ${
                              mobileFullscreen 
                                ? "bg-white dark:bg-slate-800 border-2 shadow-md border-green-400 dark:border-green-500"
                                : "bg-white/10 border border-white/20"
                            }`}>
                              <button
                                onClick={() => setInspirationPreviewOpen(true)}
                                className="relative group cursor-pointer"
                                data-testid="button-preview-inspiration"
                              >
                                <img 
                                  src={inspirationPreviewUrl} 
                                  alt="Inspiration" 
                                  className="w-8 h-8 min-[375px]:w-12 min-[375px]:h-12 object-cover rounded-md min-[375px]:rounded-lg"
                                />
                                <div className="absolute inset-0 bg-black/40 rounded-md min-[375px]:rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <ZoomIn className="w-3 h-3 min-[375px]:w-4 min-[375px]:h-4 text-white" />
                                </div>
                              </button>
                              <div className="flex-1 min-w-0">
                                <p className={`font-medium text-xs min-[375px]:text-sm ${mobileFullscreen ? "text-foreground" : "text-white"}`}>Style uploaded</p>
                                <span className="text-green-500 text-[10px] min-[375px]:text-xs flex items-center gap-0.5 min-[375px]:gap-1 mt-0.5">
                                  <Check className="w-2.5 h-2.5 min-[375px]:w-3 min-[375px]:h-3" />
                                  Ready to apply
                                </span>
                              </div>
                              <button
                                onClick={() => { setInspirationPreviewUrl(""); setInspirationPhotoUrl(""); }}
                                className={`w-6 h-6 min-[375px]:w-8 min-[375px]:h-8 rounded-full flex items-center justify-center ${
                                  mobileFullscreen 
                                    ? "bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-500"
                                    : "bg-white/10 text-white/70 hover:bg-white/20"
                                }`}
                                data-testid="button-clear-inspiration-landing"
                              >
                                <X className="h-3 w-3 min-[375px]:h-4 min-[375px]:w-4" />
                              </button>
                            </div>
                          ) : (
                            <label className="block cursor-pointer group h-full">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleInspirationFileUpload}
                                data-testid="input-inspiration-file-landing"
                              />
                              <div className={`flex items-center gap-2 min-[375px]:gap-4 px-2 min-[375px]:px-4 h-full rounded-lg min-[375px]:rounded-xl border-2 border-dashed transition-all group-hover:border-blue-400 ${
                                mobileFullscreen 
                                  ? "border-slate-400 dark:border-slate-400 bg-white dark:bg-slate-800 shadow-md"
                                  : "border-white/30 bg-white/5"
                              }`}>
                                <div className="w-7 h-7 min-[375px]:w-10 min-[375px]:h-10 rounded-full bg-blue-500 flex items-center justify-center">
                                  <Image className="h-3.5 w-3.5 min-[375px]:h-5 min-[375px]:w-5 text-white" />
                                </div>
                                <div>
                                  <p className={`font-medium text-xs min-[375px]:text-sm ${mobileFullscreen ? "text-foreground" : "text-white"}`}>Upload Inspo</p>
                                  <p className={`text-[10px] min-[375px]:text-xs ${mobileFullscreen ? "text-muted-foreground" : "text-white/60"}`}>Any hairstyle you like</p>
                                </div>
                              </div>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Generate Button - stays at bottom */}
                  <div className="mt-auto pt-3">
                    {!hasCredits ? (
                      <div className="space-y-3">
                        <div className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl ${
                          mobileFullscreen ? "bg-slate-100 dark:bg-slate-700" : "bg-white/10"
                        }`}>
                          <Lock className={`w-4 h-4 ${mobileFullscreen ? "text-slate-500" : "text-white/60"}`} />
                          <span className={`font-medium text-sm ${mobileFullscreen ? "text-foreground" : "text-white"}`}>No generations left</span>
                        </div>
                        <Button 
                          onClick={() => setLocation(creditsData?.isAuthenticated ? "/pricing" : "/auth")}
                          className="w-full h-12 rounded-xl font-semibold bg-blue-500 hover:bg-blue-600 text-white"
                          data-testid="button-get-more-credits"
                        >
                          {creditsData?.isAuthenticated ? "Get More Credits" : "Credits Reset in 24h"}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button 
                          onClick={handleSubmit}
                          className="w-full h-12 rounded-xl font-semibold bg-blue-500 hover:bg-blue-600 text-white"
                          disabled={!canGenerate || isGenerating}
                          data-testid="button-generate-landing"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="mr-2 h-4 w-4" />
                              Generate
                            </>
                          )}
                        </Button>
                        
                        {!isUnlimited && (
                          <p className={`text-xs text-center mt-3 ${mobileFullscreen ? "text-muted-foreground" : "text-white/60"}`}>
                            {remainingCredits} generation{remainingCredits !== 1 ? 's' : ''} left
                            {hoursUntilReset !== null && hoursUntilReset > 0 && (
                              <span className="ml-1">· refills in {hoursUntilReset}h</span>
                            )}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
      
      {/* Inspiration Image Preview Modal */}
      <Dialog open={inspirationPreviewOpen} onOpenChange={setInspirationPreviewOpen}>
        <DialogContent className="max-w-lg p-0 overflow-hidden bg-black/95 border-0">
          <div className="relative">
            <button
              onClick={() => setInspirationPreviewOpen(false)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
              data-testid="button-close-inspiration-preview"
            >
              <X className="h-5 w-5" />
            </button>
            <img 
              src={inspirationPreviewUrl} 
              alt="Inspiration Preview" 
              className="w-full max-h-[70vh] object-contain"
            />
            <div className="p-4 bg-gradient-to-t from-black to-transparent">
              <p className="text-white text-sm font-medium">Inspiration Hairstyle</p>
              <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Ready to use
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
