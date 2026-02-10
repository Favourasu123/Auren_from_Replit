import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, MessageSquare, Calendar, Sparkles, Download, Shield, TrendingUp, AlertCircle, CheckCircle, Heart, LogIn, Star, ThumbsDown, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

interface AdminOverview {
  totalUsers: number;
  totalFeedback: number;
  totalBookings: number;
  totalGenerations: number;
  totalFavorites: number;
  totalDislikes: number;
  totalDevices: number;
  usersLast24h: number;
  generationsLast24h: number;
  generationMetrics: {
    totalRequests: number;
    successfulGenerations: number;
    failedGenerations: number;
    successRate?: string;
    averageGenerationTimeMs: number;
    timeouts: number;
    retries: number;
  };
}

interface Favorite {
  id: string;
  sessionId: string;
  generatedImageUrl: string | null;
  customPrompt: string | null;
  sessionPhotoUrl: string | null;
  sessionPrompt: string | null;
  styleType: string | null;
  createdAt: string;
}

interface Feedback {
  id: string;
  userId: string | null;
  sessionId: string | null;
  email: string | null;
  rating: number;
  usability: number | null;
  imageQuality: number | null;
  wouldRecommend: boolean | null;
  favoriteFeature: string | null;
  improvementSuggestion: string | null;
  additionalComments: string | null;
  pricingPreference: string | null;
  monthlyBudget: string | null;
  generationCount: number | null;
  // Survey-specific fields
  mostUsedFeature: string | null;
  frustration: string | null;
  missingFeature: string | null;
  problemSolved: string | null;
  aurenRating: number | null;
  createdAt: string;
}

interface FeedbackSummary {
  totalResponses: number;
  avgOverallRating: number;
  avgUsabilityRating: number;
  avgImageQualityRating: number;
  recommendRate: number;
  ratingDistribution: { [key: number]: number };
  pricingPreferences: { [key: string]: number };
  budgetDistribution: { [key: string]: number };
  topImprovements: string[];
  topFavoriteFeatures: string[];
}

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountType: string;
  plan: string;
  credits: number;
  createdAt: string;
}

interface Booking {
  id: string;
  userId: string | null;
  stylistId: string | null;
  placeId: string;
  date: string;
  time: string;
  status: string;
  service: string | null;
  price: number | null;
  createdAt: string;
}

interface Generation {
  id: string;
  sessionId: string;
  status: string;
  styleType: string | null;
  renderType: string | null;
  inspirationPhotoUrl: string | null;
  customPrompt: string | null;
  createdAt: string;
}

export default function Admin() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: adminCheck, isLoading: checkingAdmin } = useQuery<{ isAdmin: boolean; canBecomeAdmin: boolean }>({
    queryKey: ["/api/admin/check"],
  });

  const { data: overview, isLoading: loadingOverview } = useQuery<AdminOverview>({
    queryKey: ["/api/admin/overview"],
    enabled: adminCheck?.isAdmin === true,
  });

  const { data: feedbackData } = useQuery<{ data: Feedback[]; total: number }>({
    queryKey: ["/api/admin/feedback"],
    enabled: adminCheck?.isAdmin === true && activeTab === "feedback",
  });

  const { data: usersData } = useQuery<{ data: User[]; total: number }>({
    queryKey: ["/api/admin/users"],
    enabled: adminCheck?.isAdmin === true && activeTab === "users",
  });

  const { data: bookingsData } = useQuery<{ data: Booking[]; total: number }>({
    queryKey: ["/api/admin/bookings"],
    enabled: adminCheck?.isAdmin === true && activeTab === "bookings",
  });

  const { data: generationsData } = useQuery<{ data: Generation[]; total: number }>({
    queryKey: ["/api/admin/generations"],
    enabled: adminCheck?.isAdmin === true && activeTab === "generations",
  });

  const { data: favoritesData } = useQuery<{ data: Favorite[]; total: number }>({
    queryKey: ["/api/admin/favorites"],
    enabled: adminCheck?.isAdmin === true && activeTab === "favorites",
  });

  const { data: planPreferences } = useQuery<{ plan: string; count: number; uniqueUsers: number }[]>({
    queryKey: ["/api/admin/plan-preferences"],
    enabled: adminCheck?.isAdmin === true && activeTab === "plans",
  });

  const { data: dislikesData } = useQuery<{ data: Favorite[]; total: number }>({
    queryKey: ["/api/admin/dislikes"],
    enabled: adminCheck?.isAdmin === true && activeTab === "dislikes",
  });

  const promoteMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/promote"),
    onSuccess: () => {
      toast({ title: "Success", description: "You are now an admin!" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/check"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleExport = (type: "feedback" | "users" | "bookings") => {
    window.open(`/api/admin/export/${type}`, "_blank");
  };

  if (checkingAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking access...</p>
        </div>
      </div>
    );
  }

  if (!adminCheck?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <CardTitle>Admin Access Required</CardTitle>
            <CardDescription>
              {adminCheck?.canBecomeAdmin 
                ? "You can activate admin access for this dashboard."
                : "Sign in with your admin account to access this dashboard."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Admin login button - available even during beta */}
            <Button
              className="w-full"
              onClick={() => window.location.href = "/api/login"}
              data-testid="button-admin-login"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Sign In as Admin
            </Button>
            {adminCheck?.canBecomeAdmin && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => promoteMutation.mutate()}
                disabled={promoteMutation.isPending}
                data-testid="button-become-admin"
              >
                {promoteMutation.isPending ? "Setting up..." : "Activate Admin Access"}
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/")}
              data-testid="button-go-home"
            >
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            <p className="text-muted-foreground">Monitor your beta app performance</p>
          </div>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Admin
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 md:grid-cols-8 lg:w-auto lg:inline-grid">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="plans" data-testid="tab-plans">Plan Prefs</TabsTrigger>
            <TabsTrigger value="feedback" data-testid="tab-feedback">Feedback</TabsTrigger>
            <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
            <TabsTrigger value="bookings" data-testid="tab-bookings">Bookings</TabsTrigger>
            <TabsTrigger value="generations" data-testid="tab-generations">Generations</TabsTrigger>
            <TabsTrigger value="favorites" data-testid="tab-favorites">Favorites</TabsTrigger>
            <TabsTrigger value="dislikes" data-testid="tab-dislikes">Dislikes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {loadingOverview ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <CardHeader className="pb-2">
                      <div className="h-4 bg-muted rounded w-20"></div>
                    </CardHeader>
                    <CardContent>
                      <div className="h-8 bg-muted rounded w-16"></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : overview && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="text-total-users">{overview.totalUsers}</div>
                      <p className="text-xs text-muted-foreground">
                        +{overview.usersLast24h} in last 24h
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Feedback Received</CardTitle>
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="text-total-feedback">{overview.totalFeedback}</div>
                      <p className="text-xs text-muted-foreground">Beta user responses</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Total Bookings</CardTitle>
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="text-total-bookings">{overview.totalBookings}</div>
                      <p className="text-xs text-muted-foreground">Appointments made</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Generations</CardTitle>
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="text-total-generations">{overview.totalGenerations}</div>
                      <p className="text-xs text-muted-foreground">
                        +{overview.generationsLast24h} in last 24h
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Saved Favorites</CardTitle>
                      <Heart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="text-total-favorites">{overview.totalFavorites}</div>
                      <p className="text-xs text-muted-foreground">User-saved looks</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Disliked Results</CardTitle>
                      <ThumbsDown className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="text-total-dislikes">{overview.totalDislikes || 0}</div>
                      <p className="text-xs text-muted-foreground">Negative feedback</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Unique Devices</CardTitle>
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="text-total-devices">{overview.totalDevices || 0}</div>
                      <p className="text-xs text-muted-foreground">Anonymous users</p>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Generation Performance
                    </CardTitle>
                    <CardDescription>Real-time AI generation metrics</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Success Rate</p>
                        <p className="text-2xl font-semibold flex items-center gap-2">
                          {overview.generationMetrics.successRate || "N/A"}
                          {overview.generationMetrics.successfulGenerations > 0 && (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          )}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Avg. Time</p>
                        <p className="text-2xl font-semibold">
                          {(overview.generationMetrics.averageGenerationTimeMs / 1000).toFixed(1)}s
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Failed</p>
                        <p className="text-2xl font-semibold flex items-center gap-2">
                          {overview.generationMetrics.failedGenerations}
                          {overview.generationMetrics.failedGenerations > 0 && (
                            <AlertCircle className="w-4 h-4 text-destructive" />
                          )}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Timeouts</p>
                        <p className="text-2xl font-semibold">
                          {overview.generationMetrics.timeouts}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="plans" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Plan Preferences</h2>
              <p className="text-sm text-muted-foreground">
                Which plans users would choose (beta research) - each user can only select one plan
              </p>
            </div>

            {!planPreferences ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"></div>
              </div>
            ) : planPreferences.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <TrendingUp className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">No plan preference data yet</p>
                  <p className="text-sm text-muted-foreground mt-2">Users will be tracked when they select a plan on the pricing page</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {planPreferences.map((pref) => {
                    const totalUsers = planPreferences.reduce((sum, p) => sum + p.uniqueUsers, 0);
                    const percentage = totalUsers > 0 ? ((pref.uniqueUsers / totalUsers) * 100).toFixed(0) : "0";
                    return (
                      <Card key={pref.plan} className="relative" data-testid={`card-plan-${pref.plan}`}>
                        <CardContent className="pt-6">
                          <div className="text-center">
                            <p className="text-3xl font-bold text-primary">{pref.uniqueUsers}</p>
                            <p className="text-sm text-muted-foreground">users</p>
                            <Badge variant="outline" className="mt-2">
                              {pref.plan === "payg" ? "Pay-as-you-go" : pref.plan === "monthly" ? "Unlimited" : pref.plan.charAt(0).toUpperCase() + pref.plan.slice(1)}
                            </Badge>
                            <p className="text-xs text-muted-foreground mt-2">
                              {percentage}% of total
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Plan Popularity Breakdown</CardTitle>
                    <CardDescription>Each user's current plan selection</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Plan</TableHead>
                          <TableHead className="text-right">Users</TableHead>
                          <TableHead className="text-right">% of Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {planPreferences.map((pref) => {
                          const totalUsers = planPreferences.reduce((sum, p) => sum + p.uniqueUsers, 0);
                          const percentage = totalUsers > 0 ? ((pref.uniqueUsers / totalUsers) * 100).toFixed(1) : "0";
                          const isHighest = pref.uniqueUsers === Math.max(...planPreferences.map(p => p.uniqueUsers));
                          return (
                            <TableRow key={pref.plan}>
                              <TableCell className="font-medium">
                                {pref.plan === "payg" ? "Pay-as-you-go" : pref.plan === "monthly" ? "Unlimited" : pref.plan.charAt(0).toUpperCase() + pref.plan.slice(1)}
                              </TableCell>
                              <TableCell className="text-right">{pref.uniqueUsers}</TableCell>
                              <TableCell className="text-right">
                                <Badge variant={isHighest ? "default" : "secondary"}>
                                  {percentage}%
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="feedback" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Beta Feedback Analysis</h2>
                <p className="text-sm text-muted-foreground">
                  {feedbackData?.total || 0} total survey responses
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => handleExport("feedback")}
                data-testid="button-export-feedback"
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>

            {/* Summary Statistics */}
            {feedbackData?.data && feedbackData.data.length > 0 && (() => {
              const data = feedbackData.data;
              const avgOverall = (data.reduce((sum, f) => sum + f.rating, 0) / data.length).toFixed(1);
              const validUsability = data.filter(f => f.usability);
              const avgUsability = validUsability.length > 0 ? (validUsability.reduce((sum, f) => sum + (f.usability || 0), 0) / validUsability.length).toFixed(1) : "N/A";
              const validQuality = data.filter(f => f.imageQuality);
              const avgQuality = validQuality.length > 0 ? (validQuality.reduce((sum, f) => sum + (f.imageQuality || 0), 0) / validQuality.length).toFixed(1) : "N/A";
              const recommenders = data.filter(f => f.wouldRecommend === true).length;
              const respondedToRecommend = data.filter(f => f.wouldRecommend !== null).length;
              const recommendRate = respondedToRecommend > 0 ? Math.round((recommenders / respondedToRecommend) * 100) : 0;
              
              // Rating distribution (7-point scale)
              const ratingDist: { [key: number]: number } = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
              data.forEach(f => { ratingDist[f.rating] = (ratingDist[f.rating] || 0) + 1; });
              
              // Pricing preferences
              const pricingPrefs: { [key: string]: number } = {};
              data.forEach(f => { 
                if (f.pricingPreference) {
                  pricingPrefs[f.pricingPreference] = (pricingPrefs[f.pricingPreference] || 0) + 1;
                }
              });
              
              // Budget distribution
              const budgetDist: { [key: string]: number } = {};
              data.forEach(f => { 
                if (f.monthlyBudget) {
                  budgetDist[f.monthlyBudget] = (budgetDist[f.monthlyBudget] || 0) + 1;
                }
              });
              
              // Collect all improvement suggestions
              const improvements = data
                .map(f => f.improvementSuggestion)
                .filter(Boolean) as string[];
              
              // Collect all favorite features
              const favorites = data
                .map(f => f.favoriteFeature)
                .filter(Boolean) as string[];
              
              // Collect additional comments
              const comments = data
                .map(f => f.additionalComments)
                .filter(Boolean) as string[];
              
              return (
                <>
                  {/* Key Metrics Row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Overall Rating</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-bold">{avgOverall}</span>
                          <span className="text-muted-foreground">/7</span>
                        </div>
                        <div className="flex gap-0.5 mt-1">
                          {[1, 2, 3, 4, 5, 6, 7].map(star => (
                            <Star key={star} className={`w-3 h-3 ${parseFloat(avgOverall) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted'}`} />
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Would Recommend</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-bold">{recommendRate}%</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {recommenders} of {respondedToRecommend} respondents
                        </p>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Usability</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-bold">{avgUsability}</span>
                          {avgUsability !== "N/A" && <span className="text-muted-foreground">/7</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {validUsability.length} responses
                        </p>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Image Quality</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-bold">{avgQuality}</span>
                          {avgQuality !== "N/A" && <span className="text-muted-foreground">/7</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {validQuality.length} responses
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Rating Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Rating Distribution</CardTitle>
                      <CardDescription>How users rated their overall experience</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {[7, 6, 5, 4, 3, 2, 1].map(rating => {
                          const count = ratingDist[rating] || 0;
                          const percentage = data.length > 0 ? (count / data.length) * 100 : 0;
                          return (
                            <div key={rating} className="flex items-center gap-3">
                              <div className="flex items-center gap-1 w-16">
                                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                                <span className="font-medium">{rating}</span>
                              </div>
                              <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${rating >= 5 ? 'bg-green-500' : rating >= 3 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                              <div className="w-16 text-right text-sm text-muted-foreground">
                                {count} ({Math.round(percentage)}%)
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Pricing Preferences & Budget */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {Object.keys(pricingPrefs).length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Pricing Preference</CardTitle>
                          <CardDescription>Pay-as-you-go vs Subscription</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {Object.entries(pricingPrefs).sort((a, b) => b[1] - a[1]).map(([pref, count]) => {
                              const total = Object.values(pricingPrefs).reduce((a, b) => a + b, 0);
                              const percentage = Math.round((count / total) * 100);
                              return (
                                <div key={pref} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                                  <span className="font-medium capitalize">{pref === 'payg' ? 'Pay-as-you-go' : pref}</span>
                                  <Badge variant="secondary">{count} ({percentage}%)</Badge>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    
                    {Object.keys(budgetDist).length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Monthly Budget</CardTitle>
                          <CardDescription>How much users would spend</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {Object.entries(budgetDist).sort((a, b) => b[1] - a[1]).map(([budget, count]) => {
                              const total = Object.values(budgetDist).reduce((a, b) => a + b, 0);
                              const percentage = Math.round((count / total) * 100);
                              return (
                                <div key={budget} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                                  <span className="font-medium">{budget}</span>
                                  <Badge variant="secondary">{count} ({percentage}%)</Badge>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* Qualitative Feedback */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {favorites.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Heart className="w-5 h-5 text-pink-500" />
                            Favorite Features
                          </CardTitle>
                          <CardDescription>{favorites.length} responses</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {favorites.map((feature, i) => (
                              <div key={i} className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg text-sm border border-green-200 dark:border-green-900">
                                "{feature}"
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    
                    {improvements.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-blue-500" />
                            Improvement Suggestions
                          </CardTitle>
                          <CardDescription>{improvements.length} responses</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {improvements.map((suggestion, i) => (
                              <div key={i} className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-sm border border-blue-200 dark:border-blue-900">
                                "{suggestion}"
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  
                  {comments.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <MessageSquare className="w-5 h-5 text-purple-500" />
                          Additional Comments
                        </CardTitle>
                        <CardDescription>{comments.length} additional comments from users</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {comments.map((comment, i) => (
                            <div key={i} className="p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg text-sm border border-purple-200 dark:border-purple-900">
                              "{comment}"
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              );
            })()}

            {/* All Responses Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">All Survey Responses</CardTitle>
                <CardDescription>Complete list of all feedback submissions</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead>Usability</TableHead>
                      <TableHead>Most Used</TableHead>
                      <TableHead>Recommend</TableHead>
                      <TableHead>Pricing</TableHead>
                      <TableHead>Favorite Feature</TableHead>
                      <TableHead>Problem Solved</TableHead>
                      <TableHead>Frustration</TableHead>
                      <TableHead>Missing Feature</TableHead>
                      <TableHead>Improvements</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedbackData?.data?.map((feedback) => (
                      <TableRow key={feedback.id}>
                        <TableCell className="font-medium">
                          {feedback.email || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          {feedback.aurenRating ? (
                            <Badge variant={feedback.aurenRating >= 5 ? "default" : feedback.aurenRating >= 3 ? "secondary" : "destructive"}>
                              {feedback.aurenRating}/7
                            </Badge>
                          ) : (
                            <Badge variant={feedback.rating >= 5 ? "default" : feedback.rating >= 3 ? "secondary" : "destructive"}>
                              {feedback.rating}/7
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{feedback.usability ? `${feedback.usability}/7` : "-"}</TableCell>
                        <TableCell className="capitalize">
                          {feedback.mostUsedFeature?.replace(/_/g, ' ') || "-"}
                        </TableCell>
                        <TableCell>
                          {feedback.wouldRecommend ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : feedback.wouldRecommend === false ? (
                            <AlertCircle className="w-4 h-4 text-destructive" />
                          ) : "-"}
                        </TableCell>
                        <TableCell className="capitalize">
                          {feedback.pricingPreference === 'payg' ? 'Pay-as-you-go' : feedback.pricingPreference || "-"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={feedback.favoriteFeature || ""}>
                          {feedback.favoriteFeature || "-"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={feedback.problemSolved || ""}>
                          {feedback.problemSolved || "-"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={feedback.frustration || ""}>
                          {feedback.frustration || "-"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={feedback.missingFeature || ""}>
                          {feedback.missingFeature || "-"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={feedback.improvementSuggestion || ""}>
                          {feedback.improvementSuggestion || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {feedback.createdAt ? format(new Date(feedback.createdAt), "MMM d, yyyy") : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!feedbackData?.data?.length && (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                          No feedback received yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Registered Users</h2>
                <p className="text-sm text-muted-foreground">
                  {usersData?.total || 0} total users
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => handleExport("users")}
                data-testid="button-export-users"
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersData?.data?.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        {user.firstName || user.lastName 
                          ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                          : "Anonymous"}
                      </TableCell>
                      <TableCell>{user.email || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={user.accountType === "admin" ? "default" : "secondary"}>
                          {user.accountType}
                        </Badge>
                      </TableCell>
                      <TableCell>{user.plan}</TableCell>
                      <TableCell>{user.credits}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!usersData?.data?.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No users registered yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="bookings" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Appointments</h2>
                <p className="text-sm text-muted-foreground">
                  {bookingsData?.total || 0} total bookings
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => handleExport("bookings")}
                data-testid="button-export-bookings"
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookingsData?.data?.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell>{booking.service || "-"}</TableCell>
                      <TableCell>{booking.date}</TableCell>
                      <TableCell>{booking.time}</TableCell>
                      <TableCell>
                        <Badge variant={
                          booking.status === "confirmed" ? "default" :
                          booking.status === "cancelled" ? "destructive" :
                          "secondary"
                        }>
                          {booking.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {booking.price ? `$${booking.price}` : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {booking.createdAt ? format(new Date(booking.createdAt), "MMM d") : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!bookingsData?.data?.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No bookings made yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="generations" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">AI Generations</h2>
              <p className="text-sm text-muted-foreground">
                {generationsData?.total || 0} total generations
              </p>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Style Type</TableHead>
                    <TableHead>Render Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {generationsData?.data?.map((gen) => (
                    <TableRow key={gen.id}>
                      <TableCell className="font-mono text-xs">
                        {gen.id.substring(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <Badge variant={gen.inspirationPhotoUrl ? "outline" : "secondary"}>
                          {gen.inspirationPhotoUrl ? "Inspiration" : gen.customPrompt ? "Text" : "-"}
                        </Badge>
                      </TableCell>
                      <TableCell>{gen.styleType || "-"}</TableCell>
                      <TableCell>{gen.renderType || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={
                          gen.status === "completed" ? "default" :
                          gen.status === "failed" ? "destructive" :
                          "secondary"
                        }>
                          {gen.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {gen.createdAt ? format(new Date(gen.createdAt), "MMM d, HH:mm") : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!generationsData?.data?.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No generations yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="favorites" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Saved Favorites</h2>
              <p className="text-sm text-muted-foreground">
                {favoritesData?.total || 0} generations saved by users
              </p>
            </div>

            {favoritesData?.data?.length ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {favoritesData.data.map((fav) => (
                  <Card key={fav.id} className="overflow-hidden">
                    <div className="aspect-[3/4] relative">
                      {fav.generatedImageUrl ? (
                        <img 
                          src={fav.generatedImageUrl} 
                          alt="Saved generation" 
                          className="w-full h-full object-cover"
                          data-testid={`img-favorite-${fav.id}`}
                        />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center">
                          <Sparkles className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2">
                        <Heart className="w-5 h-5 fill-red-500 text-red-500" />
                      </div>
                    </div>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground truncate">
                        {fav.sessionPrompt || fav.customPrompt || "No prompt"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {fav.createdAt ? format(new Date(fav.createdAt), "MMM d, yyyy") : "-"}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="text-center py-12 text-muted-foreground">
                  <Heart className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No favorites saved yet</p>
                  <p className="text-sm mt-1">Users can save generations they like by clicking the heart icon.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="dislikes" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Disliked Generations</h2>
              <p className="text-sm text-muted-foreground">
                {dislikesData?.total || 0} generations marked as disliked by users
              </p>
            </div>

            {dislikesData?.data?.length ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {dislikesData.data.map((item) => (
                  <Card key={item.id} className="overflow-hidden">
                    <div className="aspect-[3/4] relative">
                      {item.generatedImageUrl ? (
                        <img 
                          src={item.generatedImageUrl} 
                          alt="Disliked generation" 
                          className="w-full h-full object-cover"
                          data-testid={`img-dislike-${item.id}`}
                        />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center">
                          <Sparkles className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2">
                        <ThumbsDown className="w-5 h-5 fill-red-500 text-red-500" />
                      </div>
                    </div>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground truncate">
                        {item.sessionPrompt || item.customPrompt || "No prompt"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {item.createdAt ? format(new Date(item.createdAt), "MMM d, yyyy") : "-"}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="text-center py-12 text-muted-foreground">
                  <ThumbsDown className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No disliked generations yet</p>
                  <p className="text-sm mt-1">Users can mark generations they dislike by clicking the thumbs down icon.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
