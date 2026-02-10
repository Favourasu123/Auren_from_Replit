import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Loader2, Heart, ArrowLeft, Trash2, ExternalLink, Clock, ThumbsDown } from "lucide-react";
import { format } from "date-fns";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SavedGeneration {
  id: string;
  sessionId: string;
  generatedImageUrl: string | null;
  customPrompt: string | null;
  sessionPhotoUrl: string | null;
  sessionPrompt: string | null;
  styleType: string | null;
  favoritedAt: string | null;
  isFavorited?: boolean;
  isDisliked?: boolean;
  createdAt: string;
}

type TabType = "saved" | "history";

export default function SavedLooks() {
  const { user: authUser, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>("saved");

  const { data: favorites = [], isLoading: favoritesLoading } = useQuery<SavedGeneration[]>({
    queryKey: ["/api/user/favorites"],
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<SavedGeneration[]>({
    queryKey: ["/api/user/history"],
  });

  const unfavoriteMutation = useMutation({
    mutationFn: async (variantId: string) => {
      const response = await fetch(`/api/variant/${variantId}/toggle-favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to remove favorite");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/history"] });
      toast({
        title: "Removed from saved",
        description: "This look has been removed from your favorites.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove. Please try again.",
        variant: "destructive",
      });
    },
  });

  const isLoading = activeTab === "saved" ? favoritesLoading : historyLoading;
  const items = activeTab === "saved" ? favorites : history;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loader" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4 pb-mobile-nav">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setLocation("/dashboard")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold" style={{ fontFamily: "DM Sans" }} data-testid="text-page-title">
              My Looks
            </h1>
            <p className="text-muted-foreground">
              {activeTab === "saved" 
                ? `${favorites.length} saved transformation${favorites.length !== 1 ? 's' : ''}`
                : `${history.length} recent generation${history.length !== 1 ? 's' : ''}`
              }
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === "saved" ? "default" : "outline"}
            onClick={() => setActiveTab("saved")}
            className="gap-2"
            data-testid="tab-saved"
          >
            <Heart className="h-4 w-4" />
            Saved ({favorites.length})
          </Button>
          <Button
            variant={activeTab === "history" ? "default" : "outline"}
            onClick={() => setActiveTab("history")}
            className="gap-2"
            data-testid="tab-history"
          >
            <Clock className="h-4 w-4" />
            History ({history.length})
          </Button>
        </div>

        {items.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              {activeTab === "saved" ? (
                <>
                  <Heart className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No saved looks yet</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    When you find a hairstyle you love, tap the heart icon to save it here for easy access later.
                  </p>
                </>
              ) : (
                <>
                  <Clock className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No generation history</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Your hairstyle transformations will appear here. Try generating your first look!
                  </p>
                </>
              )}
              <Button onClick={() => setLocation("/")} data-testid="button-try-now">
                Try a New Look
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => (
              <Card 
                key={item.id} 
                className="overflow-hidden group hover-elevate"
                data-testid={`card-look-${item.id}`}
              >
                <div className="aspect-[3/4] relative">
                  {item.generatedImageUrl ? (
                    <img
                      src={item.generatedImageUrl}
                      alt="Hairstyle"
                      className="w-full h-full object-cover"
                      data-testid={`img-look-${item.id}`}
                    />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <Heart className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  
                  {/* Status indicators */}
                  <div className="absolute top-2 left-2 flex gap-1">
                    {item.isFavorited && (
                      <div className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center">
                        <Heart className="w-4 h-4 fill-red-500 text-red-500" />
                      </div>
                    )}
                    {item.isDisliked && (
                      <div className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center">
                        <ThumbsDown className="w-4 h-4 text-slate-500" />
                      </div>
                    )}
                  </div>
                  
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="flex-1 text-xs"
                        onClick={() => setLocation(`/results/${item.sessionId}`)}
                        data-testid={`button-view-${item.id}`}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View
                      </Button>
                      {activeTab === "saved" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => unfavoriteMutation.mutate(item.id)}
                          disabled={unfavoriteMutation.isPending}
                          data-testid={`button-remove-${item.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                
                <CardContent className="p-3">
                  <p className="text-sm text-foreground truncate font-medium">
                    {item.sessionPrompt || item.customPrompt || "Custom look"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {activeTab === "saved" && item.favoritedAt
                      ? `Saved ${format(new Date(item.favoritedAt), "MMM d, yyyy")}`
                      : `Created ${format(new Date(item.createdAt), "MMM d, yyyy")}`
                    }
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
