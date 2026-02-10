import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, index, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (REQUIRED for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User table (REQUIRED for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  accountType: varchar("account_type").notNull().default("user"), // user, business
  businessId: varchar("business_id"), // Links to business if accountType is "business"
  plan: varchar("plan").notNull().default("free"), // free, payg, monthly, business
  credits: integer("credits").notNull().default(3), // Current credits balance
  dailyCreditsResetAt: timestamp("daily_credits_reset_at"), // For free plan daily reset
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionStatus: varchar("subscription_status"), // active, canceled, past_due
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Credit transactions log
export const creditTransactions = pgTable("credit_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(), // Positive for credits added, negative for used
  type: varchar("type").notNull(), // purchase, subscription, daily_reset, generation, refund
  description: text("description"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userSessions = pgTable("user_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id), // Links to user if logged in
  deviceId: varchar("device_id"), // Links to anonymous device for history retrieval
  photoUrl: text("photo_url").notNull(),
  facialFeatures: text("facial_features"),
  replicateMaskUrl: text("replicate_mask_url"), // Cached Replicate hair mask output for this photo
  rankedReferences: jsonb("ranked_references"), // Stores vision-ranked reference images for additional generations
  usedReferenceIndex: integer("used_reference_index").default(0), // Tracks highest reference index used across sessions
  seenReferenceUrls: jsonb("seen_reference_urls"), // URLs already fetched to avoid duplicates when refreshing
  originalSearchQuery: text("original_search_query"), // Original search query for fetching more references
  hairstyleDescription: text("hairstyle_description"), // Vision model's interpretation of the hairstyle
  customPrompt: text("custom_prompt"), // Original user prompt for regeneration
  rootSessionId: varchar("root_session_id"), // Links to the original session for related generations (null for root sessions)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [index("IDX_user_sessions_device").on(table.deviceId)]);

export const generatedVariants = pgTable("generated_variants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  hairstyleId: varchar("hairstyle_id"),
  customPrompt: text("custom_prompt"),
  inspirationPhotoUrl: text("inspiration_photo_url"), // URL of reference photo to copy style from
  styleType: varchar("style_type").default("hairstyle"), // hairstyle, makeup, or both
  generatedImageUrl: text("generated_image_url"), // Front view image (or composite in HYBRID mode)
  sideImageUrl: text("side_image_url"), // Side/profile view image (not used in HYBRID mode)
  webReferenceImageUrl: text("web_reference_image_url"), // URL of web-searched reference image used for generation
  webReferenceSource: text("web_reference_source"), // Title/source of the web reference image
  webReferenceImageUrl2: text("web_reference_image_url_2"), // URL of second web-searched reference image
  webReferenceSource2: text("web_reference_source_2"), // Title/source of the second web reference image
  webReferenceImageUrl3: text("web_reference_image_url_3"), // URL of third web-searched reference image
  webReferenceSource3: text("web_reference_source_3"), // Title/source of the third web reference image
  webReferenceImageUrl4: text("web_reference_image_url_4"), // URL of fourth web-searched reference image
  webReferenceSource4: text("web_reference_source_4"), // Title/source of the fourth web reference image
  webReferenceImageUrl5: text("web_reference_image_url_5"), // URL of fifth web-searched reference image
  webReferenceSource5: text("web_reference_source_5"), // Title/source of the fifth web reference image
  status: varchar("status").notNull().default("pending"),
  orderId: varchar("order_id"),
  parentVariantId: varchar("parent_variant_id"), // Links to parent variant for refinement chain
  refinementNumber: integer("refinement_number").default(0), // 0 = original, 1+ = refinements
  refinementPrompt: text("refinement_prompt"), // The user's chat message for this refinement
  renderType: varchar("render_type").default("ai"), // "composite" (copy/paste) or "ai" (AI generated) or "ai_variant"
  variantIndex: integer("variant_index").default(0), // Order in hybrid results: 0=composite, 1-3=AI variants
  compositeData: text("composite_data"), // JSON with composite layer info (mask URLs, blend params)
  referenceIndex: integer("reference_index").default(0), // Which ranked reference was used (0=first, 1=second, etc.)
  isFavorited: boolean("is_favorited").default(false), // User saved/favorited this generation
  favoritedByUserId: varchar("favorited_by_user_id"), // User who favorited this generation
  favoritedByDeviceId: varchar("favorited_by_device_id"), // Anonymous device ID for non-logged-in favorites
  favoritedAt: timestamp("favorited_at"), // When the generation was favorited
  isDisliked: boolean("is_disliked").default(false), // User disliked/thumbs-downed this generation
  dislikedByDeviceId: varchar("disliked_by_device_id"), // Anonymous device ID for dislike tracking
  dislikedAt: timestamp("disliked_at"), // When the generation was disliked
});

export const hairstyles = pgTable("hairstyles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  promptTemplate: text("prompt_template").notNull(),
});

export const salons = pgTable("salons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  rating: real("rating").notNull(),
  imageUrl: text("image_url").notNull(),
  specialties: text("specialties").array().notNull(),
  distance: real("distance"),
});

// Explore page - Video community for hair transformations
export const videos = pgTable("videos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  generatedVariantId: varchar("generated_variant_id").references(() => generatedVariants.id),
  duration: integer("duration"), // in seconds
  viewCount: integer("view_count").notNull().default(0),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  tags: text("tags").array(),
  status: varchar("status").notNull().default("active"), // active, hidden, removed
  createdAt: timestamp("created_at").defaultNow(),
});

export const videoLikes = pgTable("video_likes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const videoComments = pgTable("video_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const videoViews = pgTable("video_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  viewerUserId: varchar("viewer_user_id").references(() => users.id),
  viewerIp: varchar("viewer_ip"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Stylists table
export const stylists = pgTable("stylists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  bio: text("bio"),
  profileImageUrl: text("profile_image_url"),
  specialty: text("specialty"),
  location: text("location"),
  address: text("address"), // Full street address
  city: text("city"),
  phone: text("phone"),
  email: text("email"),
  instagram: text("instagram"),
  website: text("website"),
  distance: real("distance"), // Distance in miles
  priceRange: text("price_range"), // e.g., "$25-$50"
  services: text("services"), // JSON array of {name, price, duration}
  workingHours: text("working_hours"), // JSON object of hours per day
  rating: real("rating").notNull().default(5.0),
  reviewCount: integer("review_count").notNull().default(0),
  isRegistered: integer("is_registered").notNull().default(0),
  isBetaDemo: boolean("is_beta_demo").notNull().default(false), // Demo business for beta testing
  createdAt: timestamp("created_at").defaultNow(),
});

// Stylist portfolio
export const stylistPortfolios = pgTable("stylist_portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stylistId: varchar("stylist_id").notNull().references(() => stylists.id),
  imageUrl: text("image_url").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Appointments/bookings
export const appointments = pgTable("appointments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  deviceId: varchar("device_id"), // For anonymous beta booking tracking
  sessionId: varchar("session_id").references(() => userSessions.id),
  stylistId: varchar("stylist_id").notNull().references(() => stylists.id),
  variantId: varchar("variant_id").references(() => generatedVariants.id),
  serviceName: text("service_name"), // Selected service
  servicePrice: real("service_price"), // Price in dollars
  appointmentDate: timestamp("appointment_date"), // Requested date/time
  notes: text("notes"),
  attachedImages: text("attached_images").array(),
  status: varchar("status").notNull().default("pending"),
  isBetaBooking: boolean("is_beta_booking").notNull().default(false), // Track beta demo bookings
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSessionSchema = createInsertSchema(userSessions).omit({
  id: true,
});

export const insertGeneratedVariantSchema = createInsertSchema(generatedVariants).omit({
  id: true,
});

export const insertHairstyleSchema = createInsertSchema(hairstyles).omit({
  id: true,
});

export const insertSalonSchema = createInsertSchema(salons).omit({
  id: true,
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({
  id: true,
});

export const insertVideoSchema = createInsertSchema(videos).omit({
  id: true,
  viewCount: true,
  likeCount: true,
  commentCount: true,
  createdAt: true,
});

export const insertVideoLikeSchema = createInsertSchema(videoLikes).omit({
  id: true,
  createdAt: true,
});

export const insertVideoCommentSchema = createInsertSchema(videoComments).omit({
  id: true,
  createdAt: true,
});

export const insertVideoViewSchema = createInsertSchema(videoViews).omit({
  id: true,
  createdAt: true,
});

export const insertStylistSchema = createInsertSchema(stylists).omit({
  id: true,
  createdAt: true,
});

export const insertStylistPortfolioSchema = createInsertSchema(stylistPortfolios).omit({
  id: true,
  createdAt: true,
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
});

export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof userSessions.$inferSelect;

export type InsertGeneratedVariant = z.infer<typeof insertGeneratedVariantSchema>;
export type GeneratedVariant = typeof generatedVariants.$inferSelect;

export type InsertHairstyle = z.infer<typeof insertHairstyleSchema>;
export type Hairstyle = typeof hairstyles.$inferSelect;

export type InsertSalon = z.infer<typeof insertSalonSchema>;
export type Salon = typeof salons.$inferSelect;

// User and auth types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

// Video community types
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videos.$inferSelect;

export type InsertVideoLike = z.infer<typeof insertVideoLikeSchema>;
export type VideoLike = typeof videoLikes.$inferSelect;

export type InsertVideoComment = z.infer<typeof insertVideoCommentSchema>;
export type VideoComment = typeof videoComments.$inferSelect;

export type InsertVideoView = z.infer<typeof insertVideoViewSchema>;
export type VideoView = typeof videoViews.$inferSelect;

// Extended video type with user info for the feed
export type VideoWithUser = Video & {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  };
  isLiked?: boolean;
};

export type InsertStylist = z.infer<typeof insertStylistSchema>;
export type Stylist = typeof stylists.$inferSelect;

export type InsertStylistPortfolio = z.infer<typeof insertStylistPortfolioSchema>;
export type StylistPortfolio = typeof stylistPortfolios.$inferSelect;

export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

// Extended stylist type with portfolio
export type StylistWithPortfolio = Stylist & {
  portfolio: StylistPortfolio[];
};

// Hairstyle reference images for text mode matching
export const hairstyleReferences = pgTable("hairstyle_references", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  imageUrl: text("image_url").notNull(),
  skinTone: varchar("skin_tone").notNull(), // light, medium-light, medium, medium-dark, dark
  faceShape: varchar("face_shape").notNull(), // oval, round, square, heart, oblong, diamond
  hairLength: varchar("hair_length").notNull(), // short, medium, long
  hairTexture: varchar("hair_texture").notNull(), // straight, wavy, curly, coily
  hairColor: varchar("hair_color"), // blonde, brunette, black, red, etc.
  gender: varchar("gender").notNull(), // male, female, unisex
  styleName: text("style_name").notNull(), // e.g., "textured quiff", "long layers", "buzz cut"
  styleKeywords: text("style_keywords").array(), // searchable keywords
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHairstyleReferenceSchema = createInsertSchema(hairstyleReferences).omit({
  id: true,
  createdAt: true,
});

export type InsertHairstyleReference = z.infer<typeof insertHairstyleReferenceSchema>;
export type HairstyleReference = typeof hairstyleReferences.$inferSelect;

// User photo analysis result
export type UserPhotoAnalysis = {
  skinTone: string;
  skinToneConfidence: number;
  faceShape: string;
  faceShapeConfidence: number;
  gender: string;
  hairTexture: string | null;
  currentHairLength: string | null;
};

// ===============================
// BOOKING SYSTEM TABLES
// ===============================

// Businesses table - links Google Place IDs to our booking system
export const businesses = pgTable("businesses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  googlePlaceId: varchar("google_place_id").unique(), // Links to Google Places
  ownerId: varchar("owner_id").references(() => users.id), // Business owner/manager
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  phone: varchar("phone"),
  website: varchar("website"),
  description: text("description"),
  imageUrl: text("image_url"),
  isVerified: integer("is_verified").notNull().default(0), // Business verified ownership
  isActive: integer("is_active").notNull().default(1), // Accepting bookings
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Services offered by businesses
export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  name: text("name").notNull(), // e.g., "Men's Haircut", "Beard Trim", "Coloring"
  description: text("description"),
  price: integer("price").notNull(), // Price in cents
  duration: integer("duration").notNull().default(30), // Duration in minutes
  category: varchar("category"), // haircut, coloring, styling, treatment, etc.
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

// Business stylists - extends the stylists table with business linkage
export const businessStylists = pgTable("business_stylists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  userId: varchar("user_id").references(() => users.id), // If stylist has an account
  name: text("name").notNull(),
  bio: text("bio"),
  profileImageUrl: text("profile_image_url"),
  specialty: text("specialty"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

// Stylist availability schedule - weekly recurring hours
export const stylistAvailability = pgTable("stylist_availability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stylistId: varchar("stylist_id").notNull().references(() => businessStylists.id),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday, 1=Monday, ... 6=Saturday
  startTime: varchar("start_time").notNull(), // "09:00" format
  endTime: varchar("end_time").notNull(), // "17:00" format
  isAvailable: integer("is_available").notNull().default(1),
});

// Time-off / blocked dates for stylists
export const stylistTimeOff = pgTable("stylist_time_off", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stylistId: varchar("stylist_id").notNull().references(() => businessStylists.id),
  date: varchar("date").notNull(), // "2025-01-15" format
  startTime: varchar("start_time"), // null = all day
  endTime: varchar("end_time"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Bookings / Appointments - extended version
export const bookings = pgTable("bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  stylistId: varchar("stylist_id").notNull().references(() => businessStylists.id),
  serviceId: varchar("service_id").notNull().references(() => services.id),
  userId: varchar("user_id").references(() => users.id), // Logged in user
  customerName: text("customer_name").notNull(),
  customerEmail: varchar("customer_email"),
  customerPhone: varchar("customer_phone"),
  date: varchar("date").notNull(), // "2025-01-15" format
  startTime: varchar("start_time").notNull(), // "10:00" format
  endTime: varchar("end_time").notNull(), // "10:30" format (based on service duration)
  notes: text("notes"), // Customer notes/special requests
  desiredHairstyle: text("desired_hairstyle"), // Text description of desired style
  attachedVariantId: varchar("attached_variant_id").references(() => generatedVariants.id), // AI-generated look
  attachedImageUrl: text("attached_image_url"), // Direct image URL if not using variant
  status: varchar("status").notNull().default("pending"), // pending, confirmed, completed, cancelled, no_show
  totalPrice: integer("total_price").notNull(), // Price in cents at time of booking
  paymentIntentId: varchar("payment_intent_id"), // Stripe payment intent ID
  paymentStatus: varchar("payment_status").default("pending"), // pending, succeeded, failed, refunded
  rescheduledFromId: varchar("rescheduled_from_id"), // Original booking ID if this is a reschedule
  rescheduledAt: timestamp("rescheduled_at"), // When the reschedule happened
  reminder24hSentAt: timestamp("reminder_24h_sent_at"), // When 24h reminder was sent
  reminder1hSentAt: timestamp("reminder_1h_sent_at"), // When 1h reminder was sent
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for new booking tables
export const insertBusinessSchema = createInsertSchema(businesses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertServiceSchema = createInsertSchema(services).omit({
  id: true,
  createdAt: true,
});

export const insertBusinessStylistSchema = createInsertSchema(businessStylists).omit({
  id: true,
  createdAt: true,
});

export const insertStylistAvailabilitySchema = createInsertSchema(stylistAvailability).omit({
  id: true,
});

export const insertStylistTimeOffSchema = createInsertSchema(stylistTimeOff).omit({
  id: true,
  createdAt: true,
});

export const insertBookingSchema = createInsertSchema(bookings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// User reviews on businesses
export const businessReviews = pgTable("business_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  bookingId: varchar("booking_id").references(() => bookings.id), // Optional - links to specific booking
  rating: integer("rating").notNull(), // 1-5 stars
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBusinessReviewSchema = createInsertSchema(businessReviews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types for new booking tables
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Business = typeof businesses.$inferSelect;

export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;

export type InsertBusinessStylist = z.infer<typeof insertBusinessStylistSchema>;
export type BusinessStylist = typeof businessStylists.$inferSelect;

export type InsertStylistAvailability = z.infer<typeof insertStylistAvailabilitySchema>;
export type StylistAvailability = typeof stylistAvailability.$inferSelect;

export type InsertStylistTimeOff = z.infer<typeof insertStylistTimeOffSchema>;
export type StylistTimeOff = typeof stylistTimeOff.$inferSelect;

export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookings.$inferSelect;

// Extended types for booking UI
export type ServiceWithBusiness = Service & {
  business: Business;
};

export type BusinessStylistWithAvailability = BusinessStylist & {
  availability: StylistAvailability[];
  timeOff: StylistTimeOff[];
};

export type BusinessWithDetails = Business & {
  services: Service[];
  stylists: BusinessStylistWithAvailability[];
};

export type BookingWithDetails = Booking & {
  business: Business;
  stylist: BusinessStylist;
  service: Service;
  user?: User;
};

export type InsertBusinessReview = z.infer<typeof insertBusinessReviewSchema>;
export type BusinessReview = typeof businessReviews.$inferSelect;

export type BusinessReviewWithDetails = BusinessReview & {
  business: Business;
  booking?: Booking;
  user?: User;
};

// Stylist reviews - individual stylist ratings
export const stylistReviews = pgTable("stylist_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  stylistId: varchar("stylist_id").notNull().references(() => businessStylists.id),
  bookingId: varchar("booking_id").references(() => bookings.id),
  rating: integer("rating").notNull(), // 1-5 stars
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertStylistReviewSchema = createInsertSchema(stylistReviews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStylistReview = z.infer<typeof insertStylistReviewSchema>;
export type StylistReview = typeof stylistReviews.$inferSelect;

export type StylistReviewWithDetails = StylistReview & {
  stylist: BusinessStylist;
  booking?: Booking;
  user?: User;
};

// ===============================
// ADVANCED SCHEDULING TABLES
// ===============================

// Waitlist entries - when no slots available
export const waitlistEntries = pgTable("waitlist_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  stylistId: varchar("stylist_id").references(() => businessStylists.id), // null = any stylist
  serviceId: varchar("service_id").notNull().references(() => services.id),
  userId: varchar("user_id").references(() => users.id),
  customerName: text("customer_name").notNull(),
  customerEmail: varchar("customer_email").notNull(),
  customerPhone: varchar("customer_phone"),
  preferredDate: varchar("preferred_date").notNull(), // "2025-01-15" format
  preferredTimeStart: varchar("preferred_time_start"), // "09:00" - null = any time
  preferredTimeEnd: varchar("preferred_time_end"), // "17:00"
  flexibleDates: integer("flexible_dates").notNull().default(1), // Can accept other dates?
  notes: text("notes"),
  status: varchar("status").notNull().default("waiting"), // waiting, notified, booked, expired, cancelled
  notifiedAt: timestamp("notified_at"), // When we notified them of opening
  expiresAt: timestamp("expires_at"), // When this waitlist entry expires
  createdAt: timestamp("created_at").defaultNow(),
});

// Recurring booking rules
export const recurringBookingRules = pgTable("recurring_booking_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  stylistId: varchar("stylist_id").notNull().references(() => businessStylists.id),
  serviceId: varchar("service_id").notNull().references(() => services.id),
  userId: varchar("user_id").references(() => users.id),
  customerName: text("customer_name").notNull(),
  customerEmail: varchar("customer_email"),
  customerPhone: varchar("customer_phone"),
  frequency: varchar("frequency").notNull(), // weekly, biweekly, monthly
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday, 1=Monday, etc.
  preferredTime: varchar("preferred_time").notNull(), // "10:00"
  startDate: varchar("start_date").notNull(), // When recurring starts
  endDate: varchar("end_date"), // null = indefinite
  maxOccurrences: integer("max_occurrences"), // null = unlimited
  occurrencesCreated: integer("occurrences_created").notNull().default(0),
  notes: text("notes"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Individual instances of recurring bookings (extends bookings table)
export const bookingOccurrences = pgTable("booking_occurrences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => bookings.id),
  recurringRuleId: varchar("recurring_rule_id").references(() => recurringBookingRules.id),
  occurrenceNumber: integer("occurrence_number").notNull().default(1),
  originalDate: varchar("original_date").notNull(), // Originally scheduled date
  actualDate: varchar("actual_date"), // If rescheduled
  status: varchar("status").notNull().default("scheduled"), // scheduled, completed, cancelled, rescheduled
  createdAt: timestamp("created_at").defaultNow(),
});

// Push notification subscriptions for PWA
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(), // Public key
  auth: text("auth").notNull(), // Auth secret
  userAgent: text("user_agent"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

// Notification history
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  type: varchar("type").notNull(), // booking_reminder, booking_confirmed, waitlist_opening, etc.
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data"), // Additional data (bookingId, etc.)
  status: varchar("status").notNull().default("pending"), // pending, sent, failed, read
  sentAt: timestamp("sent_at"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Google/Apple calendar sync accounts
export const calendarSyncAccounts = pgTable("calendar_sync_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  provider: varchar("provider").notNull(), // google, apple
  accountEmail: varchar("account_email"),
  accessToken: text("access_token"), // Encrypted
  refreshToken: text("refresh_token"), // Encrypted
  tokenExpiresAt: timestamp("token_expires_at"),
  calendarId: varchar("calendar_id"), // Selected calendar ID
  syncEnabled: integer("sync_enabled").notNull().default(1),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for new tables
export const insertWaitlistEntrySchema = createInsertSchema(waitlistEntries).omit({
  id: true,
  notifiedAt: true,
  createdAt: true,
});

export const insertRecurringBookingRuleSchema = createInsertSchema(recurringBookingRules).omit({
  id: true,
  occurrencesCreated: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBookingOccurrenceSchema = createInsertSchema(bookingOccurrences).omit({
  id: true,
  createdAt: true,
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  sentAt: true,
  readAt: true,
  createdAt: true,
});

export const insertCalendarSyncAccountSchema = createInsertSchema(calendarSyncAccounts).omit({
  id: true,
  lastSyncAt: true,
  createdAt: true,
  updatedAt: true,
});

// Types for new tables
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistEntrySchema>;
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;

export type InsertRecurringBookingRule = z.infer<typeof insertRecurringBookingRuleSchema>;
export type RecurringBookingRule = typeof recurringBookingRules.$inferSelect;

export type InsertBookingOccurrence = z.infer<typeof insertBookingOccurrenceSchema>;
export type BookingOccurrence = typeof bookingOccurrences.$inferSelect;

export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export type InsertCalendarSyncAccount = z.infer<typeof insertCalendarSyncAccountSchema>;
export type CalendarSyncAccount = typeof calendarSyncAccounts.$inferSelect;

// Preprocessing cache table - stores user masks, ethnicity, analysis data persistently
export const preprocessingCache = pgTable("preprocessing_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cacheKey: text("cache_key").notNull().unique(), // Photo URL hash or identifier
  sessionId: varchar("session_id").references(() => userSessions.id),
  maskedUserPhoto: text("masked_user_photo"), // Base64 user photo with hair removed
  userAnalysis: jsonb("user_analysis"), // Gender, ethnicity, face shape, etc.
  ethnicity: varchar("ethnicity"), // Quick access to ethnicity
  gender: varchar("gender"), // Quick access to gender
  faceShape: varchar("face_shape"), // Quick access to face shape
  rankedReferences: jsonb("ranked_references"), // Vision-ranked reference images
  usedReferenceIndex: integer("used_reference_index").default(0), // Track which references have been used
  expiresAt: timestamp("expires_at").notNull(), // Auto-cleanup after expiry
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [index("IDX_preprocessing_cache_key").on(table.cacheKey), index("IDX_preprocessing_expires").on(table.expiresAt)]);

export const insertPreprocessingCacheSchema = createInsertSchema(preprocessingCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPreprocessingCache = z.infer<typeof insertPreprocessingCacheSchema>;
export type PreprocessingCache = typeof preprocessingCache.$inferSelect;

// Extended types
export type WaitlistEntryWithDetails = WaitlistEntry & {
  business: Business;
  stylist?: BusinessStylist;
  service: Service;
};

export type RecurringBookingRuleWithDetails = RecurringBookingRule & {
  business: Business;
  stylist: BusinessStylist;
  service: Service;
  occurrences: BookingOccurrence[];
};

// Beta feedback table - collect user feedback after 10-15 generations
export const betaFeedback = pgTable("beta_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id"), // Device-based tracking for anonymous feedback
  sessionId: varchar("session_id").references(() => userSessions.id),
  email: varchar("email"), // For raffle winner notification
  rating: integer("rating").notNull(), // 1-5 stars
  usability: integer("usability"), // 1-5 scale
  imageQuality: integer("image_quality"), // 1-5 scale
  wouldRecommend: boolean("would_recommend"),
  favoriteFeature: text("favorite_feature"),
  improvementSuggestion: text("improvement_suggestion"),
  additionalComments: text("additional_comments"),
  generationCount: integer("generation_count"), // How many generations before feedback
  pricingPreference: varchar("pricing_preference"), // "payg" or "subscription"
  monthlyBudget: varchar("monthly_budget"), // e.g. "$5-10", "$10-20", etc.
  // Survey-specific fields
  mostUsedFeature: varchar("most_used_feature"), // text_mode, inspiration_mode, aureniq
  frustration: text("frustration"), // What frustrated users most
  missingFeature: text("missing_feature"), // What features users want
  problemSolved: text("problem_solved"), // What problem Auren solved for them
  aurenRating: integer("auren_rating"), // 1-7 overall rating
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [index("IDX_beta_feedback_device").on(table.deviceId)]);

export const insertBetaFeedbackSchema = createInsertSchema(betaFeedback).omit({
  id: true,
  createdAt: true,
});

export type InsertBetaFeedback = z.infer<typeof insertBetaFeedbackSchema>;
export type BetaFeedback = typeof betaFeedback.$inferSelect;

// Generation queue table - prevents rate limit issues by processing one at a time
export const generationQueue = pgTable("generation_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  sessionId: varchar("session_id").references(() => userSessions.id),
  variantId: varchar("variant_id").references(() => generatedVariants.id),
  status: varchar("status").notNull().default("queued"), // queued, processing, completed, failed
  priority: integer("priority").notNull().default(0), // Higher = processed first
  position: integer("position"), // Calculated queue position
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_generation_queue_status").on(table.status),
  index("IDX_generation_queue_user").on(table.userId),
  index("IDX_generation_queue_created").on(table.createdAt),
]);

export const insertGenerationQueueSchema = createInsertSchema(generationQueue).omit({
  id: true,
  position: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
});

export type InsertGenerationQueue = z.infer<typeof insertGenerationQueueSchema>;
export type GenerationQueueItem = typeof generationQueue.$inferSelect;

// Plan preference tracking for beta analytics
export const planPreferences = pgTable("plan_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  plan: varchar("plan").notNull(), // free, payg, monthly, business
  deviceId: varchar("device_id"), // Anonymous tracking
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_plan_preferences_plan").on(table.plan),
  index("IDX_plan_preferences_device").on(table.deviceId),
]);

export const insertPlanPreferenceSchema = createInsertSchema(planPreferences).omit({
  id: true,
  createdAt: true,
});

export type InsertPlanPreference = z.infer<typeof insertPlanPreferenceSchema>;
export type PlanPreference = typeof planPreferences.$inferSelect;
