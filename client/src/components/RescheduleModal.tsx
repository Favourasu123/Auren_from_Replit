import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CalendarDays, Clock } from "lucide-react";
import { format, addDays, parseISO } from "date-fns";
import type { BookingWithDetails } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TimeSlot {
  startTime: string;
  endTime: string;
  stylistId: string;
  stylistName: string;
}

interface RescheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithDetails;
  onSuccess: () => void;
}

export function RescheduleModal({ open, onOpenChange, booking, onSuccess }: RescheduleModalProps) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;

  const { data: slots = [], isLoading: slotsLoading } = useQuery<TimeSlot[]>({
    queryKey: ["/api/scheduling/slots", booking.businessId, dateStr, booking.serviceId],
    queryFn: async () => {
      if (!dateStr) return [];
      const res = await fetch(
        `/api/scheduling/slots/${booking.businessId}/${dateStr}?serviceId=${booking.serviceId}`
      );
      if (!res.ok) throw new Error("Failed to fetch slots");
      return res.json();
    },
    enabled: !!dateStr,
  });

  const availableSlots = useMemo(() => {
    return slots.filter((slot) => slot.stylistId === booking.stylistId);
  }, [slots, booking.stylistId]);

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDate || !selectedSlot) throw new Error("Please select a date and time");
      
      await apiRequest("POST", `/api/bookings/${booking.id}/reschedule`, {
        newDate: format(selectedDate, "yyyy-MM-dd"),
        newStartTime: selectedSlot.startTime,
        newEndTime: selectedSlot.endTime,
      });
    },
    onSuccess: () => {
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to reschedule",
        description: error.message || "The time slot may no longer be available",
        variant: "destructive",
      });
    },
  });

  const minDate = addDays(new Date(), 1);
  const maxDate = addDays(new Date(), 60);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reschedule Appointment</DialogTitle>
          <DialogDescription>
            Choose a new date and time for your appointment with {booking.stylist?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4 py-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Select Date</span>
            </div>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                setSelectedDate(date);
                setSelectedSlot(null);
              }}
              disabled={(date) => date < minDate || date > maxDate}
              className="rounded-md border"
              data-testid="calendar-reschedule"
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Select Time</span>
            </div>

            {!selectedDate ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Please select a date first
              </div>
            ) : slotsLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm text-center px-4">
                No available times on this date. Please try another day.
              </div>
            ) : (
              <ScrollArea className="h-64 rounded-md border p-2">
                <div className="grid grid-cols-2 gap-2">
                  {availableSlots.map((slot) => (
                    <Button
                      key={slot.startTime}
                      variant={selectedSlot?.startTime === slot.startTime ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedSlot(slot)}
                      className="w-full"
                      data-testid={`button-slot-${slot.startTime}`}
                    >
                      {slot.startTime}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <div className="bg-muted/50 rounded-lg p-3 text-sm">
          <div className="font-medium mb-1">Current appointment:</div>
          <div className="text-muted-foreground">
            {format(parseISO(booking.date), "EEEE, MMMM d")} at {booking.startTime}
          </div>
          {selectedDate && selectedSlot && (
            <>
              <div className="font-medium mb-1 mt-3">New appointment:</div>
              <div className="text-primary">
                {format(selectedDate, "EEEE, MMMM d")} at {selectedSlot.startTime}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-reschedule">
            Cancel
          </Button>
          <Button
            onClick={() => rescheduleMutation.mutate()}
            disabled={!selectedDate || !selectedSlot || rescheduleMutation.isPending}
            data-testid="button-confirm-reschedule"
          >
            {rescheduleMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Rescheduling...
              </>
            ) : (
              "Confirm Reschedule"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
