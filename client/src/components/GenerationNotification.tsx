import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PendingGeneration {
  sessionId: string;
  startedAt: number;
}

const PENDING_GENERATION_KEY = "auren_pending_generation";

export function usePendingGeneration() {
  const setPendingGeneration = (sessionId: string) => {
    const data: PendingGeneration = {
      sessionId,
      startedAt: Date.now(),
    };
    localStorage.setItem(PENDING_GENERATION_KEY, JSON.stringify(data));
    window.dispatchEvent(new Event('pendingGenerationUpdated'));
  };

  const clearPendingGeneration = () => {
    localStorage.removeItem(PENDING_GENERATION_KEY);
    window.dispatchEvent(new Event('pendingGenerationUpdated'));
  };

  const getPendingGeneration = (): PendingGeneration | null => {
    const stored = localStorage.getItem(PENDING_GENERATION_KEY);
    if (!stored) return null;
    try {
      const data = JSON.parse(stored);
      // Clear if older than 10 minutes
      if (Date.now() - data.startedAt > 10 * 60 * 1000) {
        localStorage.removeItem(PENDING_GENERATION_KEY);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  };

  return { setPendingGeneration, clearPendingGeneration, getPendingGeneration };
}

export function GenerationNotification() {
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getPendingGeneration, clearPendingGeneration } = usePendingGeneration();
  const [pendingSession, setPendingSession] = useState<PendingGeneration | null>(null);
  const [notifiedSessions, setNotifiedSessions] = useState<Set<string>>(new Set());

  // Listen for updates to pending generation
  useEffect(() => {
    const handleUpdate = () => {
      setPendingSession(getPendingGeneration());
    };
    
    // Initial load
    handleUpdate();
    
    window.addEventListener('pendingGenerationUpdated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    
    return () => {
      window.removeEventListener('pendingGenerationUpdated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  // Poll for session status when we have a pending generation
  const { data: sessionData } = useQuery<{
    variants?: Array<{ status: string; generatedImageUrl?: string }>;
  }>({
    queryKey: ["/api/session", pendingSession?.sessionId],
    enabled: !!pendingSession?.sessionId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.variants) return 3000;
      
      const hasCompleted = data.variants.some(
        (v) => v.status === "completed" && v.generatedImageUrl
      );
      const hasPending = data.variants.some(
        (v) => v.status === "pending" || v.status === "processing" || v.status === "queued"
      );
      
      // Stop polling once we have a completed variant
      if (hasCompleted && !hasPending) return false;
      return 3000;
    },
  });

  // Check if generation is complete
  useEffect(() => {
    if (!pendingSession || !sessionData?.variants) return;

    const hasCompleted = sessionData.variants.some(
      (v) => v.status === "completed" && v.generatedImageUrl
    );
    const hasPending = sessionData.variants.some(
      (v) => v.status === "pending" || v.status === "processing" || v.status === "queued"
    );
    
    // Only clear pending generation when on results page AND generation is complete
    const isOnThisResultsPage = location.includes(`/results/${pendingSession.sessionId}`);
    if (isOnThisResultsPage && hasCompleted && !hasPending) {
      clearPendingGeneration();
      return;
    }

    // Show notification if complete, NOT on results page, and haven't already notified
    if (hasCompleted && !hasPending && !isOnThisResultsPage && !notifiedSessions.has(pendingSession.sessionId)) {
      // Capture session ID before any state changes
      const completedSessionId = pendingSession.sessionId;
      setNotifiedSessions(prev => new Set(prev).add(completedSessionId));
      
      // Show notification - user must click "View" to navigate (NO auto-redirect)
      toast({
        title: "Your look is ready!",
        description: "Tap to view your AI-generated hairstyle.",
        duration: 5000,
        action: (
          <ToastAction 
            altText="View Results" 
            onClick={() => {
              clearPendingGeneration();
              setLocation(`/results/${completedSessionId}`);
            }}
            data-testid="toast-view-results"
          >
            View
          </ToastAction>
        ),
      });
      
      // Clear the pending generation tracking (but do NOT navigate)
      clearPendingGeneration();
      
      // Invalidate queries to update any UI showing generation status
      queryClient.invalidateQueries({ queryKey: ["/api/my-generations"] });
    }
  }, [sessionData, pendingSession, location, toast, setLocation, queryClient, notifiedSessions]);

  // Show a subtle indicator when generation is in progress (optional floating badge)
  if (!pendingSession) return null;

  const isOnResultsPage = location.includes(`/results/${pendingSession.sessionId}`);
  if (isOnResultsPage) return null;

  const hasCompleted = sessionData?.variants?.some(
    (v) => v.status === "completed" && v.generatedImageUrl
  );

  if (hasCompleted) return null;

  return (
    <Button
      onClick={() => setLocation(`/results/${pendingSession.sessionId}`)}
      className="fixed bottom-20 right-4 z-50 rounded-full shadow-lg"
      data-testid="button-generation-in-progress"
    >
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      Generating...
    </Button>
  );
}
