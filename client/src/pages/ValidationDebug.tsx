import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, CheckCircle, XCircle, AlertTriangle, Image, ToggleLeft, ToggleRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ValidationResult {
  timestamp: string;
  processingTimeMs: number;
  dimensions: { width: number; height: number };
  maskCreated: boolean;
  userMaskBase64: string | null;
  rawMaskBase64: string | null;
  maskValidation: {
    valid: boolean;
    score: number;
    issues: string[];
  } | null;
  photoQuality: {
    valid: boolean;
    issues: string[];
    guidance: string;
    metrics: Record<string, any>;
  } | null;
  overallValid: boolean;
}

export default function ValidationDebug() {
  const [photoUrl, setPhotoUrl] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [showRawMask, setShowRawMask] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateMutation = useMutation({
    mutationFn: async (data: { photoUrl: string }) => {
      const response = await apiRequest("POST", "/api/debug-validate-photo", data);
      return await response.json() as ValidationResult;
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setPreviewUrl(result);
        setPhotoUrl(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const runValidation = () => {
    if (photoUrl) {
      validateMutation.mutate({ photoUrl });
    }
  };

  const result = validateMutation.data;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Photo Validation Debug</h1>
          <Badge variant="outline">Testing Only</Badge>
        </div>

        <Card className="bg-muted/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Image className="w-5 h-5 mt-0.5 text-primary" />
              <div className="space-y-1">
                <p className="font-medium">Raw Mask Pipeline (Active)</p>
                <p className="text-sm text-muted-foreground">
                  Multi-scale BiSeNet segmentation [512, 768, 1024] → Direct hair pixel gray-out. 
                  No buffer, no hairline extension, no guided filter. Simple and accurate.
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant="secondary">Multi-scale BiSeNet</Badge>
                  <Badge variant="secondary">No Post-processing</Badge>
                  <Badge variant="secondary">Neck Preserved</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload Photo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-debug-photo"
              />
              
              <Button 
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full h-20"
                data-testid="button-upload-debug"
              >
                {previewUrl ? "Change Photo" : "Select Photo"}
              </Button>

              {previewUrl && (
                <div className="space-y-4">
                  <div className="aspect-[3/4] max-h-80 mx-auto rounded-lg overflow-hidden border">
                    <img 
                      src={previewUrl} 
                      alt="Preview" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  
                  <Button 
                    onClick={runValidation}
                    disabled={validateMutation.isPending}
                    className="w-full"
                    data-testid="button-run-validation"
                  >
                    {validateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      "Run Validation"
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {result.overallValid ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  Validation Result
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Overall Status</span>
                  <Badge variant={result.overallValid ? "default" : "destructive"}>
                    {result.overallValid ? "PASSED" : "FAILED"}
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Processing Time</span>
                  <span>{result.processingTimeMs}ms</span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Dimensions</span>
                  <span>{result.dimensions.width} × {result.dimensions.height}</span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Mask Created</span>
                  <Badge variant={result.maskCreated ? "default" : "destructive"}>
                    {result.maskCreated ? "Yes" : "No"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {result && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="w-5 h-5" />
                  Mask Validation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.maskValidation ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Valid</span>
                      <Badge variant={result.maskValidation.valid ? "default" : "destructive"}>
                        {result.maskValidation.valid ? "Yes" : "No"}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Score</span>
                      <span>{result.maskValidation.score?.toFixed(2) || "N/A"}</span>
                    </div>
                    
                    {result.maskValidation.issues.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-muted-foreground text-sm">Issues:</span>
                        <div className="space-y-1">
                          {result.maskValidation.issues.map((issue, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm bg-yellow-500/10 p-2 rounded">
                              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                              <span>{issue}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">No mask validation data</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Photo Quality (BiSeNet)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.photoQuality ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Valid</span>
                      <Badge variant={result.photoQuality.valid ? "default" : "destructive"}>
                        {result.photoQuality.valid ? "Yes" : "No"}
                      </Badge>
                    </div>
                    
                    {result.photoQuality.issues.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-muted-foreground text-sm">Issues:</span>
                        <div className="space-y-1">
                          {result.photoQuality.issues.map((issue, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm bg-red-500/10 p-2 rounded">
                              <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                              <span>{issue}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {result.photoQuality.guidance && (
                      <div className="text-sm bg-blue-500/10 p-3 rounded">
                        <strong>Guidance:</strong> {result.photoQuality.guidance}
                      </div>
                    )}
                    
                    {result.photoQuality.metrics && Object.keys(result.photoQuality.metrics).length > 0 && (
                      <div className="space-y-2">
                        <span className="text-muted-foreground text-sm">Metrics:</span>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {Object.entries(result.photoQuality.metrics).map(([key, value]) => (
                            <div key={key} className="flex justify-between bg-muted/50 p-2 rounded">
                              <span className="text-muted-foreground">{key}</span>
                              <span className="font-mono">{typeof value === 'number' ? value.toFixed(2) : String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">No photo quality data</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {result && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Original Photo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="aspect-[3/4] rounded-lg overflow-hidden border bg-muted">
                  <img 
                    src={previewUrl} 
                    alt="Original" 
                    className="w-full h-full object-cover"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle>Generated Mask (Hair Removed)</CardTitle>
                  {result.rawMaskBase64 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRawMask(!showRawMask)}
                      data-testid="button-toggle-mask-view"
                    >
                      {showRawMask ? (
                        <>
                          <ToggleRight className="h-4 w-4 mr-2" />
                          Raw
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="h-4 w-4 mr-2" />
                          Processed
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {result.rawMaskBase64 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {showRawMask 
                      ? "Showing raw BiSeNet segmentation (no post-processing)" 
                      : "Showing processed mask (with buffer, hairline, guided filter)"}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <div className="aspect-[3/4] rounded-lg overflow-hidden border bg-muted">
                  {(showRawMask ? result.rawMaskBase64 : result.userMaskBase64) ? (
                    <img 
                      src={showRawMask ? result.rawMaskBase64! : result.userMaskBase64!} 
                      alt={showRawMask ? "Raw Mask" : "User Mask"} 
                      className="w-full h-full object-cover"
                      data-testid="img-generated-mask"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      No mask generated
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
