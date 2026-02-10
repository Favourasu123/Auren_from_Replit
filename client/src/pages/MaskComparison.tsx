import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, RefreshCw, Clock, Layers, Eye, CheckCircle, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface MaskResult {
  success: boolean;
  error: string | null;
  timeMs: number;
  hairPixels: number;
  facialPixels: number;
  maskedImage: string | null;
  overlayImage: string | null;
}

interface ComparisonResult {
  success: boolean;
  width: number;
  height: number;
  faceDetected: boolean;
  faceCropRegion: [number, number, number, number] | null;
  bisenet: MaskResult;
  segformer: MaskResult;
}

export default function MaskComparison() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"masked" | "overlay">("masked");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const compareMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await apiRequest("POST", "/api/debug/compare-masks", { imageUrl: url });
      return response.json() as Promise<ComparisonResult>;
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImageUrl(dataUrl);
      compareMutation.mutate(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleCompare = () => {
    if (imageUrl) {
      compareMutation.mutate(imageUrl);
    }
  };

  const result = compareMutation.data;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Mask Pipeline Comparison</h1>
            <p className="text-muted-foreground">
              Compare BiSeNet (raw pipeline - active) vs SegFormer B5 for face/hair segmentation
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
              data-testid="input-file-upload"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              data-testid="button-upload"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Photo
            </Button>
            {imageUrl && (
              <Button
                onClick={handleCompare}
                disabled={compareMutation.isPending}
                data-testid="button-compare"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${compareMutation.isPending ? 'animate-spin' : ''}`} />
                Compare
              </Button>
            )}
          </div>
        </div>

        {!imageUrl && (
          <Card>
            <CardContent className="py-16 text-center">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium mb-2">Upload a photo to compare mask pipelines</p>
              <p className="text-muted-foreground">
                See how BiSeNet (53MB) and SegFormer B5 (325MB) perform on the same image
              </p>
              <Button
                className="mt-4"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-cta"
              >
                Select Photo
              </Button>
            </CardContent>
          </Card>
        )}

        {imageUrl && (
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Original Photo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted">
                  <img
                    src={imageUrl}
                    alt="Original"
                    className="w-full h-full object-cover"
                    data-testid="img-original"
                  />
                </div>
                {result && (
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={result.faceDetected ? "default" : "destructive"}>
                        {result.faceDetected ? "Face Detected" : "No Face Found"}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">
                      {result.width} x {result.height}px
                    </p>
                    {result.faceCropRegion && (
                      <p className="text-xs text-muted-foreground font-mono">
                        Crop: [{result.faceCropRegion.join(", ")}]
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-lg flex items-center gap-2">
                    BiSeNet
                    <Badge variant="secondary">53MB</Badge>
                  </CardTitle>
                  {result?.bisenet && (
                    result.bisenet.success ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {compareMutation.isPending ? (
                  <Skeleton className="aspect-[3/4] rounded-lg" />
                ) : result?.bisenet ? (
                  result.bisenet.success && result.bisenet.maskedImage ? (
                    <>
                      <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted">
                        <img
                          src={viewMode === "masked" 
                            ? result.bisenet.maskedImage 
                            : result.bisenet.overlayImage || result.bisenet.maskedImage
                          }
                          alt="BiSeNet result"
                          className="w-full h-full object-cover"
                          data-testid="img-bisenet"
                        />
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-3 text-sm">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            {result.bisenet.timeMs}ms
                          </span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Layers className="h-4 w-4" />
                            {(result.bisenet.hairPixels / 1000).toFixed(1)}k hair
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {(result.bisenet.facialPixels / 1000).toFixed(1)}k facial pixels
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="aspect-[3/4] rounded-lg bg-destructive/10 flex flex-col items-center justify-center p-4">
                      <XCircle className="h-8 w-8 text-destructive mb-2" />
                      <p className="text-sm font-medium text-destructive">Failed</p>
                      {result.bisenet.error && (
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          {result.bisenet.error.slice(0, 100)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Time: {result.bisenet.timeMs}ms
                      </p>
                    </div>
                  )
                ) : (
                  <div className="aspect-[3/4] rounded-lg bg-muted flex items-center justify-center">
                    <p className="text-muted-foreground">Run comparison to see result</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-lg flex items-center gap-2">
                    SegFormer B5
                    <Badge variant="secondary">325MB</Badge>
                  </CardTitle>
                  {result?.segformer && (
                    result.segformer.success ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {compareMutation.isPending ? (
                  <Skeleton className="aspect-[3/4] rounded-lg" />
                ) : result?.segformer ? (
                  result.segformer.success && result.segformer.maskedImage ? (
                    <>
                      <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted">
                        <img
                          src={viewMode === "masked" 
                            ? result.segformer.maskedImage 
                            : result.segformer.overlayImage || result.segformer.maskedImage
                          }
                          alt="SegFormer result"
                          className="w-full h-full object-cover"
                          data-testid="img-segformer"
                        />
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-3 text-sm">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            {result.segformer.timeMs}ms
                          </span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Layers className="h-4 w-4" />
                            {(result.segformer.hairPixels / 1000).toFixed(1)}k hair
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {(result.segformer.facialPixels / 1000).toFixed(1)}k facial pixels
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="aspect-[3/4] rounded-lg bg-destructive/10 flex flex-col items-center justify-center p-4">
                      <XCircle className="h-8 w-8 text-destructive mb-2" />
                      <p className="text-sm font-medium text-destructive">Failed</p>
                      {result.segformer.error && (
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          {result.segformer.error.slice(0, 100)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Time: {result.segformer.timeMs}ms
                      </p>
                    </div>
                  )
                ) : (
                  <div className="aspect-[3/4] rounded-lg bg-muted flex items-center justify-center">
                    <p className="text-muted-foreground">Run comparison to see result</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {compareMutation.isError && (
          <Card className="border-destructive">
            <CardContent className="py-6 text-center">
              <XCircle className="h-8 w-8 mx-auto mb-2 text-destructive" />
              <p className="font-medium text-destructive">Comparison Failed</p>
              <p className="text-sm text-muted-foreground mt-1">
                {(compareMutation.error as Error)?.message || "An error occurred"}
              </p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={handleCompare}
                data-testid="button-retry"
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">View Options</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === "masked" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("masked")}
                  data-testid="button-view-masked"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Masked (Hair Grayed)
                </Button>
                <Button
                  variant={viewMode === "overlay" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("overlay")}
                  data-testid="button-view-overlay"
                >
                  <Layers className="h-4 w-4 mr-2" />
                  Overlay (Hair Red, Face Green)
                </Button>
              </div>
              
              {result.bisenet.success && result.segformer.success && (
                <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                  <h3 className="font-medium mb-2">Comparison Summary</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Faster Model</p>
                      <p className="font-medium">
                        {result.bisenet.timeMs < result.segformer.timeMs ? "BiSeNet" : "SegFormer"} 
                        {" "}({Math.abs(result.bisenet.timeMs - result.segformer.timeMs).toFixed(0)}ms diff)
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">More Hair Detected</p>
                      <p className="font-medium">
                        {result.bisenet.hairPixels > result.segformer.hairPixels ? "BiSeNet" : "SegFormer"}
                        {" "}({Math.abs(result.bisenet.hairPixels - result.segformer.hairPixels)} px diff)
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">BiSeNet Time</p>
                      <p className="font-medium">{result.bisenet.timeMs}ms</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">SegFormer Time</p>
                      <p className="font-medium">{result.segformer.timeMs}ms</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Model Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-2">BiSeNet (Current)</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>Model Size: 53MB</li>
                  <li>Architecture: Bilateral Segmentation Network</li>
                  <li>Training: CelebAMask-HQ (ResNet18 backbone)</li>
                  <li>Input: 512x512 fixed</li>
                  <li>Classes: 19 face parsing labels</li>
                  <li>Speed: Fast (~200-400ms multi-scale)</li>
                </ul>
              </div>
              <div>
                <h3 className="font-medium mb-2">SegFormer B5</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>Model Size: 325MB</li>
                  <li>Architecture: Transformer (MIT-B5 backbone)</li>
                  <li>Training: CelebAMask-HQ (fine-tuned)</li>
                  <li>Input: Dynamic resolution</li>
                  <li>Classes: 19 face parsing labels</li>
                  <li>Speed: Slower (~500-1000ms multi-scale)</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
