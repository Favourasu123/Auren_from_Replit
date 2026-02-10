import Navigation from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload as UploadIcon, Camera, Sparkles, Image, ChevronRight, Star, Wand2, Check, ArrowRight, Info, AlertCircle, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { motion } from "framer-motion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GenerationProgress } from "@/components/GenerationProgress";
import { usePendingGeneration } from "@/components/GenerationNotification";

// New diverse transformation images
import blackManFade from "@assets/generated_images/black_man_fade_haircut_transformation.png";
import whiteManMature from "@assets/generated_images/white_man_mature_hair_transformation.png";
import hispanicManQuiff from "@assets/generated_images/hispanic_man_quiff_hair_transformation.png";
import asianManKpop from "@assets/generated_images/asian_man_k-pop_style_transformation.png";
import middleEasternMan from "@assets/generated_images/middle_eastern_man_grooming_transformation.png";
import indianManExecutive from "@assets/generated_images/indian_man_executive_style_transformation.png";
import mixedRaceMan from "@assets/generated_images/mixed_race_man_curly_fade_transformation.png";
import blackWomanNatural from "@assets/generated_images/black_woman_natural_hair_transformation.png";
import whiteWomanBalayage from "@assets/generated_images/white_woman_balayage_color_transformation.png";
import asianWomanKbeauty from "@assets/generated_images/asian_woman_k-beauty_makeup_transformation.png";
import hispanicWomanGlam from "@assets/generated_images/hispanic_woman_glam_makeup_transformation.png";
import indianWomanBridal from "@assets/generated_images/indian_woman_bridal_glam_transformation.png";

const SUGGESTED_STYLES = [
  { text: "long wavy hair with soft highlights and volume", category: "Hairstyle" },
  { text: "short textured cut with modern styling", category: "Hairstyle" },
  { text: "sleek straight hair with a polished finish", category: "Hairstyle" },
];

const AI_MATCH_PROMPT = "__AURENIQ__"; // Special marker to indicate AurenIQ mode

type InputMode = "describe" | "inspiration";

const showcaseImages = [
  { src: blackManFade, label: "Clean Fade" },
  { src: whiteManMature, label: "Distinguished" },
  { src: hispanicManQuiff, label: "Modern Quiff" },
  { src: asianManKpop, label: "K-Pop Style" },
  { src: middleEasternMan, label: "Groomed" },
  { src: indianManExecutive, label: "Executive" },
  { src: mixedRaceMan, label: "Curly Fade" },
  { src: blackWomanNatural, label: "Natural Curls" },
  { src: whiteWomanBalayage, label: "Balayage" },
  { src: asianWomanKbeauty, label: "K-Beauty" },
  { src: hispanicWomanGlam, label: "Glam Look" },
  { src: indianWomanBridal, label: "Bridal Glow" },
];

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default function Upload() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { setPendingGeneration } = usePendingGeneration();
  const [photoUrl, setPhotoUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [hairstylePrompt, setHairstylePrompt] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("describe");
  const [inspirationPhotoUrl, setInspirationPhotoUrl] = useState("");
  const [inspirationPreviewUrl, setInspirationPreviewUrl] = useState("");
  const [photoValidationError, setPhotoValidationError] = useState<string | null>(null);
  const [photoValidated, setPhotoValidated] = useState(false);
  const [pendingValidation, setPendingValidation] = useState<string | null>(null);
  const [lastValidatedPhotoUrl, setLastValidatedPhotoUrl] = useState<string | null>(null);
  const [lastViewedSessionId, setLastViewedSessionId] = useState<string | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);

  // Photo validation mutation - defined before effects that use it
  const validatePhotoMutation = useMutation({
    mutationFn: async (data: { photoUrl: string }) => {
      const response = await apiRequest("POST", "/api/validate-photo", data);
      return await response.json();
    },
    onSuccess: (data, variables) => {
      if (data.valid) {
        setPhotoValidated(true);
        setPhotoValidationError(null);
        setLastValidatedPhotoUrl(variables.photoUrl);
        // Cache the validated photo URL in sessionStorage
        sessionStorage.setItem('lastValidatedPhotoUrl', variables.photoUrl);
        
        // Preemptively start mask creation and vision analysis in background
        // This runs while the user selects their hairstyle, speeding up generation
        fetch('/api/preprocess-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoUrl: variables.photoUrl })
        }).catch(() => {
          // Silently ignore errors - this is a background optimization
        });
      }
    },
    onError: (error: any) => {
      // Parse the error message to extract JSON data
      // Error format: "400: {\"valid\":false,\"guidance\":\"...\"}"
      let guidance = "Photo doesn't meet quality requirements. Please try a different photo.";
      try {
        const message = error?.message || String(error) || "";
        const colonIndex = message.indexOf(":");
        if (colonIndex > 0) {
          const jsonPart = message.slice(colonIndex + 1).trim();
          const errorData = JSON.parse(jsonPart);
          // Check for guidance or qualityIssues
          if (errorData?.guidance) {
            guidance = errorData.guidance;
          } else if (errorData?.qualityIssues && errorData.qualityIssues.length > 0) {
            guidance = errorData.qualityIssues.join(" ");
          } else if (errorData?.error) {
            guidance = errorData.error;
          }
        }
      } catch {
        // Use default guidance if parsing fails
        console.log("[Upload] Error parsing validation response:", error);
      }
      
      setPhotoValidated(false);
      setPhotoValidationError(guidance);
      // Don't clear the photo URL - let user see the preview and the error
      // Only clear the validation cache
      setLastValidatedPhotoUrl(null);
      sessionStorage.removeItem('lastValidatedPhotoUrl');
    }
  });

  // Restore uploaded photo and session from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('lastUploadedPhoto');
    const savedValidated = sessionStorage.getItem('lastValidatedPhotoUrl');
    const savedSessionId = sessionStorage.getItem('lastViewedSessionId');
    
    if (savedSessionId) {
      setLastViewedSessionId(savedSessionId);
    }
    
    if (saved) {
      setPhotoUrl(saved);
      setPreviewUrl(saved);
      // If this photo was already validated, skip re-validation
      if (saved === savedValidated) {
        setPhotoValidated(true);
        setLastValidatedPhotoUrl(saved);
        
        // Still trigger preprocessing for cached photos - ensures mask is ready
        fetch('/api/preprocess-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoUrl: saved })
        }).catch(() => {
          // Silently ignore errors - this is a background optimization
        });
      } else {
        setPhotoValidated(false);
        setPendingValidation(saved);
      }
    }
  }, []);

  // Trigger validation when pendingValidation is set (for restored photos)
  useEffect(() => {
    if (pendingValidation) {
      validatePhotoMutation.mutate({ photoUrl: pendingValidation });
      setPendingValidation(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingValidation]);

  // Save uploaded photo to sessionStorage whenever it changes
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
      // Server also validates as a safeguard (frontend validation is for immediate UX feedback)
      const response = await apiRequest("POST", "/api/upload-photo", data);
      const result = await response.json();
      return result as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-generations"] });
      
      // Set pending generation for notification if user leaves before completion
      setPendingGeneration(data.id);
      
      // Navigate directly to results page for initial generation
      sessionStorage.setItem('lastViewedSessionId', data.id);
      const isAurenIQ = hairstylePrompt === AI_MATCH_PROMPT;
      setLocation(`/results/${data.id}${isAurenIQ ? '?aureniq=true' : ''}`);
    },
    onError: (error: any) => {
      const errorStatus = error?.status;
      const errorData = error?.data;

      if (errorStatus === 402) {
        // Out of credits error
        if (errorData?.isAuthenticated) {
          // Authenticated user with no credits
          toast({
            title: "Out of Credits",
            description: "You've used all your credits. Visit the pricing page to get more.",
            variant: "destructive",
            action: (
              <ToastAction altText="Get Credits" onClick={() => setLocation("/pricing")}>
                Get Credits
              </ToastAction>
            ),
          });
        } else if (errorData?.requiresSignup) {
          // Beta: Don't prompt for signup - just show credit limit message
          toast({
            title: "Credits Used Up",
            description: "You've used all your credits for now. Check back later for more!",
            variant: "destructive",
          });
        }
      } else if (errorData?.qualityIssues) {
        // Photo quality check failed - show specific guidance
        toast({
          title: "Photo Quality Issue",
          description: errorData?.guidance || "Please upload a clearer photo with your full face visible.",
          variant: "destructive",
          duration: 3000,
        });
      } else {
        // Generic upload error
        toast({
          title: "Upload Failed",
          description: "We couldn't upload your photo. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  const handleSubmit = () => {
    if (!photoUrl.trim()) {
      toast({
        title: "Photo Required",
        description: "Please upload your photo first.",
        variant: "destructive",
      });
      return;
    }

    if (validatePhotoMutation.isPending) {
      toast({
        title: "Please Wait",
        description: "Your photo is still being checked. Please wait a moment.",
        variant: "destructive",
      });
      return;
    }

    if (!photoValidated) {
      toast({
        title: "Photo Validation Required",
        description: "Your photo needs to pass quality checks before generating. Please try a different photo.",
        variant: "destructive",
      });
      return;
    }

    if (inputMode === "describe" && !hairstylePrompt.trim()) {
      toast({
        title: "Style Description Required",
        description: "Please describe the style you want to try or select a suggestion.",
        variant: "destructive",
      });
      return;
    }

    if (inputMode === "inspiration" && !inspirationPhotoUrl.trim()) {
      toast({
        title: "Inspiration Photo Required",
        description: "Please upload or paste the inspiration photo URL.",
        variant: "destructive",
      });
      return;
    }

    setGenerationStartTime(Date.now());
    uploadMutation.mutate({ 
      photoUrl, 
      hairstylePrompt: inputMode === "describe" ? hairstylePrompt : undefined,
      inspirationPhotoUrl: inputMode === "inspiration" ? inspirationPhotoUrl : undefined,
      styleType: "hairstyle"
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
        // Check if this photo was already validated (skip re-validation)
        const savedValidated = sessionStorage.getItem('lastValidatedPhotoUrl');
        if (result === savedValidated) {
          setPhotoValidated(true);
          setLastValidatedPhotoUrl(result);
        } else {
          setPhotoValidated(false);
          // Validate the photo quality
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


  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Navigation />
      
      {/* Main content - fits on one page */}
      <div className="flex-1 bg-background px-4 py-4 lg:py-6 overflow-hidden">
        <div className="max-w-2xl mx-auto h-full flex flex-col">
          {/* Header */}
          <div className="text-center mb-4 flex-shrink-0">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-foreground">
              What hairstyle would you like to try?
            </h1>
          </div>
          
          {/* Return to previous generation banner */}
          {lastViewedSessionId && (
            <div className="mb-3 p-2 bg-muted/50 rounded-lg border border-muted flex items-center justify-between flex-shrink-0">
              <span className="text-sm text-muted-foreground">You have a generated look</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/results/${lastViewedSessionId}`)}
                data-testid="button-return-to-results"
              >
                <ArrowRight className="h-4 w-4 mr-1" />
                View Results
              </Button>
            </div>
          )}
          <Card className="border shadow-lg flex-1 overflow-hidden">
            <CardContent className="p-4 md:p-6 h-full overflow-y-auto space-y-4">
              {uploadMutation.isPending ? (
                <GenerationProgress 
                  startTime={generationStartTime || Date.now()} 
                  estimatedDuration={55000}
                />
              ) : (
                <div className="space-y-4">
                  {/* Step 1: Photo Upload Section */}
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-900 text-white flex items-center justify-center text-sm font-bold">
                        1
                      </div>
                      <h3 className="font-heading font-semibold text-lg">
                        Upload Your Photo
                      </h3>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" data-testid="button-photo-tips">
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-4" side="top">
                          <div className="space-y-2">
                            <h4 className="font-semibold text-sm">Photo Tips for Best Results</h4>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              <li className="flex items-start gap-2">
                                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                <span>Use a well-lit photo</span>
                              </li>
                              <li className="flex items-start gap-2">
                                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                <span>Show your full face clearly</span>
                              </li>
                              <li className="flex items-start gap-2">
                                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                <span>Avoid obstructions (sunglasses, hats, hands)</span>
                              </li>
                              <li className="flex items-start gap-2">
                                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                <span>Face the camera directly</span>
                              </li>
                            </ul>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    
                    {/* Photo validation error alert */}
                    {photoValidationError && (
                      <Alert variant="destructive" className="mb-4" data-testid="alert-photo-validation-error">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{photoValidationError}</AlertDescription>
                      </Alert>
                    )}

                    {previewUrl ? (
                      <motion.div 
                        className="mb-4 relative"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                      >
                        <div className="relative w-full max-w-sm mx-auto">
                          <img 
                            src={previewUrl} 
                            alt="Your photo" 
                            className={`w-full rounded-xl shadow-lg ${validatePhotoMutation.isPending ? 'opacity-70' : ''}`}
                            data-testid="img-preview"
                          />
                          <div className="absolute top-2 right-2">
                            {validatePhotoMutation.isPending ? (
                              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/90 text-white text-xs font-medium">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Checking quality...
                              </div>
                            ) : photoValidated ? (
                              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/90 text-white text-xs font-medium">
                                <Check className="w-3 h-3" />
                                Ready
                              </div>
                            ) : photoValidationError ? (
                              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/90 text-white text-xs font-medium">
                                <AlertCircle className="w-3 h-3" />
                                Photo issue
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/90 text-white text-xs font-medium">
                                <AlertCircle className="w-3 h-3" />
                                Needs validation
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          className="mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto block"
                          onClick={() => { setPreviewUrl(""); setPhotoUrl(""); setPhotoValidated(false); setPhotoValidationError(null); }}
                          data-testid="button-change-photo"
                        >
                          Change photo
                        </button>
                      </motion.div>
                    ) : (
                      <div className="grid md:grid-cols-2 gap-4">
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileUpload}
                            data-testid="input-file"
                          />
                          <div className="h-full p-6 rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100/50 dark:hover:bg-blue-900/30 transition-all text-center group">
                            <div className="w-14 h-14 rounded-full bg-blue-900 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                              <UploadIcon className="h-7 w-7 text-white" />
                            </div>
                            <h4 className="font-semibold mb-1">Upload from Device</h4>
                            <p className="text-sm text-muted-foreground">
                              Click or drag a photo here
                            </p>
                          </div>
                        </label>

                        <div className="flex flex-col">
                          <div className="h-full p-6 rounded-xl border border-border bg-muted/30 flex flex-col justify-center">
                            <Camera className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                            <Input
                              placeholder="Or paste image URL"
                              value={photoUrl.startsWith("data:") ? "" : photoUrl}
                              onChange={(e) => {
                                const url = e.target.value;
                                setPhotoUrl(url);
                                if (url) {
                                  setPreviewUrl(url);
                                  // Clear validation status when URL changes
                                  setPhotoValidated(false);
                                  setPhotoValidationError(null);
                                } else {
                                  setPhotoValidated(false);
                                  setPreviewUrl("");
                                }
                              }}
                              onBlur={(e) => {
                                const url = e.target.value.trim();
                                // Only validate if URL looks valid (starts with http/https)
                                if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                                  // Check cache first
                                  const savedValidated = sessionStorage.getItem('lastValidatedPhotoUrl');
                                  if (url === savedValidated) {
                                    setPhotoValidated(true);
                                  } else {
                                    validatePhotoMutation.mutate({ photoUrl: url });
                                  }
                                }
                              }}
                              className="text-center"
                              data-testid="input-url"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step 2: Style Input Mode */}
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-900 text-white flex items-center justify-center text-sm font-bold">
                        2
                      </div>
                      <h3 className="font-heading font-semibold text-lg">
                        Choose Your Style
                      </h3>
                    </div>
                    
                    <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)} className="w-full">
                      <TabsList className="grid w-full grid-cols-2 mb-6 h-12 bg-muted/50">
                        <TabsTrigger value="describe" className="text-sm data-[state=active]:bg-blue-900 data-[state=active]:text-white" data-testid="tab-describe">
                          <Sparkles className="w-4 h-4 mr-2" />
                          Describe Style
                        </TabsTrigger>
                        <TabsTrigger value="inspiration" className="text-sm data-[state=active]:bg-blue-900 data-[state=active]:text-white" data-testid="tab-inspiration">
                          <Image className="w-4 h-4 mr-2" />
                          Try a Look
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="describe" className="space-y-4">
                        {/* AI Polish Option */}
                        <motion.div
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <Card
                            className={`cursor-pointer transition-all ${
                              hairstylePrompt === AI_MATCH_PROMPT 
                                ? 'border-amber-500 ring-2 ring-amber-500/20 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30' 
                                : 'bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200 dark:border-amber-800 hover:border-amber-400 dark:hover:border-amber-600'
                            }`}
                            onClick={() => setHairstylePrompt(AI_MATCH_PROMPT)}
                            data-testid="suggestion-ai-match"
                          >
                            <CardContent className="p-4 flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                                <Wand2 className="w-5 h-5 text-white" />
                              </div>
                              <div>
                                <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">AI Polish</span>
                                <p className="text-xs text-muted-foreground">Enhance your current look with better styling</p>
                              </div>
                              {hairstylePrompt === AI_MATCH_PROMPT && (
                                <Check className="w-5 h-5 text-amber-600 ml-auto" />
                              )}
                            </CardContent>
                          </Card>
                        </motion.div>

                        <div className="relative py-2">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                          </div>
                          <div className="relative flex justify-center">
                            <span className="bg-card px-3 text-xs text-muted-foreground uppercase tracking-wide">
                              Or describe your style
                            </span>
                          </div>
                        </div>

                        <Input
                          placeholder="e.g., curly shoulder-length hair with caramel highlights..."
                          value={hairstylePrompt === AI_MATCH_PROMPT ? "" : hairstylePrompt}
                          onChange={(e) => setHairstylePrompt(e.target.value)}
                          className="h-12 border-2 focus-visible:ring-blue-500"
                          data-testid="input-prompt"
                        />
                      </TabsContent>

                      <TabsContent value="inspiration" className="space-y-6">
                        <div className="bg-blue-50/50 dark:bg-blue-950/30 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
                          <p className="text-sm text-center">
                            <span className="font-medium">Pro tip:</span> Upload a celebrity photo, influencer look, or magazine image. 
                            Our AI will transfer that exact style to your photo.
                          </p>
                        </div>

                        {inspirationPreviewUrl ? (
                          <motion.div 
                            className="relative"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                          >
                            <div className="relative w-full max-w-sm mx-auto">
                              <img 
                                src={inspirationPreviewUrl} 
                                alt="Inspiration" 
                                className="w-full rounded-xl shadow-lg"
                                data-testid="img-inspiration-preview"
                              />
                              <div className="absolute top-2 right-2">
                                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/90 text-white text-xs font-medium">
                                  <Check className="w-3 h-3" />
                                  Inspiration Set
                                </div>
                              </div>
                            </div>
                            <button
                              className="mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto block"
                              onClick={() => { setInspirationPreviewUrl(""); setInspirationPhotoUrl(""); }}
                              data-testid="button-change-inspiration"
                            >
                              Change inspiration
                            </button>
                          </motion.div>
                        ) : (
                          <div className="grid md:grid-cols-2 gap-4">
                            <label className="cursor-pointer">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleInspirationFileUpload}
                                data-testid="input-inspiration-file"
                              />
                              <div className="h-full p-6 rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100/50 dark:hover:bg-blue-900/30 transition-all text-center group">
                                <div className="w-14 h-14 rounded-full bg-blue-900 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                                  <Image className="h-7 w-7 text-white" />
                                </div>
                                <h4 className="font-semibold mb-1">Upload Inspiration</h4>
                                <p className="text-sm text-muted-foreground">
                                  From your device
                                </p>
                              </div>
                            </label>

                            <div className="flex flex-col">
                              <div className="h-full p-6 rounded-xl border border-border bg-muted/30 flex flex-col justify-center">
                                <Camera className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                                <Input
                                  placeholder="Or paste inspiration URL"
                                  value={inspirationPhotoUrl.startsWith("data:") ? "" : inspirationPhotoUrl}
                                  onChange={(e) => {
                                    const url = e.target.value;
                                    setInspirationPhotoUrl(url);
                                    if (url) setInspirationPreviewUrl(url);
                                  }}
                                  className="text-center"
                                  data-testid="input-inspiration-url"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                      </TabsContent>
                    </Tabs>
                  </div>

                  {/* Submit button */}
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <Button 
                      onClick={handleSubmit}
                      className="w-full h-14 text-lg rounded-xl shadow-lg bg-blue-900 hover:bg-blue-800"
                      size="lg"
                      disabled={!photoUrl || !photoValidated || validatePhotoMutation.isPending || (inputMode === "describe" ? !hairstylePrompt : !inspirationPhotoUrl)}
                      data-testid="button-generate"
                    >
                      <Sparkles className="mr-2 h-5 w-5" />
                      Generate
                      <ChevronRight className="ml-2 h-5 w-5" />
                    </Button>
                  </motion.div>

                  <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Your photos are encrypted and automatically deleted after 24 hours
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
