import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, Loader2, Calendar as CalendarIcon, Clock } from "lucide-react";
import { format, addDays, startOfWeek, addWeeks, subWeeks, isSameDay, parseISO } from "date-fns";

interface TimeSlot {
  time: string;
  available: boolean;
  stylistId?: string;
  reason?: string;
}

interface DayAvailability {
  date: string;
  dayOfWeek: number;
  slots: TimeSlot[];
  hasAvailability: boolean;
}

interface AvailabilityCalendarProps {
  stylistId: string;
  serviceId?: string;
  onSlotSelect?: (date: string, time: string) => void;
  selectedDate?: string;
  selectedTime?: string;
}

export function AvailabilityCalendar({
  stylistId,
  serviceId,
  onSlotSelect,
  selectedDate,
  selectedTime,
}: AvailabilityCalendarProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));

  const startDate = format(weekStart, "yyyy-MM-dd");
  const endDate = format(addDays(weekStart, 6), "yyyy-MM-dd");

  const { data: availability = [], isLoading } = useQuery<DayAvailability[]>({
    queryKey: ["/api/stylists", stylistId, "calendar", startDate, endDate, serviceId],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate,
        endDate,
        ...(serviceId && { serviceId }),
      });
      const res = await fetch(`/api/stylists/${stylistId}/calendar?${params}`);
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
  });

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const getAvailabilityForDay = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return availability.find((a) => a.date === dateStr);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Availability
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeekStart(subWeeks(weekStart, 1))}
              data-testid="button-prev-week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">
              {format(weekStart, "MMM d")} - {format(addDays(weekStart, 6), "MMM d")}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeekStart(addWeeks(weekStart, 1))}
              data-testid="button-next-week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((day, idx) => {
              const dayAvail = getAvailabilityForDay(day);
              const isToday = isSameDay(day, new Date());
              const isPast = day < new Date() && !isToday;
              const availableSlots = dayAvail?.slots.filter((s) => s.available) || [];
              const isSelected = selectedDate === format(day, "yyyy-MM-dd");

              return (
                <div key={idx} className="flex flex-col">
                  <div
                    className={`text-center py-2 rounded-t-md ${
                      isToday ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <div className="text-xs font-medium">{dayNames[idx]}</div>
                    <div className="text-lg font-bold">{format(day, "d")}</div>
                  </div>
                  <div
                    className={`flex-1 border border-t-0 rounded-b-md p-1 min-h-[100px] ${
                      isPast ? "bg-muted/50 opacity-50" : ""
                    }`}
                  >
                    {isPast ? (
                      <div className="text-xs text-muted-foreground text-center py-4">Past</div>
                    ) : availableSlots.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-4">No slots</div>
                    ) : (
                      <ScrollArea className="h-[120px]">
                        <div className="space-y-1">
                          {availableSlots.slice(0, 6).map((slot) => (
                            <Button
                              key={slot.time}
                              variant={
                                isSelected && selectedTime === slot.time ? "default" : "outline"
                              }
                              size="sm"
                              className="w-full text-xs h-7"
                              onClick={() =>
                                onSlotSelect?.(format(day, "yyyy-MM-dd"), slot.time)
                              }
                              data-testid={`button-slot-${format(day, "yyyy-MM-dd")}-${slot.time}`}
                            >
                              {slot.time}
                            </Button>
                          ))}
                          {availableSlots.length > 6 && (
                            <div className="text-xs text-muted-foreground text-center">
                              +{availableSlots.length - 6} more
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-primary" />
            <span>Today</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded border" />
            <span>Available</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-muted/50" />
            <span>Past/Unavailable</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface BusinessAvailabilityProps {
  businessId: string;
  serviceId: string;
  onSlotSelect?: (date: string, startTime: string, endTime: string, stylistId: string, stylistName: string) => void;
}

export function BusinessAvailabilityCalendar({
  businessId,
  serviceId,
  onSlotSelect,
}: BusinessAvailabilityProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));

  const startDate = format(weekStart, "yyyy-MM-dd");
  const endDate = format(addDays(weekStart, 6), "yyyy-MM-dd");

  const { data: calendar = [], isLoading } = useQuery<{
    date: string;
    slots: { startTime: string; endTime: string; stylistId: string; stylistName: string }[];
    hasAvailability: boolean;
  }[]>({
    queryKey: ["/api/businesses", businessId, "calendar", startDate, endDate, serviceId],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate, serviceId });
      const res = await fetch(`/api/businesses/${businessId}/calendar?${params}`);
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
  });

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const getCalendarForDay = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return calendar.find((c) => c.date === dateStr);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Available Times
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeekStart(subWeeks(weekStart, 1))}
              data-testid="button-business-prev-week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">
              {format(weekStart, "MMM d")} - {format(addDays(weekStart, 6), "MMM d")}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeekStart(addWeeks(weekStart, 1))}
              data-testid="button-business-next-week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((day, idx) => {
              const dayCalendar = getCalendarForDay(day);
              const isToday = isSameDay(day, new Date());
              const isPast = day < new Date() && !isToday;
              const slots = dayCalendar?.slots || [];

              return (
                <div key={idx} className="flex flex-col">
                  <div
                    className={`text-center py-2 rounded-t-md ${
                      isToday ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <div className="text-xs font-medium">{dayNames[idx]}</div>
                    <div className="text-lg font-bold">{format(day, "d")}</div>
                  </div>
                  <div
                    className={`flex-1 border border-t-0 rounded-b-md p-1 min-h-[100px] ${
                      isPast ? "bg-muted/50 opacity-50" : ""
                    }`}
                  >
                    {isPast ? (
                      <div className="text-xs text-muted-foreground text-center py-4">Past</div>
                    ) : slots.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-4">No slots</div>
                    ) : (
                      <ScrollArea className="h-[120px]">
                        <div className="space-y-1">
                          {slots.slice(0, 6).map((slot, i) => (
                            <Button
                              key={`${slot.startTime}-${slot.stylistId}-${i}`}
                              variant="outline"
                              size="sm"
                              className="w-full text-xs h-7"
                              onClick={() =>
                                onSlotSelect?.(
                                  format(day, "yyyy-MM-dd"),
                                  slot.startTime,
                                  slot.endTime,
                                  slot.stylistId,
                                  slot.stylistName
                                )
                              }
                              title={slot.stylistName}
                              data-testid={`button-bslot-${format(day, "yyyy-MM-dd")}-${slot.startTime}`}
                            >
                              {slot.startTime}
                            </Button>
                          ))}
                          {slots.length > 6 && (
                            <div className="text-xs text-muted-foreground text-center">
                              +{slots.length - 6} more
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
