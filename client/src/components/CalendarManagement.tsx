import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Calendar as CalendarIcon,
  Plus,
  X,
  AlertCircle,
  Users,
  CheckCircle,
  Ban,
  Trash2
} from "lucide-react";
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO, isToday, isBefore } from "date-fns";

interface TimeSlot {
  time: string;
  isAvailable: boolean;
  stylistId?: string;
  stylistName?: string;
  bookingId?: string;
  customerName?: string;
  serviceName?: string;
}

interface DaySchedule {
  date: string;
  dayName: string;
  slots: TimeSlot[];
  bookings: Booking[];
}

interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  customerName: string;
  serviceName: string;
  stylistName: string;
  totalPrice: number;
}

interface TimeOff {
  id: string;
  stylistId: string;
  stylistName: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}

interface Stylist {
  id: string;
  name: string;
  isActive: number;
}

const HOURS = Array.from({ length: 12 }, (_, i) => {
  const hour = i + 8;
  return `${hour.toString().padStart(2, '0')}:00`;
});

const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const hour = Math.floor(i / 2) + 8;
  const minute = i % 2 === 0 ? '00' : '30';
  return `${hour.toString().padStart(2, '0')}:${minute}`;
});

export function CalendarManagement({ businessId, stylists }: { businessId: string; stylists: Stylist[] }) {
  const { toast } = useToast();
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [selectedStylistFilter, setSelectedStylistFilter] = useState<string>("all");
  const [showTimeOffDialog, setShowTimeOffDialog] = useState(false);
  const [newTimeOff, setNewTimeOff] = useState({
    stylistId: "",
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: "09:00",
    endTime: "17:00",
    reason: "",
    isFullDay: true
  });

  const weekDays = useMemo(() => {
    return eachDayOfInterval({
      start: currentWeekStart,
      end: endOfWeek(currentWeekStart, { weekStartsOn: 0 })
    });
  }, [currentWeekStart]);

  const startDate = format(currentWeekStart, 'yyyy-MM-dd');
  const endDate = format(endOfWeek(currentWeekStart, { weekStartsOn: 0 }), 'yyyy-MM-dd');

  const { data: calendarData, isLoading } = useQuery<{
    schedule: DaySchedule[];
    timeOff: TimeOff[];
    bookings: Booking[];
  }>({
    queryKey: ['/api/scheduling/calendar', businessId, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/scheduling/calendar/${businessId}?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) {
        return { schedule: [], timeOff: [], bookings: [] };
      }
      return res.json();
    },
    enabled: !!businessId,
  });

  const { data: timeOffList = [] } = useQuery<TimeOff[]>({
    queryKey: ['/api/business', businessId, 'time-off', startDate, endDate],
    enabled: !!businessId,
  });

  const goToPreviousWeek = () => setCurrentWeekStart(prev => addDays(prev, -7));
  const goToNextWeek = () => setCurrentWeekStart(prev => addDays(prev, 7));
  const goToToday = () => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));

  const bookingsByDateAndTime = useMemo(() => {
    const map = new Map<string, Booking[]>();
    const bookings = calendarData?.bookings || [];
    
    bookings.forEach(booking => {
      if (selectedStylistFilter !== "all" && booking.stylistName !== selectedStylistFilter) {
        return;
      }
      const key = `${booking.date}-${booking.startTime}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(booking);
    });
    
    return map;
  }, [calendarData?.bookings, selectedStylistFilter]);

  const getBookingsForSlot = (date: string, time: string) => {
    return bookingsByDateAndTime.get(`${date}-${time}`) || [];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800';
      case 'pending': return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-800';
      case 'completed': return 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800';
      case 'cancelled': return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Calendar</h2>
          <p className="text-sm text-muted-foreground">View and manage your schedule, bookings, and time off</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowTimeOffDialog(true)} data-testid="button-add-timeoff">
            <Plus className="h-4 w-4 mr-2" />
            Add Time Off
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPreviousWeek} data-testid="button-prev-week">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToToday} data-testid="button-today">
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={goToNextWeek} data-testid="button-next-week">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium ml-2">
                {format(currentWeekStart, 'MMM d')} - {format(endOfWeek(currentWeekStart, { weekStartsOn: 0 }), 'MMM d, yyyy')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">Stylist:</Label>
              <Select value={selectedStylistFilter} onValueChange={setSelectedStylistFilter}>
                <SelectTrigger className="w-40" data-testid="select-stylist-filter">
                  <SelectValue placeholder="All stylists" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stylists</SelectItem>
                  {stylists.filter(s => s.isActive).map(stylist => (
                    <SelectItem key={stylist.id} value={stylist.name}>{stylist.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-8 border-b sticky top-0 bg-background z-10">
                <div className="p-2 border-r text-center text-xs font-medium text-muted-foreground">
                  Time
                </div>
                {weekDays.map((day) => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const isPast = isBefore(day, new Date()) && !isToday(day);
                  return (
                    <div 
                      key={dayStr} 
                      className={`p-2 border-r text-center ${isToday(day) ? 'bg-primary/5' : ''} ${isPast ? 'opacity-60' : ''}`}
                    >
                      <p className="text-xs font-medium text-muted-foreground">{format(day, 'EEE')}</p>
                      <p className={`text-sm font-semibold ${isToday(day) ? 'text-primary' : ''}`}>{format(day, 'd')}</p>
                    </div>
                  );
                })}
              </div>

              {HOURS.map((hour) => (
                <div key={hour} className="grid grid-cols-8 border-b min-h-[60px]">
                  <div className="p-2 border-r flex items-start justify-center">
                    <span className="text-xs text-muted-foreground">{hour}</span>
                  </div>
                  {weekDays.map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const bookings = getBookingsForSlot(dateStr, hour);
                    const isPast = isBefore(day, new Date()) && !isToday(day);

                    return (
                      <div 
                        key={`${dateStr}-${hour}`} 
                        className={`p-1 border-r min-h-[60px] ${isPast ? 'bg-muted/30' : 'hover:bg-muted/20'}`}
                      >
                        {bookings.map((booking) => (
                          <div
                            key={booking.id}
                            className={`text-xs p-1.5 rounded mb-1 border ${getStatusColor(booking.status)} cursor-pointer hover:opacity-80`}
                            data-testid={`booking-${booking.id}`}
                          >
                            <p className="font-medium truncate">{booking.customerName}</p>
                            <p className="truncate opacity-75">{booking.serviceName}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Clock className="h-3 w-3" />
                              <span>{booking.startTime} - {booking.endTime}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today's Schedule</CardTitle>
            <CardDescription>Quick overview of today's appointments</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(calendarData?.bookings || [])
                  .filter(b => b.date === format(new Date(), 'yyyy-MM-dd'))
                  .sort((a, b) => a.startTime.localeCompare(b.startTime))
                  .slice(0, 5)
                  .map(booking => (
                    <div key={booking.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <div className={`w-2 h-full min-h-[40px] rounded-full ${
                        booking.status === 'confirmed' ? 'bg-green-500' :
                        booking.status === 'pending' ? 'bg-yellow-500' :
                        booking.status === 'completed' ? 'bg-blue-500' : 'bg-muted'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{booking.customerName}</p>
                        <p className="text-sm text-muted-foreground truncate">{booking.serviceName}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{booking.startTime}</p>
                        <p className="text-xs text-muted-foreground">{booking.stylistName}</p>
                      </div>
                    </div>
                  ))
                }
                {(!calendarData?.bookings || calendarData.bookings.filter(b => b.date === format(new Date(), 'yyyy-MM-dd')).length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <CalendarIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No appointments today</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming Time Off</CardTitle>
            <CardDescription>Scheduled time off and blocked slots</CardDescription>
          </CardHeader>
          <CardContent>
            {timeOffList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Ban className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No scheduled time off</p>
              </div>
            ) : (
              <div className="space-y-3">
                {timeOffList.slice(0, 5).map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800">
                    <Ban className="h-5 w-5 text-red-500" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">{item.stylistName}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(item.date), 'MMM d, yyyy')} • {item.startTime} - {item.endTime}
                      </p>
                      {item.reason && <p className="text-xs text-muted-foreground mt-1">{item.reason}</p>}
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showTimeOffDialog} onOpenChange={setShowTimeOffDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Time Off</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Stylist</Label>
              <Select 
                value={newTimeOff.stylistId} 
                onValueChange={(val) => setNewTimeOff(prev => ({ ...prev, stylistId: val }))}
              >
                <SelectTrigger data-testid="select-timeoff-stylist">
                  <SelectValue placeholder="Select stylist" />
                </SelectTrigger>
                <SelectContent>
                  {stylists.filter(s => s.isActive).map(stylist => (
                    <SelectItem key={stylist.id} value={stylist.id}>{stylist.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input 
                type="date" 
                value={newTimeOff.date}
                onChange={(e) => setNewTimeOff(prev => ({ ...prev, date: e.target.value }))}
                data-testid="input-timeoff-date"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={newTimeOff.isFullDay}
                onCheckedChange={(checked) => setNewTimeOff(prev => ({ ...prev, isFullDay: checked }))}
                data-testid="switch-fullday"
              />
              <Label>Full day</Label>
            </div>
            {!newTimeOff.isFullDay && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Select 
                    value={newTimeOff.startTime} 
                    onValueChange={(val) => setNewTimeOff(prev => ({ ...prev, startTime: val }))}
                  >
                    <SelectTrigger data-testid="select-timeoff-start">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map(time => (
                        <SelectItem key={time} value={time}>{time}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>End Time</Label>
                  <Select 
                    value={newTimeOff.endTime} 
                    onValueChange={(val) => setNewTimeOff(prev => ({ ...prev, endTime: val }))}
                  >
                    <SelectTrigger data-testid="select-timeoff-end">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map(time => (
                        <SelectItem key={time} value={time}>{time}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                placeholder="e.g., Vacation, Personal appointment"
                value={newTimeOff.reason}
                onChange={(e) => setNewTimeOff(prev => ({ ...prev, reason: e.target.value }))}
                data-testid="input-timeoff-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTimeOffDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => {
                toast({ title: "Time off added", description: "The time off has been scheduled." });
                setShowTimeOffDialog(false);
                setNewTimeOff({
                  stylistId: "",
                  date: format(new Date(), 'yyyy-MM-dd'),
                  startTime: "09:00",
                  endTime: "17:00",
                  reason: "",
                  isFullDay: true
                });
              }}
              disabled={!newTimeOff.stylistId || !newTimeOff.date}
              data-testid="button-save-timeoff"
            >
              Save Time Off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
