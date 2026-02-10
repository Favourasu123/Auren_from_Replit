import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Wand2, Camera, Upload, Sparkles, User, Clock, Calendar,
  ChevronRight, ArrowLeft, Image, Check, Loader2, Play,
  MessageSquare, Star, TrendingUp, Eye, Send, Plus, X,
  Scissors, Palette, Zap, History, BookOpen, Users, BarChart3
} from "lucide-react";

interface Appointment {
  id: string;
  userId: string;
  scheduledAt: string;
  status: string;
  notes: string | null;
  totalPrice: number;
  user?: { firstName: string; lastName: string; email: string; profileImageUrl: string | null };
  service?: { name: string };
}

interface ClientPreview {
  id: string;
  clientName: string;
  clientPhoto: string;
  generatedImage: string;
  styleDescription: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'completed';
  notes?: string;
}

export default function StylistWorkMode() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [activeTab, setActiveTab] = useState("generate");
  const [clientPhotoUrl, setClientPhotoUrl] = useState("");
  const [clientPhotoPreview, setClientPhotoPreview] = useState("");
  const [stylePrompt, setStylePrompt] = useState("");
  const [clientName, setClientName] = useState("");
  const [consultationNotes, setConsultationNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState<string | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);

  // Check for preview mode
  const urlParams = new URLSearchParams(window.location.search);
  const isPreviewMode = urlParams.get('preview') === 'true';

  const { data: business } = useQuery<any>({
    queryKey: ["/api/business/mine"],
    enabled: !!user && !isPreviewMode,
  });

  const { data: todayAppointments = [] } = useQuery<Appointment[]>({
    queryKey: ["/api/business", business?.id, "bookings/today"],
    enabled: !!business?.id && !isPreviewMode,
  });

  // Mock data for preview mode
  const mockAppointments: Appointment[] = [
    {
      id: "apt1",
      userId: "u1",
      scheduledAt: new Date().toISOString(),
      status: "confirmed",
      notes: "Wants a modern fade with texture on top",
      totalPrice: 45,
      user: { firstName: "Marcus", lastName: "Johnson", email: "marcus@example.com", profileImageUrl: null },
      service: { name: "Men's Haircut" }
    },
    {
      id: "apt2",
      userId: "u2",
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      status: "confirmed",
      notes: "Consultation for balayage",
      totalPrice: 120,
      user: { firstName: "Sarah", lastName: "Chen", email: "sarah@example.com", profileImageUrl: null },
      service: { name: "Color & Highlights" }
    },
    {
      id: "apt3",
      userId: "u3",
      scheduledAt: new Date(Date.now() + 7200000).toISOString(),
      status: "pending",
      notes: null,
      totalPrice: 55,
      user: { firstName: "Emily", lastName: "Rodriguez", email: "emily@example.com", profileImageUrl: null },
      service: { name: "Women's Haircut" }
    },
  ];

  const mockPreviews: ClientPreview[] = [
    {
      id: "p1",
      clientName: "Marcus Johnson",
      clientPhoto: "/api/placeholder/150",
      generatedImage: "/api/placeholder/300",
      styleDescription: "Modern textured fade with longer top",
      createdAt: new Date().toISOString(),
      status: "approved",
      notes: "Client loved this look, proceeding with cut"
    },
    {
      id: "p2",
      clientName: "Sarah Chen",
      clientPhoto: "/api/placeholder/150",
      generatedImage: "/api/placeholder/300",
      styleDescription: "Honey blonde balayage with face framing highlights",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      status: "completed"
    },
  ];

  const displayAppointments = isPreviewMode ? mockAppointments : todayAppointments;

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setClientPhotoPreview(base64);
        setClientPhotoUrl(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const generatePreview = async () => {
    if (!clientPhotoUrl || !stylePrompt) {
      toast({
        title: "Missing information",
        description: "Please upload a client photo and describe the desired style",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    
    // Simulate generation for preview mode
    if (isPreviewMode) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      setGeneratedPreview(clientPhotoPreview);
      setIsGenerating(false);
      setShowPreviewDialog(true);
      toast({
        title: "Preview Generated!",
        description: "AI visualization ready to show your client"
      });
      return;
    }

    try {
      const response = await apiRequest("POST", "/api/generate-preview", {
        photoUrl: clientPhotoUrl,
        prompt: stylePrompt,
        clientName,
        notes: consultationNotes
      });
      const result = await response.json();
      setGeneratedPreview(result.imageUrl);
      setShowPreviewDialog(true);
      toast({
        title: "Preview Generated!",
        description: "AI visualization ready to show your client"
      });
    } catch (error) {
      toast({
        title: "Generation failed",
        description: "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const quickStyles = [
    { label: "Modern Fade", prompt: "Clean modern fade haircut with textured top, professional styling" },
    { label: "Textured Crop", prompt: "Short textured crop with natural movement and easy styling" },
    { label: "Classic Taper", prompt: "Classic tapered sides with neat, professional finish" },
    { label: "Long Layers", prompt: "Flowing long layers with soft movement and face-framing pieces" },
    { label: "Bob Cut", prompt: "Sleek modern bob with clean lines and polished finish" },
    { label: "Balayage", prompt: "Natural sun-kissed balayage highlights with seamless blending" },
  ];

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'pending': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      case 'completed': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/business/workspace">
              <Button variant="ghost" size="icon" data-testid="button-back-workspace">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Wand2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg">Work Mode</h1>
                <p className="text-xs text-muted-foreground">AI-Powered Styling</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-violet-600 border-violet-300 dark:text-violet-400">
              <Sparkles className="h-3 w-3 mr-1" />
              Pro Tools Active
            </Badge>
          </div>
        </div>
        
        {isPreviewMode && (
          <div className="bg-amber-500 text-white text-center py-1.5 px-4 text-sm font-medium">
            Preview Mode - Showing sample data
          </div>
        )}
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Content - AI Generation */}
          <div className="lg:col-span-2 space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="generate" className="flex items-center gap-2" data-testid="tab-generate">
                  <Wand2 className="h-4 w-4" />
                  Generate
                </TabsTrigger>
                <TabsTrigger value="history" className="flex items-center gap-2" data-testid="tab-history">
                  <History className="h-4 w-4" />
                  History
                </TabsTrigger>
                <TabsTrigger value="inspiration" className="flex items-center gap-2" data-testid="tab-inspiration">
                  <BookOpen className="h-4 w-4" />
                  Inspiration
                </TabsTrigger>
              </TabsList>

              <TabsContent value="generate" className="space-y-6 mt-6">
                {/* Client Photo Upload */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Camera className="h-5 w-5 text-primary" />
                      Client Photo
                    </CardTitle>
                    <CardDescription>Upload or take a photo of your client</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4">
                      <div 
                        className="w-32 h-32 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors overflow-hidden bg-muted/30"
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="upload-client-photo"
                      >
                        {clientPhotoPreview ? (
                          <img src={clientPhotoPreview} alt="Client" className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center p-2">
                            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-1" />
                            <span className="text-xs text-muted-foreground">Upload Photo</span>
                          </div>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoUpload}
                      />
                      <div className="flex-1 space-y-3">
                        <div>
                          <Label htmlFor="clientName">Client Name (optional)</Label>
                          <Input 
                            id="clientName"
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                            placeholder="For your records"
                            data-testid="input-client-name"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1" data-testid="button-camera">
                            <Camera className="h-4 w-4 mr-1" />
                            Camera
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-photo">
                            <Upload className="h-4 w-4 mr-1" />
                            Upload
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Style Description */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Palette className="h-5 w-5 text-primary" />
                      Describe the Style
                    </CardTitle>
                    <CardDescription>What look does your client want?</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea
                      value={stylePrompt}
                      onChange={(e) => setStylePrompt(e.target.value)}
                      placeholder="Describe the hairstyle in detail... e.g., 'Modern textured fade with 2 inches on top, tapered sides, natural movement'"
                      className="min-h-[100px]"
                      data-testid="input-style-prompt"
                    />
                    
                    <div>
                      <p className="text-sm font-medium mb-2">Quick Styles</p>
                      <div className="flex flex-wrap gap-2">
                        {quickStyles.map((style) => (
                          <Button
                            key={style.label}
                            variant="outline"
                            size="sm"
                            onClick={() => setStylePrompt(style.prompt)}
                            className="text-xs"
                            data-testid={`quick-style-${style.label.toLowerCase().replace(' ', '-')}`}
                          >
                            {style.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Consultation Notes */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      Consultation Notes
                    </CardTitle>
                    <CardDescription>Add notes from your conversation</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={consultationNotes}
                      onChange={(e) => setConsultationNotes(e.target.value)}
                      placeholder="Hair texture, previous treatments, lifestyle considerations, maintenance preferences..."
                      className="min-h-[80px]"
                      data-testid="input-consultation-notes"
                    />
                  </CardContent>
                </Card>

                {/* Generate Button */}
                <Button 
                  size="lg" 
                  className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                  onClick={generatePreview}
                  disabled={isGenerating || !clientPhotoUrl || !stylePrompt}
                  data-testid="button-generate-preview"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Generating AI Preview...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-5 w-5 mr-2" />
                      Generate AI Preview
                    </>
                  )}
                </Button>

                {isGenerating && (
                  <Card className="border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20">
                    <CardContent className="py-6">
                      <div className="text-center space-y-3">
                        <div className="flex items-center justify-center gap-2">
                          <Sparkles className="h-5 w-5 text-violet-500 animate-pulse" />
                          <span className="font-medium text-violet-700 dark:text-violet-300">AI is crafting the visualization...</span>
                        </div>
                        <Progress value={66} className="h-2 max-w-xs mx-auto" />
                        <p className="text-sm text-muted-foreground">This typically takes 10-20 seconds</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="history" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Recent Previews</CardTitle>
                    <CardDescription>Visualizations you've created for clients</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {mockPreviews.map((preview) => (
                        <div key={preview.id} className="flex gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors" data-testid={`preview-item-${preview.id}`}>
                          <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                            <div className="w-full h-full bg-gradient-to-br from-violet-200 to-purple-200 dark:from-violet-900 dark:to-purple-900 flex items-center justify-center">
                              <Image className="h-6 w-6 text-violet-500" />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium" data-testid={`text-client-name-${preview.id}`}>{preview.clientName}</span>
                              <Badge variant="secondary" className={`text-xs ${
                                preview.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                preview.status === 'completed' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                ''
                              }`} data-testid={`badge-status-${preview.id}`}>
                                {preview.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground truncate" data-testid={`text-style-desc-${preview.id}`}>{preview.styleDescription}</p>
                            {preview.notes && (
                              <p className="text-xs text-muted-foreground mt-1 italic">{preview.notes}</p>
                            )}
                          </div>
                          <Button variant="ghost" size="icon" data-testid={`button-view-preview-${preview.id}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="inspiration" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Style Inspiration Library</CardTitle>
                    <CardDescription>Browse trending styles and save favorites</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {['Modern Fade', 'Textured Crop', 'Classic Taper', 'Long Layers', 'Balayage', 'Pixie Cut'].map((style, i) => (
                        <div key={style} className="aspect-square rounded-lg bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary transition-all" data-testid={`inspiration-card-${style.toLowerCase().replace(' ', '-')}`}>
                          <div className="text-center p-2">
                            <Scissors className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                            <span className="text-sm font-medium">{style}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar - Today's Queue */}
          <div className="space-y-6">
            {/* Today's Stats */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Today's Stats
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                    <div className="text-2xl font-bold text-green-600" data-testid="stat-appointments-count">{displayAppointments.length}</div>
                    <div className="text-xs text-muted-foreground">Appointments</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-violet-50 dark:bg-violet-900/20">
                    <div className="text-2xl font-bold text-violet-600" data-testid="stat-previews-count">{mockPreviews.length}</div>
                    <div className="text-xs text-muted-foreground">Previews</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Today's Queue */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  Today's Queue
                </CardTitle>
                <CardDescription>
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-3">
                    {displayAppointments.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Calendar className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No appointments today</p>
                      </div>
                    ) : (
                      displayAppointments.map((apt) => (
                        <div 
                          key={apt.id} 
                          className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer"
                          data-testid={`appointment-${apt.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={apt.user?.profileImageUrl || undefined} />
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {apt.user?.firstName?.[0]}{apt.user?.lastName?.[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm" data-testid={`text-apt-client-${apt.id}`}>
                                  {apt.user?.firstName} {apt.user?.lastName}
                                </span>
                                <Badge className={`text-xs ${getStatusColor(apt.status)}`} data-testid={`badge-apt-status-${apt.id}`}>
                                  {apt.status}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground" data-testid={`text-apt-service-${apt.id}`}>{apt.service?.name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground" data-testid={`text-apt-time-${apt.id}`}>{formatTime(apt.scheduledAt)}</span>
                              </div>
                              {apt.notes && (
                                <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2" data-testid={`text-apt-notes-${apt.id}`}>"{apt.notes}"</p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="flex-1 text-xs"
                              onClick={() => {
                                setClientName(`${apt.user?.firstName} ${apt.user?.lastName}`);
                                if (apt.notes) setStylePrompt(apt.notes);
                                setActiveTab("generate");
                              }}
                              data-testid={`button-generate-for-${apt.id}`}
                            >
                              <Wand2 className="h-3 w-3 mr-1" />
                              Generate Preview
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start" data-testid="action-walk-in">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Walk-in Client
                </Button>
                <Button variant="outline" className="w-full justify-start" data-testid="action-view-portfolio">
                  <Image className="h-4 w-4 mr-2" />
                  View My Portfolio
                </Button>
                <Button variant="outline" className="w-full justify-start" data-testid="action-analytics">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Performance Analytics
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-500" />
              AI Generated Preview
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-2">Original</p>
                <div className="aspect-square rounded-lg overflow-hidden bg-muted">
                  {clientPhotoPreview && (
                    <img src={clientPhotoPreview} alt="Original" className="w-full h-full object-cover" />
                  )}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">AI Preview</p>
                <div className="aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30">
                  {generatedPreview ? (
                    <img src={generatedPreview} alt="Generated" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Sparkles className="h-12 w-12 text-violet-300" />
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium mb-1">Style Description</p>
              <p className="text-sm text-muted-foreground" data-testid="text-dialog-style-desc">{stylePrompt}</p>
            </div>

            {clientName && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm font-medium mb-1">Client</p>
                <p className="text-sm text-muted-foreground" data-testid="text-dialog-client-name">{clientName}</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPreviewDialog(false)} data-testid="button-close-dialog">
              Close
            </Button>
            <Button variant="outline" data-testid="button-send-to-client">
              <Send className="h-4 w-4 mr-2" />
              Send to Client
            </Button>
            <Button className="bg-gradient-to-r from-violet-600 to-purple-600" data-testid="button-save-portfolio">
              <Check className="h-4 w-4 mr-2" />
              Save to Portfolio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
