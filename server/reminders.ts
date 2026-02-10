import { storage } from "./storage";
import { db } from "./db";
import { bookings } from "@shared/schema";
import { eq, and, isNull, or } from "drizzle-orm";

// Check for appointments that need reminders and send them
export async function processAppointmentReminders(): Promise<number> {
  const now = new Date();
  let remindersSent = 0;

  try {
    // Find confirmed bookings that may need either 24h or 1h reminder
    const upcomingBookings = await db.select()
      .from(bookings)
      .where(and(
        eq(bookings.status, 'confirmed'),
        or(
          isNull(bookings.reminder24hSentAt),
          isNull(bookings.reminder1hSentAt)
        )
      ));

    for (const booking of upcomingBookings) {
      if (!booking.userId) continue;

      const appointmentDateTime = new Date(`${booking.date}T${booking.startTime}`);
      const hoursUntil = (appointmentDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // 24-hour reminder (between 23-25 hours) - only if not already sent
      if (hoursUntil >= 23 && hoursUntil <= 25 && !booking.reminder24hSentAt) {
        await sendReminder(booking, '24h');
        remindersSent++;
      }
      
      // 1-hour reminder (between 50-70 minutes) - only if not already sent
      if (hoursUntil >= 0.83 && hoursUntil <= 1.17 && !booking.reminder1hSentAt) {
        await sendReminder(booking, '1h');
        remindersSent++;
      }
    }
  } catch (error) {
    console.error("Error processing reminders:", error);
  }

  return remindersSent;
}

async function sendReminder(
  booking: typeof bookings.$inferSelect, 
  type: '24h' | '1h'
): Promise<void> {
  if (!booking.userId) return;

  const business = await storage.getBusinessById(booking.businessId);
  const stylist = await storage.getBusinessStylistById(booking.stylistId);
  
  const timeText = type === '24h' ? 'tomorrow' : 'in 1 hour';
  const title = type === '24h' ? 'Appointment Tomorrow' : 'Appointment Soon';
  
  await storage.createNotification({
    userId: booking.userId,
    type: 'appointment_reminder',
    title,
    body: `Reminder: Your appointment at ${business?.name || 'the salon'} with ${stylist?.name || 'your stylist'} is ${timeText} at ${booking.startTime}.`,
    data: { 
      bookingId: booking.id, 
      date: booking.date, 
      startTime: booking.startTime,
      reminderType: type
    }
  });

  // Mark the specific reminder type as sent
  if (type === '24h') {
    await db.update(bookings)
      .set({ reminder24hSentAt: new Date() })
      .where(eq(bookings.id, booking.id));
  } else {
    await db.update(bookings)
      .set({ reminder1hSentAt: new Date() })
      .where(eq(bookings.id, booking.id));
  }
  
  console.log(`Sent ${type} reminder for booking ${booking.id}`);
}

// Start the reminder scheduler (runs every 10 minutes)
let reminderInterval: NodeJS.Timeout | null = null;

export function startReminderScheduler(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
  }

  console.log("Starting appointment reminder scheduler...");
  
  // Run immediately on start
  processAppointmentReminders()
    .then(count => console.log(`Initial reminder check: ${count} reminders sent`))
    .catch(err => console.error("Error in initial reminder check:", err));
  
  // Then run every 10 minutes
  reminderInterval = setInterval(async () => {
    try {
      const count = await processAppointmentReminders();
      if (count > 0) {
        console.log(`Reminder check: ${count} reminders sent`);
      }
    } catch (error) {
      console.error("Error in reminder scheduler:", error);
    }
  }, 10 * 60 * 1000); // 10 minutes
}

export function stopReminderScheduler(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
    console.log("Reminder scheduler stopped");
  }
}
