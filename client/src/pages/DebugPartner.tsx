import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, User, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PartnerGeneration {
  id: string;
  imageUrl: string;
  userPhoto: string;
  prompt: string | null;
  styleType: string | null;
  renderType: string | null;
  inspirationPhotoUrl: string | null;
  referenceUrl: string | null;
  userEmail: string;
  userName: string;
  createdAt: string | null;
}

export default function DebugPartner() {
  const { data: generations, isLoading, error } = useQuery<PartnerGeneration[]>({
    queryKey: ["/api/debug-partner/generations"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading generations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="p-6 text-center max-w-md">
          <h2 className="text-xl font-semibold mb-2">Error Loading</h2>
          <p className="text-muted-foreground mb-4">
            Could not load partner generations.
          </p>
          <Link href="/">
            <Button>Go Home</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const favourGenerations = generations?.filter((g) => g.userName === "Favour") || [];
  const deborahGenerations = generations?.filter((g) => g.userName === "Deborah") || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b p-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Partner Generations (Debug)
            </h1>
            <p className="text-sm text-muted-foreground">
              Generations from Favour and Deborah
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 space-y-8">
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Badge variant="default" className="bg-green-600">Favour's Generations</Badge>
            <span className="text-muted-foreground text-sm">({favourGenerations.length})</span>
          </h2>
          
          {favourGenerations.length === 0 ? (
            <p className="text-muted-foreground">No generations yet</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {favourGenerations.map((gen) => (
                <GenerationCard key={gen.id} generation={gen} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Badge variant="secondary" className="bg-purple-600 text-white">Deborah's Generations</Badge>
            <span className="text-muted-foreground text-sm">({deborahGenerations.length})</span>
          </h2>
          
          {deborahGenerations.length === 0 ? (
            <p className="text-muted-foreground">No generations from Deborah yet</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {deborahGenerations.map((gen) => (
                <GenerationCard key={gen.id} generation={gen} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function GenerationCard({ generation }: { generation: PartnerGeneration }) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <Card className="overflow-hidden group" data-testid={`card-generation-${generation.id}`}>
      <div className="relative aspect-square">
        <img
          src={generation.imageUrl}
          alt="Generated hairstyle"
          className="w-full h-full object-cover"
        />
        <div className="absolute top-2 left-2">
          <Badge 
            variant="secondary" 
            className={generation.userName === "Favour" ? "bg-green-600/90 text-white" : "bg-purple-600/90 text-white"}
          >
            <User className="w-3 h-3 mr-1" />
            {generation.userName}
          </Badge>
        </div>
        {generation.inspirationPhotoUrl && (
          <div className="absolute bottom-2 right-2">
            <Badge variant="outline" className="bg-background/80 text-xs">
              Inspiration
            </Badge>
          </div>
        )}
      </div>
      
      <div className="p-3 space-y-2">
        {generation.prompt && (
          <p className="text-sm text-muted-foreground line-clamp-2" title={generation.prompt}>
            {generation.prompt}
          </p>
        )}
        
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{generation.renderType || "ai"}</span>
          <span>{formatDate(generation.createdAt)}</span>
        </div>
        
        {generation.userPhoto && (
          <div className="flex items-center gap-2 pt-2 border-t">
            <span className="text-xs text-muted-foreground">Original:</span>
            <img 
              src={generation.userPhoto} 
              alt="User photo"
              className="w-8 h-8 rounded object-cover"
            />
          </div>
        )}
      </div>
    </Card>
  );
}
