import { 
  type UserSession, 
  type InsertUserSession,
  type GeneratedVariant,
  type InsertGeneratedVariant,
  type Hairstyle,
  type InsertHairstyle,
  type Salon,
  type InsertSalon,
  type User,
  type UpsertUser,
  type CreditTransaction,
  type InsertCreditTransaction,
  type Video,
  type InsertVideo,
  type VideoWithUser,
  type VideoComment,
  type InsertVideoComment,
  type VideoLike,
  type InsertVideoLike,
  type Stylist,
  type InsertStylist,
  type StylistPortfolio,
  type InsertStylistPortfolio,
  type Appointment,
  type InsertAppointment,
  type StylistWithPortfolio,
  type HairstyleReference,
  type InsertHairstyleReference,
  type Business,
  type InsertBusiness,
  type Service,
  type InsertService,
  type BusinessStylist,
  type InsertBusinessStylist,
  type StylistAvailability,
  type InsertStylistAvailability,
  type StylistTimeOff,
  type InsertStylistTimeOff,
  type Booking,
  type InsertBooking,
  type BusinessWithDetails,
  type BookingWithDetails,
  type BusinessReview,
  type InsertBusinessReview,
  type BusinessReviewWithDetails,
  type StylistReview,
  type InsertStylistReview,
  type StylistReviewWithDetails,
  type WaitlistEntry,
  type InsertWaitlistEntry,
  type RecurringBookingRule,
  type InsertRecurringBookingRule,
  type PushSubscription,
  type InsertPushSubscription,
  type Notification,
  type InsertNotification,
  type PreprocessingCache,
  type InsertPreprocessingCache,
  type BetaFeedback,
  type InsertBetaFeedback,
  users,
  creditTransactions,
  userSessions,
  generatedVariants,
  hairstyles,
  salons,
  videos,
  videoLikes,
  videoComments,
  videoViews,
  stylists,
  stylistPortfolios,
  appointments,
  hairstyleReferences,
  businesses,
  services,
  businessStylists,
  stylistAvailability,
  stylistTimeOff,
  bookings,
  businessReviews,
  stylistReviews,
  waitlistEntries,
  recurringBookingRules,
  pushSubscriptions,
  notifications,
  preprocessingCache,
  betaFeedback,
  planPreferences,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, lt, or, gte, lte, isNotNull, inArray, not, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // User operations (REQUIRED for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Credit management
  getUserCredits(userId: string): Promise<number>;
  deductCredits(userId: string, amount: number): Promise<void>;
  addCredits(userId: string, amount: number, type: string, description?: string): Promise<void>;
  getCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  resetDailyCredits(userId: string): Promise<void>;
  
  createUserSession(session: InsertUserSession): Promise<UserSession>;
  getUserSession(id: string): Promise<UserSession | undefined>;
  getAllUserSessions(): Promise<UserSession[]>;
  updateUserSession(id: string, updates: Partial<UserSession>): Promise<UserSession | undefined>;
  updateSessionMask(sessionId: string, maskDataUrl: string): Promise<void>;
  clearSessionMask(sessionId: string): Promise<void>;
  
  createGeneratedVariant(variant: InsertGeneratedVariant): Promise<GeneratedVariant>;
  getGeneratedVariant(id: string): Promise<GeneratedVariant | undefined>;
  getGeneratedVariantsBySessionId(sessionId: string): Promise<GeneratedVariant[]>;
  updateGeneratedVariant(id: string, updates: Partial<GeneratedVariant>): Promise<GeneratedVariant | undefined>;
  
  // Get sibling sessions (all sessions sharing the same root session ID)
  getSiblingSessions(sessionId: string): Promise<UserSession[]>;
  
  getAllHairstyles(): Promise<Hairstyle[]>;
  getHairstyleById(id: string): Promise<Hairstyle | undefined>;
  
  getAllSalons(): Promise<Salon[]>;
  getSalonsByCity(city: string): Promise<Salon[]>;
  
  // Video community operations
  createVideo(video: InsertVideo): Promise<Video>;
  getVideoById(id: string): Promise<Video | undefined>;
  getVideoFeed(limit?: number, offset?: number, userId?: string): Promise<VideoWithUser[]>;
  getUserVideos(userId: string): Promise<Video[]>;
  deleteVideo(id: string, userId: string): Promise<boolean>;
  incrementVideoViews(videoId: string): Promise<void>;
  
  // Video likes
  likeVideo(videoId: string, userId: string): Promise<void>;
  unlikeVideo(videoId: string, userId: string): Promise<void>;
  isVideoLikedByUser(videoId: string, userId: string): Promise<boolean>;
  
  // Video comments
  createComment(comment: InsertVideoComment): Promise<VideoComment>;
  getVideoComments(videoId: string): Promise<(VideoComment & { user: { firstName: string | null; lastName: string | null; profileImageUrl: string | null } })[]>;
  deleteComment(commentId: string, userId: string): Promise<boolean>;

  // Stylists
  getAllStylists(): Promise<StylistWithPortfolio[]>;
  getStylistById(id: string): Promise<StylistWithPortfolio | undefined>;
  getBetaDemoStylists(): Promise<StylistWithPortfolio[]>;
  createStylist(stylist: InsertStylist): Promise<Stylist>;
  addPortfolioImage(stylistId: string, portfolio: InsertStylistPortfolio): Promise<StylistPortfolio>;

  // Appointments
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  getUserAppointments(userId: string): Promise<Appointment[]>;
  getBetaBookingsCount(): Promise<number>;
  getBetaBookings(limit: number, offset: number): Promise<any[]>;

  // Plan preferences
  recordPlanPreference(preference: { plan: string; deviceId?: string; userId?: string }): Promise<void>;
  getUserPlanPreference(deviceId?: string, userId?: string): Promise<string | null>;
  getPlanPreferenceAnalytics(): Promise<{ plan: string; count: number; uniqueUsers: number }[]>;

  // User profile data (for dashboard and profile menu)
  getUserUpcomingBookings(userId: string): Promise<BookingWithDetails[]>;
  getUserTransformations(userId: string, limit?: number): Promise<GeneratedVariant[]>;
  getUserReviews(userId: string): Promise<BusinessReview[]>;
  createBusinessReview(review: InsertBusinessReview): Promise<BusinessReview>;

  // Hairstyle references for text mode matching
  getAllHairstyleReferences(): Promise<HairstyleReference[]>;
  searchHairstyleReferences(params: {
    skinTone?: string;
    faceShape?: string;
    gender?: string;
    keywords?: string[];
  }): Promise<HairstyleReference[]>;
  createHairstyleReference(reference: InsertHairstyleReference): Promise<HairstyleReference>;

  // Business booking operations
  createBusiness(business: InsertBusiness): Promise<Business>;
  getBusinessById(id: string): Promise<Business | undefined>;
  getBusinessByGooglePlaceId(placeId: string): Promise<Business | undefined>;
  getBusinessByOwnerId(ownerId: string): Promise<Business | undefined>;
  updateBusiness(id: string, updates: Partial<Business>): Promise<Business | undefined>;
  getBusinessWithDetails(id: string): Promise<BusinessWithDetails | undefined>;
  getActiveBusinesses(): Promise<Business[]>;
  searchBusinessesByName(query: string): Promise<Business[]>;

  // Services
  createService(service: InsertService): Promise<Service>;
  getServicesByBusinessId(businessId: string): Promise<Service[]>;
  updateService(id: string, updates: Partial<Service>): Promise<Service | undefined>;
  deleteService(id: string): Promise<boolean>;

  // Business stylists
  createBusinessStylist(stylist: InsertBusinessStylist): Promise<BusinessStylist>;
  getBusinessStylistsByBusinessId(businessId: string): Promise<BusinessStylist[]>;
  updateBusinessStylist(id: string, updates: Partial<BusinessStylist>): Promise<BusinessStylist | undefined>;
  deleteBusinessStylist(id: string): Promise<boolean>;

  // Stylist availability
  setStylistAvailability(stylistId: string, availability: Omit<InsertStylistAvailability, 'stylistId'>[]): Promise<StylistAvailability[]>;
  getStylistAvailability(stylistId: string): Promise<StylistAvailability[]>;

  // Stylist time off
  addStylistTimeOff(timeOff: InsertStylistTimeOff): Promise<StylistTimeOff>;
  getStylistTimeOff(stylistId: string, startDate: string, endDate: string): Promise<StylistTimeOff[]>;
  deleteStylistTimeOff(id: string): Promise<boolean>;

  // Bookings
  createBooking(booking: InsertBooking): Promise<Booking>;
  getBookingById(id: string): Promise<BookingWithDetails | undefined>;
  getBookingsByBusinessId(businessId: string, date?: string): Promise<Booking[]>;
  getBookingsByStylistId(stylistId: string, date: string): Promise<Booking[]>;
  getBookingsByUserId(userId: string): Promise<BookingWithDetails[]>;
  updateBookingStatus(id: string, status: string): Promise<Booking | undefined>;
  cancelBooking(id: string): Promise<boolean>;

  // Get available time slots for a stylist on a specific date
  getAvailableSlots(stylistId: string, date: string, serviceDuration: number): Promise<{ startTime: string; endTime: string }[]>;

  // Advanced scheduling - methods for scheduling.ts
  getStylistAvailabilityByDay(stylistId: string, dayOfWeek: number): Promise<StylistAvailability | undefined>;
  getStylistTimeOffByDate(stylistId: string, date: string): Promise<StylistTimeOff[]>;
  getBookingsByStylistAndDate(stylistId: string, date: string): Promise<Booking[]>;
  getBusinessStylists(businessId: string): Promise<BusinessStylist[]>;
  getService(serviceId: string): Promise<Service | undefined>;

  // Waitlist operations
  createWaitlistEntry(entry: InsertWaitlistEntry): Promise<WaitlistEntry>;
  getWaitlistEntriesForOpening(businessId: string, date: string, serviceId: string, stylistId?: string | null): Promise<WaitlistEntry[]>;
  updateWaitlistEntry(id: string, updates: Partial<WaitlistEntry>): Promise<WaitlistEntry | undefined>;
  getUserWaitlistEntries(userId: string): Promise<WaitlistEntry[]>;

  // Recurring booking operations
  createRecurringRule(rule: InsertRecurringBookingRule): Promise<RecurringBookingRule>;
  getRecurringRuleById(id: string): Promise<RecurringBookingRule | undefined>;
  updateRecurringRule(id: string, updates: Partial<RecurringBookingRule>): Promise<RecurringBookingRule | undefined>;
  cancelRecurringRule(id: string): Promise<boolean>;
  getActiveRecurringRulesByStylist(stylistId: string): Promise<RecurringBookingRule[]>;

  // Push notification operations
  createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  getPushSubscriptionsByUserId(userId: string): Promise<PushSubscription[]>;
  deletePushSubscription(endpoint: string): Promise<boolean>;
  
  // Notification operations
  createNotification(notification: InsertNotification): Promise<Notification>;
  getUserNotifications(userId: string, limit?: number): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<void>;

  // Preprocessing cache operations (persistent storage for masks, ethnicity, etc.)
  getPreprocessingCache(cacheKey: string): Promise<PreprocessingCache | undefined>;
  setPreprocessingCache(cacheKey: string, data: Partial<InsertPreprocessingCache>): Promise<PreprocessingCache>;
  updatePreprocessingCache(cacheKey: string, updates: Partial<PreprocessingCache>): Promise<PreprocessingCache | undefined>;
  cleanupExpiredCache(): Promise<number>;
  clearAllPreprocessingCache(): Promise<number>;
  
  // Beta feedback operations
  createBetaFeedback(feedback: InsertBetaFeedback): Promise<BetaFeedback>;
  getDeviceFeedbackCount(deviceId: string): Promise<number>;
  
  // Admin operations for monitoring
  getAllFeedback(limit?: number, offset?: number): Promise<BetaFeedback[]>;
  getFeedbackCount(): Promise<number>;
  getAllUsers(limit?: number, offset?: number): Promise<User[]>;
  getUserCount(): Promise<number>;
  getUsersCreatedAfter(date: Date): Promise<User[]>;
  getAllBookings(limit?: number, offset?: number): Promise<Booking[]>;
  getBookingCount(): Promise<number>;
  getRecentGenerations(limit?: number): Promise<GeneratedVariant[]>;
  getGenerationCount(): Promise<number>;
  getGenerationCountByDate(startDate: Date, endDate: Date): Promise<number>;
  setUserAccountType(userId: string, accountType: string): Promise<User | undefined>;
  getFavoritedGenerationsCount(): Promise<number>;
  getFavoritedGenerations(limit: number, offset: number): Promise<any[]>;
  getUserFavorites(userId: string): Promise<any[]>;
  getUserFavoritesWithDevice(userId: string | null, deviceId: string | null): Promise<any[]>;
  getDislikedGenerationsCount(): Promise<number>;
  getDislikedGenerations(limit: number, offset: number): Promise<any[]>;
  getUniqueDeviceCount(): Promise<number>;
  getUserGenerationHistory(userId: string | null, deviceId: string | null, limit?: number): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    this.seedData();
  }

  // User operations (REQUIRED for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const now = new Date();
    
    // Try to insert, on conflict update
    const [user] = await db
      .insert(users)
      .values({
        id: userData.id!,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: now,
        },
      })
      .returning();
    
    return user;
  }

  // Credit management
  async getUserCredits(userId: string): Promise<number> {
    const user = await this.getUser(userId);
    return user?.credits ?? 0;
  }

  async deductCredits(userId: string, amount: number): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    if (user.credits < amount) throw new Error("Insufficient credits");
    
    // Update user credits
    await db
      .update(users)
      .set({ credits: user.credits - amount })
      .where(eq(users.id, userId));
    
    // Log transaction
    await db.insert(creditTransactions).values({
      userId,
      amount: -amount,
      type: "generation",
      description: "AI hairstyle generation",
    });
  }

  async addCredits(userId: string, amount: number, type: string, description?: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    
    // Update user credits
    await db
      .update(users)
      .set({ credits: user.credits + amount })
      .where(eq(users.id, userId));
    
    // Log transaction
    await db.insert(creditTransactions).values({
      userId,
      amount,
      type,
      description: description ?? `Added ${amount} credits`,
    });
  }

  async getCreditTransactions(userId: string): Promise<CreditTransaction[]> {
    return await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt));
  }

  async resetDailyCredits(userId: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user || user.plan !== "free") return;
    
    const now = new Date();
    const lastReset = user.dailyCreditsResetAt;
    
    // Only reset if it's been more than 24 hours
    if (!lastReset || (now.getTime() - lastReset.getTime()) >= 24 * 60 * 60 * 1000) {
      // Beta credits: Give 25 credits/day to beta users (everyone except owners/admins)
      // Owners and users named "deborah" keep normal 3 credits as they're not beta testers
      const userEmail = user.email?.toLowerCase() || "";
      const isOwner = user.accountType === "admin" || userEmail.includes("deborah");
      const dailyCredits = isOwner ? 3 : 25; // Beta users get 25 credits/day
      
      // Update user with new credits and reset time
      await db
        .update(users)
        .set({ 
          credits: dailyCredits,
          dailyCreditsResetAt: now,
        })
        .where(eq(users.id, userId));
      
      // Log transaction
      await db.insert(creditTransactions).values({
        userId,
        amount: dailyCredits,
        type: "daily_reset",
        description: isOwner ? "Daily free credits reset" : "Beta user daily credits reset (25 credits)",
      });
    }
  }

  async createUserSession(insertSession: InsertUserSession): Promise<UserSession> {
    const [session] = await db
      .insert(userSessions)
      .values(insertSession)
      .returning();
    return session;
  }

  async getUserSession(id: string): Promise<UserSession | undefined> {
    const [session] = await db.select().from(userSessions).where(eq(userSessions.id, id));
    return session;
  }

  async getAllUserSessions(): Promise<UserSession[]> {
    const sessions = await db.select()
      .from(userSessions)
      .orderBy(desc(userSessions.createdAt))
      .limit(500);
    return sessions;
  }

  async updateUserSession(id: string, updates: Partial<UserSession>): Promise<UserSession | undefined> {
    const [session] = await db
      .update(userSessions)
      .set(updates)
      .where(eq(userSessions.id, id))
      .returning();
    return session;
  }

  async updateSessionMask(sessionId: string, maskDataUrl: string): Promise<void> {
    await db.update(userSessions)
      .set({ replicateMaskUrl: maskDataUrl })
      .where(eq(userSessions.id, sessionId));
  }

  async clearSessionMask(sessionId: string): Promise<void> {
    await db.update(userSessions)
      .set({ replicateMaskUrl: null })
      .where(eq(userSessions.id, sessionId));
  }

  async createGeneratedVariant(insertVariant: InsertGeneratedVariant): Promise<GeneratedVariant> {
    const [variant] = await db
      .insert(generatedVariants)
      .values(insertVariant)
      .returning();
    return variant;
  }

  async getGeneratedVariant(id: string): Promise<GeneratedVariant | undefined> {
    const [variant] = await db
      .select()
      .from(generatedVariants)
      .where(eq(generatedVariants.id, id));
    return variant;
  }

  async getGeneratedVariantsBySessionId(sessionId: string): Promise<GeneratedVariant[]> {
    return await db
      .select()
      .from(generatedVariants)
      .where(eq(generatedVariants.sessionId, sessionId));
  }

  // Get all sibling sessions (sessions that share the same root session ID)
  // Returns sessions ordered by usedReferenceIndex for consistent navigation
  async getSiblingSessions(sessionId: string): Promise<UserSession[]> {
    // First, get the current session to find its rootSessionId
    const [session] = await db.select().from(userSessions).where(eq(userSessions.id, sessionId));
    if (!session) return [];
    
    // Determine the root ID: if this session has a rootSessionId, use that; otherwise this IS the root
    const rootId = session.rootSessionId || sessionId;
    
    // Find ALL sessions that are related:
    // 1. The root session itself (where id = rootId)
    // 2. All sessions that have rootSessionId = rootId
    const siblings = await db
      .select()
      .from(userSessions)
      .where(
        sql`${userSessions.id} = ${rootId} OR ${userSessions.rootSessionId} = ${rootId}`
      );
    
    // Sort by usedReferenceIndex for consistent ordering
    siblings.sort((a, b) => (a.usedReferenceIndex || 0) - (b.usedReferenceIndex || 0));
    
    return siblings;
  }

  async updateGeneratedVariant(id: string, updates: Partial<GeneratedVariant>): Promise<GeneratedVariant | undefined> {
    const [variant] = await db
      .update(generatedVariants)
      .set(updates)
      .where(eq(generatedVariants.id, id))
      .returning();
    return variant;
  }

  async getAllHairstyles(): Promise<Hairstyle[]> {
    return await db.select().from(hairstyles);
  }

  async getHairstyleById(id: string): Promise<Hairstyle | undefined> {
    const [hairstyle] = await db.select().from(hairstyles).where(eq(hairstyles.id, id));
    return hairstyle;
  }

  async getAllSalons(): Promise<Salon[]> {
    return await db.select().from(salons);
  }

  async getSalonsByCity(city: string): Promise<Salon[]> {
    return await db
      .select()
      .from(salons)
      .where(eq(salons.city, city));
  }

  // Video community operations
  async createVideo(video: InsertVideo): Promise<Video> {
    const [newVideo] = await db
      .insert(videos)
      .values(video)
      .returning();
    return newVideo;
  }

  async getVideoById(id: string): Promise<Video | undefined> {
    const [video] = await db.select().from(videos).where(eq(videos.id, id));
    return video;
  }

  async getVideoFeed(limit = 20, offset = 0, userId?: string): Promise<VideoWithUser[]> {
    const videoList = await db
      .select({
        id: videos.id,
        userId: videos.userId,
        title: videos.title,
        description: videos.description,
        videoUrl: videos.videoUrl,
        thumbnailUrl: videos.thumbnailUrl,
        generatedVariantId: videos.generatedVariantId,
        duration: videos.duration,
        viewCount: videos.viewCount,
        likeCount: videos.likeCount,
        commentCount: videos.commentCount,
        tags: videos.tags,
        status: videos.status,
        createdAt: videos.createdAt,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userProfileImageUrl: users.profileImageUrl,
      })
      .from(videos)
      .leftJoin(users, eq(videos.userId, users.id))
      .where(eq(videos.status, "active"))
      .orderBy(desc(videos.createdAt))
      .limit(limit)
      .offset(offset);

    // Check if videos are liked by current user
    const videosWithUser: VideoWithUser[] = await Promise.all(
      videoList.map(async (v) => {
        let isLiked = false;
        if (userId) {
          isLiked = await this.isVideoLikedByUser(v.id, userId);
        }
        return {
          id: v.id,
          userId: v.userId,
          title: v.title,
          description: v.description,
          videoUrl: v.videoUrl,
          thumbnailUrl: v.thumbnailUrl,
          generatedVariantId: v.generatedVariantId,
          duration: v.duration,
          viewCount: v.viewCount,
          likeCount: v.likeCount,
          commentCount: v.commentCount,
          tags: v.tags,
          status: v.status,
          createdAt: v.createdAt,
          user: {
            id: v.userId,
            firstName: v.userFirstName,
            lastName: v.userLastName,
            profileImageUrl: v.userProfileImageUrl,
          },
          isLiked,
        };
      })
    );

    return videosWithUser;
  }

  async getUserVideos(userId: string): Promise<Video[]> {
    return await db
      .select()
      .from(videos)
      .where(eq(videos.userId, userId))
      .orderBy(desc(videos.createdAt));
  }

  async deleteVideo(id: string, userId: string): Promise<boolean> {
    const [video] = await db.select().from(videos).where(eq(videos.id, id));
    if (!video || video.userId !== userId) return false;
    
    await db.update(videos).set({ status: "removed" }).where(eq(videos.id, id));
    return true;
  }

  async incrementVideoViews(videoId: string): Promise<void> {
    await db
      .update(videos)
      .set({ viewCount: sql`${videos.viewCount} + 1` })
      .where(eq(videos.id, videoId));
  }

  // Video likes
  async likeVideo(videoId: string, userId: string): Promise<void> {
    const existingLike = await this.isVideoLikedByUser(videoId, userId);
    if (existingLike) return;
    
    await db.insert(videoLikes).values({ videoId, userId });
    await db
      .update(videos)
      .set({ likeCount: sql`${videos.likeCount} + 1` })
      .where(eq(videos.id, videoId));
  }

  async unlikeVideo(videoId: string, userId: string): Promise<void> {
    const result = await db
      .delete(videoLikes)
      .where(and(eq(videoLikes.videoId, videoId), eq(videoLikes.userId, userId)))
      .returning();
    
    if (result.length > 0) {
      await db
        .update(videos)
        .set({ likeCount: sql`GREATEST(0, ${videos.likeCount} - 1)` })
        .where(eq(videos.id, videoId));
    }
  }

  async isVideoLikedByUser(videoId: string, userId: string): Promise<boolean> {
    const [like] = await db
      .select()
      .from(videoLikes)
      .where(and(eq(videoLikes.videoId, videoId), eq(videoLikes.userId, userId)));
    return !!like;
  }

  // Video comments
  async createComment(comment: InsertVideoComment): Promise<VideoComment> {
    const [newComment] = await db
      .insert(videoComments)
      .values(comment)
      .returning();
    
    // Increment comment count
    await db
      .update(videos)
      .set({ commentCount: sql`${videos.commentCount} + 1` })
      .where(eq(videos.id, comment.videoId));
    
    return newComment;
  }

  async getVideoComments(videoId: string): Promise<(VideoComment & { user: { firstName: string | null; lastName: string | null; profileImageUrl: string | null } })[]> {
    const comments = await db
      .select({
        id: videoComments.id,
        videoId: videoComments.videoId,
        userId: videoComments.userId,
        content: videoComments.content,
        createdAt: videoComments.createdAt,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userProfileImageUrl: users.profileImageUrl,
      })
      .from(videoComments)
      .leftJoin(users, eq(videoComments.userId, users.id))
      .where(eq(videoComments.videoId, videoId))
      .orderBy(desc(videoComments.createdAt));

    return comments.map(c => ({
      id: c.id,
      videoId: c.videoId,
      userId: c.userId,
      content: c.content,
      createdAt: c.createdAt,
      user: {
        firstName: c.userFirstName,
        lastName: c.userLastName,
        profileImageUrl: c.userProfileImageUrl,
      },
    }));
  }

  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    const [comment] = await db.select().from(videoComments).where(eq(videoComments.id, commentId));
    if (!comment || comment.userId !== userId) return false;
    
    await db.delete(videoComments).where(eq(videoComments.id, commentId));
    
    // Decrement comment count
    await db
      .update(videos)
      .set({ commentCount: sql`GREATEST(0, ${videos.commentCount} - 1)` })
      .where(eq(videos.id, comment.videoId));
    
    return true;
  }

  private async seedData() {
    // Check if hairstyles data already exists
    const existingHairstyles = await db.select().from(hairstyles).limit(1);
    
    // Seed hairstyles and salons if they don't exist
    if (existingHairstyles.length === 0) {
      await this.seedHairstylesAndSalons();
    }
    
    // Always check and seed stylists separately
    const existingStylists = await db.select().from(stylists).limit(1);
    if (existingStylists.length === 0) {
      await this.seedStylists();
    }

    // Check and seed hairstyle references
    const existingRefs = await db.select().from(hairstyleReferences).limit(1);
    if (existingRefs.length === 0) {
      await this.seedHairstyleReferences();
    }
  }

  private async seedHairstylesAndSalons() {

    const sampleHairstyles: InsertHairstyle[] = [
      {
        name: "Modern Textured Crop",
        description: "A contemporary, low-maintenance style with textured layers on top and faded sides",
        category: "Men's Short",
        promptTemplate: "short textured crop hairstyle with fade, modern men's haircut",
      },
      {
        name: "Long Layered Waves",
        description: "Flowing layers with soft waves that frame the face beautifully",
        category: "Women's Long",
        promptTemplate: "long layered wavy hair, flowing feminine hairstyle",
      },
      {
        name: "Classic Bob with Bangs",
        description: "Timeless shoulder-length bob with soft bangs",
        category: "Women's Medium",
        promptTemplate: "shoulder-length bob haircut with bangs, classic style",
      },
      {
        name: "Fade with Side Part",
        description: "Clean fade with a defined side part for a polished, professional look",
        category: "Men's Short",
        promptTemplate: "clean fade haircut with side part, professional men's style",
      },
      {
        name: "Pixie Cut",
        description: "Bold and edgy short cut with textured styling",
        category: "Women's Short",
        promptTemplate: "short pixie cut, edgy feminine hairstyle",
      },
      {
        name: "Curly Afro",
        description: "Natural, voluminous curls that celebrate your texture",
        category: "Natural",
        promptTemplate: "natural curly afro hairstyle, voluminous curls",
      },
    ];

    await db.insert(hairstyles).values(sampleHairstyles);

    const sampleSalons: InsertSalon[] = [
      {
        name: "Elegance Hair Studio",
        address: "123 Main Street",
        city: "New York",
        rating: 4.8,
        imageUrl: "https://images.pexels.com/photos/3065209/pexels-photo-3065209.jpeg?auto=compress&cs=tinysrgb&w=800",
        specialties: ["Cuts", "Color", "Styling"],
        distance: 0.5,
      },
      {
        name: "The Modern Barber",
        address: "456 Oak Avenue",
        city: "New York",
        rating: 4.9,
        imageUrl: "https://images.pexels.com/photos/1813272/pexels-photo-1813272.jpeg?auto=compress&cs=tinysrgb&w=800",
        specialties: ["Men's Cuts", "Beard Trim", "Hot Towel Shave"],
        distance: 0.8,
      },
      {
        name: "Curl & Co.",
        address: "789 Elm Street",
        city: "New York",
        rating: 4.7,
        imageUrl: "https://images.pexels.com/photos/3992870/pexels-photo-3992870.jpeg?auto=compress&cs=tinysrgb&w=800",
        specialties: ["Natural Hair", "Braiding", "Locs"],
        distance: 1.2,
      },
      {
        name: "Style Haven Salon",
        address: "321 Park Place",
        city: "Los Angeles",
        rating: 4.6,
        imageUrl: "https://images.pexels.com/photos/3993324/pexels-photo-3993324.jpeg?auto=compress&cs=tinysrgb&w=800",
        specialties: ["Balayage", "Extensions", "Updos"],
        distance: 2.1,
      },
      {
        name: "Golden Gate Salon",
        address: "567 Market Street",
        city: "San Francisco",
        rating: 4.9,
        imageUrl: "https://images.pexels.com/photos/3992856/pexels-photo-3992856.jpeg?auto=compress&cs=tinysrgb&w=800",
        specialties: ["Cuts", "Color", "Highlights"],
        distance: 0.3,
      },
      {
        name: "Bay Area Barbers",
        address: "890 Valencia Street",
        city: "San Francisco",
        rating: 4.7,
        imageUrl: "https://images.pexels.com/photos/1570807/pexels-photo-1570807.jpeg?auto=compress&cs=tinysrgb&w=800",
        specialties: ["Men's Cuts", "Fades", "Beard Styling"],
        distance: 0.6,
      },
      {
        name: "Mission District Hair Co.",
        address: "234 Mission Street",
        city: "San Francisco",
        rating: 4.8,
        imageUrl: "https://images.pexels.com/photos/3065171/pexels-photo-3065171.jpeg?auto=compress&cs=tinysrgb&w=800",
        specialties: ["Styling", "Keratin", "Extensions"],
        distance: 0.9,
      },
    ];

    await db.insert(salons).values(sampleSalons);
  }

  private async seedStylists() {
    // Beta demo businesses - Favour's Barbershop and Deborah's Salon
    const betaDemoStylists: InsertStylist[] = [
      {
        name: "Favour's Barbershop",
        bio: "Premium men's grooming experience. Specializing in precision fades, beard sculpting, and classic cuts. Walk-ins welcome. Creating sharp looks for the modern gentleman since 2018.",
        profileImageUrl: "https://images.pexels.com/photos/1805600/pexels-photo-1805600.jpeg?auto=compress&cs=tinysrgb&w=400",
        specialty: "Fades, Beard Styling, Men's Cuts",
        location: "Downtown Oakland",
        address: "1234 Broadway Ave, Suite 101",
        city: "Oakland, CA 94612",
        phone: "(510) 555-0147",
        email: "book@favoursbarbershop.com",
        instagram: "@favoursbarbershop",
        website: "favoursbarbershop.com",
        distance: 2.3,
        priceRange: "$25-$60",
        services: JSON.stringify([
          { name: "Classic Haircut", price: 35, duration: 30 },
          { name: "Fade & Line-up", price: 40, duration: 45 },
          { name: "Beard Trim & Shape", price: 25, duration: 20 },
          { name: "Full Service (Cut + Beard)", price: 55, duration: 60 },
          { name: "Hot Towel Shave", price: 30, duration: 25 },
          { name: "Kid's Cut (12 & under)", price: 25, duration: 25 },
        ]),
        workingHours: JSON.stringify({
          monday: "9:00 AM - 7:00 PM",
          tuesday: "9:00 AM - 7:00 PM",
          wednesday: "9:00 AM - 7:00 PM",
          thursday: "9:00 AM - 8:00 PM",
          friday: "9:00 AM - 8:00 PM",
          saturday: "8:00 AM - 6:00 PM",
          sunday: "Closed",
        }),
        rating: 4.8,
        reviewCount: 127,
        isRegistered: 1,
        isBetaDemo: true,
      },
      {
        name: "Deborah's Salon",
        bio: "Full-service beauty salon dedicated to bringing out your natural beauty. Expert colorists, stylists, and natural hair specialists. Relaxing atmosphere with personalized consultations for every client.",
        profileImageUrl: "https://images.pexels.com/photos/3993455/pexels-photo-3993455.jpeg?auto=compress&cs=tinysrgb&w=400",
        specialty: "Color, Women's Hairstyles, Braiding, Women's Styles",
        location: "Piedmont Ave",
        address: "4567 Piedmont Ave",
        city: "Oakland, CA 94611",
        phone: "(510) 555-0289",
        email: "hello@deborahssalon.com",
        instagram: "@deborahssalon",
        website: "deborahssalon.com",
        distance: 1.8,
        priceRange: "$45-$150",
        services: JSON.stringify([
          { name: "Women's Haircut", price: 55, duration: 45 },
          { name: "Blowout & Style", price: 45, duration: 40 },
          { name: "Full Color", price: 120, duration: 120 },
          { name: "Highlights (Partial)", price: 95, duration: 90 },
          { name: "Highlights (Full)", price: 150, duration: 150 },
          { name: "Natural Hair Styling", price: 65, duration: 60 },
          { name: "Braiding (Cornrows)", price: 85, duration: 120 },
          { name: "Protective Style Consultation", price: 0, duration: 15 },
          { name: "Deep Conditioning Treatment", price: 35, duration: 30 },
        ]),
        workingHours: JSON.stringify({
          monday: "Closed",
          tuesday: "10:00 AM - 7:00 PM",
          wednesday: "10:00 AM - 7:00 PM",
          thursday: "10:00 AM - 8:00 PM",
          friday: "10:00 AM - 8:00 PM",
          saturday: "9:00 AM - 5:00 PM",
          sunday: "10:00 AM - 4:00 PM",
        }),
        rating: 4.9,
        reviewCount: 203,
        isRegistered: 1,
        isBetaDemo: true,
      },
    ];

    // Also keep some regular sample stylists (non-demo)
    const sampleStylists: InsertStylist[] = [
      {
        name: "Sarah Chen",
        bio: "Expert in modern cuts and color. 10+ years experience.",
        profileImageUrl: "https://images.pexels.com/photos/1239254/pexels-photo-1239254.jpeg?auto=compress&cs=tinysrgb&w=400",
        specialty: "Balayage, Keratin, Modern Cuts",
        location: "San Francisco",
        rating: 4.9,
        isRegistered: 0,
        isBetaDemo: false,
      },
      {
        name: "Marcus Johnson",
        bio: "Specialist in men's fades and beard styling.",
        profileImageUrl: "https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=400",
        specialty: "Men's Cuts, Fades, Beard Styling",
        location: "San Francisco",
        rating: 4.8,
        isRegistered: 0,
        isBetaDemo: false,
      },
    ];

    const allStylists = [...betaDemoStylists, ...sampleStylists];
    
    const createdStylists = await Promise.all(
      allStylists.map(s => db.insert(stylists).values(s).returning())
    );

    // Add portfolio images for each stylist
    const favourPortfolio = [
      { imageUrl: "https://images.pexels.com/photos/1570807/pexels-photo-1570807.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Clean fade with line-up" },
      { imageUrl: "https://images.pexels.com/photos/1813272/pexels-photo-1813272.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Textured crop fade" },
      { imageUrl: "https://images.pexels.com/photos/2040189/pexels-photo-2040189.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Classic taper cut" },
      { imageUrl: "https://images.pexels.com/photos/1805600/pexels-photo-1805600.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Precision beard sculpting" },
    ];

    const deborahPortfolio = [
      { imageUrl: "https://images.pexels.com/photos/3993449/pexels-photo-3993449.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Balayage highlights" },
      { imageUrl: "https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Natural curls styling" },
      { imageUrl: "https://images.pexels.com/photos/3993333/pexels-photo-3993333.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Blonde color transformation" },
      { imageUrl: "https://images.pexels.com/photos/3992870/pexels-photo-3992870.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Soft waves finish" },
    ];

    const genericPortfolio = [
      { imageUrl: "https://images.pexels.com/photos/3993333/pexels-photo-3993333.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Modern balayage highlights" },
      { imageUrl: "https://images.pexels.com/photos/3992870/pexels-photo-3992870.jpeg?auto=compress&cs=tinysrgb&w=600", description: "Natural waves style" },
    ];

    for (let i = 0; i < createdStylists.length; i++) {
      const stylist = createdStylists[i][0];
      if (stylist) {
        let portfolio = genericPortfolio;
        if (stylist.name === "Favour's Barbershop") {
          portfolio = favourPortfolio;
        } else if (stylist.name === "Deborah's Salon") {
          portfolio = deborahPortfolio;
        }
        
        for (const item of portfolio) {
          await db.insert(stylistPortfolios).values({
            stylistId: stylist.id,
            ...item,
          });
        }
      }
    }
  }

  private async seedHairstyleReferences() {
    // Sample hairstyle reference images with metadata for the AI matching system
    const sampleReferences: InsertHairstyleReference[] = [
      // Women's styles - various skin tones and face shapes
      {
        imageUrl: "https://images.pexels.com/photos/3993449/pexels-photo-3993449.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Long Wavy Balayage",
        skinTone: "light",
        faceShape: "oval",
        gender: "female",
        hairLength: "long",
        hairTexture: "wavy",
        hairColor: "brunette",
        styleKeywords: ["wavy", "balayage", "highlights", "long", "flowing"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/3992870/pexels-photo-3992870.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Natural Waves Medium",
        skinTone: "medium",
        faceShape: "heart",
        gender: "female",
        hairLength: "medium",
        hairTexture: "wavy",
        hairColor: "brunette",
        styleKeywords: ["waves", "natural", "medium", "soft", "romantic"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Natural Curls",
        skinTone: "dark",
        faceShape: "round",
        gender: "female",
        hairLength: "medium",
        hairTexture: "coily",
        hairColor: "black",
        styleKeywords: ["curly", "natural", "afro", "volume", "textured"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/3993333/pexels-photo-3993333.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Sleek Straight Brunette",
        skinTone: "light",
        faceShape: "oval",
        gender: "female",
        hairLength: "long",
        hairTexture: "straight",
        hairColor: "brunette",
        styleKeywords: ["straight", "sleek", "brunette", "shiny", "polished"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/2726111/pexels-photo-2726111.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Bob Cut Professional",
        skinTone: "medium",
        faceShape: "square",
        gender: "female",
        hairLength: "short",
        hairTexture: "straight",
        hairColor: "black",
        styleKeywords: ["bob", "short", "professional", "sleek", "modern"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/1898555/pexels-photo-1898555.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Curly Long Natural",
        skinTone: "olive",
        faceShape: "oval",
        gender: "female",
        hairLength: "long",
        hairTexture: "curly",
        hairColor: "brunette",
        styleKeywords: ["curly", "long", "natural", "volume", "bouncy"],
      },
      // Men's styles - various skin tones and face shapes
      {
        imageUrl: "https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Clean Fade",
        skinTone: "dark",
        faceShape: "round",
        gender: "male",
        hairLength: "short",
        hairTexture: "coily",
        hairColor: "black",
        styleKeywords: ["fade", "clean", "short", "modern", "professional"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Textured Quiff",
        skinTone: "light",
        faceShape: "square",
        gender: "male",
        hairLength: "short",
        hairTexture: "straight",
        hairColor: "brunette",
        styleKeywords: ["quiff", "textured", "short", "styled", "modern"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/1680172/pexels-photo-1680172.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Side Part Classic",
        skinTone: "medium",
        faceShape: "oval",
        gender: "male",
        hairLength: "short",
        hairTexture: "straight",
        hairColor: "black",
        styleKeywords: ["side part", "classic", "professional", "clean", "business"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Curly Top Fade",
        skinTone: "dark",
        faceShape: "oval",
        gender: "male",
        hairLength: "short",
        hairTexture: "curly",
        hairColor: "black",
        styleKeywords: ["curly", "fade", "textured", "afro", "modern"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/2269872/pexels-photo-2269872.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Medium Length Waves",
        skinTone: "olive",
        faceShape: "heart",
        gender: "male",
        hairLength: "medium",
        hairTexture: "wavy",
        hairColor: "brunette",
        styleKeywords: ["waves", "medium", "casual", "textured", "natural"],
      },
      {
        imageUrl: "https://images.pexels.com/photos/1043474/pexels-photo-1043474.jpeg?auto=compress&cs=tinysrgb&w=800",
        styleName: "Buzz Cut Clean",
        skinTone: "light",
        faceShape: "round",
        gender: "male",
        hairLength: "short",
        hairTexture: "straight",
        hairColor: "brunette",
        styleKeywords: ["buzz", "short", "clean", "minimal", "easy"],
      },
    ];

    await db.insert(hairstyleReferences).values(sampleReferences);
    console.log(`Seeded ${sampleReferences.length} hairstyle references for AI matching`);
  }

  async getAllStylists(): Promise<StylistWithPortfolio[]> {
    const allStylists = await db.select().from(stylists);
    const result: StylistWithPortfolio[] = [];
    for (const stylist of allStylists) {
      const portfolio = await db.select().from(stylistPortfolios).where(eq(stylistPortfolios.stylistId, stylist.id));
      result.push({ ...stylist, portfolio });
    }
    return result;
  }

  async getStylistById(id: string): Promise<StylistWithPortfolio | undefined> {
    const [stylist] = await db.select().from(stylists).where(eq(stylists.id, id));
    if (!stylist) return undefined;
    const portfolio = await db.select().from(stylistPortfolios).where(eq(stylistPortfolios.stylistId, id));
    return { ...stylist, portfolio };
  }

  async createStylist(stylist: InsertStylist): Promise<Stylist> {
    const [newStylist] = await db.insert(stylists).values(stylist).returning();
    return newStylist;
  }

  async addPortfolioImage(stylistId: string, portfolio: Omit<InsertStylistPortfolio, 'stylistId'>): Promise<StylistPortfolio> {
    const [image] = await db.insert(stylistPortfolios).values({ stylistId, ...portfolio }).returning();
    return image;
  }

  async createAppointment(appointment: InsertAppointment): Promise<Appointment> {
    const [newAppointment] = await db.insert(appointments).values(appointment).returning();
    return newAppointment;
  }

  async getUserAppointments(userId: string): Promise<Appointment[]> {
    return db.select().from(appointments).where(eq(appointments.userId, userId));
  }

  async getBetaDemoStylists(): Promise<StylistWithPortfolio[]> {
    const allStylists = await db.select().from(stylists).where(eq(stylists.isBetaDemo, true));
    const result: StylistWithPortfolio[] = [];
    for (const stylist of allStylists) {
      const portfolio = await db.select().from(stylistPortfolios).where(eq(stylistPortfolios.stylistId, stylist.id));
      result.push({ ...stylist, portfolio });
    }
    return result;
  }

  async getBetaBookingsCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(appointments)
      .where(eq(appointments.isBetaBooking, true));
    return result[0]?.count || 0;
  }

  async getBetaBookings(limit: number, offset: number): Promise<any[]> {
    const betaBookings = await db.select()
      .from(appointments)
      .where(eq(appointments.isBetaBooking, true))
      .orderBy(desc(appointments.createdAt))
      .limit(limit)
      .offset(offset);

    // Enrich with stylist info
    const enriched = await Promise.all(betaBookings.map(async (booking) => {
      const stylist = await this.getStylistById(booking.stylistId);
      return {
        ...booking,
        stylistName: stylist?.name || "Unknown",
        stylistProfileImage: stylist?.profileImageUrl || null,
      };
    }));

    return enriched;
  }

  // Hairstyle reference methods
  async getAllHairstyleReferences(): Promise<HairstyleReference[]> {
    return db.select().from(hairstyleReferences);
  }

  async searchHairstyleReferences(params: {
    skinTone?: string;
    faceShape?: string;
    gender?: string;
    keywords?: string[];
  }): Promise<HairstyleReference[]> {
    let query = db.select().from(hairstyleReferences);
    
    const conditions: any[] = [];
    
    if (params.skinTone) {
      conditions.push(eq(hairstyleReferences.skinTone, params.skinTone));
    }
    if (params.faceShape) {
      conditions.push(eq(hairstyleReferences.faceShape, params.faceShape));
    }
    if (params.gender) {
      conditions.push(eq(hairstyleReferences.gender, params.gender));
    }
    
    if (conditions.length > 0) {
      return db.select().from(hairstyleReferences).where(and(...conditions));
    }
    
    return db.select().from(hairstyleReferences);
  }

  async createHairstyleReference(reference: InsertHairstyleReference): Promise<HairstyleReference> {
    const [newReference] = await db.insert(hairstyleReferences).values(reference).returning();
    return newReference;
  }

  // ===============================
  // BUSINESS BOOKING OPERATIONS
  // ===============================

  async createBusiness(business: InsertBusiness): Promise<Business> {
    const [newBusiness] = await db.insert(businesses).values(business).returning();
    return newBusiness;
  }

  async getBusinessById(id: string): Promise<Business | undefined> {
    const [business] = await db.select().from(businesses).where(eq(businesses.id, id));
    return business;
  }

  async getBusinessByGooglePlaceId(placeId: string): Promise<Business | undefined> {
    const [business] = await db.select().from(businesses).where(eq(businesses.googlePlaceId, placeId));
    return business;
  }

  async getBusinessByOwnerId(ownerId: string): Promise<Business | undefined> {
    const [business] = await db.select().from(businesses).where(eq(businesses.ownerId, ownerId));
    return business;
  }

  async updateBusiness(id: string, updates: Partial<Business>): Promise<Business | undefined> {
    const [business] = await db.update(businesses).set({ ...updates, updatedAt: new Date() }).where(eq(businesses.id, id)).returning();
    return business;
  }

  async getBusinessWithDetails(id: string): Promise<BusinessWithDetails | undefined> {
    const business = await this.getBusinessById(id);
    if (!business) return undefined;

    const businessServices = await this.getServicesByBusinessId(id);
    const businessStylistsList = await this.getBusinessStylistsByBusinessId(id);

    // Get availability and time-off for each stylist
    const stylistsWithAvailability = await Promise.all(
      businessStylistsList.map(async (stylist) => {
        const availability = await this.getStylistAvailability(stylist.id);
        const timeOff = await db.select().from(stylistTimeOff).where(eq(stylistTimeOff.stylistId, stylist.id));
        return { ...stylist, availability, timeOff };
      })
    );

    return {
      ...business,
      services: businessServices,
      stylists: stylistsWithAvailability,
    };
  }

  async getActiveBusinesses(): Promise<Business[]> {
    return db.select().from(businesses).where(eq(businesses.isActive, 1));
  }

  async searchBusinessesByName(query: string): Promise<Business[]> {
    // Search for active businesses whose name contains the query (case-insensitive)
    const allActive = await db.select().from(businesses).where(eq(businesses.isActive, 1));
    return allActive.filter(b => b.name.toLowerCase().includes(query.toLowerCase()));
  }

  // Services
  async createService(service: InsertService): Promise<Service> {
    const [newService] = await db.insert(services).values(service).returning();
    return newService;
  }

  async getServicesByBusinessId(businessId: string): Promise<Service[]> {
    return db.select().from(services).where(and(eq(services.businessId, businessId), eq(services.isActive, 1)));
  }

  async updateService(id: string, updates: Partial<Service>): Promise<Service | undefined> {
    const [service] = await db.update(services).set(updates).where(eq(services.id, id)).returning();
    return service;
  }

  async deleteService(id: string): Promise<boolean> {
    const [service] = await db.update(services).set({ isActive: 0 }).where(eq(services.id, id)).returning();
    return !!service;
  }

  // Business stylists
  async createBusinessStylist(stylist: InsertBusinessStylist): Promise<BusinessStylist> {
    const [newStylist] = await db.insert(businessStylists).values(stylist).returning();
    return newStylist;
  }

  async getBusinessStylistsByBusinessId(businessId: string): Promise<BusinessStylist[]> {
    return db.select().from(businessStylists).where(and(eq(businessStylists.businessId, businessId), eq(businessStylists.isActive, 1)));
  }

  async getBusinessStylistById(id: string): Promise<BusinessStylist | undefined> {
    const [stylist] = await db.select().from(businessStylists).where(eq(businessStylists.id, id));
    return stylist;
  }

  async updateBusinessStylist(id: string, updates: Partial<BusinessStylist>): Promise<BusinessStylist | undefined> {
    const [stylist] = await db.update(businessStylists).set(updates).where(eq(businessStylists.id, id)).returning();
    return stylist;
  }

  async deleteBusinessStylist(id: string): Promise<boolean> {
    const [stylist] = await db.update(businessStylists).set({ isActive: 0 }).where(eq(businessStylists.id, id)).returning();
    return !!stylist;
  }

  // Stylist availability
  async setStylistAvailability(stylistId: string, availability: Omit<InsertStylistAvailability, 'stylistId'>[]): Promise<StylistAvailability[]> {
    // Delete existing availability for this stylist
    await db.delete(stylistAvailability).where(eq(stylistAvailability.stylistId, stylistId));
    
    // Insert new availability
    if (availability.length === 0) return [];
    
    const newAvailability = await db.insert(stylistAvailability)
      .values(availability.map(a => ({ ...a, stylistId })))
      .returning();
    
    return newAvailability;
  }

  async getStylistAvailability(stylistId: string): Promise<StylistAvailability[]> {
    return db.select().from(stylistAvailability).where(eq(stylistAvailability.stylistId, stylistId));
  }

  // Stylist time off
  async addStylistTimeOff(timeOff: InsertStylistTimeOff): Promise<StylistTimeOff> {
    const [newTimeOff] = await db.insert(stylistTimeOff).values(timeOff).returning();
    return newTimeOff;
  }

  async getStylistTimeOff(stylistId: string, startDate: string, endDate: string): Promise<StylistTimeOff[]> {
    return db.select().from(stylistTimeOff)
      .where(and(
        eq(stylistTimeOff.stylistId, stylistId),
        sql`${stylistTimeOff.date} >= ${startDate}`,
        sql`${stylistTimeOff.date} <= ${endDate}`
      ));
  }

  async deleteStylistTimeOff(id: string): Promise<boolean> {
    const result = await db.delete(stylistTimeOff).where(eq(stylistTimeOff.id, id)).returning();
    return result.length > 0;
  }

  // Bookings - with atomic double-booking prevention using advisory lock + transaction
  async createBooking(booking: InsertBooking): Promise<Booking> {
    // Use a transaction with PostgreSQL advisory lock to prevent race conditions
    // Advisory locks work even when there are no existing rows to lock
    const result = await db.transaction(async (tx) => {
      // Generate a unique lock key from stylist ID and date
      // Using a hash to fit within bigint range for pg_advisory_xact_lock
      const lockKey = Math.abs(this.hashCode(`${booking.stylistId}:${booking.date}`));
      
      // Acquire exclusive advisory lock for this stylist+date combination
      // This blocks other transactions trying to book the same stylist/date
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      // Now safely check existing bookings with the lock held
      const existingBookings = await tx.select()
        .from(bookings)
        .where(and(
          eq(bookings.stylistId, booking.stylistId),
          eq(bookings.date, booking.date),
          sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
        ));

      // Check for time overlap with existing bookings
      const hasConflict = existingBookings.some(existing => {
        const toMinutes = (time: string) => {
          const [h, m] = time.split(':').map(Number);
          return h * 60 + m;
        };
        
        const newStart = toMinutes(booking.startTime);
        const newEnd = toMinutes(booking.endTime);
        const existingStart = toMinutes(existing.startTime);
        const existingEnd = toMinutes(existing.endTime);
        
        // Check if time ranges overlap
        return newStart < existingEnd && existingStart < newEnd;
      });

      if (hasConflict) {
        throw new Error("DOUBLE_BOOKING_CONFLICT: This time slot is already booked");
      }

      // No conflict, create the booking
      const [newBooking] = await tx.insert(bookings).values(booking).returning();
      return newBooking;
    });

    return result;
  }

  // Simple hash function to generate consistent lock keys
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  async getBookingById(id: string): Promise<BookingWithDetails | undefined> {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!booking) return undefined;

    const [business] = await db.select().from(businesses).where(eq(businesses.id, booking.businessId));
    const [stylist] = await db.select().from(businessStylists).where(eq(businessStylists.id, booking.stylistId));
    const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
    const user = booking.userId ? await this.getUser(booking.userId) : undefined;

    return {
      ...booking,
      business: business!,
      stylist: stylist!,
      service: service!,
      user,
    };
  }

  async getBookingsByBusinessId(businessId: string, date?: string): Promise<Booking[]> {
    if (date) {
      return db.select().from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.date, date)));
    }
    return db.select().from(bookings).where(eq(bookings.businessId, businessId));
  }

  async getBookingsByStylistId(stylistId: string, date: string): Promise<Booking[]> {
    return db.select().from(bookings).where(
      and(
        eq(bookings.stylistId, stylistId),
        eq(bookings.date, date),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    );
  }

  async getBookingsByUserId(userId: string): Promise<BookingWithDetails[]> {
    const userBookings = await db.select().from(bookings)
      .where(eq(bookings.userId, userId))
      .orderBy(desc(bookings.createdAt));

    const bookingsWithDetails: BookingWithDetails[] = await Promise.all(
      userBookings.map(async (booking) => {
        const [business] = await db.select().from(businesses).where(eq(businesses.id, booking.businessId));
        const [stylist] = await db.select().from(businessStylists).where(eq(businessStylists.id, booking.stylistId));
        const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
        return {
          ...booking,
          business: business!,
          stylist: stylist!,
          service: service!,
        };
      })
    );

    return bookingsWithDetails;
  }

  async updateBookingStatus(id: string, status: string): Promise<Booking | undefined> {
    const [booking] = await db.update(bookings).set({ status, updatedAt: new Date() }).where(eq(bookings.id, id)).returning();
    return booking;
  }

  async cancelBooking(id: string): Promise<boolean> {
    const [booking] = await db.update(bookings).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(bookings.id, id)).returning();
    return !!booking;
  }

  // Get available time slots
  async getAvailableSlots(stylistId: string, date: string, serviceDuration: number): Promise<{ startTime: string; endTime: string }[]> {
    // Get day of week (0=Sunday, 6=Saturday)
    // Parse date string as local date to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayOfWeek = dateObj.getDay();

    // Get stylist availability for this day
    const [availability] = await db.select().from(stylistAvailability)
      .where(and(
        eq(stylistAvailability.stylistId, stylistId),
        eq(stylistAvailability.dayOfWeek, dayOfWeek),
        eq(stylistAvailability.isAvailable, 1)
      ));

    // Check if this is a demo shop stylist - generate mock availability if no real availability exists
    if (!availability) {
      // Check if stylist belongs to demo shop
      const allBusinesses = await db.select().from(businesses).where(eq(businesses.isActive, 1));
      const demoShop = allBusinesses.find(b => b.googlePlaceId === "demo-favours-shop");
      
      if (demoShop) {
        const demoStylists = await db.select().from(businessStylists)
          .where(and(eq(businessStylists.businessId, demoShop.id), eq(businessStylists.isActive, 1)));
        const isDemoStylist = demoStylists.some(s => s.id === stylistId);
        
        if (isDemoStylist && dayOfWeek !== 0) { // Skip Sunday
          // Generate demo slots for weekdays 9am-5pm, Saturday 9am-4pm
          const slots: { startTime: string; endTime: string }[] = [];
          const startHour = 9;
          const endHour = dayOfWeek === 6 ? 16 : 17;
          
          // Get existing bookings to exclude
          const existingBookings = await this.getBookingsByStylistId(stylistId, date);
          
          for (let hour = startHour; hour < endHour; hour++) {
            for (let min = 0; min < 60; min += 30) {
              const slotStart = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
              const endMinutes = hour * 60 + min + serviceDuration;
              const slotEndHour = Math.floor(endMinutes / 60);
              const slotEndMinute = endMinutes % 60;
              const slotEnd = `${String(slotEndHour).padStart(2, '0')}:${String(slotEndMinute).padStart(2, '0')}`;
              
              if (slotEndHour <= endHour) {
                // Check for booking conflicts
                const hasConflict = existingBookings.some(booking => {
                  return (slotStart < booking.endTime && slotEnd > booking.startTime);
                });
                
                if (!hasConflict) {
                  slots.push({ startTime: slotStart, endTime: slotEnd });
                }
              }
            }
          }
          return slots;
        }
      }
      return [];
    }

    // Check for time off on this date
    const timeOffList = await db.select().from(stylistTimeOff)
      .where(and(
        eq(stylistTimeOff.stylistId, stylistId),
        eq(stylistTimeOff.date, date)
      ));

    // If full day off, no slots available
    if (timeOffList.some(to => !to.startTime)) return [];

    // Get existing bookings for this stylist on this date
    const existingBookings = await this.getBookingsByStylistId(stylistId, date);

    // Generate time slots based on availability
    const slots: { startTime: string; endTime: string }[] = [];
    const startHour = parseInt(availability.startTime.split(':')[0]);
    const startMinute = parseInt(availability.startTime.split(':')[1]);
    const endHour = parseInt(availability.endTime.split(':')[0]);
    const endMinute = parseInt(availability.endTime.split(':')[1]);

    // Generate slots in 30-minute increments
    let currentHour = startHour;
    let currentMinute = startMinute;

    while (true) {
      const slotStart = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
      
      // Calculate end time based on service duration
      let endTimeMinutes = currentHour * 60 + currentMinute + serviceDuration;
      const slotEndHour = Math.floor(endTimeMinutes / 60);
      const slotEndMinute = endTimeMinutes % 60;
      const slotEnd = `${String(slotEndHour).padStart(2, '0')}:${String(slotEndMinute).padStart(2, '0')}`;

      // Check if slot end time exceeds availability
      if (slotEndHour > endHour || (slotEndHour === endHour && slotEndMinute > endMinute)) {
        break;
      }

      // Check if slot conflicts with existing bookings
      const hasConflict = existingBookings.some(booking => {
        const bookingStart = booking.startTime;
        const bookingEnd = booking.endTime;
        return (slotStart < bookingEnd && slotEnd > bookingStart);
      });

      // Check if slot conflicts with time off
      const hasTimeOffConflict = timeOffList.some(to => {
        if (!to.startTime || !to.endTime) return false;
        return (slotStart < to.endTime && slotEnd > to.startTime);
      });

      if (!hasConflict && !hasTimeOffConflict) {
        slots.push({ startTime: slotStart, endTime: slotEnd });
      }

      // Move to next slot (30-minute increments)
      currentMinute += 30;
      if (currentMinute >= 60) {
        currentHour += 1;
        currentMinute = 0;
      }

      // Prevent infinite loop
      if (currentHour > 23) break;
    }

    return slots;
  }

  // User profile data methods
  async getUserUpcomingBookings(userId: string): Promise<BookingWithDetails[]> {
    const today = new Date().toISOString().split('T')[0];
    const userBookings = await db.select()
      .from(bookings)
      .where(and(
        eq(bookings.userId, userId),
        sql`${bookings.date} >= ${today}`,
        sql`${bookings.status} IN ('pending', 'confirmed')`
      ))
      .orderBy(bookings.date);

    const results: BookingWithDetails[] = [];
    for (const booking of userBookings) {
      const business = await db.select().from(businesses).where(eq(businesses.id, booking.businessId)).limit(1);
      const stylist = await db.select().from(businessStylists).where(eq(businessStylists.id, booking.stylistId)).limit(1);
      const service = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
      
      if (business[0] && stylist[0] && service[0]) {
        results.push({
          ...booking,
          business: business[0],
          stylist: stylist[0],
          service: service[0],
        });
      }
    }
    return results;
  }

  async getUserTransformations(userId: string, limit: number = 10): Promise<GeneratedVariant[]> {
    // Get sessions that belong to this user
    const userSessionsList = await db.select()
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .orderBy(desc(userSessions.createdAt))
      .limit(limit);

    if (userSessionsList.length === 0) return [];

    const sessionIds = userSessionsList.map(s => s.id);
    
    // Get completed variants from those sessions
    const variants = await db.select()
      .from(generatedVariants)
      .where(and(
        sql`${generatedVariants.sessionId} IN (${sql.join(sessionIds.map(id => sql`${id}`), sql`, `)})`,
        eq(generatedVariants.status, 'completed')
      ))
      .orderBy(desc(generatedVariants.id))
      .limit(limit);

    return variants;
  }

  async getUserReviews(userId: string): Promise<BusinessReview[]> {
    return await db.select()
      .from(businessReviews)
      .where(eq(businessReviews.userId, userId))
      .orderBy(desc(businessReviews.createdAt));
  }

  async createBusinessReview(review: InsertBusinessReview): Promise<BusinessReview> {
    const [newReview] = await db.insert(businessReviews).values(review).returning();
    return newReview;
  }

  async getBusinessReviews(businessId: string): Promise<BusinessReviewWithDetails[]> {
    const reviews = await db.select()
      .from(businessReviews)
      .where(eq(businessReviews.businessId, businessId))
      .orderBy(desc(businessReviews.createdAt));
    
    // Enrich with user and booking details
    const enriched = await Promise.all(reviews.map(async (review) => {
      const [business] = await db.select().from(businesses).where(eq(businesses.id, review.businessId));
      const [user] = review.userId ? await db.select().from(users).where(eq(users.id, review.userId)) : [undefined];
      const [booking] = review.bookingId ? await db.select().from(bookings).where(eq(bookings.id, review.bookingId)) : [undefined];
      return { ...review, business, user, booking };
    }));
    
    return enriched;
  }

  async getBusinessAverageRating(businessId: string): Promise<{ average: number; count: number }> {
    const result = await db.select({
      avg: sql<number>`AVG(${businessReviews.rating})`,
      count: sql<number>`COUNT(*)`
    }).from(businessReviews).where(eq(businessReviews.businessId, businessId));
    
    return { average: result[0]?.avg || 0, count: result[0]?.count || 0 };
  }

  // Stylist reviews
  async getStylistReviews(stylistId: string): Promise<StylistReviewWithDetails[]> {
    const reviews = await db.select()
      .from(stylistReviews)
      .where(eq(stylistReviews.stylistId, stylistId))
      .orderBy(desc(stylistReviews.createdAt));
    
    const enriched = await Promise.all(reviews.map(async (review) => {
      const [stylist] = await db.select().from(businessStylists).where(eq(businessStylists.id, review.stylistId));
      const [user] = review.userId ? await db.select().from(users).where(eq(users.id, review.userId)) : [undefined];
      const [booking] = review.bookingId ? await db.select().from(bookings).where(eq(bookings.id, review.bookingId)) : [undefined];
      return { ...review, stylist, user, booking };
    }));
    
    return enriched;
  }

  async createStylistReview(review: InsertStylistReview): Promise<StylistReview> {
    const [newReview] = await db.insert(stylistReviews).values(review).returning();
    return newReview;
  }

  async getStylistAverageRating(stylistId: string): Promise<{ average: number; count: number }> {
    const result = await db.select({
      avg: sql<number>`AVG(${stylistReviews.rating})`,
      count: sql<number>`COUNT(*)`
    }).from(stylistReviews).where(eq(stylistReviews.stylistId, stylistId));
    
    return { average: result[0]?.avg || 0, count: result[0]?.count || 0 };
  }

  async getUserStylistReviews(userId: string): Promise<StylistReview[]> {
    return await db.select()
      .from(stylistReviews)
      .where(eq(stylistReviews.userId, userId))
      .orderBy(desc(stylistReviews.createdAt));
  }

  async canUserReviewBooking(userId: string, bookingId: string): Promise<boolean> {
    // Check if booking exists, is completed, belongs to user, and hasn't been reviewed
    const [booking] = await db.select().from(bookings).where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.userId, userId),
        eq(bookings.status, 'completed')
      )
    );
    
    if (!booking) return false;
    
    // Check if already reviewed
    const [existingStylistReview] = await db.select().from(stylistReviews)
      .where(and(eq(stylistReviews.bookingId, bookingId), eq(stylistReviews.userId, userId)));
    const [existingBusinessReview] = await db.select().from(businessReviews)
      .where(and(eq(businessReviews.bookingId, bookingId), eq(businessReviews.userId, userId)));
    
    return !existingStylistReview && !existingBusinessReview;
  }

  // Appointment history
  async getUserAppointmentHistory(userId: string, status?: string): Promise<BookingWithDetails[]> {
    const conditions = [eq(bookings.userId, userId)];
    if (status) {
      conditions.push(eq(bookings.status, status));
    }
    
    const userBookings = await db.select()
      .from(bookings)
      .where(and(...conditions))
      .orderBy(desc(bookings.createdAt));
    
    const enriched = await Promise.all(userBookings.map(async (booking) => {
      const [business] = await db.select().from(businesses).where(eq(businesses.id, booking.businessId));
      const [stylist] = await db.select().from(businessStylists).where(eq(businessStylists.id, booking.stylistId));
      const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
      const [user] = booking.userId ? await db.select().from(users).where(eq(users.id, booking.userId)) : [undefined];
      return { ...booking, business, stylist, service, user };
    }));
    
    return enriched;
  }

  // Reschedule booking
  async rescheduleBooking(
    bookingId: string, 
    newDate: string, 
    newStartTime: string, 
    newEndTime: string
  ): Promise<Booking> {
    // Get original booking
    const [originalBooking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!originalBooking) throw new Error("Booking not found");
    
    // Use advisory lock and transaction for new slot
    const result = await db.transaction(async (tx) => {
      const lockKey = Math.abs(this.hashCode(`${originalBooking.stylistId}:${newDate}`));
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
      
      // Check if new slot is available
      const conflictingBookings = await tx.select()
        .from(bookings)
        .where(and(
          eq(bookings.stylistId, originalBooking.stylistId),
          eq(bookings.date, newDate),
          sql`${bookings.status} NOT IN ('cancelled', 'no_show')`,
          sql`${bookings.id} != ${bookingId}` // Exclude current booking
        ));
      
      const toMinutes = (time: string) => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
      };
      
      const newStart = toMinutes(newStartTime);
      const newEnd = toMinutes(newEndTime);
      
      const hasConflict = conflictingBookings.some(existing => {
        const existingStart = toMinutes(existing.startTime);
        const existingEnd = toMinutes(existing.endTime);
        return newStart < existingEnd && existingStart < newEnd;
      });
      
      if (hasConflict) {
        throw new Error("SLOT_UNAVAILABLE: The new time slot is not available");
      }
      
      // Update the booking with new time
      const [updatedBooking] = await tx.update(bookings)
        .set({
          date: newDate,
          startTime: newStartTime,
          endTime: newEndTime,
          rescheduledFromId: originalBooking.rescheduledFromId || bookingId,
          rescheduledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, bookingId))
        .returning();
      
      return updatedBooking;
    });
    
    return result;
  }

  // Advanced scheduling methods
  async getStylistAvailabilityByDay(stylistId: string, dayOfWeek: number): Promise<StylistAvailability | undefined> {
    const [availability] = await db.select().from(stylistAvailability)
      .where(and(
        eq(stylistAvailability.stylistId, stylistId),
        eq(stylistAvailability.dayOfWeek, dayOfWeek)
      ));
    return availability;
  }

  async getStylistTimeOffByDate(stylistId: string, date: string): Promise<StylistTimeOff[]> {
    return db.select().from(stylistTimeOff)
      .where(and(
        eq(stylistTimeOff.stylistId, stylistId),
        eq(stylistTimeOff.date, date)
      ));
  }

  async getBookingsByStylistAndDate(stylistId: string, date: string): Promise<Booking[]> {
    return db.select().from(bookings)
      .where(and(
        eq(bookings.stylistId, stylistId),
        eq(bookings.date, date)
      ));
  }

  async getBusinessStylists(businessId: string): Promise<BusinessStylist[]> {
    return db.select().from(businessStylists)
      .where(eq(businessStylists.businessId, businessId));
  }

  async getService(serviceId: string): Promise<Service | undefined> {
    const [service] = await db.select().from(services)
      .where(eq(services.id, serviceId));
    return service;
  }

  // Waitlist operations
  async createWaitlistEntry(entry: InsertWaitlistEntry): Promise<WaitlistEntry> {
    const [newEntry] = await db.insert(waitlistEntries).values(entry).returning();
    return newEntry;
  }

  async getWaitlistEntriesForOpening(
    businessId: string, 
    date: string, 
    serviceId: string, 
    stylistId?: string | null
  ): Promise<WaitlistEntry[]> {
    const conditions = [
      eq(waitlistEntries.businessId, businessId),
      eq(waitlistEntries.serviceId, serviceId),
      eq(waitlistEntries.status, 'waiting'),
    ];
    
    // Match by preferred date or flexible dates
    const results = await db.select().from(waitlistEntries)
      .where(and(...conditions));
    
    return results.filter(entry => {
      // Match date or flexible
      const dateMatches = entry.preferredDate === date || entry.flexibleDates === 1;
      // Match stylist or any stylist
      const stylistMatches = !entry.stylistId || !stylistId || entry.stylistId === stylistId;
      return dateMatches && stylistMatches;
    });
  }

  async updateWaitlistEntry(id: string, updates: Partial<WaitlistEntry>): Promise<WaitlistEntry | undefined> {
    const [updated] = await db.update(waitlistEntries)
      .set(updates)
      .where(eq(waitlistEntries.id, id))
      .returning();
    return updated;
  }

  async getUserWaitlistEntries(userId: string): Promise<WaitlistEntry[]> {
    return db.select().from(waitlistEntries)
      .where(eq(waitlistEntries.userId, userId))
      .orderBy(desc(waitlistEntries.createdAt));
  }

  // Recurring booking operations
  async createRecurringRule(rule: InsertRecurringBookingRule): Promise<RecurringBookingRule> {
    const [newRule] = await db.insert(recurringBookingRules).values(rule).returning();
    return newRule;
  }

  async getRecurringRuleById(id: string): Promise<RecurringBookingRule | undefined> {
    const [rule] = await db.select().from(recurringBookingRules)
      .where(eq(recurringBookingRules.id, id));
    return rule;
  }

  async updateRecurringRule(id: string, updates: Partial<RecurringBookingRule>): Promise<RecurringBookingRule | undefined> {
    const [updated] = await db.update(recurringBookingRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(recurringBookingRules.id, id))
      .returning();
    return updated;
  }

  async cancelRecurringRule(id: string): Promise<boolean> {
    const [updated] = await db.update(recurringBookingRules)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(eq(recurringBookingRules.id, id))
      .returning();
    return !!updated;
  }

  async getActiveRecurringRulesByStylist(stylistId: string): Promise<RecurringBookingRule[]> {
    return db.select().from(recurringBookingRules)
      .where(and(
        eq(recurringBookingRules.stylistId, stylistId),
        eq(recurringBookingRules.isActive, 1)
      ));
  }

  // Push notification operations
  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const [newSub] = await db.insert(pushSubscriptions).values(subscription).returning();
    return newSub;
  }

  async getPushSubscriptionsByUserId(userId: string): Promise<PushSubscription[]> {
    return db.select().from(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.isActive, 1)
      ));
  }

  async deletePushSubscription(endpoint: string): Promise<boolean> {
    const result = await db.delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .returning();
    return result.length > 0;
  }

  // Notification operations
  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotif] = await db.insert(notifications).values(notification).returning();
    return newNotif;
  }

  async getUserNotifications(userId: string, limit: number = 50): Promise<Notification[]> {
    return db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async markNotificationRead(id: string): Promise<void> {
    await db.update(notifications)
      .set({ status: 'read', readAt: new Date() })
      .where(eq(notifications.id, id));
  }

  // Preprocessing cache operations (persistent storage for masks, ethnicity, etc.)
  async getPreprocessingCache(cacheKey: string): Promise<PreprocessingCache | undefined> {
    const [cached] = await db.select().from(preprocessingCache)
      .where(eq(preprocessingCache.cacheKey, cacheKey));
    
    // Check if expired
    if (cached && cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
      // Delete expired entry
      await db.delete(preprocessingCache).where(eq(preprocessingCache.cacheKey, cacheKey));
      return undefined;
    }
    
    return cached;
  }

  async setPreprocessingCache(cacheKey: string, data: Partial<InsertPreprocessingCache>): Promise<PreprocessingCache> {
    const now = new Date();
    // Default expiry: 2 hours from now
    const expiresAt = data.expiresAt || new Date(now.getTime() + 2 * 60 * 60 * 1000);
    
    const [cached] = await db.insert(preprocessingCache)
      .values({
        cacheKey,
        sessionId: data.sessionId,
        maskedUserPhoto: data.maskedUserPhoto,
        userAnalysis: data.userAnalysis,
        ethnicity: data.ethnicity,
        gender: data.gender,
        faceShape: data.faceShape,
        rankedReferences: data.rankedReferences,
        usedReferenceIndex: data.usedReferenceIndex || 0,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: preprocessingCache.cacheKey,
        set: {
          sessionId: data.sessionId,
          maskedUserPhoto: data.maskedUserPhoto,
          userAnalysis: data.userAnalysis,
          ethnicity: data.ethnicity,
          gender: data.gender,
          faceShape: data.faceShape,
          rankedReferences: data.rankedReferences,
          usedReferenceIndex: data.usedReferenceIndex,
          expiresAt,
          updatedAt: now,
        },
      })
      .returning();
    
    return cached;
  }

  async updatePreprocessingCache(cacheKey: string, updates: Partial<PreprocessingCache>): Promise<PreprocessingCache | undefined> {
    const [updated] = await db.update(preprocessingCache)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(preprocessingCache.cacheKey, cacheKey))
      .returning();
    return updated;
  }

  async cleanupExpiredCache(): Promise<number> {
    const result = await db.delete(preprocessingCache)
      .where(sql`${preprocessingCache.expiresAt} < NOW()`)
      .returning();
    return result.length;
  }

  async clearAllPreprocessingCache(): Promise<number> {
    const result = await db.delete(preprocessingCache).returning();
    return result.length;
  }

  // Beta feedback methods
  async createBetaFeedback(feedback: InsertBetaFeedback): Promise<BetaFeedback> {
    const [created] = await db.insert(betaFeedback)
      .values(feedback)
      .returning();
    return created;
  }

  async getDeviceFeedbackCount(deviceId: string): Promise<number> {
    const [result] = await db.select({ count: sql`count(*)` })
      .from(betaFeedback)
      .where(eq(betaFeedback.deviceId, deviceId));
    return Number(result?.count || 0);
  }

  // Admin monitoring methods
  async getAllFeedback(limit = 100, offset = 0): Promise<BetaFeedback[]> {
    return db.select().from(betaFeedback)
      .orderBy(sql`${betaFeedback.createdAt} DESC`)
      .limit(limit)
      .offset(offset);
  }

  async getFeedbackCount(): Promise<number> {
    const [result] = await db.select({ count: sql`count(*)` }).from(betaFeedback);
    return Number(result?.count || 0);
  }

  async getAllUsers(limit = 100, offset = 0): Promise<User[]> {
    return db.select().from(users)
      .orderBy(sql`${users.createdAt} DESC`)
      .limit(limit)
      .offset(offset);
  }

  async getUserCount(): Promise<number> {
    const [result] = await db.select({ count: sql`count(*)` }).from(users);
    return Number(result?.count || 0);
  }

  async getUsersCreatedAfter(date: Date): Promise<User[]> {
    return db.select().from(users)
      .where(sql`${users.createdAt} >= ${date}`)
      .orderBy(sql`${users.createdAt} DESC`);
  }

  async getAllBookings(limit = 100, offset = 0): Promise<Booking[]> {
    return db.select().from(bookings)
      .orderBy(sql`${bookings.createdAt} DESC`)
      .limit(limit)
      .offset(offset);
  }

  async getBookingCount(): Promise<number> {
    const [result] = await db.select({ count: sql`count(*)` }).from(bookings);
    return Number(result?.count || 0);
  }

  async getRecentGenerations(limit = 100): Promise<GeneratedVariant[]> {
    // Join with sessions to get chronological order
    const results = await db.select({
      variant: generatedVariants
    })
      .from(generatedVariants)
      .innerJoin(userSessions, eq(generatedVariants.sessionId, userSessions.id))
      .orderBy(desc(userSessions.createdAt))
      .limit(limit);
    return results.map(r => r.variant);
  }

  async getGenerationCount(): Promise<number> {
    const [result] = await db.select({ count: sql`count(*)` }).from(generatedVariants);
    return Number(result?.count || 0);
  }

  async getGenerationCountByDate(startDate: Date, endDate: Date): Promise<number> {
    // Join with sessions to get the creation date
    const [result] = await db.select({ count: sql`count(*)` })
      .from(generatedVariants)
      .innerJoin(userSessions, eq(generatedVariants.sessionId, userSessions.id))
      .where(and(
        gte(userSessions.createdAt, startDate),
        lte(userSessions.createdAt, endDate)
      ));
    return Number(result?.count || 0);
  }

  async setUserAccountType(userId: string, accountType: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ accountType, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async getFavoritedGenerationsCount(): Promise<number> {
    const [result] = await db.select({ count: sql`count(*)` })
      .from(generatedVariants)
      .where(eq(generatedVariants.isFavorited, true));
    return Number(result?.count || 0);
  }

  async getDislikedGenerationsCount(): Promise<number> {
    const [result] = await db.select({ count: sql`count(*)` })
      .from(generatedVariants)
      .where(eq(generatedVariants.isDisliked, true));
    return Number(result?.count || 0);
  }

  async getFavoritedGenerations(limit = 50, offset = 0): Promise<any[]> {
    const variants = await db.select()
      .from(generatedVariants)
      .where(eq(generatedVariants.isFavorited, true))
      .orderBy(desc(generatedVariants.favoritedAt))
      .limit(limit)
      .offset(offset);
    
    // Enrich with session info to get user context
    const enriched = await Promise.all(variants.map(async (v) => {
      const session = await this.getUserSession(v.sessionId);
      return {
        ...v,
        sessionPhotoUrl: session?.photoUrl,
        sessionPrompt: session?.textPrompt,
      };
    }));
    
    return enriched;
  }

  async getUserFavorites(userId: string): Promise<any[]> {
    const variants = await db.select()
      .from(generatedVariants)
      .where(
        and(
          eq(generatedVariants.isFavorited, true),
          eq(generatedVariants.favoritedByUserId, userId)
        )
      )
      .orderBy(desc(generatedVariants.favoritedAt));
    
    // Enrich with session info
    const enriched = await Promise.all(variants.map(async (v) => {
      const session = await this.getUserSession(v.sessionId);
      return {
        ...v,
        sessionPhotoUrl: session?.photoUrl,
        sessionPrompt: session?.textPrompt,
      };
    }));
    
    return enriched;
  }

  async getUserFavoritesWithDevice(userId: string | null, deviceId: string | null): Promise<any[]> {
    // Build conditions based on what identifiers we have
    const conditions: any[] = [eq(generatedVariants.isFavorited, true)];
    
    if (userId && deviceId) {
      // Logged-in user: match either userId OR their deviceId (for continuity)
      conditions.push(
        or(
          eq(generatedVariants.favoritedByUserId, userId),
          eq(generatedVariants.favoritedByDeviceId, deviceId)
        )!
      );
    } else if (userId) {
      conditions.push(eq(generatedVariants.favoritedByUserId, userId));
    } else if (deviceId) {
      conditions.push(eq(generatedVariants.favoritedByDeviceId, deviceId));
    } else {
      // No identifiers - return empty
      return [];
    }
    
    const variants = await db.select()
      .from(generatedVariants)
      .where(and(...conditions))
      .orderBy(desc(generatedVariants.favoritedAt));
    
    // Enrich with session info
    const enriched = await Promise.all(variants.map(async (v) => {
      const session = await this.getUserSession(v.sessionId);
      return {
        ...v,
        sessionPhotoUrl: session?.photoUrl,
        sessionPrompt: session?.textPrompt,
      };
    }));
    
    return enriched;
  }

  async getUserGenerationHistory(userId: string | null, deviceId: string | null, limit: number = 50): Promise<any[]> {
    // Get sessions for this user/device
    const conditions: any[] = [];
    
    if (userId && deviceId) {
      // Logged-in user: match either userId OR their deviceId (for continuity)
      conditions.push(
        or(
          eq(userSessions.userId, userId),
          eq(userSessions.deviceId, deviceId)
        )!
      );
    } else if (userId) {
      conditions.push(eq(userSessions.userId, userId));
    } else if (deviceId) {
      conditions.push(eq(userSessions.deviceId, deviceId));
    } else {
      // No identifiers - return empty
      return [];
    }
    
    // Get sessions ordered by creation date
    const sessions = await db.select()
      .from(userSessions)
      .where(and(...conditions))
      .orderBy(desc(userSessions.createdAt))
      .limit(limit);
    
    if (sessions.length === 0) {
      return [];
    }
    
    // Get all variants for these sessions that have completed generation
    const sessionIds = sessions.map(s => s.id);
    const variants = await db.select()
      .from(generatedVariants)
      .where(
        and(
          inArray(generatedVariants.sessionId, sessionIds),
          eq(generatedVariants.status, "completed"),
          not(isNull(generatedVariants.generatedImageUrl))
        )
      )
      .orderBy(desc(generatedVariants.createdAt));
    
    // Combine variant data with session data
    const sessionMap = new Map(sessions.map(s => [s.id, s]));
    
    const history = variants.map(v => {
      const session = sessionMap.get(v.sessionId);
      return {
        id: v.id,
        sessionId: v.sessionId,
        generatedImageUrl: v.generatedImageUrl,
        customPrompt: v.customPrompt || session?.customPrompt,
        inspirationPhotoUrl: v.inspirationPhotoUrl,
        styleType: v.styleType,
        isFavorited: v.isFavorited,
        isDisliked: v.isDisliked,
        createdAt: v.createdAt,
        sessionPhotoUrl: session?.photoUrl,
      };
    });
    
    return history;
  }

  async recordPlanPreference(preference: { plan: string; deviceId?: string; userId?: string }): Promise<void> {
    const deviceId = preference.deviceId || null;
    const userId = preference.userId || null;
    
    let existing = null;
    if (deviceId) {
      const [byDevice] = await db.select()
        .from(planPreferences)
        .where(eq(planPreferences.deviceId, deviceId))
        .limit(1);
      existing = byDevice;
    }
    if (!existing && userId) {
      const [byUser] = await db.select()
        .from(planPreferences)
        .where(eq(planPreferences.userId, userId))
        .limit(1);
      existing = byUser;
    }
    
    if (existing) {
      await db.update(planPreferences)
        .set({ 
          plan: preference.plan,
          userId: userId || existing.userId,
          deviceId: deviceId || existing.deviceId,
        })
        .where(eq(planPreferences.id, existing.id));
    } else {
      await db.insert(planPreferences).values({
        plan: preference.plan,
        deviceId,
        userId,
      });
    }
  }

  async getUserPlanPreference(deviceId?: string, userId?: string): Promise<string | null> {
    if (deviceId) {
      const [byDevice] = await db.select()
        .from(planPreferences)
        .where(eq(planPreferences.deviceId, deviceId))
        .limit(1);
      if (byDevice) return byDevice.plan;
    }
    if (userId) {
      const [byUser] = await db.select()
        .from(planPreferences)
        .where(eq(planPreferences.userId, userId))
        .limit(1);
      if (byUser) return byUser.plan;
    }
    return null;
  }

  async getPlanPreferenceAnalytics(): Promise<{ plan: string; count: number; uniqueUsers: number }[]> {
    const result = await db.select({
      plan: planPreferences.plan,
      count: sql<number>`count(*)::int`,
      uniqueUsers: sql<number>`count(distinct COALESCE(${planPreferences.deviceId}, ${planPreferences.userId}))::int`,
    })
      .from(planPreferences)
      .groupBy(planPreferences.plan)
      .orderBy(sql`count(*) DESC`);
    
    return result;
  }

  async getDislikedGenerations(limit = 50, offset = 0): Promise<any[]> {
    const variants = await db.select()
      .from(generatedVariants)
      .where(eq(generatedVariants.isDisliked, true))
      .orderBy(desc(generatedVariants.dislikedAt))
      .limit(limit)
      .offset(offset);
    
    // Enrich with session info to get user context
    const enriched = await Promise.all(variants.map(async (v) => {
      const session = await this.getUserSession(v.sessionId);
      return {
        ...v,
        sessionPhotoUrl: session?.photoUrl,
        sessionPrompt: session?.textPrompt,
      };
    }));
    
    return enriched;
  }

  async getUniqueDeviceCount(): Promise<number> {
    // Count unique device IDs from user_sessions table
    const [result] = await db.select({ 
      count: sql<number>`count(distinct device_id)::int` 
    })
      .from(userSessions)
      .where(sql`device_id IS NOT NULL`);
    return result?.count || 0;
  }
}

export const storage = new DatabaseStorage();
