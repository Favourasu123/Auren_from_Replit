import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { 
  Loader2, Calendar, Clock, MapPin, User, Star, 
  ChevronRight, RefreshCw, X, MessageSquare 
} from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import type { BookingWithDetails } from "@shared/schema";
import { RescheduleModal } from "@/components/RescheduleModal";
import { ReviewModal } from "@/components/ReviewModal";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  confirmed: { label: "Confirmed", variant: "default" },
  completed: { label: "Completed", variant: "outline" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  no_show: { label: "No Show", variant: "destructive" },
};

export default function AppointmentHistory() {
  const { user: authUser, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedTab, setSelectedTab] = useState("upcoming");
  const [rescheduleBooking, setRescheduleBooking] = useState<BookingWithDetails | null>(null);
  const [reviewBooking, setReviewBooking] = useState<BookingWithDetails | null>(null);

  const { data: appointments = [], isLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/appointments/history"],
    enabled: !!authUser,
  });

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">No appointments found</p>
        <Button onClick={() => setLocation("/stylists")} data-testid="button-find-stylists">
          Find Stylists
        </Button>
      </div>
    );
  }

  const upcomingAppointments = appointments.filter(
    (a) => !isPast(parseISO(`${a.date}T${a.endTime}`)) && !["cancelled", "no_show"].includes(a.status)
  );
  const pastAppointments = appointments.filter(
    (a) => isPast(parseISO(`${a.date}T${a.endTime}`)) || ["completed", "cancelled", "no_show"].includes(a.status)
  );

  return (
    <div className="min-h-screen bg-background py-8 px-4 pb-mobile-nav">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "DM Sans" }} data-testid="text-page-title">
            My Appointments
          </h1>
          <p className="text-muted-foreground">
            View and manage your salon appointments
          </p>
        </div>

        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="upcoming" data-testid="tab-upcoming">
              Upcoming ({upcomingAppointments.length})
            </TabsTrigger>
            <TabsTrigger value="past" data-testid="tab-past">
              Past ({pastAppointments.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="space-y-4">
            {upcomingAppointments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No upcoming appointments</p>
                  <Button onClick={() => setLocation("/stylists")} data-testid="button-book-now">
                    Book an Appointment
                  </Button>
                </CardContent>
              </Card>
            ) : (
              upcomingAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  onReschedule={() => setRescheduleBooking(appointment)}
                  onCancel={() => {}}
                  showActions
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="past" className="space-y-4">
            {pastAppointments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No past appointments</p>
                </CardContent>
              </Card>
            ) : (
              pastAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  onReview={() => setReviewBooking(appointment)}
                  showReviewButton={appointment.status === "completed"}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {rescheduleBooking && (
        <RescheduleModal
          open={!!rescheduleBooking}
          onOpenChange={(open) => !open && setRescheduleBooking(null)}
          booking={rescheduleBooking}
          onSuccess={() => {
            setRescheduleBooking(null);
            queryClient.invalidateQueries({ queryKey: ["/api/appointments/history"] });
            toast({ title: "Appointment rescheduled successfully!" });
          }}
        />
      )}

      {reviewBooking && (
        <ReviewModal
          open={!!reviewBooking}
          onOpenChange={(open) => !open && setReviewBooking(null)}
          booking={reviewBooking}
          onSuccess={() => {
            setReviewBooking(null);
            queryClient.invalidateQueries({ queryKey: ["/api/appointments/history"] });
            toast({ title: "Thank you for your review!" });
          }}
        />
      )}
    </div>
  );
}

function AppointmentCard({
  appointment,
  onReschedule,
  onCancel,
  onReview,
  showActions = false,
  showReviewButton = false,
}: {
  appointment: BookingWithDetails;
  onReschedule?: () => void;
  onCancel?: () => void;
  onReview?: () => void;
  showActions?: boolean;
  showReviewButton?: boolean;
}) {
  const { toast } = useToast();
  const status = statusConfig[appointment.status] || statusConfig.pending;

  const { data: canReview } = useQuery<{ canReview: boolean }>({
    queryKey: ["/api/bookings", appointment.id, "can-review"],
    queryFn: async () => {
      const res = await fetch(`/api/bookings/${appointment.id}/can-review`);
      if (!res.ok) throw new Error("Failed to check");
      return res.json();
    },
    enabled: showReviewButton,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/bookings/${appointment.id}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/history"] });
      toast({ title: "Appointment cancelled" });
    },
    onError: () => {
      toast({ title: "Failed to cancel appointment", variant: "destructive" });
    },
  });

  return (
    <Card className="hover-elevate" data-testid={`card-appointment-${appointment.id}`}>
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-lg" data-testid={`text-service-${appointment.id}`}>
                {appointment.service?.name || "Service"}
              </h3>
              <Badge variant={status.variant} data-testid={`badge-status-${appointment.id}`}>
                {status.label}
              </Badge>
            </div>

            <div className="space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span data-testid={`text-date-${appointment.id}`}>
                  {format(parseISO(appointment.date), "EEEE, MMMM d, yyyy")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span data-testid={`text-time-${appointment.id}`}>
                  {appointment.startTime} - {appointment.endTime}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span data-testid={`text-business-${appointment.id}`}>
                  {appointment.business?.name || "Salon"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span data-testid={`text-stylist-${appointment.id}`}>
                  {appointment.stylist?.name || "Stylist"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-right mb-2">
              <span className="text-lg font-semibold" data-testid={`text-price-${appointment.id}`}>
                ${(appointment.totalPrice / 100).toFixed(2)}
              </span>
            </div>

            {showActions && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReschedule}
                  data-testid={`button-reschedule-${appointment.id}`}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Reschedule
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                  data-testid={`button-cancel-${appointment.id}`}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            )}

            {showReviewButton && canReview?.canReview && (
              <Button
                variant="outline"
                size="sm"
                onClick={onReview}
                data-testid={`button-review-${appointment.id}`}
              >
                <Star className="h-4 w-4 mr-1" />
                Leave Review
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
