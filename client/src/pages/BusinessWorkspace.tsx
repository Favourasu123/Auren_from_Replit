import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard, Calendar, Scissors, Users, Settings, LogOut,
  Plus, Trash2, Clock, DollarSign, TrendingUp, CheckCircle, XCircle,
  Eye, Edit2, Save, X, Building2, MapPin, Phone, Globe, Star,
  CalendarDays, CreditCard, BarChart3, ArrowUpRight, ChevronRight, Wand2, Sparkles
} from "lucide-react";
import salonInteriorImage from "@assets/generated_images/modern_salon_interior_design.png";
import happyClientImage from "@assets/generated_images/happy_client_salon_mirror.png";
import consultationImage from "@assets/generated_images/stylist_client_consultation_tablet.png";
import { CalendarManagement } from "@/components/CalendarManagement";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration: number;
  category: string | null;
  isActive: number;
}

interface BusinessStylist {
  id: string;
  name: string;
  bio: string | null;
  profileImageUrl: string | null;
  specialty: string | null;
  isActive: number;
  availability?: { dayOfWeek: number; startTime: string; endTime: string; isAvailable: number }[];
}

interface Business {
  id: string;
  googlePlaceId: string | null;
  ownerId: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  imageUrl: string | null;
  isVerified: number;
  isActive: number;
  services?: Service[];
  stylists?: BusinessStylist[];
}

interface Appointment {
  id: string;
  userId: string;
  businessId: string;
  stylistId: string | null;
  serviceId: string | null;
  scheduledAt: string;
  status: string;
  notes: string | null;
  totalPrice: number;
  user?: { firstName: string; lastName: string; email: string; profileImageUrl: string | null };
  service?: { name: string };
  stylist?: { name: string };
}

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function BusinessWorkspace() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState("dashboard");
  
  const [showServiceDialog, setShowServiceDialog] = useState(false);
  const [showStylistDialog, setShowStylistDialog] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editingStylist, setEditingStylist] = useState<BusinessStylist | null>(null);
  
  const [newService, setNewService] = useState({ name: "", description: "", price: "", duration: "30", category: "" });
  const [newStylist, setNewStylist] = useState({ name: "", bio: "", specialty: "" });
  const [availability, setAvailability] = useState<{ dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean }[]>(
    DAYS_OF_WEEK.map((_, i) => ({
      dayOfWeek: i,
      startTime: "09:00",
      endTime: "17:00",
      isAvailable: i !== 0 && i !== 6,
    }))
  );

  const { data: business, isLoading: businessLoading } = useQuery<Business | null>({
    queryKey: ["/api/business/mine"],
    enabled: !!user,
  });

  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery<Appointment[]>({
    queryKey: ["/api/business", business?.id, "bookings"],
    enabled: !!business?.id,
  });

  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["/api/business", business?.id, "services"],
    enabled: !!business?.id,
  });

  const { data: stylists = [] } = useQuery<BusinessStylist[]>({
    queryKey: ["/api/business", business?.id, "stylists"],
    enabled: !!business?.id,
  });

  const addServiceMutation = useMutation({
    mutationFn: async (data: typeof newService) => {
      const response = await apiRequest("POST", `/api/business/${business?.id}/services`, {
        ...data,
        price: parseFloat(data.price) * 100,
        duration: parseInt(data.duration),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", business?.id, "services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/business/mine"] });
      setShowServiceDialog(false);
      setNewService({ name: "", description: "", price: "", duration: "30", category: "" });
      toast({ title: "Service added successfully!" });
    },
    onError: () => {
      toast({ title: "Failed to add service", variant: "destructive" });
    },
  });

  const addStylistMutation = useMutation({
    mutationFn: async (data: typeof newStylist) => {
      const response = await apiRequest("POST", `/api/business/${business?.id}/stylists`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", business?.id, "stylists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/business/mine"] });
      setShowStylistDialog(false);
      setNewStylist({ name: "", bio: "", specialty: "" });
      toast({ title: "Team member added successfully!" });
    },
    onError: () => {
      toast({ title: "Failed to add team member", variant: "destructive" });
    },
  });

  const updateAppointmentMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await apiRequest("PATCH", `/api/appointments/${id}`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business", business?.id, "bookings"] });
      toast({ title: "Appointment updated!" });
    },
    onError: () => {
      toast({ title: "Failed to update appointment", variant: "destructive" });
    },
  });

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardHeader className="text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Business Login Required</CardTitle>
            <CardDescription>Please log in to access your business workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" size="lg" onClick={() => window.location.href = "/api/login"} data-testid="button-business-login">
              Log In to Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (businessLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!business) {
    navigate("/business");
    return null;
  }

  const todayAppointments = appointments.filter(apt => {
    const aptDate = new Date(apt.scheduledAt);
    const today = new Date();
    return aptDate.toDateString() === today.toDateString();
  });

  const upcomingAppointments = appointments.filter(apt => {
    const aptDate = new Date(apt.scheduledAt);
    return aptDate > new Date() && apt.status !== "cancelled";
  }).slice(0, 5);

  const pendingAppointments = appointments.filter(apt => apt.status === "pending");

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "appointments", label: "Appointments", icon: Calendar },
    { id: "services", label: "Services", icon: Scissors },
    { id: "team", label: "Team", icon: Users },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background">
        <Sidebar>
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
                <Scissors className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{business.name}</p>
                <p className="text-xs text-muted-foreground truncate">{business.city}</p>
              </div>
            </div>
          </SidebarHeader>
          
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Management</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {menuItems.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        onClick={() => setActiveSection(item.id)}
                        isActive={activeSection === item.id}
                        data-testid={`menu-${item.id}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                        {item.id === "appointments" && pendingAppointments.length > 0 && (
                          <Badge variant="secondary" className="ml-auto text-xs">
                            {pendingAppointments.length}
                          </Badge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="p-4 space-y-3">
            {/* Work Mode Button - Prominent CTA */}
            <Link href="/business/work">
              <Button 
                className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-lg"
                data-testid="button-work-mode"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Work Mode
                <Sparkles className="h-3 w-3 ml-auto" />
              </Button>
            </Link>
            
            <Separator />
            
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.profileImageUrl || undefined} />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {user.firstName?.[0] || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.firstName}</p>
                <p className="text-xs text-muted-foreground">Owner</p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              className="w-full justify-start text-muted-foreground" 
              onClick={() => window.location.href = "/api/logout"}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </Button>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between px-6 py-4 border-b bg-background">
            <div className="flex items-center gap-4">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <h1 className="text-xl font-semibold">
                {menuItems.find(item => item.id === activeSection)?.label}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="outline" size="sm" data-testid="button-view-public">
                  <Eye className="h-4 w-4 mr-2" />
                  View Public Page
                </Button>
              </Link>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-6">
            {activeSection === "dashboard" && (
              <DashboardSection
                business={business}
                todayAppointments={todayAppointments}
                upcomingAppointments={upcomingAppointments}
                pendingAppointments={pendingAppointments}
                services={services}
                stylists={stylists}
                onViewAppointments={() => setActiveSection("appointments")}
              />
            )}

            {activeSection === "calendar" && business && (
              <CalendarManagement
                businessId={business.id}
                stylists={stylists}
              />
            )}

            {activeSection === "appointments" && (
              <AppointmentsSection
                appointments={appointments}
                isLoading={appointmentsLoading}
                onUpdateStatus={(id, status) => updateAppointmentMutation.mutate({ id, status })}
              />
            )}

            {activeSection === "services" && (
              <ServicesSection
                services={services}
                onAddService={() => setShowServiceDialog(true)}
              />
            )}

            {activeSection === "team" && (
              <TeamSection
                stylists={stylists}
                onAddStylist={() => setShowStylistDialog(true)}
              />
            )}

            {activeSection === "settings" && (
              <SettingsSection business={business} />
            )}
          </main>
        </div>
      </div>

      {/* Add Service Dialog */}
      <Dialog open={showServiceDialog} onOpenChange={setShowServiceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="service-name">Service Name</Label>
              <Input
                id="service-name"
                value={newService.name}
                onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                placeholder="e.g., Men's Haircut"
                data-testid="input-service-name"
              />
            </div>
            <div>
              <Label htmlFor="service-description">Description</Label>
              <Textarea
                id="service-description"
                value={newService.description}
                onChange={(e) => setNewService({ ...newService, description: e.target.value })}
                placeholder="Describe the service..."
                data-testid="input-service-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="service-price">Price ($)</Label>
                <Input
                  id="service-price"
                  type="number"
                  value={newService.price}
                  onChange={(e) => setNewService({ ...newService, price: e.target.value })}
                  placeholder="25.00"
                  data-testid="input-service-price"
                />
              </div>
              <div>
                <Label htmlFor="service-duration">Duration (min)</Label>
                <Input
                  id="service-duration"
                  type="number"
                  value={newService.duration}
                  onChange={(e) => setNewService({ ...newService, duration: e.target.value })}
                  placeholder="30"
                  data-testid="input-service-duration"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="service-category">Category</Label>
              <Input
                id="service-category"
                value={newService.category}
                onChange={(e) => setNewService({ ...newService, category: e.target.value })}
                placeholder="e.g., Haircuts, Coloring"
                data-testid="input-service-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowServiceDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => addServiceMutation.mutate(newService)}
              disabled={!newService.name || !newService.price || addServiceMutation.isPending}
              data-testid="button-save-service"
            >
              {addServiceMutation.isPending ? "Adding..." : "Add Service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Stylist Dialog */}
      <Dialog open={showStylistDialog} onOpenChange={setShowStylistDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="stylist-name">Name</Label>
              <Input
                id="stylist-name"
                value={newStylist.name}
                onChange={(e) => setNewStylist({ ...newStylist, name: e.target.value })}
                placeholder="Full name"
                data-testid="input-stylist-name"
              />
            </div>
            <div>
              <Label htmlFor="stylist-specialty">Specialty</Label>
              <Input
                id="stylist-specialty"
                value={newStylist.specialty}
                onChange={(e) => setNewStylist({ ...newStylist, specialty: e.target.value })}
                placeholder="e.g., Color Specialist, Barber"
                data-testid="input-stylist-specialty"
              />
            </div>
            <div>
              <Label htmlFor="stylist-bio">Bio</Label>
              <Textarea
                id="stylist-bio"
                value={newStylist.bio}
                onChange={(e) => setNewStylist({ ...newStylist, bio: e.target.value })}
                placeholder="A short bio..."
                data-testid="input-stylist-bio"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStylistDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => addStylistMutation.mutate(newStylist)}
              disabled={!newStylist.name || addStylistMutation.isPending}
              data-testid="button-save-stylist"
            >
              {addStylistMutation.isPending ? "Adding..." : "Add Team Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}

function DashboardSection({
  business,
  todayAppointments,
  upcomingAppointments,
  pendingAppointments,
  services,
  stylists,
  onViewAppointments,
}: {
  business: Business;
  todayAppointments: Appointment[];
  upcomingAppointments: Appointment[];
  pendingAppointments: Appointment[];
  services: Service[];
  stylists: BusinessStylist[];
  onViewAppointments: () => void;
}) {
  const totalRevenue = upcomingAppointments.reduce((sum, apt) => sum + (apt.totalPrice || 0), 0);

  return (
    <div className="space-y-6">
      {/* Welcome Banner with Image */}
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="p-6 md:p-8 flex flex-col justify-center">
            <h2 className="text-2xl font-bold mb-2">Welcome back!</h2>
            <p className="text-muted-foreground mb-4">
              You have {todayAppointments.length} appointments today and {pendingAppointments.length} pending requests.
            </p>
            <Button onClick={onViewAppointments} className="w-fit" data-testid="button-view-today">
              View Today's Schedule
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
          <div className="hidden md:block h-48 overflow-hidden">
            <img src={salonInteriorImage} alt="Salon interior" className="w-full h-full object-cover" />
          </div>
        </div>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="text-2xl font-bold">{todayAppointments.length}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{pendingAppointments.length}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Services</p>
                <p className="text-2xl font-bold">{services.length}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
                <Scissors className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Team</p>
                <p className="text-2xl font-bold">{stylists.length}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                <Users className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Appointments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg">Upcoming Appointments</CardTitle>
              <CardDescription>Your next scheduled bookings</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {upcomingAppointments.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No upcoming appointments</p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingAppointments.map((apt) => (
                  <div key={apt.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={apt.user?.profileImageUrl || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-sm">
                        {apt.user?.firstName?.[0] || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {apt.user?.firstName} {apt.user?.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {apt.service?.name} • {apt.stylist?.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {new Date(apt.scheduledAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(apt.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" onClick={onViewAppointments}>
                <Calendar className="h-5 w-5" />
                <span className="text-sm">View Calendar</span>
              </Button>
              <Link href="/upload">
                <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 w-full">
                  <Scissors className="h-5 w-5" />
                  <span className="text-sm">Try AI Preview</span>
                </Button>
              </Link>
            </div>
            <div className="mt-4">
              <img src={consultationImage} alt="Client consultation" className="w-full rounded-lg h-32 object-cover" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AppointmentsSection({
  appointments,
  isLoading,
  onUpdateStatus,
}: {
  appointments: Appointment[];
  isLoading: boolean;
  onUpdateStatus: (id: string, status: string) => void;
}) {
  const [filter, setFilter] = useState<string>("all");

  const filteredAppointments = appointments.filter(apt => {
    if (filter === "all") return true;
    return apt.status === filter;
  });

  const sortedAppointments = [...filteredAppointments].sort((a, b) => 
    new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {["all", "pending", "confirmed", "completed", "cancelled"].map((status) => (
          <Button
            key={status}
            variant={filter === status ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(status)}
            data-testid={`filter-${status}`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
            {status !== "all" && (
              <Badge variant="secondary" className="ml-2">
                {appointments.filter(a => a.status === status).length}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto" />
        </div>
      ) : sortedAppointments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium mb-2">No appointments found</p>
            <p className="text-muted-foreground">
              {filter === "all" 
                ? "Appointments will appear here when clients book with you"
                : `No ${filter} appointments`
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedAppointments.map((apt) => (
            <Card key={apt.id} className="hover-elevate">
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={apt.user?.profileImageUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {apt.user?.firstName?.[0] || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">
                        {apt.user?.firstName} {apt.user?.lastName}
                      </p>
                      <Badge variant={
                        apt.status === "confirmed" ? "default" :
                        apt.status === "pending" ? "secondary" :
                        apt.status === "completed" ? "outline" :
                        "destructive"
                      }>
                        {apt.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {apt.service?.name} with {apt.stylist?.name || "Any stylist"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(apt.scheduledAt).toLocaleDateString()} at {new Date(apt.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-lg">${((apt.totalPrice || 0) / 100).toFixed(2)}</p>
                    {apt.status === "pending" && (
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          onClick={() => onUpdateStatus(apt.id, "confirmed")}
                          data-testid={`button-confirm-${apt.id}`}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onUpdateStatus(apt.id, "cancelled")}
                          data-testid={`button-cancel-${apt.id}`}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ServicesSection({
  services,
  onAddService,
}: {
  services: Service[];
  onAddService: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Your Services</h2>
          <p className="text-sm text-muted-foreground">Manage the services you offer</p>
        </div>
        <Button onClick={onAddService} data-testid="button-add-service">
          <Plus className="h-4 w-4 mr-2" />
          Add Service
        </Button>
      </div>

      {services.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Scissors className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium mb-2">No services yet</p>
            <p className="text-muted-foreground mb-4">Add your first service to start accepting bookings</p>
            <Button onClick={onAddService}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Service
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((service) => (
            <Card key={service.id} className="hover-elevate">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{service.name}</CardTitle>
                    {service.category && (
                      <Badge variant="secondary" className="mt-1">{service.category}</Badge>
                    )}
                  </div>
                  <Badge variant="outline" className={service.isActive ? "bg-green-50 text-green-700" : ""}>
                    {service.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                {service.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{service.description}</p>
                )}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>{service.duration} min</span>
                  </div>
                  <div className="font-semibold text-lg">
                    ${(service.price / 100).toFixed(2)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamSection({
  stylists,
  onAddStylist,
}: {
  stylists: BusinessStylist[];
  onAddStylist: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Your Team</h2>
          <p className="text-sm text-muted-foreground">Manage your stylists and their schedules</p>
        </div>
        <Button onClick={onAddStylist} data-testid="button-add-stylist">
          <Plus className="h-4 w-4 mr-2" />
          Add Team Member
        </Button>
      </div>

      {stylists.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium mb-2">No team members yet</p>
            <p className="text-muted-foreground mb-4">Add your first team member to manage bookings</p>
            <Button onClick={onAddStylist}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Team Member
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stylists.map((stylist) => (
            <Card key={stylist.id} className="hover-elevate">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <Avatar className="h-14 w-14">
                    <AvatarImage src={stylist.profileImageUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-lg">
                      {stylist.name[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{stylist.name}</p>
                      <Badge variant="outline" className={stylist.isActive ? "bg-green-50 text-green-700" : ""}>
                        {stylist.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {stylist.specialty && (
                      <p className="text-sm text-primary">{stylist.specialty}</p>
                    )}
                    {stylist.bio && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{stylist.bio}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsSection({ business }: { business: Business }) {
  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Business Information</CardTitle>
          <CardDescription>Your public business profile</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-lg">{business.name}</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {business.isVerified ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-700">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Verified
                  </Badge>
                ) : (
                  <Badge variant="secondary">Unverified</Badge>
                )}
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4">
            {business.address && (
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Address</p>
                  <p className="text-sm text-muted-foreground">{business.address}, {business.city}</p>
                </div>
              </div>
            )}
            {business.phone && (
              <div className="flex items-start gap-3">
                <Phone className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Phone</p>
                  <p className="text-sm text-muted-foreground">{business.phone}</p>
                </div>
              </div>
            )}
            {business.website && (
              <div className="flex items-start gap-3">
                <Globe className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Website</p>
                  <a href={business.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                    {business.website}
                  </a>
                </div>
              </div>
            )}
          </div>

          {business.description && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-2">Description</p>
                <p className="text-sm text-muted-foreground">{business.description}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment Settings</CardTitle>
          <CardDescription>Manage how you receive payments</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
            <div className="h-12 w-12 rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
              <CreditCard className="h-6 w-6 text-purple-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium">Stripe Connected</p>
              <p className="text-sm text-muted-foreground">Payments are processed securely via Stripe</p>
            </div>
            <Badge className="bg-green-100 text-green-700">Active</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cancellation Policy</CardTitle>
          <CardDescription>Your booking cancellation terms</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <p className="text-sm">
              <strong>20% cancellation fee</strong> applies when appointments are cancelled less than 3 hours before the scheduled time. Full refunds are available with more than 3 hours notice.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
