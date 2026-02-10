import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ExternalLink, Image, User, Sparkles, Info, Layers } from "lucide-react";

interface SessionData {
  id: string;
  photoUrl: string;
  customPrompt: string | null;
  hairstyleDescription: string | null;
  facialFeatures: string | null;
  rankedReferences: { url: string; source: string }[] | null;
  usedReferenceIndex: number | null;
  rootSessionId: string | null;
  createdAt: string;
}

interface VariantData {
  id: number;
  sessionId: string;
  customPrompt: string | null;
  generatedImageUrl: string | null;
  sideImageUrl: string | null;
  webReferenceImageUrl: string | null;
  webReferenceSource: string | null;
  inspirationPhotoUrl: string | null;
  referenceIndex: number | null;
  compositeData: string | null;
  status: string;
  createdAt: string;
}

interface CompositeDebugData {
  userMaskUrl?: string;
  refHairMaskUrl?: string;
}

interface SiblingsData {
  sessions: string[];
  currentIndex: number;
  total: number;
}

interface UsedReference {
  url: string;
  source: string | null;
  generationIndex: number;
  sessionId: string;
}

function proxyImageUrl(url: string): string {
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

function AllUsedReferences({ siblings }: { siblings: SiblingsData }) {
  const variantQueries = siblings.sessions.map((sid, index) => ({
    queryKey: ['/api/session', sid, 'variants'],
    sessionId: sid,
    index,
  }));

  const results = variantQueries.map(q => 
    useQuery<VariantData[]>({ queryKey: q.queryKey })
  );

  const isLoading = results.some(r => r.isLoading);
  
  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const usedRefs: UsedReference[] = [];
  results.forEach((result, idx) => {
    const variant = result.data?.[0];
    if (variant?.webReferenceImageUrl) {
      usedRefs.push({
        url: variant.webReferenceImageUrl,
        source: variant.webReferenceSource,
        generationIndex: idx,
        sessionId: siblings.sessions[idx],
      });
    }
  });

  if (usedRefs.length === 0) {
    return <p className="text-sm text-muted-foreground">No reference images used yet</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">All Used Reference Images ({usedRefs.length}):</p>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {usedRefs.map((ref, i) => (
          <div key={ref.sessionId} className="space-y-1">
            <div className="aspect-[3/4] rounded overflow-hidden border-2 border-primary bg-muted">
              <img
                src={proxyImageUrl(ref.url)}
                alt={`Used ref ${i + 1}`}
                className="w-full h-full object-cover"
                data-testid={`img-used-ref-${i}`}
              />
            </div>
            <p className="text-xs text-center font-medium">Gen #{ref.generationIndex + 1}</p>
            {ref.source && (
              <p className="text-[10px] text-muted-foreground truncate text-center" title={ref.source}>
                {ref.source}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenerationCard({ sessionId, index }: { sessionId: string; index: number }) {
  const { data: session, isLoading: sessionLoading } = useQuery<SessionData>({
    queryKey: ['/api/session', sessionId],
  });

  const { data: variants, isLoading: variantsLoading } = useQuery<VariantData[]>({
    queryKey: ['/api/session', sessionId, 'variants'],
  });

  if (sessionLoading || variantsLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!session) return null;

  const variant = variants?.[0];
  const features = session.facialFeatures ? JSON.parse(session.facialFeatures) : {};
  
  // Parse compositeData for inspiration mode masks
  let debugData: CompositeDebugData | null = null;
  if (variant?.compositeData) {
    try {
      debugData = JSON.parse(variant.compositeData) as CompositeDebugData;
    } catch (e) {
      console.warn("Failed to parse compositeData:", e);
    }
  }
  const isInspirationMode = !!variant?.inspirationPhotoUrl;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2">
            Generation #{index + 1}
            {index === 0 && <Badge variant="secondary">Original</Badge>}
          </CardTitle>
          <Badge variant={variant?.status === 'completed' ? 'default' : 'destructive'}>
            {variant?.status || 'unknown'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">{sessionId}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`grid gap-3 ${isInspirationMode ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" /> User Photo
            </p>
            <div className="aspect-[3/4] bg-muted rounded overflow-hidden">
              <img
                src={session.photoUrl}
                alt="User"
                className="w-full h-full object-cover"
                data-testid={`img-user-photo-${index}`}
              />
            </div>
          </div>

          {debugData?.userMaskUrl && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" /> User Mask
              </p>
              <div className="aspect-[3/4] bg-muted rounded overflow-hidden">
                <img
                  src={debugData.userMaskUrl}
                  alt="User Mask"
                  className="w-full h-full object-cover"
                  data-testid={`img-user-mask-${index}`}
                />
              </div>
              <Badge variant="outline" className="text-[10px]">Face Only (Hair+BG Gray)</Badge>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Image className="h-3 w-3" /> {isInspirationMode ? "Inspiration" : "Reference"}
            </p>
            <div className="aspect-[3/4] bg-muted rounded overflow-hidden">
              {variant?.inspirationPhotoUrl ? (
                <img
                  src={variant.inspirationPhotoUrl}
                  alt="Inspiration"
                  className="w-full h-full object-cover"
                  data-testid={`img-inspiration-${index}`}
                />
              ) : variant?.webReferenceImageUrl ? (
                <img
                  src={proxyImageUrl(variant.webReferenceImageUrl)}
                  alt="Reference"
                  className="w-full h-full object-cover"
                  data-testid={`img-reference-${index}`}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                  No ref
                </div>
              )}
            </div>
            {variant?.webReferenceSource && !isInspirationMode && (
              <p className="text-[10px] text-muted-foreground truncate" title={variant.webReferenceSource}>
                {variant.webReferenceSource}
              </p>
            )}
            {isInspirationMode && (
              <Badge variant="outline" className="text-[10px]">Inspiration Mode</Badge>
            )}
          </div>

          {isInspirationMode && debugData?.refHairMaskUrl && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Image className="h-3 w-3" /> Ref Hair Mask
              </p>
              <div className="aspect-[3/4] bg-muted rounded overflow-hidden">
                <img
                  src={debugData.refHairMaskUrl}
                  alt="Reference Hair Mask"
                  className="w-full h-full object-cover"
                  data-testid={`img-ref-mask-${index}`}
                />
              </div>
              <Badge variant="outline" className="text-[10px]">Hair Only</Badge>
            </div>
          )}

          <div className="space-y-1 col-span-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Result
            </p>
            <div className="aspect-[3/4] bg-muted rounded overflow-hidden">
              {variant?.generatedImageUrl ? (
                <img
                  src={variant.generatedImageUrl}
                  alt="Generated"
                  className="w-full h-full object-cover"
                  data-testid={`img-result-${index}`}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                  Pending...
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Ref #{(variant?.referenceIndex ?? 0) + 1}</Badge>
            {features.gender && <Badge variant="outline">{features.gender}</Badge>}
            {features.raceEthnicity && <Badge variant="outline">{features.raceEthnicity}</Badge>}
            {features.skinTone && <Badge variant="outline">{features.skinTone} skin</Badge>}
            {features.faceShape && <Badge variant="outline">{features.faceShape} face</Badge>}
            {features.faceAngle && <Badge variant="outline">{features.faceAngle} angle</Badge>}
          </div>

          <div className="bg-muted/50 rounded p-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">Prompt:</p>
            <p className="text-sm">{session.hairstyleDescription || session.customPrompt || 'N/A'}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Link href={`/results/${sessionId}`}>
            <Button size="sm" variant="outline" data-testid={`link-view-result-${index}`}>
              <ExternalLink className="h-3 w-3 mr-1" />
              View Result
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Debug() {
  const { id } = useParams<{ id: string }>();

  const { data: session, isLoading: sessionLoading } = useQuery<SessionData>({
    queryKey: ['/api/session', id],
    enabled: !!id,
  });

  const { data: siblings, isLoading: siblingsLoading } = useQuery<SiblingsData>({
    queryKey: ['/api/session', id, 'siblings'],
    enabled: !!id,
    refetchInterval: 5000, // Refetch every 5s to show new generate-more results
  });

  if (!id) {
    return (
      <div className="min-h-screen bg-background p-6">
        <p className="text-muted-foreground">No session ID provided</p>
      </div>
    );
  }

  const isLoading = sessionLoading || siblingsLoading;
  const rankedRefs = session?.rankedReferences || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href={`/results/${id}`}>
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Generation Debug</h1>
            <p className="text-xs text-muted-foreground font-mono">{id}</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2].map(i => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-48 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            <Card className="bg-muted/30 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  Active Pipeline Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Two-Stage Kontext Refined Pipeline</p>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p><strong>Stage 1:</strong> Kontext Pro (ref photo + user face mask → initial hairstyle)</p>
                      <p><strong>Stage 2:</strong> FLUX 2 Pro (user mask + hair mask from Stage 1 + user photo)</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Mask Pipeline Settings</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">Multi-scale BiSeNet [512, 768, 1024]</Badge>
                      <Badge variant="secondary" className="text-[10px]">Raw Mode (No Buffer)</Badge>
                      <Badge variant="secondary" className="text-[10px]">Gray Out Background</Badge>
                      <Badge variant="secondary" className="text-[10px]">Neck Preserved</Badge>
                      <Badge variant="secondary" className="text-[10px]">Ref Sharpened Only</Badge>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground border-t pt-3">
                  <p className="flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    User mask grays out hair + background, keeping only face visible. Kontext result is NOT sharpened to preserve natural texture.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Session Family Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge>Total Generations: {siblings?.total || 1}</Badge>
                  <Badge variant="outline">Ranked References: {rankedRefs.length}</Badge>
                  <Badge variant="outline">Used: {(session?.usedReferenceIndex ?? 0) + 1}</Badge>
                  <Badge variant="outline">Remaining: {Math.max(0, rankedRefs.length - (session?.usedReferenceIndex ?? 0) - 1)}</Badge>
                </div>
                
                {siblings && (
                  <AllUsedReferences siblings={siblings} />
                )}

                {rankedRefs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">All Ranked References (Pool):</p>
                    <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
                      {rankedRefs.map((ref, i) => (
                        <div
                          key={i}
                          className={`aspect-square rounded overflow-hidden border-2 ${
                            i <= (session?.usedReferenceIndex ?? 0) ? 'border-primary' : 'border-transparent opacity-50'
                          }`}
                          title={`#${i + 1}: ${ref.source}`}
                        >
                          <img
                            src={proxyImageUrl(ref.url)}
                            alt={`Ref ${i + 1}`}
                            className="w-full h-full object-cover"
                            data-testid={`img-ranked-ref-${i}`}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Highlighted = used, Faded = available for generate-more
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              {siblings?.sessions.map((sid, index) => (
                <GenerationCard key={sid} sessionId={sid} index={index} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
