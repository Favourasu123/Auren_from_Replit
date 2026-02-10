import { storage } from "./storage";
import type { 
  StylistAvailability, 
  StylistTimeOff, 
  Booking,
  Service,
  BusinessStylist,
  WaitlistEntry,
  RecurringBookingRule
} from "@shared/schema";

export interface TimeSlot {
  time: string; // "09:00" format
  available: boolean;
  stylistId?: string;
  reason?: string; // "booked", "time_off", "outside_hours"
}

export interface DayAvailability {
  date: string; // "2025-01-15" format
  dayOfWeek: number;
  slots: TimeSlot[];
  hasAvailability: boolean;
}

// Generate time slots for a given interval
function generateTimeSlots(startTime: string, endTime: string, intervalMinutes: number = 30): string[] {
  const slots: string[] = [];
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  let currentMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  while (currentMinutes < endMinutes) {
    const hours = Math.floor(currentMinutes / 60);
    const mins = currentMinutes % 60;
    slots.push(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`);
    currentMinutes += intervalMinutes;
  }
  
  return slots;
}

// Check if two time ranges overlap
function timeRangesOverlap(
  start1: string, end1: string,
  start2: string, end2: string
): boolean {
  const toMinutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };
  
  const s1 = toMinutes(start1);
  const e1 = toMinutes(end1);
  const s2 = toMinutes(start2);
  const e2 = toMinutes(end2);
  
  return s1 < e2 && s2 < e1;
}

// Calculate end time from start time and duration
export function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hours, mins] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + mins + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60);
  const endMins = totalMinutes % 60;
  return `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;
}

// Get available slots for a specific stylist on a specific date
export async function getStylistAvailableSlots(
  stylistId: string,
  date: string, // "2025-01-15" format
  serviceDuration: number = 30 // duration in minutes
): Promise<TimeSlot[]> {
  // Parse date to get day of week
  const dateObj = new Date(date);
  const dayOfWeek = dateObj.getDay(); // 0=Sunday, 1=Monday, etc.
  
  // Get stylist's regular availability for this day
  const availability = await storage.getStylistAvailabilityByDay(stylistId, dayOfWeek);
  
  if (!availability || !availability.isAvailable) {
    return []; // Not available on this day
  }
  
  // Get time off for this date
  const timeOffs = await storage.getStylistTimeOffByDate(stylistId, date);
  
  // Check for all-day time off
  const allDayOff = timeOffs.find(t => !t.startTime);
  if (allDayOff) {
    return []; // All day off
  }
  
  // Get existing bookings for this stylist on this date
  const existingBookings = await storage.getBookingsByStylistAndDate(stylistId, date);
  const activeBookings = existingBookings.filter(
    b => b.status !== 'cancelled' && b.status !== 'no_show'
  );
  
  // Generate all possible slots
  const allSlots = generateTimeSlots(availability.startTime, availability.endTime, 30);
  
  // Check each slot for availability
  const slots: TimeSlot[] = allSlots.map(slotTime => {
    const slotEndTime = calculateEndTime(slotTime, serviceDuration);
    
    // Check if slot is during time off
    const duringTimeOff = timeOffs.some(to => {
      if (!to.startTime || !to.endTime) return false;
      return timeRangesOverlap(slotTime, slotEndTime, to.startTime, to.endTime);
    });
    
    if (duringTimeOff) {
      return { time: slotTime, available: false, stylistId, reason: 'time_off' };
    }
    
    // Check if slot conflicts with existing booking
    const hasConflict = activeBookings.some(booking => 
      timeRangesOverlap(slotTime, slotEndTime, booking.startTime, booking.endTime)
    );
    
    if (hasConflict) {
      return { time: slotTime, available: false, stylistId, reason: 'booked' };
    }
    
    // Check if slot end time exceeds working hours
    const [endHour, endMin] = slotEndTime.split(':').map(Number);
    const [availEndHour, availEndMin] = availability.endTime.split(':').map(Number);
    if (endHour * 60 + endMin > availEndHour * 60 + availEndMin) {
      return { time: slotTime, available: false, stylistId, reason: 'outside_hours' };
    }
    
    return { time: slotTime, available: true, stylistId };
  });
  
  return slots;
}

// Get stylist availability calendar for a date range
export async function getStylistAvailability(
  stylistId: string,
  startDate: string,
  endDate: string,
  serviceId?: string
): Promise<DayAvailability[]> {
  // Get service duration if provided
  let serviceDuration = 30;
  if (serviceId) {
    const service = await storage.getService(serviceId);
    if (service) {
      serviceDuration = service.duration;
    }
  }
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  const calendar: DayAvailability[] = [];
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getDay();
    const slots = await getStylistAvailableSlots(stylistId, dateStr, serviceDuration);
    
    calendar.push({
      date: dateStr,
      dayOfWeek,
      slots,
      hasAvailability: slots.some(s => s.available)
    });
  }
  
  return calendar;
}

// Get available slots across all stylists for a business on a date
export async function getBusinessAvailableSlots(
  businessId: string,
  date: string,
  serviceId: string
): Promise<{ stylistId: string; stylistName: string; startTime: string; endTime: string }[]> {
  const stylists = await storage.getBusinessStylists(businessId);
  const service = await storage.getService(serviceId);
  
  if (!service) {
    throw new Error('Service not found');
  }
  
  // Flatten to a simple list of available slots with stylist info
  const allSlots: { stylistId: string; stylistName: string; startTime: string; endTime: string }[] = [];
  
  for (const stylist of stylists.filter(s => s.isActive)) {
    const slots = await getStylistAvailableSlots(stylist.id, date, service.duration);
    for (const slot of slots.filter(s => s.available)) {
      allSlots.push({
        stylistId: stylist.id,
        stylistName: stylist.name,
        startTime: slot.time,
        endTime: calculateEndTime(slot.time, service.duration)
      });
    }
  }
  
  // Sort by time
  allSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  
  return allSlots;
}

// Check if a specific slot is available (for double-booking prevention)
export async function isSlotAvailable(
  stylistId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: string // For rescheduling
): Promise<{ available: boolean; reason?: string }> {
  // Parse date to get day of week
  const dateObj = new Date(date);
  const dayOfWeek = dateObj.getDay();
  
  // Check regular availability
  const availability = await storage.getStylistAvailabilityByDay(stylistId, dayOfWeek);
  
  if (!availability || !availability.isAvailable) {
    return { available: false, reason: 'Stylist not available on this day' };
  }
  
  // Check if within working hours
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const [availStartH, availStartM] = availability.startTime.split(':').map(Number);
  const [availEndH, availEndM] = availability.endTime.split(':').map(Number);
  
  const requestedStart = startH * 60 + startM;
  const requestedEnd = endH * 60 + endM;
  const availStart = availStartH * 60 + availStartM;
  const availEnd = availEndH * 60 + availEndM;
  
  if (requestedStart < availStart || requestedEnd > availEnd) {
    return { available: false, reason: 'Outside of working hours' };
  }
  
  // Check time off
  const timeOffs = await storage.getStylistTimeOffByDate(stylistId, date);
  const allDayOff = timeOffs.find(t => !t.startTime);
  if (allDayOff) {
    return { available: false, reason: 'Stylist has the day off' };
  }
  
  const duringTimeOff = timeOffs.some(to => {
    if (!to.startTime || !to.endTime) return false;
    return timeRangesOverlap(startTime, endTime, to.startTime, to.endTime);
  });
  
  if (duringTimeOff) {
    return { available: false, reason: 'Stylist has time off during this slot' };
  }
  
  // Check existing bookings
  const existingBookings = await storage.getBookingsByStylistAndDate(stylistId, date);
  const conflictingBooking = existingBookings.find(booking => {
    if (booking.status === 'cancelled' || booking.status === 'no_show') return false;
    if (excludeBookingId && booking.id === excludeBookingId) return false;
    return timeRangesOverlap(startTime, endTime, booking.startTime, booking.endTime);
  });
  
  if (conflictingBooking) {
    return { available: false, reason: 'Time slot already booked' };
  }
  
  return { available: true };
}

// Get calendar view data for a business (week or month)
export async function getBusinessCalendarView(
  businessId: string,
  startDate: string,
  endDate: string
): Promise<DayAvailability[]> {
  const days: DayAvailability[] = [];
  const stylists = await storage.getBusinessStylists(businessId);
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getDay();
    
    // Aggregate slots across all stylists
    let hasAnyAvailability = false;
    const aggregatedSlots: Map<string, TimeSlot> = new Map();
    
    for (const stylist of stylists.filter(s => s.isActive)) {
      const slots = await getStylistAvailableSlots(stylist.id, dateStr);
      
      for (const slot of slots) {
        if (slot.available) {
          hasAnyAvailability = true;
          // If slot not tracked yet or current is available, mark it available
          if (!aggregatedSlots.has(slot.time) || !aggregatedSlots.get(slot.time)?.available) {
            aggregatedSlots.set(slot.time, { ...slot, available: true });
          }
        } else if (!aggregatedSlots.has(slot.time)) {
          aggregatedSlots.set(slot.time, slot);
        }
      }
    }
    
    days.push({
      date: dateStr,
      dayOfWeek,
      slots: Array.from(aggregatedSlots.values()).sort((a, b) => a.time.localeCompare(b.time)),
      hasAvailability: hasAnyAvailability
    });
  }
  
  return days;
}

// Generate next occurrences for a recurring booking
export async function generateRecurringOccurrences(
  rule: RecurringBookingRule,
  count: number = 4 // Generate next N occurrences
): Promise<Array<{ date: string; time: string; available: boolean }>> {
  const occurrences: Array<{ date: string; time: string; available: boolean }> = [];
  
  const startDate = new Date(rule.startDate);
  const endDate = rule.endDate ? new Date(rule.endDate) : null;
  const maxOccurrences = rule.maxOccurrences || Infinity;
  
  let currentDate = new Date(startDate);
  let generated = 0;
  
  // Adjust to first occurrence on correct day of week
  while (currentDate.getDay() !== rule.dayOfWeek) {
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  const intervalDays = rule.frequency === 'weekly' ? 7 : 
                       rule.frequency === 'biweekly' ? 14 : 28; // monthly approximation
  
  while (generated < count && 
         (endDate === null || currentDate <= endDate) && 
         rule.occurrencesCreated + generated < maxOccurrences) {
    
    const dateStr = currentDate.toISOString().split('T')[0];
    const service = await storage.getService(rule.serviceId);
    const endTime = calculateEndTime(rule.preferredTime, service?.duration || 30);
    
    const slotCheck = await isSlotAvailable(
      rule.stylistId,
      dateStr,
      rule.preferredTime,
      endTime
    );
    
    occurrences.push({
      date: dateStr,
      time: rule.preferredTime,
      available: slotCheck.available
    });
    
    currentDate.setDate(currentDate.getDate() + intervalDays);
    generated++;
  }
  
  return occurrences;
}

// Notify waitlist when a slot opens up
export async function notifyWaitlistForOpening(
  businessId: string,
  stylistId: string | null,
  date: string,
  startTime: string,
  serviceId: string
): Promise<WaitlistEntry[]> {
  // Find matching waitlist entries
  const waitlistEntries = await storage.getWaitlistEntriesForOpening(
    businessId,
    date,
    serviceId,
    stylistId
  );
  
  // Sort by creation date (first come, first served)
  const sorted = waitlistEntries.sort((a, b) => 
    new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
  );
  
  // Return entries to be notified (actual notification happens in routes)
  return sorted;
}
