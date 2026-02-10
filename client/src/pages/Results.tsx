import Navigation from "@/components/Navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Sparkles, Loader2, ArrowRight, RefreshCw, Share2, Compass, CheckCircle, CreditCard, UserPlus, Coins, Download, Lock, Send, AlertCircle, Wand2, ChevronLeft, ChevronRight, Star, Eye, Columns, Plus, Bug, ArrowLeft, ChevronUp, ChevronDown, X, Heart, History, ThumbsDown } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { GeneratedVariant, User } from "@shared/schema";
import { useEffect, useState, useRef } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "framer-motion";
import { GenerationProgress } from "@/components/GenerationProgress";
import { QueueProgress } from "@/components/QueueProgress";
import { BetaSurveyPopup } from "@/components/BetaSurveyPopup";
import { usePendingGeneration } from "@/components/GenerationNotification";

const QUICK_SURVEY_INTERVAL = 5; // Quick survey every 5 generations
const EXTENDED_SURVEY_INTERVAL = 2; // Extended survey after 2 generations, then again at 11+
const GENERATION_COUNT_KEY = "auren_generation_count";
const LAST_QUICK_SURVEY_KEY = "auren_last_quick_survey";
const LAST_EXTENDED_SURVEY_KEY = "auren_last_extended_survey";
const GENERATE_MORE_TIP_KEY = "auren_generate_more_tip_shown";

// Check for reset_survey URL param on load
if (typeof window !== 'undefined' && window.location.search.includes('reset_survey=1')) {
  console.log("[SURVEY] Resetting all survey localStorage keys");
  localStorage.removeItem(GENERATION_COUNT_KEY);
  localStorage.removeItem(LAST_QUICK_SURVEY_KEY);
  localStorage.removeItem(LAST_EXTENDED_SURVEY_KEY);
  localStorage.removeItem("auren_counted_sessions");
  // Remove the param from URL without refresh
  const url = new URL(window.location.href);
  url.searchParams.delete('reset_survey');
  window.history.replaceState({}, '', url.toString());
  console.log("[SURVEY] Survey state cleared! Generation count is now 0.");
}

type ViewAngle = "front" | "side";

// Helper function to generate version labels from customPrompt
function getVersionLabel(prompt: string | null | undefined, index: number, allPrompts: (string | null | undefined)[]): string {
  if (!prompt) return `Style ${index + 1}`;
  
  // Clean up AI-generated prompts
  if (prompt.includes("STYLE ENHANCEMENT") || prompt.includes("CURRENT APPEARANCE")) {
    return "AI Enhanced";
  }
  
  // Truncate long prompts
  const cleanPrompt = prompt.length > 30 ? prompt.slice(0, 30) + "..." : prompt;
  
  // Count how many times this exact prompt appears before this index
  const samePromptCount = allPrompts.slice(0, index).filter(p => p === prompt).length;
  
  if (samePromptCount > 0) {
    return `${cleanPrompt} ${samePromptCount + 1}`;
  }
  
  return cleanPrompt;
}

// Build refinement chain from current variant back to original
interface RefinementStep {
  variantId: string;
  refinementPrompt: string | null;
  generatedImageUrl: string | null;
  refinementNumber: number;
  status: string;
}

function buildRefinementChain(currentVariant: any, allVariants: any[]): RefinementStep[] {
  if (!currentVariant || !allVariants) return [];
  
  const chain: RefinementStep[] = [];
  let current = currentVariant;
  
  // Walk back through the chain
  while (current) {
    chain.unshift({
      variantId: current.id,
      refinementPrompt: current.refinementPrompt,
      generatedImageUrl: current.generatedImageUrl,
      refinementNumber: current.refinementNumber || 0,
      status: current.status,
    });
    
    if (current.parentVariantId) {
      current = allVariants.find((v: any) => v.id === current.parentVariantId);
    } else {
      break;
    }
  }
  
  return chain;
}

interface CreditsInfo {
  isAuthenticated: boolean;
  currentCredits?: number;
  plan?: string;
  unlimitedCredits?: boolean;
  anonymousCreditsRemaining?: number;
  anonymousCreditsLimit?: number;
  requiresSignup?: boolean;
}

export default function Results() {
  const [matchResults, params] = useRoute("/results/:id");
  const [matchDebug] = useRoute("/results-debug");
  const [location, setLocation] = useLocation();
  const { setPendingGeneration } = usePendingGeneration();
  const isDebugMode = matchDebug || location === "/results-debug";
  const sessionId = isDebugMode ? "debug" : params?.id;
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTitle, setShareTitle] = useState("");
  const [shareDescription, setShareDescription] = useState("");
  const [shareSuccess, setShareSuccess] = useState(false);
  const [creditError, setCreditError] = useState<{ requiresSignup: boolean; message: string } | null>(null);
  const [refinementPrompt, setRefinementPrompt] = useState("");
  const [showSurvey, setShowSurvey] = useState(false);
  const [surveyMode, setSurveyMode] = useState<"quick" | "extended" | "followup">("quick");
  const surveyCheckedRef = useRef(false);
  const initialGenerationTrackedRef = useRef<string | null>(null);
  const [currentVariantIndex, setCurrentVariantIndex] = useState(-1);
  const [indexInitialized, setIndexInitialized] = useState(false);
  const [viewAngle, setViewAngle] = useState<ViewAngle>("front");
  const [compareMode, setCompareMode] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevVariantsCountRef = useRef<number>(0);
  const generationInitiatedRef = useRef<string | null>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);
  // Check for initial slide direction and AurenIQ mode from URL query params
  const getInitialSlideDirection = (): number => {
    if (typeof window === 'undefined') return 0;
    const params = new URLSearchParams(window.location.search);
    const dir = params.get('dir');
    if (dir === 'left') return -1;
    if (dir === 'right') return 1;
    return 0;
  };
  const getIsAurenIQMode = (): boolean => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('aureniq') === 'true';
  };
  const [slideDirection, setSlideDirection] = useState<number>(getInitialSlideDirection); // -1 for left, 1 for right
  const [isAurenIQMode] = useState<boolean>(getIsAurenIQMode); // Track if AurenIQ was selected on landing
    
  const [hasMounted, setHasMounted] = useState(false);
  const [screenHeight, setScreenHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 800);
  const [screenWidth, setScreenWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 400);
  const [showGenerateMoreTip, setShowGenerateMoreTip] = useState(() => {
    if (typeof window !== 'undefined') {
      return !localStorage.getItem(GENERATE_MORE_TIP_KEY);
    }
    return true;
  });
  
  // Prevent animation on initial mount
  useEffect(() => {
    const timer = setTimeout(() => setHasMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Clear the direction query param after reading it (keeps URL clean)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('dir')) {
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    const handleResize = () => {
      setScreenHeight(window.innerHeight);
      setScreenWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const { toast } = useToast();
  const { user: authUser } = useAuth();

  const { data: creditsInfo } = useQuery<CreditsInfo>({
    queryKey: ["/api/credits"],
  });

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user/me"],
  });

  const shareMutation = useMutation({
    mutationFn: async ({ title, description, imageUrl, variantId }: { 
      title: string; 
      description: string; 
      imageUrl: string;
      variantId: string;
    }) => {
      const response = await apiRequest("POST", "/api/videos", {
        title,
        description,
        videoUrl: imageUrl,
        thumbnailUrl: imageUrl,
        generatedVariantId: variantId,
        tags: ["hairtransformation", "auren"],
      });
      return response.json();
    },
    onSuccess: () => {
      setShareSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error sharing",
        description: error.message || "Failed to share to Explore",
        variant: "destructive",
      });
    },
  });

  // Local state to track like/dislike - this takes precedence over server data
  // and provides a reliable way to maintain UI state regardless of refetches
  const [localLikeStates, setLocalLikeStates] = useState<Record<string, boolean>>({});
  const [localDislikeStates, setLocalDislikeStates] = useState<Record<string, boolean>>({});

  // Helper functions to get effective like/dislike state (local state takes precedence)
  const getEffectiveLikeState = (variantId: string | undefined, serverState: boolean | undefined): boolean => {
    if (!variantId) return false;
    return localLikeStates[variantId] ?? serverState ?? false;
  };
  const getEffectiveDislikeState = (variantId: string | undefined, serverState: boolean | undefined): boolean => {
    if (!variantId) return false;
    return localDislikeStates[variantId] ?? serverState ?? false;
  };

  // Mock data for debug mode - using type assertion to bypass strict typing
  const mockSession = isDebugMode ? {
    id: "debug",
    photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=600&fit=crop",
    facialFeatures: null,
    variants: [
      {
        id: "debug-variant-1",
        sessionId: "debug",
        status: "completed",
        generatedImageUrl: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400&h=600&fit=crop",
        sideImageUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=600&fit=crop",
        customPrompt: "Modern textured crop with fade",
        inspirationPhotoUrl: null,
        styleType: "text",
        renderType: "standard",
      },
      {
        id: "debug-variant-2",
        sessionId: "debug",
        status: "completed",
        generatedImageUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=600&fit=crop",
        sideImageUrl: null,
        customPrompt: "Classic slicked back style",
        inspirationPhotoUrl: null,
        styleType: "text",
        renderType: "standard",
      },
    ],
  } as { id: string; photoUrl: string; facialFeatures: string | null; variants: GeneratedVariant[] } : undefined;

  const { data: session, isLoading } = useQuery<{
    id: string;
    photoUrl: string;
    facialFeatures: string | null;
    variants: GeneratedVariant[];
  }>({
    queryKey: ["/api/session", sessionId],
    enabled: !!sessionId && !isDebugMode,
    queryFn: async () => {
      const response = await fetch(`/api/session/${sessionId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch session');
      }
      return response.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasPending = data.variants?.some((v: GeneratedVariant) => 
        v.status === "pending" || v.status === "processing" || v.status === "queued"
      );
      return hasPending ? 2000 : false;
    },
    ...(isDebugMode ? { initialData: mockSession } : {}),
  });

  // Track initial generation when session loads with completed variants
  useEffect(() => {
    if (!session || !sessionId) return;
    // Only track once per session
    if (initialGenerationTrackedRef.current === sessionId) return;
    
    // Check if session has at least one completed variant (initial generation done)
    const hasCompletedVariant = session.variants?.some(
      (v: GeneratedVariant) => v.status === "completed" && v.generatedImageUrl
    );
    
    if (hasCompletedVariant) {
      initialGenerationTrackedRef.current = sessionId;
      
      // Check if this session was already counted (stored in localStorage)
      const countedSessions = JSON.parse(localStorage.getItem("auren_counted_sessions") || "[]");
      if (countedSessions.includes(sessionId)) {
        console.log("[SURVEY] Session already counted, skipping:", sessionId);
        return;
      }
      
      // Mark session as counted
      countedSessions.push(sessionId);
      // Keep only last 100 sessions to prevent localStorage bloat
      if (countedSessions.length > 100) countedSessions.shift();
      localStorage.setItem("auren_counted_sessions", JSON.stringify(countedSessions));
      
      // Increment generation count
      const currentCount = parseInt(localStorage.getItem(GENERATION_COUNT_KEY) || "0", 10);
      const newCount = currentCount + 1;
      localStorage.setItem(GENERATION_COUNT_KEY, String(newCount));
      
      // Survey logic:
      // - Extended survey at 2 generations (first detailed feedback)
      // - Quick survey every 5 generations
      // - Followup prompt at 11 generations and every 9 after
      const lastQuickAt = parseInt(localStorage.getItem(LAST_QUICK_SURVEY_KEY) || "0", 10);
      const hasShownFirstExtended = localStorage.getItem(LAST_EXTENDED_SURVEY_KEY) !== null;
      const lastExtendedAt = parseInt(localStorage.getItem(LAST_EXTENDED_SURVEY_KEY) || "0", 10);
      
      console.log("[SURVEY] Generation count:", newCount, {
        lastQuickAt,
        hasShownFirstExtended,
        lastExtendedAt,
        QUICK_SURVEY_INTERVAL
      });
      
      // Show extended survey at generation 2 (first time only)
      const shouldShowExtended = newCount >= 2 && !hasShownFirstExtended;
      
      // Show followup prompt at 11+ and every 9 after
      const shouldShowFollowup = newCount >= 11 && newCount - lastExtendedAt >= 9;
      
      console.log("[SURVEY] Decision:", {
        shouldShowExtended,
        shouldShowFollowup,
        shouldShowQuick: newCount - lastQuickAt >= QUICK_SURVEY_INTERVAL
      });
      
      if (shouldShowExtended) {
        console.log("[SURVEY] Showing EXTENDED survey");
        setTimeout(() => {
          setSurveyMode("extended");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_EXTENDED_SURVEY_KEY, String(newCount));
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      } else if (shouldShowFollowup) {
        console.log("[SURVEY] Showing FOLLOWUP survey");
        setTimeout(() => {
          setSurveyMode("followup");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_EXTENDED_SURVEY_KEY, String(newCount));
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      } else if (newCount - lastQuickAt >= QUICK_SURVEY_INTERVAL) {
        console.log("[SURVEY] Showing QUICK survey");
        setTimeout(() => {
          setSurveyMode("quick");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      } else {
        console.log("[SURVEY] No survey triggered");
      }
    }
  }, [session, sessionId]);

  const { data: siblings } = useQuery<{
    sessions: string[];
    currentIndex: number;
    total: number;
  }>({
    queryKey: ["/api/session", sessionId, "siblings"],
    enabled: !!sessionId,
    staleTime: 0,
    queryFn: async () => {
      const response = await fetch(`/api/session/${sessionId}/siblings`);
      if (!response.ok) {
        return { sessions: [], currentIndex: 0, total: 0 };
      }
      return response.json();
    },
  });

  const hasQueuedVariants = session?.variants?.some((v: GeneratedVariant) => v.status === "queued");

  const { data: queueStatus } = useQuery<{
    queued: boolean;
    position: number;
    totalInQueue: number;
    estimatedWaitSeconds: number;
    canRetry?: boolean;
  }>({
    queryKey: ["/api/session", sessionId, "queue-status"],
    enabled: !!sessionId && hasQueuedVariants,
    refetchInterval: hasQueuedVariants ? 3000 : false,
    queryFn: async () => {
      const response = await fetch(`/api/session/${sessionId}/queue-status`);
      if (!response.ok) {
        return { queued: false, position: 0, totalInQueue: 0, estimatedWaitSeconds: 0 };
      }
      return response.json();
    },
  });
  
  const retryingRef = useRef(false);
  
  useEffect(() => {
    if (queueStatus?.canRetry && hasQueuedVariants && !retryingRef.current) {
      retryingRef.current = true;
      console.log("[QUEUE] Lock is free and it's our turn, retrying generation");
      fetch(`/api/generate-hairstyles/${sessionId}`, { method: 'POST' })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/session", sessionId] });
          queryClient.invalidateQueries({ queryKey: ["/api/session", sessionId, "queue-status"] });
        })
        .catch(err => console.error("[QUEUE] Retry failed:", err))
        .finally(() => {
          retryingRef.current = false;
        });
    }
  }, [queueStatus?.canRetry, hasQueuedVariants, sessionId]);

  const canNavigateLeft = siblings && siblings.currentIndex > 0;
  const canNavigateRight = siblings && siblings.currentIndex < siblings.total - 1;
  
  const navigateToPreviousSession = () => {
    if (canNavigateLeft && siblings) {
      const prevSessionId = siblings.sessions[siblings.currentIndex - 1];
      setLocation(`/results/${prevSessionId}`);
    }
  };
  
  const navigateToNextSession = () => {
    if (canNavigateRight && siblings) {
      const nextSessionId = siblings.sessions[siblings.currentIndex + 1];
      setLocation(`/results/${nextSessionId}`);
    }
  };

  const minSwipeDistance = 50;
  const [isDragging, setIsDragging] = useState(false);
  
  // Touch event handlers (mobile)
  const onTouchStart = (e: React.TouchEvent) => {
    console.log('[SWIPE] onTouchStart', e.targetTouches?.[0]?.clientX);
    if (!e.targetTouches?.[0]) return;
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!e.targetTouches?.[0]) return;
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    console.log('[SWIPE] onTouchEnd');
    handleSwipeEnd();
  };

  // Mouse event handlers (desktop)
  const onMouseDown = (e: React.MouseEvent) => {
    console.log('[SWIPE] onMouseDown', e.clientX);
    e.preventDefault(); // Prevent text selection
    setIsDragging(true);
    setTouchEnd(null);
    setTouchStart(e.clientX);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setTouchEnd(e.clientX);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setIsDragging(false);
    handleSwipeEnd();
  };

  const onMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
      handleSwipeEnd();
    }
  };

  // Shared swipe logic - navigates within navigable set (refinement chain or originals)
  const handleSwipeEnd = () => {
    console.log('[SWIPE] handleSwipeEnd called', { touchStart, touchEnd, siblings });
    if (touchStart === null || touchEnd === null) {
      console.log('[SWIPE] No touch data, returning');
      setTouchStart(null);
      setTouchEnd(null);
      return;
    }
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    
    // Get next/prev indices within the navigable set (refinement chain OR originals)
    const nextIdx = getAdjacentNavigableIndex("next");
    const prevIdx = getAdjacentNavigableIndex("prev");
    
    console.log('[SWIPE] Distance:', distance, 'isLeft:', isLeftSwipe, 'isRight:', isRightSwipe, 'nextIdx:', nextIdx, 'prevIdx:', prevIdx);
    
    // Swipe left = go to next in navigable set
    if (isLeftSwipe && nextIdx !== null) {
      setSwipeDirection("left");
      setSlideDirection(-1);
      setCurrentVariantIndex(nextIdx);
    }
    // Swipe right = go to previous in navigable set
    else if (isRightSwipe && prevIdx !== null) {
      setSwipeDirection("right");
      setSlideDirection(1);
      setCurrentVariantIndex(prevIdx);
    }
    // If at edge of navigable set AND viewing originals, navigate to sibling sessions
    else if (isLeftSwipe && nextIdx === null && canNavigateRight && siblings) {
      // Only allow session navigation when viewing originals (not refinements)
      const currentVariant = session?.variants?.[currentVariantIndex];
      if (!currentVariant?.refinementPrompt) {
        setSwipeDirection("left");
        setSlideDirection(-1);
        const nextSessionId = siblings.sessions[siblings.currentIndex + 1];
        setLocation(`/results/${nextSessionId}?dir=left`);
      }
    }
    else if (isRightSwipe && prevIdx === null && canNavigateLeft && siblings) {
      // Only allow session navigation when viewing originals (not refinements)
      const currentVariant = session?.variants?.[currentVariantIndex];
      if (!currentVariant?.refinementPrompt) {
        setSwipeDirection("right");
        setSlideDirection(1);
        const prevSessionId = siblings.sessions[siblings.currentIndex - 1];
        setLocation(`/results/${prevSessionId}?dir=right`);
      }
    }
    
    setTouchStart(null);
    setTouchEnd(null);
  };

  useEffect(() => {
    if (swipeDirection) {
      const timer = setTimeout(() => setSwipeDirection(null), 300);
      return () => clearTimeout(timer);
    }
  }, [swipeDirection, sessionId]);

  // Reset slide direction after animation completes
  useEffect(() => {
    if (slideDirection !== 0) {
      const timer = setTimeout(() => setSlideDirection(0), 300);
      return () => clearTimeout(timer);
    }
  }, [slideDirection]);

  // Navigate to a variant by index (simplified helper)
  const navigateToVariant = (targetIndex: number) => {
    if (targetIndex === currentVariantIndex) return;
    if (targetIndex < 0 || targetIndex >= (session?.variants?.length || 0)) return;
    setSlideDirection(targetIndex > currentVariantIndex ? -1 : 1);
    setCurrentVariantIndex(targetIndex);
  };

  // Share handler for mobile - uses Web Share API with fallback
  const handleMobileShare = async () => {
    const imageUrl = variant?.generatedImageUrl;
    const aurenLink = "https://auren.replit.app";
    const shareText = "Check out my new hairstyle created with Auren - the AI hairstyle try-on app!";
    
    try {
      // Check if Web Share API is available
      if (navigator.share) {
        // Try to share with image if possible
        if (imageUrl) {
          try {
            // Fetch the image and create a blob
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const file = new File([blob], 'my-new-look.png', { type: 'image/png' });
            
            // Check if we can share files
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({
                title: 'My New Look - Auren',
                text: shareText,
                url: aurenLink,
                files: [file]
              });
            } else {
              // Fallback to sharing just text and URL
              await navigator.share({
                title: 'My New Look - Auren',
                text: shareText,
                url: aurenLink
              });
            }
          } catch (fileError) {
            // If file sharing fails, fallback to text/URL only
            await navigator.share({
              title: 'My New Look - Auren',
              text: shareText,
              url: aurenLink
            });
          }
        } else {
          await navigator.share({
            title: 'Try Auren - AI Hairstyle App',
            text: shareText,
            url: aurenLink
          });
        }
        toast({
          title: "Shared!",
          description: "Your look has been shared successfully.",
        });
      } else {
        // Fallback for browsers without Web Share API - copy link
        await navigator.clipboard.writeText(`${shareText}\n\n${aurenLink}`);
        toast({
          title: "Link Copied!",
          description: "Share link copied to clipboard.",
        });
      }
    } catch (error) {
      // User cancelled or share failed
      if ((error as Error).name !== 'AbortError') {
        toast({
          title: "Share failed",
          description: "Unable to share. Link copied to clipboard instead.",
          variant: "destructive",
        });
        try {
          await navigator.clipboard.writeText(`${shareText}\n\n${aurenLink}`);
        } catch {
          // Clipboard also failed, do nothing
        }
      }
    }
  };
  
  // Get navigable variants based on current context
  // If viewing a refinement: navigate within refinement chain only
  // If viewing an original: navigate between originals only
  const getNavigableIndices = (): number[] => {
    if (!session?.variants) return [];
    
    const currentVariant = session.variants[currentVariantIndex];
    if (!currentVariant) return [];
    
    const isRefinement = !!currentVariant.refinementPrompt;
    
    if (isRefinement) {
      // Get the refinement chain for current variant
      const chain = buildRefinementChain(currentVariant, session.variants);
      return chain.map(step => 
        session.variants.findIndex((v: any) => v.id === step.variantId)
      ).filter(idx => idx >= 0);
    } else {
      // Get all original generations (non-refinements)
      return session.variants
        .map((v: any, idx: number) => ({ v, idx }))
        .filter(({ v }) => !v.refinementPrompt)
        .map(({ idx }) => idx);
    }
  };
  
  // Get previous/next indices within navigable set
  const getAdjacentNavigableIndex = (direction: "prev" | "next"): number | null => {
    const navigable = getNavigableIndices();
    if (navigable.length <= 1) return null;
    
    const currentPosInNav = navigable.indexOf(currentVariantIndex);
    if (currentPosInNav === -1) return null;
    
    if (direction === "prev" && currentPosInNav > 0) {
      return navigable[currentPosInNav - 1];
    }
    if (direction === "next" && currentPosInNav < navigable.length - 1) {
      return navigable[currentPosInNav + 1];
    }
    return null;
  };
  
  const canNavigatePrev = getAdjacentNavigableIndex("prev") !== null;
  const canNavigateNext = getAdjacentNavigableIndex("next") !== null;

  const generateMutation = useMutation({
    mutationFn: async () => {
      // Use AurenIQ endpoint if user selected AurenIQ on landing page
      const endpoint = isAurenIQMode 
        ? `/api/generate-aureniq/${sessionId}`
        : `/api/generate-hairstyles/${sessionId}`;
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      
      if (response.status === 402) {
        const errorData = await response.json();
        throw { status: 402, ...errorData };
      }
      
      if (response.status === 504) {
        const errorData = await response.json();
        throw { status: 504, isTimeout: true, ...errorData };
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.isTimeout || errorData.error === "GENERATION_TIMEOUT") {
          throw { isTimeout: true, ...errorData };
        }
        throw new Error("Failed to generate");
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      
      // Track generation count for survey popup
      const currentCount = parseInt(localStorage.getItem(GENERATION_COUNT_KEY) || "0", 10);
      const newCount = currentCount + 1;
      localStorage.setItem(GENERATION_COUNT_KEY, String(newCount));
      
      // Survey logic:
      // - Extended survey at 2 generations (first detailed feedback)
      // - Quick survey every 5 generations
      // - Followup prompt at 11 generations and every 9 after
      const lastQuickAt = parseInt(localStorage.getItem(LAST_QUICK_SURVEY_KEY) || "0", 10);
      const hasShownFirstExtended = localStorage.getItem(LAST_EXTENDED_SURVEY_KEY) !== null;
      const lastExtendedAt = parseInt(localStorage.getItem(LAST_EXTENDED_SURVEY_KEY) || "0", 10);
      
      // Show extended survey at generation 2 (first time only)
      const shouldShowExtended = newCount >= 2 && !hasShownFirstExtended;
      
      // Show followup prompt at 11+ and every 9 after
      const shouldShowFollowup = newCount >= 11 && newCount - lastExtendedAt >= 9;
      
      if (shouldShowExtended) {
        setTimeout(() => {
          setSurveyMode("extended");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_EXTENDED_SURVEY_KEY, String(newCount));
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      } else if (shouldShowFollowup) {
        setTimeout(() => {
          setSurveyMode("followup");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_EXTENDED_SURVEY_KEY, String(newCount));
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      } else if (newCount - lastQuickAt >= QUICK_SURVEY_INTERVAL) {
        setTimeout(() => {
          setSurveyMode("quick");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      }
    },
    onError: (error: any) => {
      if (error.status === 402) {
        setCreditError({
          requiresSignup: error.requiresSignup || !error.isAuthenticated,
          message: error.message || "You've run out of free generations."
        });
      } else if (error.isTimeout || error.error === "GENERATION_TIMEOUT") {
        toast({
          title: "Generation Timed Out",
          description: "The AI is experiencing high demand. Please try again in a moment.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Generation Failed",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  const refineMutation = useMutation({
    mutationFn: async ({ variantId }: { variantId: string }) => {
      const response = await fetch(`/api/refine-generation/${variantId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refinementPrompt }),
        credentials: "include",
      });
      
      if (response.status === 402) {
        const errorData = await response.json();
        throw { status: 402, ...errorData };
      }
      
      if (response.status === 422) {
        const errorData = await response.json();
        throw { status: 422, ...errorData };
      }
      
      if (response.status === 504) {
        const errorData = await response.json();
        throw { status: 504, isTimeout: true, ...errorData };
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.isTimeout || errorData.error === "GENERATION_TIMEOUT") {
          throw { isTimeout: true, ...errorData };
        }
        if (errorData.isSessionLimit || errorData.error === "SESSION_LIMIT_REACHED") {
          throw { isSessionLimit: true, ...errorData };
        }
        throw new Error("Failed to refine");
      }
      
      return response.json();
    },
    onSuccess: async (data) => {
      setRefinementPrompt("");
      toast({
        title: "Refinement complete!",
        description: "Your look has been refined.",
      });
      
      // Refetch and wait for the data to be updated
      await queryClient.refetchQueries({ queryKey: ["/api/session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      
      if (data?.variantId) {
        // Now the cache should be updated, find the new variant
        const updatedSession = queryClient.getQueryData(["/api/session", sessionId]) as any;
        if (updatedSession?.variants) {
          const newVariantIndex = updatedSession.variants.findIndex((v: any) => v.id === data.variantId);
          if (newVariantIndex >= 0) {
            const cachedVariant = updatedSession.variants[newVariantIndex];
            console.log(`[REFINE] Switching to new variant at index ${newVariantIndex}`);
            console.log(`[REFINE] API response URL: ${data.generatedImageUrl?.substring(0, 80)}...`);
            console.log(`[REFINE] Cached variant URL: ${cachedVariant?.generatedImageUrl?.substring(0, 80)}...`);
            console.log(`[REFINE] URLs match: ${data.generatedImageUrl === cachedVariant?.generatedImageUrl}`);
            setCurrentVariantIndex(newVariantIndex);
          } else {
            console.log(`[REFINE] Variant not found by ID, using last index`);
            setCurrentVariantIndex(updatedSession.variants.length - 1);
          }
        }
      }
    },
    onError: (error: any) => {
      if (error.status === 402) {
        setCreditError({
          requiresSignup: error.requiresSignup || !error.isAuthenticated,
          message: error.message || "You've run out of credits."
        });
      } else if (error.isNsfw) {
        toast({
          title: "Image Flagged",
          description: "The AI service flagged this image. Try a different photo or prompt.",
          variant: "destructive",
        });
      } else if (error.isTimeout || error.error === "GENERATION_TIMEOUT") {
        toast({
          title: "Generation Timed Out",
          description: "The AI is experiencing high demand. Please try again in a moment.",
          variant: "destructive",
        });
      } else if (error.isSessionLimit || error.error === "SESSION_LIMIT_REACHED") {
        toast({
          title: "Session Limit Reached",
          description: error.message || "You've reached the maximum of 15 generations for this session. Start a new session to continue.",
        });
      } else {
        toast({
          title: "Refinement Failed",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  const polishMutation = useMutation({
    mutationFn: async ({ variantId }: { variantId: string }) => {
      const response = await fetch(`/api/ai-polish/${variantId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      if (response.status === 402) {
        const errorData = await response.json();
        throw { status: 402, ...errorData };
      }
      
      if (!response.ok) {
        throw new Error("Failed to generate AI Polish");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "AI Polish generating...",
        description: `Finding trending styles matching your ${data.matchedFeatures?.faceShape || ''} face shape`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      if (data?.variantId) {
        setTimeout(() => {
          const updatedSession = queryClient.getQueryData(["/api/session", sessionId]) as any;
          if (updatedSession?.variants) {
            const newVariantIndex = updatedSession.variants.findIndex((v: any) => v.id === data.variantId);
            if (newVariantIndex >= 0) {
              setCurrentVariantIndex(newVariantIndex);
            } else {
              setCurrentVariantIndex(updatedSession.variants.length - 1);
            }
          }
        }, 100);
      }
    },
    onError: (error: any) => {
      if (error.status === 402) {
        setCreditError({
          requiresSignup: error.requiresSignup || !error.isAuthenticated,
          message: error.message || "You've run out of credits."
        });
      } else {
        toast({
          title: "AI Polish Failed",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ variantId }: { variantId: string }) => {
      const response = await fetch(`/api/variant/${variantId}/toggle-favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      if (response.status === 401) {
        const errorData = await response.json();
        throw { status: 401, requiresLogin: true, ...errorData };
      }
      
      if (!response.ok) {
        throw new Error("Failed to toggle favorite");
      }
      
      return response.json();
    },
    onMutate: async ({ variantId }) => {
      // Get current state from local state or server data
      const currentVariant = session?.variants?.find(v => v.id === variantId);
      const currentState = localLikeStates[variantId] ?? currentVariant?.isFavorited ?? false;
      const newState = !currentState;
      
      // Immediately update local state - this takes precedence over server data
      setLocalLikeStates(prev => ({ ...prev, [variantId]: newState }));
      
      return { previousState: currentState, variantId };
    },
    onSuccess: (data, variables) => {
      // Update local state with server-confirmed value
      setLocalLikeStates(prev => ({ ...prev, [variables.variantId]: data.isFavorited }));
      
      // Invalidate the favorites list and session to keep everything in sync
      queryClient.invalidateQueries({ queryKey: ["/api/user/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/session", sessionId] });
      
      toast({
        title: data.isFavorited ? "Saved!" : "Removed from saved",
        description: data.isFavorited ? "This look has been saved to your favorites." : "Removed from favorites.",
        duration: 2000,
      });
    },
    onError: (error: any, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousState !== undefined) {
        setLocalLikeStates(prev => ({ ...prev, [context.variantId]: context.previousState }));
      }
      
      if (error.status === 401 || error.requiresLogin) {
        setCreditError({
          requiresSignup: true,
          message: "Create a free account to save your favorite looks and access them anytime."
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to save. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  const toggleDislikeMutation = useMutation({
    mutationFn: async ({ variantId }: { variantId: string }) => {
      const response = await fetch(`/api/variant/${variantId}/toggle-dislike`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Failed to toggle dislike");
      }
      
      return response.json();
    },
    onMutate: async ({ variantId }) => {
      // Get current state from local state or server data
      const currentVariant = session?.variants?.find(v => v.id === variantId);
      const currentState = localDislikeStates[variantId] ?? (currentVariant as any)?.isDisliked ?? false;
      const newState = !currentState;
      
      // Immediately update local state - this takes precedence over server data
      setLocalDislikeStates(prev => ({ ...prev, [variantId]: newState }));
      
      return { previousState: currentState, variantId };
    },
    onSuccess: (data, variables) => {
      // Update local state with server-confirmed value
      setLocalDislikeStates(prev => ({ ...prev, [variables.variantId]: data.isDisliked }));
      
      // Invalidate session to persist dislike state
      queryClient.invalidateQueries({ queryKey: ["/api/session", sessionId] });
      
      toast({
        title: data.isDisliked ? "Thanks for your feedback!" : "Feedback removed",
        description: data.isDisliked ? "We'll use this to improve our AI." : "",
        duration: 2000,
      });
    },
    onError: (error: any, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousState !== undefined) {
        setLocalDislikeStates(prev => ({ ...prev, [context.variantId]: context.previousState }));
      }
      toast({
        title: "Error",
        description: "Failed to submit feedback. Please try again.",
        variant: "destructive",
      });
    },
  });

  const generateMoreMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/session/${sessionId}/generate-more`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      if (response.status === 402) {
        const errorData = await response.json();
        throw { status: 402, ...errorData };
      }
      
      if (response.status === 400) {
        const errorData = await response.json();
        throw { status: 400, ...errorData };
      }
      
      if (!response.ok) {
        throw new Error("Failed to generate more");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "New generation created!",
        description: data.isInspirationMode 
          ? "Regenerating with same inspiration photo."
          : `Using reference ${data.referenceIndex + 1}. ${data.remainingReferences} more available.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      
      // Track generation count for survey popup
      const currentCount = parseInt(localStorage.getItem(GENERATION_COUNT_KEY) || "0", 10);
      const newCount = currentCount + 1;
      localStorage.setItem(GENERATION_COUNT_KEY, String(newCount));
      
      // Survey logic:
      // - Extended survey at 2 generations (first detailed feedback)
      // - Quick survey every 5 generations
      // - Followup prompt at 11 generations and every 9 after
      const lastQuickAt = parseInt(localStorage.getItem(LAST_QUICK_SURVEY_KEY) || "0", 10);
      const hasShownFirstExtended = localStorage.getItem(LAST_EXTENDED_SURVEY_KEY) !== null;
      const lastExtendedAt = parseInt(localStorage.getItem(LAST_EXTENDED_SURVEY_KEY) || "0", 10);
      
      // Show extended survey at generation 2 (first time only)
      const shouldShowExtended = newCount >= 2 && !hasShownFirstExtended;
      
      // Show followup prompt at 11+ and every 9 after
      const shouldShowFollowup = newCount >= 11 && newCount - lastExtendedAt >= 9;
      
      if (shouldShowExtended) {
        setTimeout(() => {
          setSurveyMode("extended");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_EXTENDED_SURVEY_KEY, String(newCount));
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      } else if (shouldShowFollowup) {
        setTimeout(() => {
          setSurveyMode("followup");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_EXTENDED_SURVEY_KEY, String(newCount));
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      } else if (newCount - lastQuickAt >= QUICK_SURVEY_INTERVAL) {
        setTimeout(() => {
          setSurveyMode("quick");
          setShowSurvey(true);
        }, 2000);
        localStorage.setItem(LAST_QUICK_SURVEY_KEY, String(newCount));
      }
      
      if (data?.newSessionId) {
        // Set pending generation for notification if user leaves before completion
        setPendingGeneration(data.newSessionId);
        setLocation(`/results/${data.newSessionId}`);
      }
    },
    onError: (error: any) => {
      if (error.status === 402) {
        setCreditError({
          requiresSignup: error.requiresSignup || !error.isAuthenticated,
          message: error.message || "You've run out of credits."
        });
      } else if (error.isSessionLimit || error.error === "SESSION_LIMIT_REACHED") {
        toast({
          title: "Session Limit Reached",
          description: error.message || "You've reached the maximum generations for this session. Start a new session to continue.",
        });
      } else if (error.isReferencesExhausted || error.error === "NO_REFERENCES_LEFT") {
        toast({
          title: "No More References",
          description: error.message || "All available references have been used. Start a new session to explore different looks.",
        });
      } else if (error.status === 400) {
        toast({
          title: "Generation Limit",
          description: error.message || "Unable to generate more looks. Start a new session to continue.",
        });
      } else {
        toast({
          title: "Generation Failed",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  useEffect(() => {
    if (session && sessionId && !generateMutation.isPending) {
      const hasPending = session.variants.some(v => v.status === "pending");
      if (hasPending && generationInitiatedRef.current !== sessionId) {
        generationInitiatedRef.current = sessionId;
        generateMutation.mutate();
      }
    }
  }, [session, generateMutation.isPending, sessionId]);

  useEffect(() => {
    if (session?.variants?.length && !indexInitialized) {
      setCurrentVariantIndex(session.variants.length - 1);
      setIndexInitialized(true);
    }
  }, [session?.variants?.length, indexInitialized]);

  useEffect(() => {
    const currentCount = session?.variants?.length || 0;
    // Only scroll when a new variant is added (not on initial load)
    if (chatEndRef.current && prevVariantsCountRef.current > 0 && currentCount > prevVariantsCountRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
    prevVariantsCountRef.current = currentCount;
  }, [session?.variants?.length, refineMutation.isPending, polishMutation.isPending]);

  const isShowingOriginal = currentVariantIndex === -1;
  const safeIndex = currentVariantIndex >= 0 ? currentVariantIndex : 0;
  const variant = session?.variants?.[safeIndex];
  const hasMultipleVariants = (session?.variants?.length ?? 0) > 1;
  
  useEffect(() => {
    setViewAngle("front");
  }, [safeIndex]);
  
  
  const hasPaidPlan = user && (user.plan === "payg" || user.plan === "monthly" || user.plan === "business");

  const hybridVariants = session?.variants?.filter((v: any) => 
    v.renderType === "composite" || v.renderType === "ai_variant"
  ) || [];
  const isHybridMode = hybridVariants.length >= 2;

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-1 px-4 py-4 md:py-12">
          <div className="max-w-5xl mx-auto">
            <Skeleton className="h-12 w-64 mb-4" />
            <Skeleton className="h-6 w-96 mb-4 md:mb-8" />
            <div className="grid md:grid-cols-2 gap-8">
              <Skeleton className="aspect-square" />
              <Skeleton className="aspect-square" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <h2 className="font-heading font-bold text-2xl mb-3">
              Session Not Found
            </h2>
            <p className="text-muted-foreground mb-6">
              The analysis session could not be found.
            </p>
            <Button 
              onClick={() => {
                // Check if there are other sessions with results
                if (siblings && siblings.sessions.length > 0) {
                  // Go to the most recent session
                  setLocation(`/results/${siblings.sessions[0]}`);
                } else {
                  setLocation("/");
                }
              }} 
              data-testid="button-upload"
            >
              {siblings && siblings.sessions.length > 0 ? "View Results" : "Go Home"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Adaptive sizing calculations
  const isSmallScreen = screenHeight < 700; // iPhone SE, etc.
  const isTallScreen = screenHeight > 850; // Samsung Galaxy S25, etc.
  const isLargeScreen = screenHeight > 1000; // iPad Air and larger
  
  // Calculate if there's a refinement history to show
  const refinementChain = variant ? buildRefinementChain(variant, session?.variants || []) : [];
  const hasRefinementHistory = refinementChain.length > 1 || refinementChain.some(step => step.refinementPrompt);
  
  // Refinement section height - larger when showing history strip
  const refinementHistoryHeight = hasRefinementHistory ? 60 : 0;
  const refinementInputHeight = isSmallScreen ? 56 : 72;
  const refinementSectionHeight = refinementHistoryHeight + refinementInputHeight;
  // Action buttons row height (Save + Find Stylist)
  const actionButtonsHeight = isSmallScreen ? 48 : 56;
  // Bottom bar always includes refinement section + buffer for safe area
  const bottomBarHeight = refinementSectionHeight + actionButtonsHeight + 8;
  // Top padding - gives appropriate spacing from navigation
  const topPadding = isSmallScreen ? 56 : 72;
  // Image area takes remaining space
  const imageAreaHeight = screenHeight - bottomBarHeight - topPadding;

  const desktopBottomBarHeight = 80;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white">
      
      {/* Mobile back button - fixed at top with highest z-index to stay above image */}
      {(variant?.status === "completed" && variant?.generatedImageUrl) || variant?.status === "pending" || variant?.status === "processing" || variant?.status === "queued" ? (
        <button
          className="fixed left-4 top-4 z-[100] w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md md:hidden"
          onClick={() => {
            sessionStorage.setItem('lastViewedSessionId', sessionId || '');
            setLocation("/");
          }}
          data-testid="button-back-to-upload"
          title="Back to home"
        >
          <ArrowLeft className="h-5 w-5 text-black" />
        </button>
      ) : null}
      
      {/* Desktop header */}
      <div className="hidden md:flex items-center justify-between px-8 py-6 flex-shrink-0 border-b border-gray-200">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            sessionStorage.setItem('lastViewedSessionId', sessionId || '');
            setLocation("/");
          }}
          className="text-gray-700 hover:bg-gray-100 rounded-full px-4"
          data-testid="button-back-desktop"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <h1 className="font-heading font-bold text-2xl tracking-tight text-gray-900">Your new look</h1>
        <div className="w-24" />
      </div>
      
      <div className="flex-1 md:px-8 md:py-2 px-0 py-0 overflow-hidden">
        <div className="h-full md:max-w-7xl md:mx-auto flex flex-col">

          {creditError ? (
            <div className="max-w-md mx-auto flex-1 flex items-center">
              <Card className="border-destructive/50 bg-destructive/5 w-full">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="font-semibold text-destructive mb-2">
                        {creditError.requiresSignup ? "Free Trial Used Up" : "Out of Credits"}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        {creditError.message}
                      </p>
                      <div className="flex gap-2">
                        {creditError.requiresSignup ? (
                          <>
                            {/* Beta: Login hidden - just show back button */}
                            <Button 
                              variant="outline" 
                              onClick={() => {
                                // Check if there are other sessions with results
                                const completedVariants = session?.variants?.filter(v => v.status === "completed" && v.generatedImageUrl);
                                if (completedVariants && completedVariants.length > 0) {
                                  const completedIndex = session?.variants?.findIndex(v => v.status === "completed" && v.generatedImageUrl);
                                  if (completedIndex !== undefined && completedIndex >= 0) {
                                    setCurrentVariantIndex(completedIndex);
                                    setCreditError(null);
                                  }
                                } else if (siblings && siblings.sessions.length > 0) {
                                  setLocation(`/results/${siblings.sessions[0]}`);
                                } else {
                                  setLocation("/");
                                }
                              }}
                              className="flex-1"
                              data-testid="button-back"
                            >
                              {session?.variants?.some(v => v.status === "completed" && v.generatedImageUrl) || (siblings && siblings.sessions.length > 0) ? "View Results" : "Go Home"}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button 
                              onClick={() => setLocation("/pricing")}
                              className="flex-1"
                              data-testid="button-pricing"
                            >
                              <CreditCard className="h-4 w-4 mr-2" />
                              Get More Credits
                            </Button>
                            <Button 
                              variant="outline" 
                              onClick={() => {
                                // Check if there are other sessions with results
                                const completedVariants = session?.variants?.filter(v => v.status === "completed" && v.generatedImageUrl);
                                if (completedVariants && completedVariants.length > 0) {
                                  const completedIndex = session?.variants?.findIndex(v => v.status === "completed" && v.generatedImageUrl);
                                  if (completedIndex !== undefined && completedIndex >= 0) {
                                    setCurrentVariantIndex(completedIndex);
                                    setCreditError(null);
                                  }
                                } else if (siblings && siblings.sessions.length > 0) {
                                  setLocation(`/results/${siblings.sessions[0]}`);
                                } else {
                                  setLocation("/");
                                }
                              }}
                              data-testid="button-back"
                            >
                              {session?.variants?.some(v => v.status === "completed" && v.generatedImageUrl) || (siblings && siblings.sessions.length > 0) ? "View Results" : "Go Home"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : variant?.status === "queued" ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <QueueProgress 
                position={queueStatus?.position || 1}
                totalInQueue={queueStatus?.totalInQueue || 1}
                estimatedWaitSeconds={queueStatus?.estimatedWaitSeconds || 45}
              />
              {siblings && siblings.currentIndex > 0 && (
                <button
                  onClick={() => {
                    const prevSessionId = siblings.sessions[siblings.currentIndex - 1];
                    if (prevSessionId) {
                      setLocation(`/results/${prevSessionId}`);
                    }
                  }}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium mt-4"
                  data-testid="button-view-previous-results-queued"
                >
                  <History className="w-4 h-4" />
                  <span>View Results</span>
                </button>
              )}
            </div>
          ) : variant?.status === "processing" || variant?.status === "pending" ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <GenerationProgress 
                startTime={variant?.createdAt ? new Date(variant.createdAt).getTime() : Date.now()} 
                estimatedDuration={90000}
                variantId={variant?.id?.toString()}
              />
              {siblings && siblings.currentIndex > 0 && (
                <button
                  onClick={() => {
                    const prevSessionId = siblings.sessions[siblings.currentIndex - 1];
                    if (prevSessionId) {
                      setLocation(`/results/${prevSessionId}`);
                    }
                  }}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium mt-4"
                  data-testid="button-view-previous-results"
                >
                  <History className="w-4 h-4" />
                  <span>View Results</span>
                </button>
              )}
            </div>
          ) : variant?.status === "completed" && variant?.generatedImageUrl ? (
            <div className="flex-1 flex flex-col overflow-visible">
              {(
                <div className="flex-1 flex flex-col md:flex-row md:items-center md:justify-center overflow-visible md:gap-4">

                  <div className="flex-1 flex flex-col min-h-0 md:max-w-2xl relative">
                    {/* Navigation arrows - context-aware: refinement chain OR sibling sessions */}
                    {(() => {
                      const currentVariant = session?.variants?.[currentVariantIndex];
                      const isViewingRefinement = !!currentVariant?.refinementPrompt;
                      
                      // When viewing refinement: navigate within refinement chain
                      // When viewing original: navigate between sibling sessions
                      const showArrows = isViewingRefinement 
                        ? (canNavigatePrev || canNavigateNext)
                        : (siblings && siblings.total > 1);
                      
                      const canGoPrev = isViewingRefinement ? canNavigatePrev : canNavigateLeft;
                      const canGoNext = isViewingRefinement ? canNavigateNext : canNavigateRight;
                      
                      const handlePrevClick = () => {
                        if (isViewingRefinement) {
                          const prevIdx = getAdjacentNavigableIndex("prev");
                          if (prevIdx !== null) {
                            setSlideDirection(1);
                            navigateToVariant(prevIdx);
                          }
                        } else {
                          navigateToPreviousSession();
                        }
                      };
                      
                      const handleNextClick = () => {
                        if (isViewingRefinement) {
                          const nextIdx = getAdjacentNavigableIndex("next");
                          if (nextIdx !== null) {
                            setSlideDirection(-1);
                            navigateToVariant(nextIdx);
                          }
                        } else {
                          navigateToNextSession();
                        }
                      };
                      
                      if (!showArrows) return null;
                      
                      return (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canGoPrev) {
                                setSlideDirection(1);
                                handlePrevClick();
                              }
                            }}
                            disabled={!canGoPrev}
                            className={`absolute left-2 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full backdrop-blur-sm transition-all duration-200 flex items-center justify-center shadow-xl ${
                              !canGoPrev 
                                ? 'bg-black/30 cursor-not-allowed' 
                                : 'bg-black/60 hover:bg-black/80 hover:scale-110'
                            }`}
                            data-testid="button-prev-session"
                          >
                            <ChevronLeft className={`h-6 w-6 ${!canGoPrev ? 'text-white/50' : 'text-white'}`} />
                          </button>
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canGoNext) {
                                setSlideDirection(-1);
                                handleNextClick();
                              }
                            }}
                            disabled={!canGoNext}
                            className={`absolute right-2 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full backdrop-blur-sm transition-all duration-200 flex items-center justify-center shadow-xl ${
                              !canGoNext 
                                ? 'bg-black/30 cursor-not-allowed' 
                                : 'bg-black/60 hover:bg-black/80 hover:scale-110'
                            }`}
                            data-testid="button-next-session"
                          >
                            <ChevronRight className={`h-6 w-6 ${!canGoNext ? 'text-white/50' : 'text-white'}`} />
                          </button>
                        </>
                      );
                    })()}
                    
                    <motion.div 
                      className={`flex-1 relative flex items-start justify-center md:items-center overflow-visible md:pt-0 px-4 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                      initial={false}
                      animate={{ 
                        paddingTop: screenWidth >= 768 ? '16px' : `${topPadding}px`,
                        paddingBottom: screenWidth >= 768 ? '16px' : `${bottomBarHeight}px`
                      }}
                      transition={hasMounted ? { type: 'spring', stiffness: 400, damping: 35 } : { duration: 0 }}
                      onTouchStart={onTouchStart}
                      onTouchMove={onTouchMove}
                      onTouchEnd={onTouchEnd}
                      onMouseDown={onMouseDown}
                      onMouseMove={onMouseMove}
                      onMouseUp={onMouseUp}
                      onMouseLeave={onMouseLeave}
                      style={{ touchAction: 'pan-y', pointerEvents: 'auto' }}
                    >
                      <div className={`relative max-w-2xl w-full ${!hasPaidPlan ? 'protected-container' : ''}`}>
                        <AnimatePresence mode="popLayout" initial={false} custom={slideDirection}>
                          <motion.div 
                            key={`${sessionId}-${currentVariantIndex}`}
                            custom={slideDirection}
                            variants={{
                              enter: (direction: number) => ({
                                x: direction !== 0 ? `${-direction * 100}%` : 0,
                                opacity: 0
                              }),
                              center: {
                                x: 0,
                                opacity: 1
                              },
                              exit: (direction: number) => ({
                                x: direction !== 0 ? `${direction * 100}%` : 0,
                                opacity: 0
                              })
                            }}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ 
                              type: 'spring', 
                              stiffness: 300, 
                              damping: 30,
                              opacity: { duration: 0.2 }
                            }}
                            className={`h-full w-full flex ${compareMode ? 'gap-8 px-8' : ''} items-center justify-center bg-white`}
                          >
                            {compareMode && session.photoUrl && (
                              <div className="flex flex-col items-center flex-1 h-full hidden md:flex">
                                <span className="text-xs text-gray-500 mb-2 font-medium">Original</span>
                                <img
                                  src={session.photoUrl}
                                  alt="Original photo"
                                  className="flex-1 min-h-0 w-auto object-contain border border-gray-200 rounded"
                                  data-testid="img-original-compare"
                                />
                              </div>
                            )}
                            <div className={`flex flex-col items-center ${compareMode ? 'flex-1' : ''} h-full w-full relative`}>
                              {compareMode && (
                                <span className="text-xs text-gray-500 mb-2 font-medium hidden md:block">
                                  Generated
                                </span>
                              )}
                              <div 
                                className="relative w-full h-full flex items-center justify-center md:py-4"
                              >
                                {/* Heart/Save button - top left of image */}
                                {variant?.status === "completed" && variant?.generatedImageUrl && (
                                  <button
                                    onClick={() => variant?.id && toggleFavoriteMutation.mutate({ variantId: variant.id })}
                                    disabled={toggleFavoriteMutation.isPending}
                                    className="absolute top-2 left-2 md:top-6 md:left-6 z-20 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm hover:bg-white hover:scale-110 transition-all duration-200 flex items-center justify-center shadow-lg border border-white/50"
                                    data-testid="button-favorite"
                                  >
                                    {toggleFavoriteMutation.isPending ? (
                                      <Loader2 className="h-5 w-5 animate-spin text-slate-900" />
                                    ) : (
                                      <Heart 
                                        className={`h-5 w-5 transition-colors ${getEffectiveLikeState(variant?.id, variant?.isFavorited) ? 'fill-red-500 text-red-500' : 'text-slate-900'}`} 
                                      />
                                    )}
                                  </button>
                                )}
                                <img
                                  src={viewAngle === "side" && (variant as any).sideImageUrl 
                                      ? (variant as any).sideImageUrl 
                                      : variant?.generatedImageUrl}
                                  alt={`Generated hairstyle - ${viewAngle} view`}
                                  className={`${compareMode ? 'flex-1 w-auto object-contain border border-primary rounded' : 'max-w-full object-contain border border-gray-200 rounded-lg'} ${!hasPaidPlan ? 'protected-image' : ''}`}
                                  style={{ maxHeight: screenWidth >= 768 ? 'calc(100vh - 180px)' : `calc(100vh - ${bottomBarHeight + topPadding + 16}px)` }}
                                  data-testid="img-generated"
                                  onContextMenu={!hasPaidPlan ? (e) => e.preventDefault() : undefined}
                                  draggable={hasPaidPlan}
                                />
                              </div>
                            </div>
                          </motion.div>
                        </AnimatePresence>
                        
                        {/* Fixed + button - static at 65% of screen height (35% from top) */}
                        {!compareMode && (
                          <div className="fixed left-1/2 -translate-x-1/2 z-20 md:absolute md:bottom-[15%]" style={{ top: screenWidth < 768 ? '65%' : 'auto' }}>
                            {showGenerateMoreTip && (
                              <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap animate-pulse">
                                <div className="relative bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg">
                                  Tap to generate more!
                                  <div className="absolute left-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[6px] border-l-blue-500"></div>
                                </div>
                              </div>
                            )}
                            <button
                              onClick={() => {
                                if (showGenerateMoreTip) {
                                  setShowGenerateMoreTip(false);
                                  localStorage.setItem(GENERATE_MORE_TIP_KEY, 'true');
                                }
                                generateMoreMutation.mutate();
                              }}
                              disabled={generateMoreMutation.isPending}
                              className="w-12 h-12 rounded-full bg-white/90 backdrop-blur-sm hover:bg-white hover:scale-110 transition-all duration-200 flex items-center justify-center shadow-xl border border-white/50"
                              data-testid="button-generate-more-overlay"
                            >
                              {generateMoreMutation.isPending ? (
                                <Loader2 className="h-5 w-5 animate-spin text-slate-900" />
                              ) : (
                                <Plus className="h-5 w-5 text-slate-900" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                      
                      {(() => {
                        const navigable = getNavigableIndices();
                        const posInNav = navigable.indexOf(currentVariantIndex);
                        if (navigable.length <= 1 || posInNav === -1) return null;
                        
                        const currentVariant = session?.variants?.[currentVariantIndex];
                        const isRefinement = !!currentVariant?.refinementPrompt;
                        const label = isRefinement ? "Refinement" : "Look";
                        
                        return (
                          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 md:hidden">
                            <Badge variant="secondary" className="bg-black/70 text-white backdrop-blur-md text-sm px-3 py-1 border-0 shadow-lg">
                              {`${label} ${posInNav + 1} / ${navigable.length}`}
                            </Badge>
                          </div>
                        );
                      })()}
                    </motion.div>
                    
                  </div>

                  {/* Right panel for desktop - Refine your look */}
                  <div className="hidden md:flex md:flex-col md:w-64 md:flex-shrink-0 md:pl-3 md:border-l md:border-gray-200 overflow-y-auto">
                    <div className="space-y-4 py-4">
                      {/* Header with title and beta badge */}
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg text-gray-900">Refine your look</h3>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 border-amber-200">
                          Beta
                        </Badge>
                      </div>
                      
                      {/* Refinement input form - disabled for now */}
                      <div className="space-y-3 pt-2 border-t border-gray-100">
                        <textarea
                          placeholder="Coming soon..."
                          className="w-full rounded-xl h-20 bg-gray-50 border border-gray-200 text-gray-400 placeholder:text-gray-400 px-4 py-3 resize-none cursor-not-allowed text-sm"
                          data-testid="input-refinement"
                          disabled={true}
                        />
                        <Button
                          type="button"
                          size="default"
                          className="w-full rounded-full bg-gray-300 text-gray-500 cursor-not-allowed font-medium"
                          disabled={true}
                          data-testid="button-refine"
                        >
                          Apply changes
                        </Button>
                      </div>
                      
                      <div ref={chatEndRef} />
                    </div>
                  </div>

                </div>
              )}
              
              {/* Fixed desktop bottom bar */}
              <div 
                className="hidden md:flex fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-t border-gray-200 px-8 items-center justify-between"
                style={{ height: `${desktopBottomBarHeight}px` }}
              >
                <div className="flex items-center gap-4">
                  {hasPaidPlan && variant?.generatedImageUrl && (
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => {
                        const imageToDownload = viewAngle === "side" && (variant as any).sideImageUrl 
                          ? (variant as any).sideImageUrl 
                          : variant.generatedImageUrl!;
                        const link = document.createElement('a');
                        link.href = imageToDownload;
                        link.download = `auren-${variant.id}.png`;
                        link.target = '_blank';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                      className="rounded-full px-5 text-gray-700 hover:bg-gray-100"
                      data-testid="button-download-bottom"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  )}
                  {authUser && (
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => {
                        setShareDialogOpen(true);
                        setShareTitle(variant?.customPrompt || "My Hair Transformation");
                        setShareDescription("");
                        setShareSuccess(false);
                      }}
                      className="rounded-full px-5 text-gray-700 hover:bg-gray-100"
                      data-testid="button-share-to-explore"
                    >
                      <Share2 className="h-4 w-4 mr-2" />
                      Share
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => variant?.id && toggleFavoriteMutation.mutate({ variantId: variant.id })}
                    disabled={toggleFavoriteMutation.isPending}
                    className={`rounded-full px-6 font-medium ${getEffectiveLikeState(variant?.id, variant?.isFavorited) ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                    data-testid="button-save-desktop"
                  >
                    <Heart className={`h-4 w-4 mr-2 ${getEffectiveLikeState(variant?.id, variant?.isFavorited) ? 'fill-red-500 text-red-500' : ''}`} />
                    {getEffectiveLikeState(variant?.id, variant?.isFavorited) ? 'Saved' : 'Save'}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => variant?.id && toggleDislikeMutation.mutate({ variantId: variant.id })}
                    disabled={toggleDislikeMutation.isPending}
                    className={`rounded-full h-10 w-10 transition-all duration-200 ${
                      getEffectiveDislikeState(variant?.id, (variant as any)?.isDisliked)
                        ? 'bg-gradient-to-br from-rose-100 to-orange-50 border-rose-300 text-rose-600 shadow-sm' 
                        : 'border-gray-200 text-gray-400 hover:border-rose-200 hover:text-rose-400 hover:bg-rose-50'
                    }`}
                    data-testid="button-dislike-desktop"
                    title={getEffectiveDislikeState(variant?.id, (variant as any)?.isDisliked) ? "Undo feedback" : "Not my style"}
                  >
                    <ThumbsDown className={`h-4 w-4 ${getEffectiveDislikeState(variant?.id, (variant as any)?.isDisliked) ? 'stroke-[2.5]' : 'stroke-2'}`} />
                  </Button>
                  <Link 
                    href="/stylists"
                    onClick={() => {
                      if (variant?.generatedImageUrl) {
                        sessionStorage.setItem('savedTransformation', JSON.stringify({
                          id: variant.id,
                          imageUrl: variant.generatedImageUrl,
                          prompt: variant.customPrompt,
                          originalPhoto: session.photoUrl,
                          sessionId: sessionId,
                        }));
                        toast({
                          title: "Look saved!",
                          description: "Find a stylist to share your desired look with.",
                        });
                      }
                    }}
                  >
                    <Button
                      size="lg"
                      type="button"
                      className="rounded-full px-6 font-medium bg-gray-900 text-white hover:bg-gray-800"
                      data-testid="button-find-stylists"
                    >
                      Find a stylist
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>

              <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
                <DialogContent className="sm:max-w-md">
                  {shareSuccess ? (
                    <div className="text-center py-8">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 mb-4">
                        <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                      </div>
                      <DialogTitle className="mb-2">Shared Successfully!</DialogTitle>
                      <DialogDescription className="mb-6">
                        Your transformation has been shared to the Explore feed.
                      </DialogDescription>
                      <div className="flex flex-col gap-3">
                        <Button 
                          onClick={() => setLocation("/explore")}
                          data-testid="button-view-in-explore"
                        >
                          <Compass className="mr-2 h-4 w-4" />
                          View in Explore
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={() => setShareDialogOpen(false)}
                          data-testid="button-close-share-dialog"
                        >
                          Close
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <DialogHeader>
                        <DialogTitle>Share to Explore</DialogTitle>
                        <DialogDescription>
                          Share your transformation with the Auren community. Others can like, comment, and get inspired by your look!
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="flex items-center gap-4">
                          <img 
                            src={variant?.generatedImageUrl || ""} 
                            alt="Preview" 
                            className="w-20 h-20 rounded-lg object-cover"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium">Your Transformation</p>
                            <p className="text-xs text-muted-foreground">{variant?.customPrompt}</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="share-title">Title</Label>
                          <Input
                            id="share-title"
                            value={shareTitle}
                            onChange={(e) => setShareTitle(e.target.value)}
                            placeholder="Give your look a title"
                            maxLength={100}
                            data-testid="input-share-title"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="share-description">Description (optional)</Label>
                          <Textarea
                            id="share-description"
                            value={shareDescription}
                            onChange={(e) => setShareDescription(e.target.value)}
                            placeholder="Tell others about your transformation..."
                            maxLength={500}
                            rows={3}
                            data-testid="input-share-description"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setShareDialogOpen(false)}
                          data-testid="button-cancel-share"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => {
                            if (variant?.generatedImageUrl && variant?.id) {
                              shareMutation.mutate({
                                title: shareTitle || "My Hair Transformation",
                                description: shareDescription,
                                imageUrl: variant.generatedImageUrl,
                                variantId: variant.id,
                              });
                            }
                          }}
                          disabled={shareMutation.isPending || !shareTitle.trim()}
                          data-testid="button-confirm-share"
                        >
                          {shareMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Sharing...
                            </>
                          ) : (
                            <>
                              <Share2 className="mr-2 h-4 w-4" />
                              Share
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </>
                  )}
                </DialogContent>
              </Dialog>

              <Dialog open={!!creditError} onOpenChange={(open) => !open && setCreditError(null)}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <div className="flex justify-center mb-4">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
                        {(creditError as { requiresSignup: boolean } | null)?.requiresSignup ? (
                          <UserPlus className="h-8 w-8 text-primary" />
                        ) : (
                          <CreditCard className="h-8 w-8 text-primary" />
                        )}
                      </div>
                    </div>
                    <DialogTitle className="text-center">
                      {(creditError as { requiresSignup: boolean } | null)?.requiresSignup 
                        ? "Create an Account" 
                        : "Out of Credits"}
                    </DialogTitle>
                    <DialogDescription className="text-center">
                      {(creditError as { requiresSignup: boolean } | null)?.requiresSignup 
                        ? "You've used all 3 free device generations. Sign up to get 3 free generations every day!" 
                        : "You've used all your credits. Get more to continue creating amazing looks."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    {(creditError as { requiresSignup: boolean } | null)?.requiresSignup ? (
                      <>
                        {/* Beta: Hide signup prompt - just show credit info */}
                        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <span>Beta users get 25 free credits per day</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <span>Credits reset daily</span>
                          </div>
                        </div>
                        <Button 
                          className="w-full" 
                          onClick={() => {
                            // Check if there are other sessions with results
                            const completedVariants = session?.variants?.filter(v => v.status === "completed" && v.generatedImageUrl);
                            if (completedVariants && completedVariants.length > 0) {
                              const completedIndex = session?.variants?.findIndex(v => v.status === "completed" && v.generatedImageUrl);
                              if (completedIndex !== undefined && completedIndex >= 0) {
                                setCurrentVariantIndex(completedIndex);
                                setCreditError(null);
                              }
                            } else if (siblings && siblings.sessions.length > 0) {
                              setLocation(`/results/${siblings.sessions[0]}`);
                            } else {
                              setLocation("/");
                            }
                          }}
                          data-testid="button-try-again"
                        >
                          {session?.variants?.some(v => v.status === "completed" && v.generatedImageUrl) || (siblings && siblings.sessions.length > 0) ? "View Results" : "Go Home"}
                        </Button>
                        <Button 
                          variant="outline" 
                          className="w-full"
                          onClick={() => setCreditError(null)}
                          data-testid="button-dismiss-signup"
                        >
                          Close
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button 
                          className="w-full"
                          onClick={() => setLocation("/pricing")}
                          data-testid="button-get-credits"
                        >
                          <CreditCard className="mr-2 h-4 w-4" />
                          Get More Credits
                        </Button>
                        <Button 
                          variant="outline" 
                          className="w-full"
                          onClick={() => setCreditError(null)}
                          data-testid="button-dismiss-credits"
                        >
                          Close
                        </Button>
                      </>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
              
              {variant && (
                <>
                  {/* Mobile bottom bar with always-visible refinement section */}
                  <div 
                    className="fixed bottom-0 inset-x-0 z-[200] md:hidden bg-white border-t border-gray-200 pointer-events-auto"
                    data-testid="mobile-static-bottom-bar"
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                  >
                    {/* Refinement section - always visible, compact for small screens */}
                    <div 
                      className="overflow-hidden"
                      data-testid="mobile-refinement-drawer"
                    >
                      <div className={`${isSmallScreen ? 'px-3 py-2' : 'px-4 py-3'}`}>
                        {/* Refinement input with beta badge - disabled for now */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className={`text-gray-500 ${isSmallScreen ? 'text-[10px]' : 'text-xs'}`}>Refine your look</span>
                          <Badge variant="secondary" className={`${isSmallScreen ? 'text-[8px] px-1 py-0' : 'text-[10px] px-1.5 py-0.5'} bg-amber-100 text-amber-700 border-amber-200`}>
                            Beta
                          </Badge>
                        </div>
                        <div className="flex gap-2">
                          <input
                            placeholder="Coming soon..."
                            className={`flex-1 px-3 rounded-lg bg-gray-100 border-0 text-gray-400 placeholder:text-gray-400 cursor-not-allowed ${isSmallScreen ? 'py-2 text-xs' : 'py-3 text-sm'}`}
                            data-testid="input-refinement-mobile"
                            disabled={true}
                          />
                          <button
                            className={`px-3 rounded-lg bg-gray-300 text-gray-500 cursor-not-allowed ${isSmallScreen ? 'py-2' : 'py-3'}`}
                            disabled={true}
                            data-testid="button-refine-mobile"
                          >
                            <Send className={`${isSmallScreen ? 'h-4 w-4' : 'h-5 w-5'}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Action buttons row - Share + Find Stylist */}
                    <div 
                      className="flex items-center justify-between px-3 py-2 gap-3 pointer-events-auto"
                    >
                      {/* Left side buttons */}
                      <div className="flex items-center gap-2">
                        {/* Share button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleMobileShare}
                          data-testid="button-share-mobile"
                        >
                          <Share2 className="h-4 w-4 mr-1.5" />
                          Share
                        </Button>
                        
                        {/* Dislike button - thumbs down for "not my style" */}
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => variant?.id && toggleDislikeMutation.mutate({ variantId: variant.id })}
                          disabled={toggleDislikeMutation.isPending}
                          className={`rounded-full transition-all duration-200 ${
                            getEffectiveDislikeState(variant?.id, (variant as any)?.isDisliked)
                              ? 'bg-gradient-to-br from-rose-100 to-orange-50 border-rose-300 text-rose-600 shadow-sm' 
                              : 'border-gray-200 text-gray-400 hover:border-rose-200 hover:text-rose-400 hover:bg-rose-50'
                          }`}
                          data-testid="button-dislike"
                          title={getEffectiveDislikeState(variant?.id, (variant as any)?.isDisliked) ? "Undo feedback" : "Not my style"}
                        >
                          <ThumbsDown className={`h-4 w-4 ${getEffectiveDislikeState(variant?.id, (variant as any)?.isDisliked) ? 'stroke-[2.5]' : 'stroke-2'}`} />
                        </Button>
                      </div>
                      
                      {/* Find Stylist button - right side - using Link for reliable mobile touch */}
                      <Link 
                        href="/stylists"
                        onClick={() => {
                          if (variant?.generatedImageUrl) {
                            sessionStorage.setItem('savedTransformation', JSON.stringify({
                              id: variant.id,
                              imageUrl: variant.generatedImageUrl,
                              prompt: variant.customPrompt,
                              originalPhoto: session.photoUrl,
                              sessionId: sessionId,
                            }));
                          }
                        }}
                      >
                        <Button
                          size="sm"
                          type="button"
                          data-testid="button-find-stylists-collapsed"
                        >
                          <Send className="h-4 w-4 mr-1.5" />
                          Find Stylist
                        </Button>
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : variant?.status === "failed" ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="max-w-md mx-auto text-center px-4">
                <h2 className="font-heading font-bold text-2xl mb-3">
                  Generation Failed
                </h2>
                <p className="text-muted-foreground mb-6">
                  We couldn't generate your hairstyle. This might be due to image quality or API issues.
                </p>
                <Button
                  onClick={() => {
                    // Check if there are other completed generations to view
                    const completedVariants = session?.variants?.filter(v => v.status === "completed" && v.generatedImageUrl);
                    if (completedVariants && completedVariants.length > 0) {
                      // Navigate to a completed variant in this session
                      const completedIndex = session?.variants?.findIndex(v => v.status === "completed" && v.generatedImageUrl);
                      if (completedIndex !== undefined && completedIndex >= 0) {
                        setCurrentVariantIndex(completedIndex);
                      }
                    } else if (siblings && siblings.currentIndex > 0) {
                      // Go to previous session that has results
                      const prevSessionId = siblings.sessions[siblings.currentIndex - 1];
                      setLocation(`/results/${prevSessionId}`);
                    } else {
                      // No generations exist, go to homepage
                      setLocation("/");
                    }
                  }}
                  data-testid="button-try-again"
                >
                  {session?.variants?.some(v => v.status === "completed" && v.generatedImageUrl) || (siblings && siblings.currentIndex > 0) ? "View Results" : "Try Again"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center px-4">
                <p className="text-muted-foreground mb-6">
                  No result available.
                </p>
                <Button 
                  onClick={() => {
                    // Check if there are other sessions with results
                    if (siblings && siblings.currentIndex > 0) {
                      const prevSessionId = siblings.sessions[siblings.currentIndex - 1];
                      setLocation(`/results/${prevSessionId}`);
                    } else {
                      setLocation("/");
                    }
                  }} 
                  data-testid="button-upload"
                >
                  {siblings && siblings.currentIndex > 0 ? "View Results" : "Start Over"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Beta Survey Popup - shows every 5 generations */}
      <BetaSurveyPopup 
        isOpen={showSurvey} 
        onClose={() => setShowSurvey(false)}
        mode={surveyMode}
      />
    </div>
  );
}
