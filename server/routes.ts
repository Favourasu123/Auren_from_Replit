import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertUserSessionSchema, insertGeneratedVariantSchema, insertVideoSchema, insertVideoCommentSchema, insertBetaFeedbackSchema, generationQueue, users, userSessions, generatedVariants } from "@shared/schema";
import { z } from "zod";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import Stripe from "stripe";
import { setupAuth } from "./auth";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { GENERATION_CONFIG, logConfig, buildGenerationPrompt, getRegionBasedEthnicity } from "./config";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { runHybridPipeline, isHybridModeEnabled } from "./hybridService";
import { generateHairMask, generateHairMaskWithOverlay, generateHairMaskReplicate, isReplicateConfigured, createHairOnlyImage, createKontextResultMaskTest, createUserMaskedImage, addWatermark } from "./imageProcessing";
import Replicate from "replicate";
import * as fs from "fs";
import * as crypto from "crypto";
import * as fsPromises from "fs/promises";
import { addToQueue, getQueueStatus, getQueueStatusByVariant, markCompleted, markFailed, getNextInQueue, markProcessing } from "./generationQueue";

// File-based debug logging since console.log isn't captured in Replit
const DEBUG_LOG_FILE = "/tmp/flux_fill_debug.log";

// === MONITORING & RELIABILITY UTILITIES ===

// Track generation success/failure rates for monitoring
interface GenerationMetrics {
  totalRequests: number;
  successfulGenerations: number;
  failedGenerations: number;
  timeouts: number;
  retries: number;
  lastUpdated: Date;
  averageGenerationTimeMs: number;
  totalGenerationTimeMs: number;
  apiErrors: { [key: string]: number };
}

const generationMetrics: GenerationMetrics = {
  totalRequests: 0,
  successfulGenerations: 0,
  failedGenerations: 0,
  timeouts: 0,
  retries: 0,
  lastUpdated: new Date(),
  averageGenerationTimeMs: 0,
  totalGenerationTimeMs: 0,
  apiErrors: {},
};

// Update metrics on successful generation
function recordGenerationSuccess(durationMs: number) {
  generationMetrics.totalRequests++;
  generationMetrics.successfulGenerations++;
  generationMetrics.totalGenerationTimeMs += durationMs;
  generationMetrics.averageGenerationTimeMs = 
    generationMetrics.totalGenerationTimeMs / generationMetrics.successfulGenerations;
  generationMetrics.lastUpdated = new Date();
}

// Update metrics on failed generation
function recordGenerationFailure(reason: string) {
  generationMetrics.totalRequests++;
  generationMetrics.failedGenerations++;
  generationMetrics.apiErrors[reason] = (generationMetrics.apiErrors[reason] || 0) + 1;
  generationMetrics.lastUpdated = new Date();
}

// Retry utility with exponential backoff for external API calls
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    operationName?: string;
    shouldRetry?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    operationName = "operation",
    shouldRetry = () => true,
  } = options;

  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isRetryable = shouldRetry(error);
      
      if (!isRetryable || attempt === maxRetries) {
        console.error(`[RETRY] ${operationName} failed after ${attempt} attempts:`, error);
        throw error;
      }
      
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      console.log(`[RETRY] ${operationName} attempt ${attempt} failed, retrying in ${delay}ms...`);
      generationMetrics.retries++;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Rate limiting map: tracks request counts per IP/user
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Check if request should be rate limited
function isRateLimited(identifier: string, maxRequests: number = 10, windowMs: number = 60000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + windowMs });
    return false;
  }
  
  if (entry.count >= maxRequests) {
    return true;
  }
  
  entry.count++;
  return false;
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60000); // Clean every minute

// === GENERATION QUEUE LOCK ===
// Ensures only one generation runs at a time to prevent API rate limits
let generationLockHolder: string | null = null;
let generationLockStartTime: number = 0;

function isGenerationLocked(): boolean {
  if (!generationLockHolder) return false;
  // Auto-release lock after 5 minutes (safety valve)
  if (Date.now() - generationLockStartTime > 5 * 60 * 1000) {
    console.log(`[QUEUE] Auto-releasing stale lock from ${generationLockHolder}`);
    generationLockHolder = null;
    return false;
  }
  return true;
}

function acquireGenerationLock(sessionId: string): boolean {
  if (isGenerationLocked()) {
    console.log(`[QUEUE] Lock held by ${generationLockHolder}, ${sessionId} must wait`);
    return false;
  }
  generationLockHolder = sessionId;
  generationLockStartTime = Date.now();
  console.log(`[QUEUE] Lock acquired by ${sessionId}`);
  return true;
}

function releaseGenerationLock(sessionId: string): void {
  if (generationLockHolder === sessionId) {
    console.log(`[QUEUE] Lock released by ${sessionId}`);
    generationLockHolder = null;
    // Trigger server-side queue processing after a short delay
    setTimeout(processNextQueuedGeneration, 500);
  }
}

export function getCurrentLockHolder(): string | null {
  if (isGenerationLocked()) {
    return generationLockHolder;
  }
  return null;
}

// Server-side queue processor - runs when lock is released
async function processNextQueuedGeneration(): Promise<void> {
  if (isGenerationLocked()) {
    console.log(`[QUEUE] Lock still held, skipping queue processing`);
    return;
  }
  
  let next;
  try {
    next = await getNextInQueue();
  } catch (error) {
    console.error(`[QUEUE] Error getting next queue item:`, error);
    setTimeout(processNextQueuedGeneration, 5000);
    return;
  }
  
  if (!next || !next.variantId) {
    console.log(`[QUEUE] No items in queue to process`);
    return;
  }
  
  console.log(`[QUEUE] Processing queued item ${next.id} for variant ${next.variantId}`);
  
  try {
    // Mark queue item as processing
    await markProcessing(next.id);
  } catch (error) {
    console.error(`[QUEUE] Error marking queue item as processing:`, error);
    setTimeout(processNextQueuedGeneration, 2000);
    return;
  }
  
  // Trigger the generation by calling the internal generate function
  if (next.sessionId && next.variantId) {
    try {
      await processQueuedSession(next.sessionId, next.id, next.variantId);
    } catch (error) {
      console.error(`[QUEUE] Error processing queued item:`, error);
      try {
        // Try to mark as failed
        await markFailed(next.id, error instanceof Error ? error.message : "Unknown error");
        if (next.variantId) {
          await storage.updateGeneratedVariant(next.variantId, { status: "failed" });
        }
      } catch (cleanupError) {
        console.error(`[QUEUE] Error during cleanup:`, cleanupError);
      }
      // Try next item
      setTimeout(processNextQueuedGeneration, 500);
    }
  } else {
    // Invalid queue item - mark as failed and move on
    console.log(`[QUEUE] Invalid queue item ${next.id} (missing sessionId or variantId), marking as failed`);
    try {
      await markFailed(next.id, "Invalid queue item: missing sessionId or variantId");
    } catch (error) {
      console.error(`[QUEUE] Error marking invalid item as failed:`, error);
    }
    setTimeout(processNextQueuedGeneration, 500);
  }
}

// Track retry counts to implement exponential backoff
const queueRetryCount = new Map<string, number>();

// Process a queued session's generation
// This makes an internal HTTP call to the existing endpoint to ensure full preprocessing pipeline is used
async function processQueuedSession(sessionId: string, queueId: string, variantId: string): Promise<void> {
  console.log(`[QUEUE] Starting server-side generation for session ${sessionId}`);
  
  // Check if variant still exists
  const variant = await storage.getGeneratedVariant(variantId);
  if (!variant) {
    console.log(`[QUEUE] Variant ${variantId} no longer exists, marking queue item as completed`);
    await markCompleted(queueId);
    setTimeout(processNextQueuedGeneration, 500);
    return;
  }
  
  // Mark the variant as pending so the generate endpoint will pick it up
  await storage.updateGeneratedVariant(variantId, { status: "pending" });
  
  // Make internal HTTP call to the generate endpoint
  // This uses the full preprocessing pipeline including reference selection, vision analysis, etc.
  const port = process.env.PORT || 5000;
  const baseUrl = `http://localhost:${port}`;
  
  // Get retry count for exponential backoff
  // Reduced from 5 to 2 to fail faster and avoid user confusion about "auto-retry"
  const retries = queueRetryCount.get(queueId) || 0;
  const maxRetries = 2;
  
  try {
    // Get queue item to retrieve userId for auth context
    const queueItem = await db.query.generationQueue.findFirst({
      where: eq(generationQueue.id, queueId),
    });
    
    const response = await fetch(`${baseUrl}/api/generate-hairstyles/${sessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Queue-Request': 'true', // Mark as internal to skip credit checks
        'X-Internal-User-Id': queueItem?.userId || '', // Pass original user ID for auth context
      },
    });
    
    if (response.ok) {
      const result = await response.json();
      if (result.queued) {
        // If it got queued again, the lock must have been taken by another request
        // Revert the queue item to "queued" status so it can be picked up again
        console.log(`[QUEUE] Request ${sessionId} was re-queued, lock taken by another request`);
        await db.update(generationQueue)
          .set({ status: "queued", startedAt: null })
          .where(eq(generationQueue.id, queueId));
        await storage.updateGeneratedVariant(variantId, { status: "queued" });
        // Retry later
        setTimeout(processNextQueuedGeneration, 2000);
        return;
      }
      // Success - clear retry count and mark completed
      queueRetryCount.delete(queueId);
      await markCompleted(queueId);
      console.log(`[QUEUE] Server-side generation completed for session ${sessionId}`);
    } else {
      const error = await response.text();
      console.error(`[QUEUE] Internal generate call failed: ${response.status} - ${error}`);
      
      // Don't retry on permanent failures (4xx errors) - only retry on transient failures (5xx, network)
      const isPermanentFailure = response.status >= 400 && response.status < 500;
      const isTimeoutOrServerError = response.status >= 500 || response.status === 504;
      
      // Check if we should retry with backoff - only for transient failures
      if (!isPermanentFailure && retries < maxRetries && isTimeoutOrServerError) {
        queueRetryCount.set(queueId, retries + 1);
        const backoffMs = Math.min(2000 * Math.pow(2, retries), 15000); // Max 15s (reduced from 30s)
        console.log(`[QUEUE] Will retry queue item ${queueId} in ${backoffMs}ms (attempt ${retries + 1}/${maxRetries})`);
        await db.update(generationQueue)
          .set({ status: "queued", startedAt: null })
          .where(eq(generationQueue.id, queueId));
        await storage.updateGeneratedVariant(variantId, { status: "queued" });
        setTimeout(processNextQueuedGeneration, backoffMs);
      } else {
        // Permanent failure or max retries exceeded - mark as failed immediately
        queueRetryCount.delete(queueId);
        const failReason = isPermanentFailure 
          ? `Generation failed: ${response.status}` 
          : `Internal call failed after ${retries + 1} attempts: ${response.status}`;
        await markFailed(queueId, failReason);
        await storage.updateGeneratedVariant(variantId, { status: "failed" });
        console.log(`[QUEUE] Marked queue item ${queueId} as failed: ${failReason}`);
        setTimeout(processNextQueuedGeneration, 500);
      }
    }
  } catch (error) {
    console.error(`[QUEUE] Internal generate call error:`, error);
    
    // Retry with backoff on network errors
    if (retries < maxRetries) {
      queueRetryCount.set(queueId, retries + 1);
      const backoffMs = Math.min(2000 * Math.pow(2, retries), 30000);
      console.log(`[QUEUE] Will retry queue item ${queueId} in ${backoffMs}ms (attempt ${retries + 1}/${maxRetries})`);
      await db.update(generationQueue)
        .set({ status: "queued", startedAt: null })
        .where(eq(generationQueue.id, queueId));
      await storage.updateGeneratedVariant(variantId, { status: "queued" });
      setTimeout(processNextQueuedGeneration, backoffMs);
    } else {
      queueRetryCount.delete(queueId);
      await markFailed(queueId, error instanceof Error ? error.message : "Unknown error");
      await storage.updateGeneratedVariant(variantId, { status: "failed" });
      setTimeout(processNextQueuedGeneration, 500);
    }
  }
}

// Module-level cache interface for preprocessed photos (mask + vision analysis)
// Now uses database-backed storage for persistence instead of in-memory Map
// Per-prompt analysis results from vision model
interface PromptAnalysis {
  searchQuery: string;
  hairstyleInterpretation: string;
  updatedAt: number;
}

interface PreprocessCacheEntry {
  maskedUserPhoto?: string;
  maskedImage?: string;
  visionResult?: { raceEthnicity?: string; gender?: string };
  userAnalysis?: { raceEthnicity?: string; gender?: string; faceShape?: string; hairTexture?: string } | null;
  rankedReferences?: any[];
  usedReferenceIndex?: number;
  // Map of normalized prompt → vision model's interpretation
  promptAnalyses?: Record<string, PromptAnalysis>;
  timestamp: number;
}

// In-memory fallback cache (used only when DB calls fail)
const memoryFallbackCache = new Map<string, PreprocessCacheEntry>();

// DEBUG: Store last fetched reference images for viewing (persisted to disk)
const FETCHED_IMAGES_PATH = "/tmp/debug_fetched_images.json";
async function saveFetchedImages(images: { url: string; base64: string; source: string; timestamp: Date }[]) {
  try {
    const fsPromises = await import("fs/promises");
    await fsPromises.writeFile(FETCHED_IMAGES_PATH, JSON.stringify(images));
  } catch (e) {
    console.error("Failed to save fetched images:", e);
  }
}
async function loadFetchedImages(): Promise<{ url: string; base64: string; source: string; timestamp: Date }[]> {
  try {
    const fsPromises = await import("fs/promises");
    const data = await fsPromises.readFile(FETCHED_IMAGES_PATH, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

// Helper to generate consistent cache key from photo URL
// IMPORTANT: This format must match everywhere cache keys are generated
// Format for long/base64 URLs: photo_${md5hash} - uses full content hash to prevent collisions
function generateCacheKey(photoUrl: string): string {
  if (photoUrl.length > 100) {
    // Use MD5 hash of entire photo content for unique identification
    // This prevents collisions for photos with same length but different content
    const hash = crypto.createHash('md5').update(photoUrl).digest('hex');
    return `photo_${hash}`;
  }
  return photoUrl;
}

// Legacy key format for backwards compatibility during migration
function generateLegacyCacheKey(photoUrl: string): string {
  if (photoUrl.startsWith("data:")) {
    const hash = crypto.createHash('md5').update(photoUrl.slice(0, 500)).digest('hex').slice(0, 16);
    return `photo_${hash}_${photoUrl.length}`;
  }
  return photoUrl;
}

// Database-backed preprocessing cache wrapper
const preprocessCache = {
  async get(key: string): Promise<PreprocessCacheEntry | undefined> {
    try {
      let cached = await storage.getPreprocessingCache(key);
      
      // If not found with current key format, try legacy MD5-based key for backwards compatibility
      if (!cached && key.startsWith("photo_") && key.includes("_data:")) {
        // The key might be in old format, try extracting the photo URL and using legacy key
        const photoUrl = key.includes("_data:") ? key.slice(key.indexOf("_data:") + 1) : null;
        if (photoUrl) {
          const legacyKey = generateLegacyCacheKey(photoUrl);
          cached = await storage.getPreprocessingCache(legacyKey);
        }
      }
      
      if (cached) {
        return {
          maskedUserPhoto: cached.maskedUserPhoto || undefined,
          maskedImage: cached.maskedUserPhoto || undefined, // Alias
          userAnalysis: cached.userAnalysis as any || (cached.ethnicity ? { 
            raceEthnicity: cached.ethnicity, 
            gender: cached.gender || undefined,
            faceShape: cached.faceShape || undefined 
          } : undefined),
          visionResult: cached.userAnalysis as any || (cached.ethnicity ? { 
            raceEthnicity: cached.ethnicity, 
            gender: cached.gender || undefined 
          } : undefined),
          rankedReferences: cached.rankedReferences as any[] || undefined,
          usedReferenceIndex: cached.usedReferenceIndex || 0,
          timestamp: cached.updatedAt ? new Date(cached.updatedAt).getTime() : Date.now(),
        };
      }
      // Fallback to memory cache
      return memoryFallbackCache.get(key);
    } catch (error) {
      console.error(`[CACHE] Error getting from DB, using memory fallback:`, error);
      return memoryFallbackCache.get(key);
    }
  },

  async set(key: string, value: PreprocessCacheEntry): Promise<void> {
    try {
      const userAnalysis = value.userAnalysis || value.visionResult;
      await storage.setPreprocessingCache(key, {
        cacheKey: key,
        maskedUserPhoto: value.maskedUserPhoto || value.maskedImage,
        userAnalysis: userAnalysis as any,
        ethnicity: userAnalysis?.raceEthnicity,
        gender: userAnalysis?.gender,
        faceShape: (userAnalysis as any)?.faceShape,
        rankedReferences: value.rankedReferences as any,
        usedReferenceIndex: value.usedReferenceIndex || 0,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hour expiry
      });
      // Also keep in memory as backup
      memoryFallbackCache.set(key, value);
    } catch (error) {
      console.error(`[CACHE] Error saving to DB, using memory fallback:`, error);
      memoryFallbackCache.set(key, value);
    }
  },

  async update(key: string, updates: Partial<PreprocessCacheEntry>): Promise<void> {
    try {
      const existing = await this.get(key);
      if (existing) {
        const merged = { ...existing, ...updates, timestamp: Date.now() };
        await this.set(key, merged);
      } else {
        await this.set(key, { ...updates, timestamp: Date.now() });
      }
    } catch (error) {
      console.error(`[CACHE] Error updating DB cache:`, error);
      const existing = memoryFallbackCache.get(key);
      memoryFallbackCache.set(key, { ...existing, ...updates, timestamp: Date.now() });
    }
  },

  entries(): IterableIterator<[string, PreprocessCacheEntry]> {
    // For debugging - return memory cache entries
    return memoryFallbackCache.entries();
  },

  async clearForPhoto(photoUrl: string): Promise<boolean> {
    try {
      // Generate cache key for this photo
      const cacheKey = `photo_${photoUrl.substring(0, 100)}`;
      const legacyKey = generateLegacyCacheKey(photoUrl);
      
      // Clear from memory
      memoryFallbackCache.delete(cacheKey);
      memoryFallbackCache.delete(legacyKey);
      
      // Clear from database by setting expired timestamp
      await storage.setPreprocessingCache(cacheKey, {
        cacheKey,
        maskedUserPhoto: null,
        userAnalysis: null,
        expiresAt: new Date(0), // Immediately expired
      });
      
      console.log(`[CACHE] Cleared cache for photo: ${cacheKey.substring(0, 60)}...`);
      return true;
    } catch (error) {
      console.error(`[CACHE] Error clearing cache:`, error);
      return false;
    }
  },

  async clearAll(): Promise<number> {
    try {
      // Clear memory cache
      const memoryCount = memoryFallbackCache.size;
      memoryFallbackCache.clear();
      
      // Clear database cache by deleting all preprocessing entries
      const dbCount = await storage.clearAllPreprocessingCache();
      
      console.log(`[CACHE] Cleared ALL mask cache - memory: ${memoryCount}, database: ${dbCount}`);
      return memoryCount + dbCount;
    } catch (error) {
      console.error(`[CACHE] Error clearing all cache:`, error);
      return 0;
    }
  }
};

// Minimum image dimensions for reference images
const MIN_PREFERRED_SIZE = 800; // Preferred minimum (800x800)
const MIN_FALLBACK_SIZE = 512;  // Fallback minimum (512x512)

// Face angle types for matching
type FaceAngle = "front" | "three_quarter" | "side" | "tilted" | "unknown";

// Detect face angle in a reference image using GPT-4o-mini vision
async function detectFaceAngle(base64Image: string): Promise<FaceAngle> {
  const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  
  if (!openaiApiKey) {
    return "unknown";
  }

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GENERATION_CONFIG.VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Detect the HEAD ANGLE in this image for hairstyle matching. Focus on the HEAD POSITION and which parts of the hair/head are visible, NOT just where the eyes are looking.

Analyze:
1. Which parts of the HEAD are visible (front of head, side of head, back of head)?
2. How much of each SIDE of the hair is visible?
3. Is the crown/top of head visible or hidden?

Return ONLY one word:
- "front" if the HEAD faces forward, both sides of hair equally visible, forehead centered
- "three_quarter" if the HEAD is turned 15-45 degrees, one side of hair more visible than other
- "side" if showing HEAD profile, mostly one side of hair visible, ear may be visible
- "tilted" if the HEAD is tilted up/down significantly, crown or neck more visible
- "unknown" if no head/hair is clearly visible

Return ONLY the single word, nothing else.`
              },
              {
                type: "image_url",
                image_url: {
                  url: base64Image,
                  detail: "low" // Use low detail for speed/cost
                }
              }
            ]
          }
        ],
        max_tokens: 10
      })
    });

    if (response.ok) {
      const data = await response.json();
      const angle = data.choices?.[0]?.message?.content?.trim().toLowerCase() as FaceAngle;
      if (["front", "three_quarter", "side", "tilted"].includes(angle)) {
        return angle;
      }
    }
    return "unknown";
  } catch (error) {
    return "unknown";
  }
}

// Check if two face angles are compatible (close enough for good generation)
function areAnglesCompatible(userAngle: FaceAngle, refAngle: FaceAngle): boolean {
  if (refAngle === "unknown") return true; // Don't reject unknowns
  if (userAngle === refAngle) return true; // Exact match
  
  // Allow more tolerance for similar angles - hair transfer works across slight angle differences
  const compatiblePairs: Record<FaceAngle, FaceAngle[]> = {
    "front": ["front", "three_quarter"], // Front users can use 3/4 refs too
    "three_quarter": ["three_quarter", "front"], // 3/4 can use front refs
    "side": ["side", "three_quarter"], // Side can use 3/4 refs
    "tilted": ["tilted", "front", "three_quarter"], // Tilted is flexible
    "unknown": ["front", "three_quarter", "side", "tilted", "unknown"]
  };
  
  return compatiblePairs[userAngle]?.includes(refAngle) ?? false;
}

// Get image dimensions from base64 data URI using sharp
// Accounts for EXIF orientation to return display dimensions
async function getImageDimensions(base64DataUri: string): Promise<{ width: number; height: number } | null> {
  try {
    const rawBase64 = base64DataUri.includes(',') ? base64DataUri.split(',')[1] : base64DataUri;
    const buffer = Buffer.from(rawBase64, 'base64');
    const metadata = await sharp(buffer).metadata();
    if (metadata.width && metadata.height) {
      let width = metadata.width;
      let height = metadata.height;
      
      // EXIF orientation values 5, 6, 7, 8 indicate the image is rotated 90° or 270°
      // In these cases, width and height should be swapped for display dimensions
      const orientation = metadata.orientation;
      if (orientation && orientation >= 5 && orientation <= 8) {
        [width, height] = [height, width];
        console.log(`📐 EXIF orientation ${orientation}: swapped to ${width}×${height}`);
      }
      
      return { width, height };
    }
    return null;
  } catch (error) {
    console.error("Error getting image dimensions:", error);
    return null;
  }
}

// Normalize image orientation by physically rotating pixels based on EXIF
// Returns base64 data URI with correct orientation and stripped EXIF metadata
async function normalizeImageOrientation(base64DataUri: string): Promise<string> {
  try {
    const rawBase64 = base64DataUri.includes(',') ? base64DataUri.split(',')[1] : base64DataUri;
    const buffer = Buffer.from(rawBase64, 'base64');
    
    // Check if rotation is needed
    const metadata = await sharp(buffer).metadata();
    const orientation = metadata.orientation;
    
    if (orientation && orientation !== 1) {
      // Apply EXIF rotation and strip metadata
      const rotatedBuffer = await sharp(buffer)
        .rotate() // Auto-rotates based on EXIF, strips orientation metadata
        .jpeg({ quality: 95 }) // Re-encode as JPEG to ensure clean output
        .toBuffer();
      
      const rotatedMetadata = await sharp(rotatedBuffer).metadata();
      console.log(`📐 Normalized orientation: EXIF ${orientation} → physical ${rotatedMetadata.width}×${rotatedMetadata.height}`);
      
      return `data:image/jpeg;base64,${rotatedBuffer.toString('base64')}`;
    }
    
    // No rotation needed, return original
    return base64DataUri;
  } catch (error) {
    console.error("Error normalizing image orientation:", error);
    return base64DataUri; // Return original on error
  }
}

type ChatGPTImageSize = "1024x1024" | "1024x1536" | "1536x1024";
type ChatGPTImageQuality = "low" | "medium" | "high";

function selectChatGPTImageSize(width: number, height: number): ChatGPTImageSize {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.15) return "1536x1024";
  if (ratio < 0.87) return "1024x1536";
  return "1024x1024";
}

async function resizeImageToDimensions(imageDataOrUrl: string, width: number, height: number): Promise<string | null> {
  try {
    let base64Image = imageDataOrUrl;
    if (!base64Image.startsWith("data:")) {
      const fetched = await fetchImageAsBase64(base64Image);
      if (!fetched) return null;
      base64Image = fetched;
    }

    const rawBase64 = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
    const rawBuffer = Buffer.from(rawBase64, "base64");
    const resized = await sharp(rawBuffer)
      .resize(width, height, { fit: "cover", position: "center" })
      .jpeg({ quality: 95 })
      .toBuffer();
    return `data:image/jpeg;base64,${resized.toString("base64")}`;
  } catch (error) {
    console.warn(`[STAGE1 RESIZE] Failed to resize image to ${width}x${height}:`, error);
    return null;
  }
}

// Calculate valid FLUX dimensions that preserve aspect ratio
// FLUX requires: multiples of 16, range 256-1440, max ~2MP (official BFL spec)
function calculateFluxDimensions(originalWidth: number, originalHeight: number): { width: number; height: number } {
  const MIN_DIM = 256;
  const MAX_DIM = 1440;
  const STEP = 16; // Official BFL spec: multiples of 16
  const MAX_PIXELS = 2_000_000; // ~2MP max for FLUX 2 Pro
  
  // Calculate original aspect ratio
  const targetRatio = originalWidth / originalHeight;
  
  // Find the best width/height combination that:
  // 1. Both are multiples of 32
  // 2. Both are within 256-1440 range
  // 3. Total pixels under 2MP
  // 4. Aspect ratio closest to original
  
  let bestWidth = 1024;
  let bestHeight = 1024;
  let bestRatioDiff = Infinity;
  
  // Iterate through valid heights and find matching widths
  for (let h = MIN_DIM; h <= MAX_DIM; h += STEP) {
    // Calculate ideal width for this height
    const idealWidth = h * targetRatio;
    
    // Try both floor and ceil to nearest STEP
    const widthFloor = Math.floor(idealWidth / STEP) * STEP;
    const widthCeil = Math.ceil(idealWidth / STEP) * STEP;
    
    for (const w of [widthFloor, widthCeil]) {
      // Check constraints
      if (w < MIN_DIM || w > MAX_DIM) continue;
      if (w * h > MAX_PIXELS) continue;
      
      // Calculate how close this ratio is to target
      const ratio = w / h;
      const ratioDiff = Math.abs(ratio - targetRatio);
      
      // Prefer larger dimensions when ratio diff is similar (within 0.001)
      if (ratioDiff < bestRatioDiff - 0.001 || 
          (ratioDiff < bestRatioDiff + 0.001 && w * h > bestWidth * bestHeight)) {
        bestRatioDiff = ratioDiff;
        bestWidth = w;
        bestHeight = h;
      }
    }
  }
  
  const finalRatio = bestWidth / bestHeight;
  console.log(`📐 Aspect ratio fix: ${originalWidth}×${originalHeight} → ${bestWidth}×${bestHeight} (target: ${targetRatio.toFixed(4)}, actual: ${finalRatio.toFixed(4)}, diff: ${(bestRatioDiff * 100).toFixed(2)}%)`);
  
  return { width: bestWidth, height: bestHeight };
}

// File system cache for hair masks (avoids Replicate cold starts)
const MASK_CACHE_DIR = "/tmp/hair_masks";

// Compute MD5 hash of image data for cache key
function computePhotoHash(base64Data: string): string {
  // Strip data URI prefix if present
  const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  return crypto.createHash('md5').update(rawBase64).digest('hex');
}

// Try to get cached mask from file system
async function getCachedMaskFromFile(photoHash: string): Promise<string | null> {
  const maskPath = `${MASK_CACHE_DIR}/${photoHash}.jpg`;
  try {
    const data = await fsPromises.readFile(maskPath);
    const base64 = data.toString('base64');
    console.log(`[FILE CACHE] ✓ Found cached mask: ${maskPath} (${data.length} bytes)`);
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    console.log(`[FILE CACHE] No cached mask found: ${maskPath}`);
    return null;
  }
}

// Save mask to file system cache
async function saveMaskToFileCache(photoHash: string, maskBase64: string): Promise<void> {
  try {
    // Ensure directory exists
    await fsPromises.mkdir(MASK_CACHE_DIR, { recursive: true });
    
    // Strip data URI prefix and write binary
    const rawBase64 = maskBase64.includes(',') ? maskBase64.split(',')[1] : maskBase64;
    const buffer = Buffer.from(rawBase64, 'base64');
    const maskPath = `${MASK_CACHE_DIR}/${photoHash}.jpg`;
    
    await fsPromises.writeFile(maskPath, buffer);
    console.log(`[FILE CACHE] ✓ Saved mask to cache: ${maskPath} (${buffer.length} bytes)`);
  } catch (err) {
    console.error(`[FILE CACHE] ✗ Failed to save mask:`, err);
  }
}
function debugLog(message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logLine = data 
    ? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}\n`
    : `[${timestamp}] ${message}\n`;
  fs.appendFileSync(DEBUG_LOG_FILE, logLine);
}

const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const TOGETHER_API_URL = "https://api.together.xyz/v1/images/generations";
const TOGETHER_CHAT_URL = "https://api.together.xyz/v1/chat/completions";
const BFL_API_KEY = process.env.BFL_API_KEY;
const BFL_API_URL = "https://api.bfl.ai/v1/flux-2-pro"; // FLUX 2 Pro with multi-reference support
const BFL_FLUX_KLEIN_STAGE1_API_URL = process.env.BFL_FLUX_KLEIN_STAGE1_API_URL || "https://api.bfl.ai/v1/flux-2-klein-9b"; // Stage 1 Flux Klein provider endpoint
const BFL_FLUX_KLEIN_STAGE2_API_URL =
  process.env.BFL_FLUX_KLEIN_API_URL ||
  process.env.BFL_FLUX_STAGE2_SINGLE_API_URL ||
  "https://api.bfl.ai/v1/flux-2-klein-9b"; // Stage 2 Flux Klein endpoint for the single-stage contract
const BFL_KONTEXT_API_URL = "https://api.bfl.ai/v1/flux-kontext-pro"; // FLUX Kontext Pro for image-to-image with context
const BFL_FILL_API_URL = "https://api.bfl.ai/v1/flux-pro-1.0-fill"; // FLUX Fill for mask-based inpainting
const FAL_AI_KEY = process.env.FAL_AI_KEY || process.env.FAL_KEY;
const FAL_REDUX_ENDPOINT_ID = "fal-ai/flux-pro/v1/redux";
const FAL_FILL_ENDPOINT_ID = "fal-ai/flux-pro/v1/fill";
const FAL_QUEUE_TIMEOUT_MS = parseInt(process.env.FAL_QUEUE_TIMEOUT_MS || "180000");
const SERPER_API_KEY = process.env.SERPER_API_KEY; // For web image search (fallback)
const SERPAPI_KEY = process.env.SERPAPI_KEY; // SerpAPI for Google Images search (primary)
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY_SEARCH || process.env.GOOGLE_CUSTOM_SEARCH_KEY || process.env.GOOGLE_PLACES_API_KEY; // Google Custom Search API
const GOOGLE_CSE_ID = "c670db0add0214306"; // Custom Search Engine ID
const SCREENSHOTONE_ACCESS_KEY = process.env.SCREENSHOTONE_ACCESS_KEY; // For high-quality social media screenshots
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN; // For PuLID and HairFastGAN

// Generation timeout - if BFL/Kontext takes longer than this, abort and prompt user to retry
const GENERATION_TIMEOUT_SECONDS = 65;

const MODEL_ID_FLUX_STAGE2 = "flux-2-pro";
const MODEL_ID_FLUX_KLEIN_STAGE2 = "flux-2-klein-9b";
const MODEL_ID_FLUX_KLEIN_STAGE1 = "flux-2-klein-9b";
const MODEL_ID_FLUX_FILL_STAGE2 = "flux-pro-1.0-fill";
const MODEL_ID_FAL_REDUX_FILL_STAGE2 = "fal-ai/flux-pro/v1/redux+fill";
const MODEL_ID_BLEND_STAGE2 = "blend-inpaint-local-v1";
const MODEL_ID_GPT_FILL_STAGE2 = "gpt-image-fill";
const MODEL_ID_KONTEXT_STAGE1 = "flux-kontext-pro";
const MODEL_ID_MASK_PIPELINE = "kontext_result_mask_test";
const KLEIN_SINGLE_STAGE_REFERENCE_PROMPT = (
  GENERATION_CONFIG.KONTEXT_STAGE2_PROMPT_KLEIN ||
  "Image 1 is the full image, it contains the subject. Use image 1 as the base and reference. Preserve the person in image 1. Image 2 shows the subject's face which you should preserve. Image 3 contains a hairstyle on a mannequin, change the subject's hair to the hairstyle in image 3. Make the hair emerge naturally from the scalp. Maintain a natural hairline and root direction. Make the hairstyle match the subject's head shape and perspective. Original photorealistic lighting."
).replace(/\s+/g, " ").trim();
type KontextStage2Backend = "fal_redux_fill" | "flux_fill" | "flux2" | "flux_klein" | "blend_inpaint" | "gpt_fill";
type KontextStage1Provider = "gpt_image" | "kontext" | "flux_klein";

if (FAL_AI_KEY) {
  fal.config({ credentials: FAL_AI_KEY });
}

type ModelDebugInfo = {
  pipeline: string;
  stage1Provider?: KontextStage1Provider;
  stage1Model?: string;
  stage2Model?: string;
  stage2Backend?: KontextStage2Backend;
  stage2PromptSource?: string;
  maskPipeline?: string;
  generatedAt: string;
};

function resolveKontextStage1Provider(rawProvider?: string): KontextStage1Provider {
  const provider = (rawProvider || "").trim().toLowerCase();
  if (provider === "flux_klein" || provider === "klein") return "flux_klein";
  if (provider === "kontext") return "kontext";
  return "gpt_image";
}

function getKontextStage1ProviderLabel(provider: KontextStage1Provider): string {
  if (provider === "gpt_image") return `GPT Image (${GENERATION_CONFIG.CHATGPT_MODEL})`;
  if (provider === "flux_klein") return "FLUX 2 Klein";
  return "FLUX Kontext Pro";
}

function getCurrentChatGptStage1Prompt(
  hairstylePrompt: string,
  userRace?: string | null,
  userGender?: string | null
): string {
  return buildGenerationPrompt(
    GENERATION_CONFIG.CHATGPT_STAGE1_PROMPT_TEMPLATE,
    hairstylePrompt,
    userRace || "natural",
    userGender || ""
  ).replace(/\s+/g, " ").trim();
}

function mergeCompositeData(existing: string | null | undefined, patch: Record<string, unknown>): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore malformed legacy payloads and overwrite with new object.
    }
  }
  return JSON.stringify({ ...base, ...patch });
}

function resolveKontextStage2Backend(rawBackend?: string): KontextStage2Backend {
  const backend = (rawBackend || "").trim().toLowerCase();
  if (backend === "fal_redux_fill") return "flux2";
  if (backend === "flux_fill") return "flux_fill";
  if (backend === "flux_klein" || backend === "klein") return "flux_klein";
  if (backend === "blend_inpaint") return "blend_inpaint";
  if (backend === "gpt_fill") return "gpt_fill";
  return "flux2";
}

function getKontextStage2BflApiUrl(backend: KontextStage2Backend): string {
  return backend === "flux_klein" ? BFL_FLUX_KLEIN_STAGE2_API_URL : BFL_API_URL;
}

function stripImageDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/\w+;base64,/, "");
}

async function saveBase64DebugImage(filePath: string, dataUri: string): Promise<void> {
  const buffer = Buffer.from(stripImageDataUri(dataUri), "base64");
  await fsPromises.writeFile(filePath, buffer);
}

async function saveDebugImageFromAnySource(filePath: string, imageSource: string): Promise<void> {
  if (imageSource.startsWith("data:")) {
    await saveBase64DebugImage(filePath, imageSource);
    return;
  }
  const response = await fetch(imageSource);
  if (!response.ok) {
    throw new Error(`Failed to fetch debug image source (${response.status})`);
  }
  const imageBuffer = Buffer.from(await response.arrayBuffer());
  await fsPromises.writeFile(filePath, imageBuffer);
}

function getRequestedDebugIndex(req: any): number | null {
  const raw = Array.isArray(req?.query?.index) ? req.query.index[0] : req?.query?.index;
  if (raw === undefined || raw === null || raw === "") return null;
  const idx = Number.parseInt(String(raw), 10);
  return Number.isFinite(idx) && idx > 0 ? idx : null;
}

async function convertGrayBackgroundMaskToBinary(
  maskImageBase64: string,
  grayTolerance: number = 12
): Promise<string | null> {
  try {
    const inputBuffer = Buffer.from(stripImageDataUri(maskImageBase64), "base64");
    const { data, info } = await sharp(inputBuffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = Math.max(1, info.channels);
    const totalPixels = info.width * info.height;
    const binary = Buffer.alloc(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * channels;
      const r = data[idx] ?? 0;
      const g = channels >= 2 ? (data[idx + 1] ?? r) : r;
      const b = channels >= 3 ? (data[idx + 2] ?? r) : r;
      const delta = Math.max(
        Math.abs(r - 128),
        Math.abs(g - 128),
        Math.abs(b - 128)
      );
      binary[i] = delta > grayTolerance ? 255 : 0;
    }

    const binaryPng = await sharp(binary, {
      raw: { width: info.width, height: info.height, channels: 1 },
    })
      .png()
      .toBuffer();
    return `data:image/png;base64,${binaryPng.toString("base64")}`;
  } catch (error) {
    console.error("[STAGE2 BLEND] Failed to convert mask to binary:", error);
    return null;
  }
}

async function runPythonHairBlend(
  userImageBase64: string,
  referenceImageBase64: string,
  userMaskBinaryBase64: string,
  referenceMaskBinaryBase64: string
): Promise<string | null> {
  try {
    const { spawn } = await import("child_process");
    const path = await import("path");
    const pythonPath = path.join(process.cwd(), "server", "hair_blend.py");
    const pythonBin = process.env.PYTHON_BIN || "python3";

    return await new Promise<string | null>((resolve) => {
      const python = spawn(pythonBin, [pythonPath], {
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timeout = setTimeout(() => {
        console.error("[STAGE2 BLEND] Python blend timed out");
        python.kill("SIGKILL");
        finish(null);
      }, 90_000);

      python.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      python.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      python.on("error", (error) => {
        clearTimeout(timeout);
        console.error("[STAGE2 BLEND] Python process error:", error);
        finish(null);
      });

      python.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          const stderrTail = stderr.trim().split("\n").slice(-20).join("\n");
          console.error(`[STAGE2 BLEND] Python blend failed (exit ${code})`);
          if (stderrTail) console.error(stderrTail);
          finish(null);
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          if (parsed?.success && typeof parsed.result === "string") {
            if (parsed.stats && typeof parsed.stats === "object") {
              console.log(`[STAGE2 BLEND] Python stats: ${JSON.stringify(parsed.stats)}`);
            }
            finish(parsed.result);
            return;
          }
          console.error("[STAGE2 BLEND] Python returned unsuccessful result");
          finish(null);
        } catch (error) {
          console.error("[STAGE2 BLEND] Failed to parse Python output:", error);
          finish(null);
        }
      });

      const payload = JSON.stringify({
        userImage: userImageBase64,
        referenceImage: referenceImageBase64,
        userMask: userMaskBinaryBase64,
        referenceMask: referenceMaskBinaryBase64,
      });

      python.stdin.on("error", (error: any) => {
        if (error?.code !== "EPIPE") {
          console.error("[STAGE2 BLEND] Python stdin error:", error);
        }
      });

      python.stdin.write(payload);
      python.stdin.end();
    });
  } catch (error) {
    console.error("[STAGE2 BLEND] Failed to run Python blend:", error);
    return null;
  }
}

async function normalizeImageForFill(imageSource: string): Promise<string | null> {
  try {
    if (!imageSource.startsWith("data:")) {
      return imageSource;
    }
    const inputBuffer = Buffer.from(stripImageDataUri(imageSource), "base64");
    const jpegBuffer = await sharp(inputBuffer)
      .rotate()
      .removeAlpha()
      .jpeg({ quality: 95 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
  } catch (error) {
    console.warn("[STAGE2 COMPARE] Failed to normalize fill image to JPEG:", error);
    return null;
  }
}

function fillEnclosedHolesInBinaryMask(binary01: Uint8Array, width: number, height: number): Uint8Array {
  const total = width * height;
  const background = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qh = 0;
  let qt = 0;

  for (let i = 0; i < total; i++) {
    background[i] = binary01[i] === 0 ? 1 : 0;
  }

  const enqueueIfBackground = (idx: number) => {
    if (idx < 0 || idx >= total) return;
    if (!background[idx] || visited[idx]) return;
    visited[idx] = 1;
    queue[qt++] = idx;
  };

  for (let x = 0; x < width; x++) {
    enqueueIfBackground(x);
    enqueueIfBackground((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    enqueueIfBackground(y * width);
    enqueueIfBackground(y * width + (width - 1));
  }

  while (qh < qt) {
    const idx = queue[qh++];
    const y = Math.floor(idx / width);
    const x = idx - y * width;

    if (x > 0) enqueueIfBackground(idx - 1);
    if (x + 1 < width) enqueueIfBackground(idx + 1);
    if (y > 0) enqueueIfBackground(idx - width);
    if (y + 1 < height) enqueueIfBackground(idx + width);
  }

  const out = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    // Keep existing foreground and fill only enclosed background holes.
    out[i] = binary01[i] === 1 || (background[i] === 1 && visited[i] === 0) ? 1 : 0;
  }
  return out;
}

async function forceStrictBinaryMask(maskImageDataUri: string): Promise<string | null> {
  try {
    const inputBuffer = Buffer.from(stripImageDataUri(maskImageDataUri), "base64");
    const { data, info } = await sharp(inputBuffer)
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    const binary01 = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      // Any non-black value is treated as foreground hair.
      binary01[i] = (data[i] ?? 0) > 0 ? 1 : 0;
    }
    const filled01 = fillEnclosedHolesInBinaryMask(binary01, info.width, info.height);

    const strictBinary = Buffer.alloc(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      strictBinary[i] = filled01[i] ? 255 : 0;
    }

    const pngBuffer = await sharp(strictBinary, {
      raw: { width: info.width, height: info.height, channels: 1 },
    }).png().toBuffer();

    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch (error) {
    console.warn("[STAGE2 COMPARE] Failed to force strict binary mask:", error);
    return null;
  }
}

/**
 * Stage 2 input_image_2 builder (canonical):
 * user face+neck mask via user_mask(includeHair=false).
 */
async function buildStage2FaceNeckMaskFromHairPipeline(
  userImageBase64: string
): Promise<string | null> {
  // Route all Stage 2 face+neck generation through the canonical user mask pipeline.
  return createUserMaskedImage(
    userImageBase64,
    0,
    false,
    0,
    true,
    true,
    false
  );
}

async function buildStage2FaceMaskForKleinSingleStage(
  userImageBase64: string
): Promise<string | null> {
  // Face-only mask for Stage 2 Klein input_image_2 (hair excluded, neck excluded).
  return createUserMaskedImage(
    userImageBase64,
    0,
    false,
    10,
    false,
    true,
    false
  );
}

async function createReferenceHairMaskForKleinSingleStage(
  referenceImageBase64: string
): Promise<string | null> {
  try {
    // Use Stage 1 result to build a Klein guidance mask (fast path: blot only facial features).
    console.log("🎭 Preparing reference mask: stage1_feature_only_face_blot...");
    const referenceHairMask = await createKontextResultMaskTest(
      referenceImageBase64,
      0,
      true,
      false,
      0,
      0,
      0,
      0,
      true,
      false,
      true
    );
    return referenceHairMask;
  } catch (error) {
    console.warn("[KLEIN SINGLE] Failed to prepare Stage 2 reference mask:", error);
    return null;
  }
}

async function buildAlphaFillImage(
  fullUserPhoto: string,
  binaryMaskDataUri: string
): Promise<string | null> {
  try {
    const userBuffer = Buffer.from(stripImageDataUri(fullUserPhoto), "base64");
    const userRaw = await sharp(userBuffer)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const maskBuffer = Buffer.from(stripImageDataUri(binaryMaskDataUri), "base64");
    let maskSharp = sharp(maskBuffer).removeAlpha().greyscale();
    const maskMeta = await maskSharp.metadata();
    if (
      maskMeta.width !== userRaw.info.width ||
      maskMeta.height !== userRaw.info.height
    ) {
      maskSharp = maskSharp.resize(userRaw.info.width, userRaw.info.height, {
        fit: "fill",
        kernel: "nearest",
      });
    }
    const maskRaw = await maskSharp.raw().toBuffer();

    const rgba = Buffer.from(userRaw.data);
    const channels = userRaw.info.channels;
    const totalPixels = userRaw.info.width * userRaw.info.height;
    if (channels < 4) {
      console.warn("[STAGE2 COMPARE] Alpha fill image expected 4 channels after ensureAlpha");
      return null;
    }

    for (let i = 0; i < totalPixels; i++) {
      const alphaIdx = i * channels + 3;
      const maskValue = maskRaw[i] ?? 0;
      // Transparent area gets inpainted by FLUX Fill.
      rgba[alphaIdx] = maskValue > 0 ? 0 : 255;
    }

    const png = await sharp(rgba, {
      raw: {
        width: userRaw.info.width,
        height: userRaw.info.height,
        channels,
      },
    })
      .png()
      .toBuffer();

    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error) {
    console.warn("[STAGE2 COMPARE] Failed to build alpha-channel fill image:", error);
    return null;
  }
}

async function buildHairGrayedFillImage(
  fullUserPhoto: string,
  binaryMaskDataUri: string,
  grayValue: number = 128
): Promise<string | null> {
  try {
    const userBuffer = Buffer.from(stripImageDataUri(fullUserPhoto), "base64");
    const userRaw = await sharp(userBuffer)
      .rotate()
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const maskBuffer = Buffer.from(stripImageDataUri(binaryMaskDataUri), "base64");
    let maskSharp = sharp(maskBuffer).removeAlpha().greyscale();
    const maskMeta = await maskSharp.metadata();
    if (maskMeta.width !== userRaw.info.width || maskMeta.height !== userRaw.info.height) {
      maskSharp = maskSharp.resize(userRaw.info.width, userRaw.info.height, {
        fit: "fill",
        kernel: "nearest",
      });
    }
    const maskRaw = await maskSharp.raw().toBuffer();

    const rgb = Buffer.from(userRaw.data);
    const channels = userRaw.info.channels;
    const totalPixels = userRaw.info.width * userRaw.info.height;
    if (channels < 3) {
      console.warn("[FLUX FILL] Hair-gray base image expected >=3 channels");
      return null;
    }

    const g = Math.max(0, Math.min(255, grayValue));
    for (let i = 0; i < totalPixels; i++) {
      if ((maskRaw[i] ?? 0) > 0) {
        const idx = i * channels;
        rgb[idx] = g;
        rgb[idx + 1] = g;
        rgb[idx + 2] = g;
      }
    }

    const out = await sharp(rgb, {
      raw: {
        width: userRaw.info.width,
        height: userRaw.info.height,
        channels,
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch (error) {
    console.warn("[FLUX FILL] Failed to build hair-grayed base image:", error);
    return null;
  }
}

async function pollBflImageResult(
  pollingUrl: string,
  label: string,
  maxAttempts: number = GENERATION_TIMEOUT_SECONDS
): Promise<string | null> {
  let attempts = 0;
  const startedAt = Date.now();
  let lastLogTime = 0;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const pollResponse = await fetch(pollingUrl, {
      headers: { "x-key": BFL_API_KEY! },
    });
    if (!pollResponse.ok) {
      attempts++;
      continue;
    }

    const result = await pollResponse.json();
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsed - lastLogTime >= 10) {
      console.log(`   ⏳ ${label}... ${elapsed}s (${result.status})`);
      lastLogTime = elapsed;
    }

    if (result.status === "Ready" || result.status === "succeeded") {
      const imageUrl = result.result?.sample || result.sample || null;
      if (imageUrl) {
        console.log(`   ✓ ${label} complete (${elapsed}s)`);
        return imageUrl;
      }
      console.error(`   ✗ ${label} returned success but no image URL`);
      return null;
    }
    if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
      console.error(`   ✗ ${label} failed: ${result.status}`);
      return null;
    }

    attempts++;
  }

  console.error(`   ✗ ${label} timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
  return null;
}

async function runFluxFillComparisonForDebug(
  fillPrompt: string,
  fullUserPhoto: string
): Promise<string | null> {
  if (!BFL_API_KEY) {
    console.warn("[FLUX FILL] BFL_API_KEY missing, skipping FLUX fill request");
    return null;
  }

  const startedAt = Date.now();
  const normalizedUserImage = await normalizeImageForFill(fullUserPhoto);
  if (!normalizedUserImage) {
    console.warn("[FLUX FILL] Could not normalize fill base image");
    return null;
  }

  // Build edit mask from regular user hair-only pipeline (white hair / black preserve).
  const userHairMask = await createHairOnlyImage(fullUserPhoto, 10);
  if (!userHairMask) {
    console.warn("[FLUX FILL] Could not build user white hair mask");
    return null;
  }
  const userBinaryMask = await convertGrayBackgroundMaskToBinary(userHairMask);
  if (!userBinaryMask) {
    console.warn("[FLUX FILL] Could not convert user hair mask to binary");
    return null;
  }

  // Keep mask strictly binary (0/255) in PNG so no non-white pixels remain in hair regions.
  const strictMask = await forceStrictBinaryMask(userBinaryMask);
  if (!strictMask) {
    console.warn("[FLUX FILL] Could not build strict binary fill mask");
    return null;
  }

  // Save exact fill inputs for debug overview.
  try {
    await fsPromises.unlink("/tmp/debug_fill_base_image.png").catch(() => {});
    await fsPromises.unlink("/tmp/debug_fill_style_reference.png").catch(() => {});
    await fsPromises.unlink("/tmp/debug_fill_style_reference.jpg").catch(() => {});
    await saveDebugImageFromAnySource("/tmp/debug_fill_base_image.jpg", normalizedUserImage);
    await saveBase64DebugImage("/tmp/debug_fill_mask_binary.png", strictMask);
  } catch (error) {
    console.warn("[FLUX FILL] Could not save fill input debug images:", error);
  }

  const fillImageRaw = normalizedUserImage.startsWith("data:")
    ? stripImageDataUri(normalizedUserImage)
    : normalizedUserImage;
  const maskRaw = strictMask.startsWith("data:")
    ? stripImageDataUri(strictMask)
    : strictMask;

  const fillPayloadAttempts: Array<{ name: string; body: Record<string, any> }> = [
    {
      name: "FLUX Fill (image+mask, raw base64)",
      body: {
        prompt: fillPrompt,
        image: fillImageRaw,
        mask: maskRaw,
        guidance: GENERATION_CONFIG.KONTEXT_FILL_GUIDANCE,
        steps: GENERATION_CONFIG.KONTEXT_FILL_STEPS,
        prompt_upsampling: GENERATION_CONFIG.KONTEXT_FILL_PROMPT_UPSAMPLING,
        output_format: GENERATION_CONFIG.KONTEXT_FILL_OUTPUT_FORMAT,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      },
    },
    {
      name: "FLUX Fill (image+mask, data URI)",
      body: {
        prompt: fillPrompt,
        image: normalizedUserImage,
        mask: strictMask,
        guidance: GENERATION_CONFIG.KONTEXT_FILL_GUIDANCE,
        steps: GENERATION_CONFIG.KONTEXT_FILL_STEPS,
        prompt_upsampling: GENERATION_CONFIG.KONTEXT_FILL_PROMPT_UPSAMPLING,
        output_format: GENERATION_CONFIG.KONTEXT_FILL_OUTPUT_FORMAT,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      },
    },
  ];

  for (const attempt of fillPayloadAttempts) {
    try {
      console.log(`[FLUX FILL] Trying ${attempt.name}...`);
      const submitResponse = await fetch(BFL_FILL_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-key": BFL_API_KEY!,
        },
        body: JSON.stringify(attempt.body),
      });
      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        console.warn(`[FLUX FILL] ${attempt.name} submit failed: ${submitResponse.status} - ${errorText}`);
        continue;
      }

      const submitData = await submitResponse.json();
      const pollingUrl = submitData.polling_url;
      if (!pollingUrl) {
        console.warn(`[FLUX FILL] ${attempt.name} returned no polling URL`);
        continue;
      }

      const imageUrl = await pollBflImageResult(pollingUrl, attempt.name);
      if (imageUrl) {
        console.log(`[FLUX FILL] ${attempt.name} succeeded in ${Date.now() - startedAt}ms`);
        return imageUrl;
      }
    } catch (error) {
      console.warn(`[FLUX FILL] ${attempt.name} error:`, error);
    }
  }
  console.warn(`[FLUX FILL] FLUX fill failed after ${Date.now() - startedAt}ms`);
  return null;
}

async function runFluxFillStage2(
  fillPrompt: string,
  fullUserPhoto: string
): Promise<string | null> {
  const startedAt = Date.now();
  console.log("[FLUX FILL] Running Stage 2 with 2-input contract...");
  console.log("[FLUX FILL] sent: image_1=full user photo, mask=white user hair mask");
  const result = await runFluxFillComparisonForDebug(
    fillPrompt,
    fullUserPhoto
  );
  const elapsedMs = Date.now() - startedAt;
  if (!result) {
    console.error(`[FLUX FILL] Stage 2 failed after ${elapsedMs}ms`);
    return null;
  }
  console.log(`[FLUX FILL] Stage 2 completed in ${elapsedMs}ms`);
  return result;
}

function extractFalImageUrl(payload: any): string | null {
  if (!payload) return null;
  if (typeof payload === "string") return payload;

  return (
    payload?.images?.[0]?.url ||
    payload?.image?.url ||
    payload?.output?.images?.[0]?.url ||
    payload?.response?.images?.[0]?.url ||
    payload?.data?.images?.[0]?.url ||
    null
  );
}

function dataUriToBlob(dataUri: string): Blob | null {
  try {
    const match = dataUri.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return null;
    const mimeType = match[1];
    const base64 = match[2];
    const buffer = Buffer.from(base64, "base64");
    return new Blob([buffer], { type: mimeType });
  } catch {
    return null;
  }
}

async function ensureFalImageUrl(imageSource: string, label: string): Promise<string | null> {
  if (!imageSource) return null;
  if (!imageSource.startsWith("data:")) return imageSource;

  const blob = dataUriToBlob(imageSource);
  if (!blob) {
    console.warn(`[FAL] ${label} is not a valid data URI`);
    return null;
  }
  try {
    const uploadedUrl = await fal.storage.upload(blob);
    return uploadedUrl;
  } catch (error) {
    console.warn(`[FAL] Failed to upload ${label} to fal storage:`, error);
    return null;
  }
}

async function runFalSubscribe(
  endpointId: string,
  input: Record<string, any>,
  label: string,
): Promise<any | null> {
  if (!FAL_AI_KEY) {
    console.warn("[FAL] Missing FAL_AI_KEY/FAL_KEY");
    return null;
  }

  const startedAt = Date.now();
  let lastLogAt = 0;
  try {
    const result = await fal.subscribe(endpointId, {
      input,
      timeout: FAL_QUEUE_TIMEOUT_MS,
      onQueueUpdate(update) {
        const now = Date.now();
        if (now - lastLogAt < 5000) return;
        lastLogAt = now;
        const status = (update as any)?.status || "unknown";
        const position = (update as any)?.position;
        if (typeof position === "number") {
          console.log(`[FAL] ${label} queue status=${status} position=${position}`);
        } else {
          console.log(`[FAL] ${label} queue status=${status}`);
        }
      },
    });

    const elapsed = Date.now() - startedAt;
    console.log(`[FAL] ${label} completed in ${elapsed}ms`);
    return result;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    console.warn(`[FAL] ${label} failed after ${elapsed}ms:`, error);
    return null;
  }
}

async function runFalReduxFillStage2(
  fillPrompt: string,
  fullUserPhoto: string,
  stage1HairMaskImage: string,
  sourceWidth: number,
  sourceHeight: number
): Promise<string | null> {
  if (!FAL_AI_KEY) {
    console.warn("[FAL REDUX+FILL] Missing FAL_AI_KEY/FAL_KEY");
    return null;
  }

  const startedAt = Date.now();
  let reduxMs = 0;
  let fillMs = 0;

  console.log("[FAL REDUX+FILL] Running Stage 2 with image1+mask2+redux3 contract...");

  const normalizedUserImage = await normalizeImageForFill(fullUserPhoto);
  if (!normalizedUserImage) {
    console.warn("[FAL REDUX+FILL] Could not normalize user image");
    return null;
  }

  const userHairMask = await createHairOnlyImage(fullUserPhoto, 10);
  if (!userHairMask) {
    console.warn("[FAL REDUX+FILL] Could not build user white hair mask");
    return null;
  }

  const userBinaryMask = await convertGrayBackgroundMaskToBinary(userHairMask);
  if (!userBinaryMask) {
    console.warn("[FAL REDUX+FILL] Could not convert user hair mask to binary");
    return null;
  }

  const strictMask = await forceStrictBinaryMask(userBinaryMask);
  if (!strictMask) {
    console.warn("[FAL REDUX+FILL] Could not build strict binary user mask");
    return null;
  }

  let styleReferenceImage = stage1HairMaskImage;
  if (!styleReferenceImage.startsWith("data:")) {
    const fetched = await fetchImageAsBase64(styleReferenceImage);
    if (!fetched) {
      console.warn("[FAL REDUX+FILL] Could not fetch stage1 hair mask reference image");
      return null;
    }
    styleReferenceImage = fetched;
  }
  styleReferenceImage = await normalizeImageForFill(styleReferenceImage);
  if (!styleReferenceImage) {
    console.warn("[FAL REDUX+FILL] Missing stage1 hair-only mask image");
    return null;
  }

  try {
    await saveDebugImageFromAnySource("/tmp/debug_fill_base_image.jpg", normalizedUserImage);
    await saveDebugImageFromAnySource("/tmp/debug_fill_style_reference.png", styleReferenceImage);
    await saveBase64DebugImage("/tmp/debug_fill_mask_binary.png", strictMask);
  } catch (error) {
    console.warn("[FAL REDUX+FILL] Could not save fill debug inputs:", error);
  }

  const reduxStart = Date.now();
  const reduxPrompt = "Extract hairstyle visual guidance from this reference image for hair transfer.";
  const styleReferenceUrl = await ensureFalImageUrl(styleReferenceImage, "redux style reference");
  if (!styleReferenceUrl) {
    console.warn("[FAL REDUX+FILL] Could not upload style reference for redux");
    return null;
  }
  const reduxAttempts: Array<{ name: string; body: Record<string, any> }> = [
    {
      name: "redux(prompt+image+format)",
      body: {
        prompt: reduxPrompt,
        image_url: styleReferenceUrl,
        num_images: 1,
        output_format: "png",
      },
    },
    {
      name: "redux(prompt+image)",
      body: {
        prompt: reduxPrompt,
        image_url: styleReferenceUrl,
      },
    },
    {
      name: "redux(prompt+reference_image_url)",
      body: {
        prompt: reduxPrompt,
        reference_image_url: styleReferenceUrl,
      },
    },
  ];

  let reduxPayload: any = null;
  for (const attempt of reduxAttempts) {
    reduxPayload = await runFalSubscribe(FAL_REDUX_ENDPOINT_ID, attempt.body, `Redux ${attempt.name}`);
    if (reduxPayload) break;
  }
  reduxMs = Date.now() - reduxStart;
  if (!reduxPayload) {
    console.warn("[FAL REDUX+FILL] Redux step failed; falling back to direct style-reference guidance");
  }

  const reduxGuidanceImage = extractFalImageUrl(reduxPayload) || styleReferenceUrl;
  try {
    await saveDebugImageFromAnySource("/tmp/debug_fill_style_reference.jpg", reduxGuidanceImage);
    await saveDebugImageFromAnySource("/tmp/debug_fill_redux_guidance.jpg", reduxGuidanceImage);
  } catch (error) {
    console.warn("[FAL REDUX+FILL] Could not save redux guidance debug image:", error);
  }

  const fillStart = Date.now();
  const fillUserImageUrl = await ensureFalImageUrl(normalizedUserImage, "fill base image");
  const fillMaskUrl = await ensureFalImageUrl(strictMask, "fill white hair mask");
  if (!fillUserImageUrl || !fillMaskUrl) {
    console.warn("[FAL REDUX+FILL] Could not upload fill image/mask to fal storage");
    return null;
  }

  const baseFillPayload: Record<string, any> = {
    prompt: fillPrompt,
    image_url: fillUserImageUrl,
    mask_url: fillMaskUrl,
    output_format: GENERATION_CONFIG.KONTEXT_FILL_OUTPUT_FORMAT,
  };

  const fillAttempts: Array<{ name: string; body: Record<string, any> }> = [
    {
      name: "fill(redux object)",
      body: {
        ...baseFillPayload,
        redux: { image_url: reduxGuidanceImage },
      },
    },
    {
      name: "fill(redux_image_url)",
      body: {
        ...baseFillPayload,
        redux_image_url: reduxGuidanceImage,
      },
    },
    {
      name: "fill(input_image_2 fallback)",
      body: {
        ...baseFillPayload,
        input_image_2: reduxGuidanceImage,
      },
    },
    {
      name: "fill(reference_image_url fallback)",
      body: {
        ...baseFillPayload,
        reference_image_url: reduxGuidanceImage,
      },
    },
  ];

  const reduxObj = reduxPayload?.redux;
  if (reduxObj && typeof reduxObj === "object") {
    fillAttempts.unshift({
      name: "fill(redux object direct)",
      body: {
        ...baseFillPayload,
        redux: reduxObj,
      },
    });
  }

  const reduxEmbedding = reduxPayload?.embedding || reduxPayload?.redux_embedding || reduxPayload?.image_embedding;
  if (reduxEmbedding) {
    fillAttempts.unshift({
      name: "fill(redux_embedding direct)",
      body: {
        ...baseFillPayload,
        redux_embedding: reduxEmbedding,
      },
    });
  }

  let fillPayload: any = null;
  for (const attempt of fillAttempts) {
    fillPayload = await runFalSubscribe(FAL_FILL_ENDPOINT_ID, attempt.body, `Fill ${attempt.name}`);
    if (fillPayload) {
      const out = extractFalImageUrl(fillPayload);
      if (out) {
        fillMs = Date.now() - fillStart;
        const totalMs = Date.now() - startedAt;
        console.log(`[FAL REDUX+FILL] Timing: redux=${reduxMs}ms fill=${fillMs}ms total=${totalMs}ms`);
        console.log(`[FAL REDUX+FILL] Inputs: image_1=user photo, image_2=user white hair mask, image_3=redux guidance`);
        return out;
      }
    }
  }

  fillMs = Date.now() - fillStart;
  const totalMs = Date.now() - startedAt;
  console.warn(`[FAL REDUX+FILL] Fill step failed. Timing: redux=${reduxMs}ms fill=${fillMs}ms total=${totalMs}ms`);
  return null;
}

async function runGptFillStage2(
  fillPrompt: string,
  fullUserPhoto: string,
  stage1HairMaskImage: string,
  sourceWidth: number,
  sourceHeight: number
): Promise<string | null> {
  try {
    const startedAt = Date.now();
    console.log("[GPT FILL] Preparing 3-image input set...");
    const prepStart = Date.now();

    const normalizedUserImage = await normalizeImageForFill(fullUserPhoto);
    if (!normalizedUserImage) {
      console.error("[GPT FILL] Could not normalize user image");
      return null;
    }

    const userHairMask = await createHairOnlyImage(fullUserPhoto, 10);
    if (!userHairMask) {
      console.error("[GPT FILL] Could not create user hair mask");
      return null;
    }

    const userBinaryMask = await convertGrayBackgroundMaskToBinary(userHairMask);
    if (!userBinaryMask) {
      console.error("[GPT FILL] Could not convert user hair mask to binary");
      return null;
    }

    const strictMask = await forceStrictBinaryMask(userBinaryMask);
    if (!strictMask) {
      console.error("[GPT FILL] Could not build strict binary mask");
      return null;
    }

    let styleReferenceImage = stage1HairMaskImage;
    if (!styleReferenceImage.startsWith("data:")) {
      const fetchedStyleReference = await fetchImageAsBase64(styleReferenceImage);
      if (!fetchedStyleReference) {
        console.error("[GPT FILL] Could not fetch stage1 hair mask reference image");
        return null;
      }
      styleReferenceImage = fetchedStyleReference;
    }
    if (!styleReferenceImage) {
      console.error("[GPT FILL] Missing stage1 hair mask reference image");
      return null;
    }

    try {
      await fsPromises.unlink("/tmp/debug_fill_base_image.png").catch(() => {});
      await saveDebugImageFromAnySource("/tmp/debug_fill_base_image.jpg", normalizedUserImage);
      await saveBase64DebugImage("/tmp/debug_fill_mask_binary.png", strictMask);
      await saveDebugImageFromAnySource("/tmp/debug_fill_style_reference.png", styleReferenceImage);
    } catch (error) {
      console.warn("[GPT FILL] Could not save fill debug inputs:", error);
    }

    const prepMs = Date.now() - prepStart;

    const imageSize = selectChatGPTImageSize(sourceWidth, sourceHeight);
    const quality = GENERATION_CONFIG.CHATGPT_IMAGE_QUALITY;
    const prompt = fillPrompt;
    const apiStart = Date.now();

    console.log(`[GPT FILL] Calling ${GENERATION_CONFIG.CHATGPT_MODEL} with imageSize=${imageSize}, quality=${quality}`);
    const generated = await generateHairstyleWithChatGPT(normalizedUserImage, prompt, {
      promptTemplate: "{hairstyle}",
      imageSize,
      quality,
      secondaryImageUrl: strictMask,
      tertiaryImageUrl: styleReferenceImage,
    });
    const apiMs = Date.now() - apiStart;

    if (!generated) {
      console.error("[GPT FILL] Generation failed");
      return null;
    }

    const resizeStart = Date.now();
    const resized = await resizeImageToDimensions(generated, sourceWidth, sourceHeight);
    const resizeMs = Date.now() - resizeStart;
    const finalResult = resized || generated;
    const elapsedMs = Date.now() - startedAt;
    console.log(`[GPT FILL] Timing: prep=${prepMs}ms api=${apiMs}ms resize=${resizeMs}ms total=${elapsedMs}ms`);
    if (resized) {
      console.log(`[GPT FILL] Output resized to ${sourceWidth}x${sourceHeight}`);
    }
    return finalResult;
  } catch (error) {
    console.error("[GPT FILL] Error:", error);
    return null;
  }
}

async function runKontextStage2BlendBackend(
  userImageBase64: string,
  stage1ImageBase64: string,
  stage1HairMaskBase64: string,
  debugPrefix: string
): Promise<string | null> {
  const stage2Start = Date.now();
  let userMaskMs = 0;
  let binaryMs = 0;
  let blendMs = 0;

  console.log("[STAGE2 BLEND] Creating user-hair mask from full user photo...");
  const userMaskStart = Date.now();
  const userHairMask = await createKontextResultMaskTest(userImageBase64, 0);
  userMaskMs = Date.now() - userMaskStart;
  if (!userHairMask) {
    console.error("[STAGE2 BLEND] Failed to create user hair mask");
    return null;
  }

  const binaryStart = Date.now();
  const userMaskBinary = await convertGrayBackgroundMaskToBinary(userHairMask);
  const stage1MaskBinary = await convertGrayBackgroundMaskToBinary(stage1HairMaskBase64);
  binaryMs = Date.now() - binaryStart;
  if (!userMaskBinary || !stage1MaskBinary) {
    console.error("[STAGE2 BLEND] Failed to create binary masks for blending");
    return null;
  }

  try {
    await saveBase64DebugImage(`/tmp/debug_${debugPrefix}_user_hair_mask_binary.png`, userMaskBinary);
    await saveBase64DebugImage(`/tmp/debug_${debugPrefix}_stage1_hair_mask_binary.png`, stage1MaskBinary);
  } catch (error) {
    console.warn("[STAGE2 BLEND] Could not save binary mask debug images:", error);
  }

  console.log("[STAGE2 BLEND] Running local blend backend...");
  const blendStart = Date.now();
  const blended = await runPythonHairBlend(
    userImageBase64,
    stage1ImageBase64,
    userMaskBinary,
    stage1MaskBinary
  );
  blendMs = Date.now() - blendStart;

  const totalMs = Date.now() - stage2Start;
  console.log(
    `[STAGE2 BLEND] Timing: userMask=${userMaskMs}ms binary=${binaryMs}ms blend=${blendMs}ms total=${totalMs}ms`
  );

  if (!blended) {
    console.error("[STAGE2 BLEND] Local blend backend failed");
    return null;
  }
  return blended;
}

function buildKontextRefinedModelDebug(
  stage1Provider: KontextStage1Provider,
  promptSource: string = "KONTEXT_STAGE2_PROMPT"
): ModelDebugInfo {
  const stage2Backend = resolveKontextStage2Backend(GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND);
  const { source: defaultPromptSource } = getKontextStage2PromptTemplateForBackend(stage2Backend);
  const resolvedPromptSource = promptSource === "KONTEXT_STAGE2_PROMPT"
    ? defaultPromptSource
    : promptSource;
  const stage2PromptSource = stage2Backend === "gpt_fill" || stage2Backend === "flux_fill"
    ? "KONTEXT_FILL_PROMPT"
    : resolvedPromptSource;
  return {
    pipeline: "kontext_refined",
    stage1Provider,
    stage1Model: stage1Provider === "gpt_image"
      ? GENERATION_CONFIG.CHATGPT_MODEL
      : stage1Provider === "flux_klein"
        ? MODEL_ID_FLUX_KLEIN_STAGE1
        : MODEL_ID_KONTEXT_STAGE1,
    stage2Model: stage2Backend === "blend_inpaint"
      ? MODEL_ID_BLEND_STAGE2
      : stage2Backend === "fal_redux_fill"
        ? MODEL_ID_FAL_REDUX_FILL_STAGE2
      : stage2Backend === "flux_fill"
        ? MODEL_ID_FLUX_FILL_STAGE2
      : stage2Backend === "flux_klein"
        ? MODEL_ID_FLUX_KLEIN_STAGE2
      : stage2Backend === "gpt_fill"
        ? `${MODEL_ID_GPT_FILL_STAGE2}:${GENERATION_CONFIG.CHATGPT_MODEL}`
      : MODEL_ID_FLUX_STAGE2,
    stage2Backend,
    stage2PromptSource,
    maskPipeline: MODEL_ID_MASK_PIPELINE,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeKontextStage2PromptForHairColorMask(prompt: string): string {
  return (prompt || "").replace(/\s+/g, " ").trim();
}

function normalizeKontextStage2PromptForKleinMask(prompt: string): string {
  return (prompt || "").replace(/\s+/g, " ").trim();
}

function getKontextStage2PromptTemplateForBackend(
  backend: KontextStage2Backend
): { template: string; source: string } {
  if (backend === "flux_klein") {
    return {
      template: GENERATION_CONFIG.KONTEXT_STAGE2_PROMPT_KLEIN,
      source: "KONTEXT_STAGE2_PROMPT_KLEIN",
    };
  }
  return {
    template: GENERATION_CONFIG.KONTEXT_STAGE2_PROMPT,
    source: "KONTEXT_STAGE2_PROMPT",
  };
}

function buildKontextStage2PromptForBackend(prompt: string, backend: KontextStage2Backend): string {
  if (backend === "flux_klein") {
    return normalizeKontextStage2PromptForKleinMask(prompt);
  }
  return normalizeKontextStage2PromptForHairColorMask(prompt);
}

// Maximum generations per session (beta limit)
const MAX_GENERATIONS_PER_SESSION = 15;

// Fetch an image from URL and convert to base64 data URI
// This allows us to proxy images from restricted sources (social media CDNs)
// Get domain-specific headers to bypass social media blocks
function getHeadersForDomain(url: string): Record<string, string> {
  const baseHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
  };

  // TikTok-specific headers
  if (url.includes("tiktok.com") || url.includes("tiktokcdn")) {
    return {
      ...baseHeaders,
      "Referer": "https://www.tiktok.com/",
      "Origin": "https://www.tiktok.com",
    };
  }
  
  // Instagram-specific headers
  if (url.includes("instagram.com") || url.includes("cdninstagram") || url.includes("fbcdn")) {
    return {
      ...baseHeaders,
      "Referer": "https://www.instagram.com/",
      "Origin": "https://www.instagram.com",
    };
  }
  
  // Pinterest-specific headers
  if (url.includes("pinterest.com") || url.includes("pinimg.com")) {
    return {
      ...baseHeaders,
      "Referer": "https://www.pinterest.com/",
    };
  }
  
  // Default headers with origin-based referer
  try {
    const origin = new URL(url).origin;
    return {
      ...baseHeaders,
      "Referer": origin,
    };
  } catch {
    return baseHeaders;
  }
}

async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    // Decode HTML entities in URL (e.g., &amp; -> &)
    const cleanUrl = imageUrl
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
    
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    // Use domain-specific headers to bypass social media blocks
    const headers = getHeadersForDomain(cleanUrl);
    
    const response = await fetch(cleanUrl, {
      signal: controller.signal,
      headers
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      return null;
    }
    
    // Check content type
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      console.error(`Invalid content type: ${contentType}`);
      return null;
    }
    
    // Get image as buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Check size (max 10MB)
    if (buffer.length > 10 * 1024 * 1024) {
      console.error(`Image too large: ${buffer.length} bytes`);
      return null;
    }
    
    // Determine MIME type
    let mimeType = contentType.split(";")[0].trim();
    if (!mimeType.startsWith("image/")) {
      mimeType = "image/jpeg"; // Default fallback
    }
    
    // Convert unsupported formats (AVIF, HEIC, HEIF, WebP) to JPEG for compatibility
    // Also normalize all images through sharp to ensure valid format for BFL FLUX API
    const unsupportedFormats = ["image/avif", "image/heic", "image/heif", "image/webp"];
    const shouldConvert = unsupportedFormats.includes(mimeType);
    
    if (shouldConvert) {
      try {
        const jpegBuffer = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
        const jpegBase64 = jpegBuffer.toString("base64");
        return `data:image/jpeg;base64,${jpegBase64}`;
      } catch (conversionError) {
        console.error(`Failed to convert ${mimeType} to JPEG:`, conversionError);
        return null;
      }
    }
    
    // For JPEG/PNG, still validate through sharp to ensure it's a valid image
    // This prevents corrupted images from causing downstream errors
    try {
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height) {
        console.error("Invalid image: no dimensions");
        return null;
      }
      
      // If image is very large, resize it to save bandwidth/memory
      if (metadata.width! > 2000 || metadata.height! > 2000) {
        const resizedBuffer = await sharp(buffer)
          .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        return `data:image/jpeg;base64,${resizedBuffer.toString("base64")}`;
      }
    } catch (validationError) {
      console.error(`Image validation failed:`, validationError);
      return null;
    }
    
    // Convert to base64 data URI
    const base64 = buffer.toString("base64");
    const dataUri = `data:${mimeType};base64,${base64}`;
    
    return dataUri;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("Image fetch timeout");
    } else {
      console.error("Error fetching image:", error);
    }
    return null;
  }
}

// Check if URL is from a social media domain that may require screenshot capture
function isSocialMediaUrl(url: string): boolean {
  const blockedDomains = [
    "tiktok.com", "tiktokcdn", "tiktokcdn-us.com",
    "instagram.com", "cdninstagram", "fbcdn.net", "fbcdn.com",
    "twitter.com", "twimg.com", "x.com",
    "snapchat.com", "sc-cdn.net",
    "facebook.com"
  ];
  return blockedDomains.some(d => url.toLowerCase().includes(d));
}

// Use ScreenshotOne to capture high-quality screenshot of social media image pages
// This bypasses CDN restrictions by taking a screenshot of the actual webpage
async function captureImageWithScreenshotOne(pageUrl: string): Promise<string | null> {
  if (!SCREENSHOTONE_ACCESS_KEY) {
    return null;
  }
  
  try {
    // Build ScreenshotOne API URL with high-quality settings
    const params = new URLSearchParams({
      access_key: SCREENSHOTONE_ACCESS_KEY,
      url: pageUrl,
      format: "png", // Lossless for best quality
      device_scale_factor: "2", // Retina quality (2x pixel density)
      viewport_width: "1080",
      viewport_height: "1080",
      block_cookie_banners: "true",
      block_ads: "true",
      delay: "2", // Wait for lazy-loaded images
      timeout: "30",
    });
    
    const screenshotUrl = `https://api.screenshotone.com/take?${params.toString()}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000); // 35 second timeout
    
    const response = await fetch(screenshotUrl, {
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ScreenshotOne error: ${response.status} - ${errorText}`);
      return null;
    }
    
    // Get screenshot as buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    if (buffer.length < 1000) {
      console.error("Screenshot too small, likely failed");
      return null;
    }
    
    // Convert to base64 data URI
    const base64 = buffer.toString("base64");
    const dataUri = `data:image/png;base64,${base64}`;
    
    return dataUri;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("ScreenshotOne timeout");
    } else {
      console.error("ScreenshotOne error:", error);
    }
    return null;
  }
}

// Try to fetch any accessible image from a list of URLs
// Returns the first successful fetch as base64, or null if all fail
// For social media URLs, uses ScreenshotOne as the PRIMARY method (social platforms block direct requests)
async function fetchFirstAccessibleImage(imageUrls: string[]): Promise<string | null> {
  for (const url of imageUrls) {
    // For social media URLs, use ScreenshotOne as PRIMARY method
    if (isSocialMediaUrl(url) && SCREENSHOTONE_ACCESS_KEY) {
      const base64 = await captureImageWithScreenshotOne(url);
      if (base64) {
        return base64;
      }
      continue;
    }
    
    // For non-social media URLs, use direct fetch
    const base64 = await fetchImageAsBase64(url);
    if (base64) {
      return base64;
    }
  }
  
  return null;
}

// Types for user photo analysis
interface UserPhotoAnalysis {
  skinTone: string;
  skinToneConfidence: number;
  faceShape: string;
  faceShapeConfidence: number;
  gender: string;
  raceEthnicity: string;
  raceEthnicityConfidence: number;
  hairTexture: string | null;
  currentHairLength: string | null;
  faceAngle: "front" | "three_quarter" | "side" | "tilted";
  faceAngleConfidence: number;
}

// Analyze user photo using GPT-4o-mini vision model
async function analyzeUserPhoto(photoUrl: string): Promise<UserPhotoAnalysis | null> {
  // Use GPT-4o-mini via Replit AI Integrations for face analysis
  const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  
  if (!openaiApiKey) {
    console.error("OpenAI AI Integrations not configured for vision analysis");
    return null;
  }

  try {
    console.log("[VISION] Analyzing user photo...");

    const prompt = `Analyze this person's face for a hairstyle recommendation system.

CRITICAL - GENDER DETECTION:
You MUST determine biological sex accurately. DO NOT guess based on hairstyle or clothing.
Look ONLY at these physical features:
1. JAWLINE: Males have wider, more angular jaws. Females have narrower, rounder jaws.
2. BROW RIDGE: Males have prominent brow ridges. Females have flatter foreheads.
3. NOSE: Males typically have larger, wider noses.
4. CHIN: Males have squarer chins. Females have pointier chins.
5. CHEEKBONES: Females often have more prominent cheekbones.
6. ADAM'S APPLE: If visible, indicates male.
7. FACIAL HAIR: Any stubble/beard = male.

IGNORE these (they don't indicate gender):
- Hair length or style
- Makeup (some men wear makeup)
- Jewelry
- Clothing

RACE/ETHNICITY DETECTION:
Analyze facial features to determine race/ethnicity for finding matching hairstyle references.
Use these categories: asian, black, white, latino, middle_eastern, south_asian, southeast_asian, mixed
Look at: eye shape, nose bridge, lip fullness, skin undertones, facial bone structure.

HEAD ANGLE DETECTION (for hairstyle matching):
Determine the HEAD POSITION/ANGLE - this is CRITICAL for finding matching hairstyle references.
Focus on which parts of the HEAD and HAIR are visible, not just eye direction.
- "front": HEAD faces forward, both sides of hair equally visible, forehead centered
- "three_quarter": HEAD turned 15-45 degrees, one side of hair more visible than the other
- "side": HEAD in profile view, mostly one side of hair visible, ear may be visible
- "tilted": HEAD tilted up/down significantly, crown or neck more visible than normal

Return this JSON:
{
  "skinTone": "light" | "medium-light" | "medium" | "medium-dark" | "dark",
  "skinToneConfidence": 0.0-1.0,
  "faceShape": "oval" | "round" | "square" | "heart" | "oblong" | "diamond",
  "faceShapeConfidence": 0.0-1.0,
  "gender": "male" | "female",
  "raceEthnicity": "asian" | "black" | "white" | "latino" | "middle_eastern" | "south_asian" | "southeast_asian" | "mixed",
  "raceEthnicityConfidence": 0.0-1.0,
  "hairTexture": "straight" | "wavy" | "curly" | "coily" | null,
  "currentHairLength": "short" | "medium" | "long" | null,
  "faceAngle": "front" | "three_quarter" | "side" | "tilted",
  "faceAngleConfidence": 0.0-1.0
}

Return ONLY valid JSON, no markdown code blocks, no explanation.`;

    // Build image URL for OpenAI - either data URL or regular URL
    // GPT-4o-mini only supports JPEG, PNG, GIF, and WebP - NOT AVIF
    let imageUrl: string;
    
    if (photoUrl.startsWith("data:")) {
      // Check if it's an unsupported format (like AVIF)
      const mimeMatch = photoUrl.match(/^data:(image\/[^;]+);base64,/);
      const mimeType = mimeMatch?.[1] || "image/jpeg";
      
      if (mimeType === "image/avif" || mimeType === "image/heic" || mimeType === "image/heif") {
        // Convert unsupported format to JPEG using sharp
        console.log(`[VISION] Converting ${mimeType} to JPEG for GPT-4o-mini compatibility`);
        try {
          const base64Data = photoUrl.split(",")[1];
          const inputBuffer = Buffer.from(base64Data, "base64");
          const jpegBuffer = await sharp(inputBuffer).jpeg({ quality: 90 }).toBuffer();
          const jpegBase64 = jpegBuffer.toString("base64");
          imageUrl = `data:image/jpeg;base64,${jpegBase64}`;
        } catch (conversionError) {
          console.error("[VISION] Failed to convert image format:", conversionError);
          return null;
        }
      } else {
        // OpenAI accepts data URLs directly for supported formats
        imageUrl = photoUrl;
      }
    } else {
      // For external URLs, fetch and convert to JPEG for consistency
      const response = await fetch(photoUrl);
      const buffer = await response.arrayBuffer();
      try {
        const jpegBuffer = await sharp(Buffer.from(buffer)).jpeg({ quality: 90 }).toBuffer();
        const jpegBase64 = jpegBuffer.toString("base64");
        imageUrl = `data:image/jpeg;base64,${jpegBase64}`;
      } catch (conversionError) {
        // Fallback to original format
        const base64 = Buffer.from(buffer).toString("base64");
        const mimeType = response.headers.get("content-type") || "image/jpeg";
        imageUrl = `data:${mimeType};base64,${base64}`;
      }
    }

    // Call OpenAI API with vision (GPT-4o-mini)
    const openaiResponse = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { 
                type: "image_url", 
                image_url: { 
                  url: imageUrl,
                  detail: "high"
                } 
              }
            ]
          }
        ],
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error(`GPT-4o-mini vision analysis error: ${openaiResponse.status} - ${errorText}`);
      return null;
    }

    const data = await openaiResponse.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("No content in GPT-4o-mini vision response");
      return null;
    }


    // Parse JSON from response - robust extraction with multiple fallback patterns
    let parsed: any = null;
    
    try {
      // Method 1: Try direct JSON parse first
      parsed = JSON.parse(content);
    } catch {
      // Method 2: Remove markdown code blocks
      let jsonStr = content;
      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }
      
      // Method 3: Extract first JSON object with greedy matching
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          // Method 4: Try cleaning up common issues (trailing commas, etc.)
          let cleanedJson = jsonMatch[0]
            .replace(/,\s*}/g, '}')  // Remove trailing commas before }
            .replace(/,\s*]/g, ']')  // Remove trailing commas before ]
            .replace(/'/g, '"')       // Replace single quotes with double quotes
            .replace(/(\w+):/g, '"$1":'); // Quote unquoted keys
          
          try {
            parsed = JSON.parse(cleanedJson);
          } catch (e) {
            console.error("Could not parse JSON after cleanup. Raw content:", content);
          }
        }
      }
    }
    
    if (!parsed) {
      console.error("Could not extract JSON from GPT-4o-mini vision response. Raw content:", content);
      return null;
    }
    
    // Ensure all required fields have defaults
    const analysis: UserPhotoAnalysis = {
      skinTone: parsed.skinTone || "medium",
      skinToneConfidence: parsed.skinToneConfidence || 0.5,
      faceShape: parsed.faceShape || "oval",
      faceShapeConfidence: parsed.faceShapeConfidence || 0.5,
      gender: parsed.gender || "female",
      raceEthnicity: parsed.raceEthnicity || "mixed",
      raceEthnicityConfidence: parsed.raceEthnicityConfidence || 0.5,
      hairTexture: parsed.hairTexture || null,
      currentHairLength: parsed.currentHairLength || null,
      faceAngle: parsed.faceAngle || "front",
      faceAngleConfidence: parsed.faceAngleConfidence || 0.5,
    };
    
    return analysis;
  } catch (error) {
    console.error("Error analyzing user photo with GPT-4o-mini:", error);
    return null;
  }
}

// Combined analysis: Analyze user photo AND understand hairstyle prompt together
// Returns user analysis + optimized search query for reference images
interface CombinedAnalysisResult {
  userAnalysis: UserPhotoAnalysis;
  searchQuery: string;
  hairstyleInterpretation: string;
}

const HAIRSTYLE_STOP_WORDS = new Set([
  "a", "an", "and", "best", "cool", "cut", "female", "for", "front", "facing",
  "hairstyle", "hairstyles", "hair", "haircut", "i", "in", "is", "look", "male",
  "me", "my", "of", "on", "please", "style", "that", "the", "to", "trendy",
  "want", "with", "world"
]);

function extractKnownHairstyleName(text: string): string | null {
  const normalized = (text || "").toLowerCase();
  const hairstylePatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\b(knotless braids)\b/, label: "knotless braids" },
    { pattern: /\b(box braids)\b/, label: "box braids" },
    { pattern: /\b(buzz cut)\b/, label: "buzz cut" },
    { pattern: /\b(crew cut)\b/, label: "crew cut" },
    { pattern: /\b(wolf cut)\b/, label: "wolf cut" },
    { pattern: /\b(slick back)\b/, label: "slick back" },
    { pattern: /\b(top knot)\b/, label: "top knot" },
    { pattern: /\b(man bun)\b/, label: "man bun" },
    { pattern: /\b(cornrows)\b/, label: "cornrows" },
    { pattern: /\b(dreadlocks|locs)\b/, label: "locs" },
    { pattern: /\b(waves)\b/, label: "waves" },
    { pattern: /\b(afro)\b/, label: "afro" },
    { pattern: /\b(mullet)\b/, label: "mullet" },
    { pattern: /\b(mohawk)\b/, label: "mohawk" },
    { pattern: /\b(undercut)\b/, label: "undercut" },
    { pattern: /\b(taper)\b/, label: "taper" },
    { pattern: /\b(fade)\b/, label: "fade" },
    { pattern: /\b(bob)\b/, label: "bob" },
    { pattern: /\b(pixie)\b/, label: "pixie" },
    { pattern: /\b(shag)\b/, label: "shag" },
    { pattern: /\b(quiff)\b/, label: "quiff" },
    { pattern: /\b(pompadour)\b/, label: "pompadour" },
    { pattern: /\b(fringe|bangs)\b/, label: "fringe" },
    { pattern: /\b(braids?)\b/, label: "braids" },
    { pattern: /\b(twists?)\b/, label: "twists" },
    { pattern: /\b(curls?)\b/, label: "curls" },
  ];

  for (const { pattern, label } of hairstylePatterns) {
    if (pattern.test(normalized)) return label;
  }
  return null;
}

function normalizeHairstyleName(rawValue: string, fallbackPrompt: string): string {
  const source = (rawValue || "").trim() || (fallbackPrompt || "").trim();
  const known = extractKnownHairstyleName(source);
  if (known) return known;

  const normalized = source
    .toLowerCase()
    .replace(/[`"'“”’]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "hairstyle";

  const words = normalized.split(" ").filter(Boolean);
  const filtered = words.filter((word) => !HAIRSTYLE_STOP_WORDS.has(word));
  const tokens = (filtered.length > 0 ? filtered : words).slice(0, 2);
  return tokens.join(" ") || "hairstyle";
}

function buildBestHairstyleSearchQuery(hairstyleName: string, userAnalysis: UserPhotoAnalysis): string {
  const gender = userAnalysis.gender === "male"
    ? "men"
    : userAnalysis.gender === "female"
      ? "women"
      : "people";

  const raceTerms: Record<string, string> = {
    asian: "asian",
    black: "black",
    white: "white",
    latino: "latino",
    middle_eastern: "middle eastern",
    south_asian: "south asian",
    southeast_asian: "southeast asian",
    mixed: "mixed",
  };
  const normalizedRace = (userAnalysis.raceEthnicity || "").toLowerCase().trim();
  const race = raceTerms[normalizedRace] || normalizedRace.replace(/_/g, " ").trim();
  const raceAndGender = race && race !== "unknown" && race !== "person" ? `${race} ${gender}` : gender;

  return `Best ${hairstyleName} hairstyle for ${raceAndGender}`.replace(/\s+/g, " ").trim();
}

function shuffleArray<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function analyzeUserPhotoWithPrompt(
  photoUrl: string,
  hairstylePrompt: string
): Promise<CombinedAnalysisResult | null> {
  const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  
  if (!openaiApiKey) {
    console.error("OpenAI API key not configured for combined analysis");
    return null;
  }

  try {
    console.log(`[COMBINED ANALYSIS] Analyzing user photo + prompt with GPT-4o-mini: "${hairstylePrompt.substring(0, 50)}..."`);

    const prompt = `Analyze this person's face for a hairstyle recommendation system.

CRITICAL - GENDER DETECTION:
You MUST determine biological sex accurately. DO NOT guess based on hairstyle or clothing.
Look at these physical features:
1. JAWLINE: Males have wider, more angular jaws. Females have narrower, rounder jaws.
2. BROW RIDGE: Males have prominent brow ridges. Females have flatter foreheads.
3. NOSE: Males typically have larger, wider noses.
4. CHIN: Males have squarer chins. Females have pointier chins.
5. CHEEKBONES: Females often have more prominent cheekbones.
6. ADAM'S APPLE: If visible, indicates male.
7. FACIAL HAIR: Any stubble/beard = male.


IGNORE these (they don't indicate gender):
- Hair length or style
- Makeup (some men wear makeup)
- Jewelry
- Clothing

RACE/ETHNICITY DETECTION:
Analyze facial features to determine race/ethnicity for finding matching hairstyle references.
Use these categories: asian, black, white, latino, middle_eastern, south_asian, southeast_asian, mixed
Look at: eye shape, nose bridge, lip fullness, skin undertones, facial bone structure.

INTERPRET THE HAIRSTYLE REQUEST:
Extract ONLY the hairstyle name from the user request.
Rules:
1. Return exactly 1-2 words.
2. No adjectives, no explanation, no sentence.
3. Keep only the hairstyle type.
Example:
- User request: "I want the best slick and trendy waves hairstyle in the world"
- hairstyleName: "waves"

USER'S HAIRSTYLE REQUEST: "${hairstylePrompt}"

Return this JSON:
{
  "userAnalysis": {
    "skinTone": "light" | "medium-light" | "medium" | "medium-dark" | "dark",
    "skinToneConfidence": 0.0-1.0,
    "faceShape": "oval" | "round" | "square" | "heart" | "oblong" | "diamond",
    "faceShapeConfidence": 0.0-1.0,
    "gender": "male" | "female",
    "raceEthnicity": "asian" | "black" | "white" | "latino" | "middle_eastern" | "south_asian" | "southeast_asian" | "mixed",
    "raceEthnicityConfidence": 0.0-1.0,
    "hairTexture": "straight" | "wavy" | "curly" | "coily" | null,
    "currentHairLength": "short" | "medium" | "long" | null,
    "faceAngle": "front" | "three_quarter" | "side" | "tilted",
    "faceAngleConfidence": 0.0-1.0
  },
  "hairstyleName": "1-2 word hairstyle label only"
}

Return ONLY valid JSON, no markdown code blocks, no explanation.`;

    // Build image URL for OpenAI format
    let imageDataUrl: string;
    
    if (photoUrl.startsWith("data:")) {
      const mimeMatch = photoUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (mimeMatch) {
        let mimeType = mimeMatch[1];
        let imageBase64 = mimeMatch[2];
        
        // Convert unsupported formats to JPEG
        if (mimeType === "image/avif" || mimeType === "image/heic" || mimeType === "image/heif") {
          console.log(`[COMBINED ANALYSIS] Converting ${mimeType} to JPEG`);
          try {
            const inputBuffer = Buffer.from(imageBase64, "base64");
            const jpegBuffer = await sharp(inputBuffer).jpeg({ quality: 90 }).toBuffer();
            imageBase64 = jpegBuffer.toString("base64");
            mimeType = "image/jpeg";
          } catch (conversionError) {
            console.error("[COMBINED ANALYSIS] Failed to convert image format:", conversionError);
            return null;
          }
        }
        imageDataUrl = `data:${mimeType};base64,${imageBase64}`;
      } else {
        console.error("[COMBINED ANALYSIS] Invalid data URL format");
        return null;
      }
    } else {
      const response = await fetch(photoUrl);
      const buffer = await response.arrayBuffer();
      let imageBase64: string;
      try {
        const jpegBuffer = await sharp(Buffer.from(buffer)).jpeg({ quality: 90 }).toBuffer();
        imageBase64 = jpegBuffer.toString("base64");
        imageDataUrl = `data:image/jpeg;base64,${imageBase64}`;
      } catch (conversionError) {
        imageBase64 = Buffer.from(buffer).toString("base64");
        const mimeType = response.headers.get("content-type") || "image/jpeg";
        imageDataUrl = `data:${mimeType};base64,${imageBase64}`;
      }
    }

    const startTime = Date.now();
    const openaiResponse = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { 
                type: "image_url",
                image_url: {
                  url: imageDataUrl,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    const responseTime = Date.now() - startTime;
    console.log(`   ⏱️ GPT-4o-mini response time: ${(responseTime / 1000).toFixed(2)}s`);

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error(`[COMBINED ANALYSIS] GPT-4o-mini error: ${openaiResponse.status} - ${errorText}`);
      return null;
    }

    const data = await openaiResponse.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("[COMBINED ANALYSIS] No content in response");
      return null;
    }

    // Parse JSON from response - robust extraction with multiple fallback patterns
    let parsed: any = null;
    
    try {
      // Method 1: Try direct JSON parse first
      parsed = JSON.parse(content);
    } catch {
      // Method 2: Remove markdown code blocks
      let jsonStr = content;
      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }
      
      // Method 3: Extract first JSON object with greedy matching
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          // Method 4: Try cleaning up common issues (trailing commas, etc.)
          let cleanedJson = jsonMatch[0]
            .replace(/,\s*}/g, '}')  // Remove trailing commas before }
            .replace(/,\s*]/g, ']')  // Remove trailing commas before ]
            .replace(/'/g, '"');      // Replace single quotes with double quotes
          
          try {
            parsed = JSON.parse(cleanedJson);
          } catch (e) {
            console.error("[COMBINED ANALYSIS] Could not parse JSON after cleanup:", content);
          }
        }
      }
    }
    
    if (!parsed) {
      console.error("[COMBINED ANALYSIS] Could not extract JSON:", content);
      return null;
    }
    
    const userAnalysis: UserPhotoAnalysis = {
      skinTone: parsed.userAnalysis?.skinTone || "medium",
      skinToneConfidence: parsed.userAnalysis?.skinToneConfidence || 0.5,
      faceShape: parsed.userAnalysis?.faceShape || "oval",
      faceShapeConfidence: parsed.userAnalysis?.faceShapeConfidence || 0.5,
      gender: parsed.userAnalysis?.gender || "female",
      raceEthnicity: parsed.userAnalysis?.raceEthnicity || "mixed",
      raceEthnicityConfidence: parsed.userAnalysis?.raceEthnicityConfidence || 0.5,
      hairTexture: parsed.userAnalysis?.hairTexture || null,
      currentHairLength: parsed.userAnalysis?.currentHairLength || null,
      faceAngle: parsed.userAnalysis?.faceAngle || "front",
      faceAngleConfidence: parsed.userAnalysis?.faceAngleConfidence || 0.5,
    };

    const hairstyleName = normalizeHairstyleName(
      parsed.hairstyleName || parsed.hairstyleInterpretation || "",
      hairstylePrompt
    );
    const searchQuery = buildBestHairstyleSearchQuery(hairstyleName, userAnalysis);

    const result: CombinedAnalysisResult = {
      userAnalysis,
      searchQuery,
      hairstyleInterpretation: hairstyleName,
    };
    
    console.log(`[COMBINED ANALYSIS] ✓ Completed in ${(responseTime / 1000).toFixed(2)}s`);
    console.log(`   👤 User: ${userAnalysis.gender}, ${userAnalysis.raceEthnicity}, ${userAnalysis.faceShape} face`);
    console.log(`   💇 Hairstyle name: "${result.hairstyleInterpretation}"`);
    console.log(`   🔍 Search query: "${result.searchQuery}"`);
    
    return result;
  } catch (error) {
    console.error("[COMBINED ANALYSIS] Error:", error);
    return null;
  }
}

// Analyze multiple reference images with GPT-4o-mini vision to generate a detailed hairstyle description
async function analyzeReferenceImages(
  referenceImageBase64s: string[],
  userPrompt: string
): Promise<string> {
  const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  
  if (!openaiApiKey || referenceImageBase64s.length === 0) {
    return userPrompt;
  }

  try {

    // Build content array with all reference images
    const imageContents = referenceImageBase64s.map((base64, index) => ({
      type: "image_url" as const,
      image_url: {
        url: base64.startsWith("data:") ? base64 : `data:image/jpeg;base64,${base64}`,
        detail: "high" as const
      }
    }));

    const prompt = `You are analyzing ${referenceImageBase64s.length} hairstyle reference images that a user wants to replicate.

The user originally described wanting: "${userPrompt}"

Analyze ALL the reference images and provide a comprehensive, unified description of the hairstyle that captures:

1. **Length**: How long is the hair? (pixie, short, medium, long, etc.)
2. **Cut Style**: What type of cut? (layers, blunt, textured, tapered, faded, etc.)
3. **Texture**: Straight, wavy, curly, coily?
4. **Volume**: Flat, medium volume, voluminous?
5. **Bangs/Fringe**: Any bangs? What type? (side-swept, curtain, blunt, micro, none)
6. **Parting**: Center part, side part, no part?
7. **Styling**: How is it styled? (slicked back, tousled, blown out, natural, etc.)
8. **Color**: What color(s) if visible? (natural, highlights, balayage, etc.)
9. **Distinctive Features**: Any unique characteristics? (undercut, face-framing layers, etc.)

Write a SINGLE detailed prompt that could be used to generate this exact hairstyle on someone else.
The prompt should be specific and descriptive, focusing on the hair only.

Format: Just write the hairstyle description directly, no preamble or explanation.
Example: "Medium-length layered haircut with curtain bangs, subtle waves, side part, honey blonde with caramel highlights, face-framing layers, natural tousled texture"`;

    const openaiResponse = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...imageContents
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error(`GPT-4o-mini reference analysis error: ${openaiResponse.status} - ${errorText}`);
      return userPrompt;
    }

    const data = await openaiResponse.json();
    const description = data.choices?.[0]?.message?.content?.trim();
    
    if (!description) {
      console.error("No content in GPT-4o-mini reference analysis response");
      return userPrompt;
    }

    return description;
  } catch (error) {
    console.error("Error analyzing reference images with GPT-4o-mini:", error);
    return userPrompt;
  }
}

// Select best reference image using vision analysis
interface ReferenceCandidate {
  imageUrl: string;
  base64: string;
  title: string;
  source: string;
}

interface ScoredReference {
  candidate: ReferenceCandidate;
  score: number;
  reasoning: string;
}

interface VisionSelectionResult {
  candidates: ReferenceCandidate[];
  hairstyleDescription: string;  // Vision model's interpretation of the hairstyle
}

// Pre-filter candidates to remove multi-person/collage images using Gemini Flash
// Uses direct fetch to Replit AI Integrations endpoint
async function filterSinglePersonImages(
  candidates: ReferenceCandidate[],
  hairstyleDescription: string = ""
): Promise<ReferenceCandidate[]> {
  const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  
  if (!geminiApiKey || !geminiBaseUrl || candidates.length === 0) {
    console.log(`   ⚠️ Gemini not available for pre-filter, skipping`);
    return candidates;
  }

  console.log(`   🔍 Pre-filtering ${candidates.length} images with Gemini Flash...`);
  
  try {
    // Prepare all images for Gemini native format
    const imageParts: any[] = [];
    const validCandidates: ReferenceCandidate[] = [];
    
    for (const candidate of candidates) {
      let base64Url = candidate.base64;
      if (!base64Url.startsWith("data:")) {
        base64Url = `data:image/jpeg;base64,${base64Url}`;
      }
      
      const mimeMatch = base64Url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!mimeMatch) continue;
      
      const mimeType = mimeMatch[1];
      const rawBase64 = mimeMatch[2];
      if (rawBase64.length < 1000) continue;
      if (!/^[A-Za-z0-9+/=]+$/.test(rawBase64)) continue;
      
      validCandidates.push(candidate);
      imageParts.push({
        inlineData: {
          mimeType: mimeType,
          data: rawBase64
        }
      });
    }
    
    if (validCandidates.length === 0) return candidates;
    
    const prompt = `You are selecting hairstyle reference images.
Evaluate each image in order.

Output for each image:
- "1" if it meets ALL criteria
- "X" if it fails ANY

Pass criteria:
- Exactly 1 person in the image
- Face clearly visible (eyes, nose, mouth visible)
- Hairstyle matches: ${hairstyleDescription || "the requested style"}
- Hairstyle clearly visible, unobstructed, and in focus
- Person is close to camera
- Front-facing or slight angle (no profile/back view)
- Unique person (not the same individual as a previous "1")

Fail if:
- Multiple people, collages, grids, or comparisons
- Face cropped, hidden, blurry, or turned away
- Hair obscured, cropped, or unclear
- Duplicate of a person already marked "1"

Important: If the same person appears multiple times, only the first valid image gets "1".

Return ONLY a JSON array like: ["1","X","X","1"]
Return exactly ${validCandidates.length} entries.`;

    // Use direct fetch to Replit AI Integrations Gemini endpoint
    const endpoint = `${geminiBaseUrl}/models/gemini-2.5-flash:generateContent`;
    
    const geminiStartTime = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiApiKey}`,
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            ...imageParts
          ]
        }]
      }),
    });
    
    const geminiResponseTime = Date.now() - geminiStartTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`   ⚠️ Gemini pre-filter error: ${response.status} - ${errorText.substring(0, 200)}`);
      return candidates;
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    console.log(`   ⏱️ Gemini Flash pre-filter: ${(geminiResponseTime / 1000).toFixed(2)}s for ${validCandidates.length} images`);
    
    // Parse the response - extract JSON array
    const arrayMatch = content.match(/\[[\s\S]*?\]/);
    if (!arrayMatch) {
      console.log(`   ⚠️ Could not parse Gemini pre-filter response: ${content.substring(0, 100)}`);
      return candidates;
    }
    
    const results: string[] = JSON.parse(arrayMatch[0]);
    
    // Filter to only keep single-person images
    const filtered: ReferenceCandidate[] = [];
    let rejected = 0;
    
    for (let i = 0; i < validCandidates.length && i < results.length; i++) {
      if (results[i] === "1") {
        filtered.push(validCandidates[i]);
      } else {
        rejected++;
      }
    }
    
    console.log(`   ✅ Gemini pre-filter: ${filtered.length} valid, ${rejected} rejected (collages/non-frontal/obscured)`);
    
    return filtered.length > 0 ? filtered : candidates.slice(0, 5); // Fallback if all rejected
    
  } catch (error) {
    console.log(`   ⚠️ Gemini pre-filter error:`, error);
    return candidates;
  }
}

async function selectTopReferencesWithVision(
  candidates: ReferenceCandidate[],
  hairstylePrompt: string,
  userAnalysis: UserPhotoAnalysis | null,
  topN: number = 100,  // Rank all candidates, no artificial limit
  hairstyleDescription: string = ""  // Vision model's interpretation of the hairstyle
): Promise<VisionSelectionResult> {
  const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  
  // Config for GPT-4o-mini only selection (no Gemini pre-filter)
  // Max candidates to send to GPT for ranking (default 20)
  const GPT_MAX_CANDIDATES = GENERATION_CONFIG.TEXT_MODE_GPT_MAX_CANDIDATES || 20;
  
  console.log(`\n🔍 [VISION SELECTION] Starting GPT-4o-mini reference selection...`);
  console.log(`   📊 Input: ${candidates.length} candidates, will send up to ${GPT_MAX_CANDIDATES} to model for ranking`);
  console.log(`   👤 User: ${userAnalysis?.gender || 'unknown'} ${userAnalysis?.raceEthnicity || 'unknown'} (${userAnalysis?.faceShape || 'unknown'} face)`);
  console.log(`   💇 Hairstyle request: "${hairstylePrompt}"`);
  
  if (candidates.length === 0) {
    console.log(`   ⚠️ Skipping vision selection: No candidates`);
    return { candidates: candidates.slice(0, topN), hairstyleDescription: hairstylePrompt };
  }

  if (!openaiApiKey) {
    console.log(`   ⚠️ No OpenAI API key - using first ${topN} candidates`);
    return { candidates: candidates.slice(0, topN), hairstyleDescription: hairstylePrompt };
  }

  try {
    // Send candidates directly to GPT-4o-mini for selection and ranking (no Gemini pre-filter)
    const candidatesForGpt = candidates.slice(0, GPT_MAX_CANDIDATES);
    console.log(`   🤖 Sending ${candidatesForGpt.length} images to GPT-4o-mini for selection & ranking...`);

    // Build image content array with candidates for GPT - VALIDATE and CONVERT each image first
    const validCandidates: ReferenceCandidate[] = [];
    const imageContents: any[] = [];
    
    for (let i = 0; i < candidatesForGpt.length; i++) {
      const candidate = candidatesForGpt[i];
      let base64Url = candidate.base64;
      
      // Ensure proper data URL format
      if (!base64Url.startsWith("data:")) {
        base64Url = `data:image/jpeg;base64,${base64Url}`;
      }
      
      // Check if it's an unsupported format that needs conversion
      const mimeMatch = base64Url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!mimeMatch) continue;
      
      const mimeType = mimeMatch[1];
      let rawBase64 = mimeMatch[2];
      
      // Convert unsupported formats (AVIF, HEIC, HEIF) to JPEG
      if (mimeType === "image/avif" || mimeType === "image/heic" || mimeType === "image/heif") {
        try {
          const inputBuffer = Buffer.from(rawBase64, "base64");
          const jpegBuffer = await sharp(inputBuffer).jpeg({ quality: 85 }).toBuffer();
          rawBase64 = jpegBuffer.toString("base64");
          base64Url = `data:image/jpeg;base64,${rawBase64}`;
        } catch (conversionError) {
          // Skip this image if conversion fails
          continue;
        }
      } else if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
        // Skip other unsupported formats
        continue;
      }
      
      // Check minimum length (very small images are likely broken)
      if (rawBase64.length < 1000) continue;
      
      // Check for valid base64 characters
      if (!/^[A-Za-z0-9+/=]+$/.test(rawBase64)) continue;
      
      // Update candidate with converted base64
      candidate.base64 = base64Url;
      validCandidates.push(candidate);
      imageContents.push({
        type: "image_url" as const,
        image_url: {
          url: base64Url,
          detail: "auto" as const  // Use auto detail for better race detection
        }
      });
    }
    
    if (validCandidates.length === 0) {
      return { candidates: candidatesForGpt.slice(0, topN), hairstyleDescription: hairstylePrompt };
    }

    const gender = userAnalysis?.gender || 'person';
    const raceEthnicity = userAnalysis?.raceEthnicity || 'unknown';
    
    // Use hairstyleDescription if provided, otherwise fall back to hairstylePrompt
    const hairstyleDescForPrompt = hairstyleDescription || hairstylePrompt;
    
    const prompt = `You are a world-class image analyzer selecting hairstyle reference images that show only 1 subject/head.

USER WANTS: "${hairstylePrompt}"
USER: ${gender}, ${raceEthnicity} background

RANKING INSTRUCTIONS:
Rank images from best to worst, Prioritize:
- (PRIMARY) Person matches users gender: ${gender}
- (PRIMARY) Person matches users race: ${raceEthnicity}
- (PRIMARY) Person is front-facing (their face is fully visible)
- (SECONDARY) Image shows only 1 subject
- (SECONDARY) Variation among hairstyles
- (SECONDARY) Visibility and clarity of the hair
- (SECONDARY) Hairstyle matches users requested hairstyle
- (TERTIARY) Symmetrical and flattering presentation

Return ONLY this JSON (no markdown, no extra text):
{"selections":[1,2,3,4,5,...],"reason":"why these show distinct variations","hairstyle":"SHORT hairstyle name"}

Replace the array with ALL valid image numbers ranked from best to worst.
Include 15 images that meet the criteria.
DO NOT return an empty array.`;

    console.log(`   ✅ Prepared ${validCandidates.length} valid images for ${GENERATION_CONFIG.VISION_MODEL} analysis`);
    
    const primaryModel = GENERATION_CONFIG.VISION_MODEL;
    
    // Build content array with prompt and candidate images only (no user photo)
    const contentArray: any[] = [{ type: "text", text: prompt }];
    
    // Add candidate images (Image 1+)
    contentArray.push(...imageContents);
    
    // Log full GPT inputs
    console.log(`\n━━━ FULL GPT INPUTS ━━━`);
    console.log(`📝 PROMPT:\n${prompt}`);
    console.log(`\n🖼️ IMAGES SENT: ${imageContents.length} candidate images`);
    for (let i = 0; i < Math.min(imageContents.length, 5); i++) {
      const url = imageContents[i]?.image_url?.url || '';
      console.log(`   Image ${i + 1}: ${url.substring(0, 50)}... (${url.length} chars)`);
    }
    if (imageContents.length > 5) {
      console.log(`   ... and ${imageContents.length - 5} more images`);
    }
    console.log(`━━━ END GPT INPUTS ━━━\n`);
    
    console.log(`   🤖 Calling ${primaryModel} vision model to rank references...`);
    const startTime = Date.now();

    const openaiResponse = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: primaryModel,
        messages: [
          {
            role: "user",
            content: contentArray
          }
        ],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });
    
    const primaryTime = Date.now() - startTime;
    console.log(`   ⏱️ ${primaryModel} response time: ${(primaryTime / 1000).toFixed(2)}s`);

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error(`❌ Vision model reference selection error: ${openaiResponse.status}`);
      console.error(`   Error details: ${errorText}`);
      console.error(`   Sent ${validCandidates.length} images to ${primaryModel}`);
      return { candidates: validCandidates.slice(0, topN), hairstyleDescription: hairstylePrompt };
    }

    const data = await openaiResponse.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    
    if (!content) {
      console.error(`No content in ${primaryModel} reference selection response`);
      return { candidates: validCandidates.slice(0, topN), hairstyleDescription: hairstylePrompt };
    }


    // Parse JSON: {"selections":[N,N,N,...],"reason":"...","hairstyle":"..."}
    const jsonMatch = content.match(/\{[^{}]*\[[\d,\s]+\][^{}]*\}/);
    if (!jsonMatch) {
      // Fallback: try to parse simpler format
      const simpleMatch = content.match(/\{[^{}]*\}/);
      if (simpleMatch) {
        try {
          const result = JSON.parse(simpleMatch[0]);
          // Handle legacy "best" format for backwards compatibility
          if (result.best) {
            const idx = result.best - 1;
            if (idx >= 0 && idx < validCandidates.length) {
              return { candidates: [validCandidates[idx]], hairstyleDescription: result.hairstyle || hairstylePrompt };
            }
          }
        } catch (e) {
          // Continue to fallback
        }
      }
      console.error("Could not extract JSON from vision response:", content);
      return { candidates: validCandidates.slice(0, topN), hairstyleDescription: hairstylePrompt };
    }

    try {
      const result = JSON.parse(jsonMatch[0]);
      // Support both new "selections" and legacy "top3" format
      const selectedIndices = result.selections || result.top3 || [];
      const reason = result.reason || "No reason provided";
      const hairstyleDescription = result.hairstyle || hairstylePrompt;
      
      // Model returns 1-based image numbers, convert to 0-based array indices
      const indexOffset = 1;
      
      // Log vision model results with clear ranking
      console.log(`\n🎯 [VISION SELECTION] ${primaryModel} Results:`);
      console.log(`   ✂️ Hairstyle interpreted as: "${hairstyleDescription}"`);
      console.log(`   💭 Reason: ${reason}`);
      console.log(`\n📊 [REFERENCE RANKING] ${selectedIndices.length} of ${validCandidates.length} images ranked:`);
      selectedIndices.forEach((idx: number, rank: number) => {
        const candidateIdx = idx - indexOffset;
        const candidate = validCandidates[candidateIdx];
        const source = candidate?.source || 'Unknown';
        const rankLabel = rank === 0 ? '🥇 #1 (BEST)' : rank === 1 ? '🥈 #2' : rank === 2 ? '🥉 #3' : `   #${rank + 1}`;
        console.log(`   ${rankLabel}: Image ${idx} → "${source.substring(0, 50)}${source.length > 50 ? '...' : ''}"`);
      });
      
      if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
        console.warn("Vision model returned empty selections array");
        return { candidates: validCandidates.slice(0, topN), hairstyleDescription: hairstylePrompt };
      }
      
      // Convert indices to candidates (accounting for user photo offset)
      const selectedCandidates: ReferenceCandidate[] = [];
      for (const idx of selectedIndices) {
        const zeroBasedIdx = idx - indexOffset;
        if (zeroBasedIdx >= 0 && zeroBasedIdx < validCandidates.length) {
          selectedCandidates.push(validCandidates[zeroBasedIdx]);
        } else {
          console.warn(`Invalid index ${idx} (maps to ${zeroBasedIdx}), skipping`);
        }
      }
      
      if (selectedCandidates.length === 0) {
        console.error("No valid indices in selections, using first candidates");
        return { candidates: validCandidates.slice(0, topN), hairstyleDescription };
      }
      
      return { candidates: selectedCandidates.slice(0, topN), hairstyleDescription };
    } catch (parseError) {
      console.error("JSON parse error:", parseError, "Raw:", content);
      return { candidates: validCandidates.slice(0, topN), hairstyleDescription: hairstylePrompt };
    }
  } catch (error) {
    console.error("Error in vision reference selection:", error);
    return { candidates: candidates.slice(0, topN), hairstyleDescription: hairstylePrompt };
  }
}

// Search the web for hairstyle reference images
interface WebSearchResult {
  imageUrl: string;
  title: string;
  source: string;
}

async function searchWebForHairstyleImages(
  hairstylePrompt: string,
  userAnalysis: UserPhotoAnalysis | null,
  maxResults: number = 5,
  viewType: "front" | "side" | "any" = "any"
): Promise<WebSearchResult[]> {
  
  // Build search query with trending celebrity format
  // Format: "best trending celebrity {hairstyle} hairstyles for {race} {gender} {previous year} {current year} (front facing)"
  let searchQuery = hairstylePrompt;
  
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  
  if (userAnalysis) {
    const genderTerm = userAnalysis.gender === "male" ? "men" : userAnalysis.gender === "female" ? "women" : "";
    
    const raceTerms: Record<string, string> = {
      "asian": "Asian",
      "black": "Black",
      "white": "Caucasian",
      "latino": "Latino",
      "middle_eastern": "Middle Eastern",
      "south_asian": "South Asian",
      "southeast_asian": "Southeast Asian",
      "mixed": ""
    };
    const raceTerm = raceTerms[userAnalysis.raceEthnicity] || "";
    
    // Format: "best trending celebrity [hairstyle] hairstyles for [race] [gender] [prev year] [current year] (front facing)"
    searchQuery = `best trending celebrity ${hairstylePrompt} hairstyles for ${raceTerm} ${genderTerm} ${previousYear} ${currentYear} (front facing)`.trim().replace(/\s+/g, " ");
  } else {
    searchQuery = `best trending celebrity ${hairstylePrompt} hairstyles ${previousYear} ${currentYear}`;
  }
  
  
  // SKIP social media domains - they block hotlinking and are unreliable
  const blockedDomains = [
    "tiktok.com", "tiktokcdn", "tiktokcdn-us.com",
    "instagram.com", "cdninstagram", "fbcdn.net", "fbcdn.com",
    "twitter.com", "twimg.com", "x.com",
    "snapchat.com", "sc-cdn.net"
  ];
  
  // PRIORITIZE reliable image sources that allow direct access
  const preferredDomains = [
    // Beauty/fashion magazines and blogs
    "allure.com", "byrdie.com", "cosmopolitan.com", "elle.com", "vogue.com",
    "harpersbazaar.com", "glamour.com", "refinery29.com", "thecut.com",
    "menshealth.com", "gq.com", "esquire.com",
    // Professional hairstyle sites
    "matrix.com", "redken.com", "loreal.com", "schwarzkopf.com",
    "behindthechair.com", "modernsalon.com", "hairdresserjournal.com",
    // E-commerce and CDNs (usually accessible)
    "shopify.com", "shopifycdn.com", "amazonaws.com", "cloudinary.com",
    "cloudfront.net", "imgix.net", "akamaized.net",
    // CMS platforms
    "wordpress.com", "wp.com", "wixstatic.com", "squarespace.com",
    "squarespace-cdn.com", "weebly.com", "medium.com",
    // Image hosts
    "imgur.com", "flickr.com", "staticflickr.com",
    // General reliable sources
    "wikimedia.org", "wikipedia.org"
  ];
  
  // Helper to process and filter images
  const processAndFilterImages = (images: any[], urlKey: string = "imageUrl") => {
    return images
      .filter((img: any) => {
        let url = img[urlKey] || "";
        url = url.replace(/&amp;/g, "&");
        
        // Skip blocked domains entirely
        const isBlocked = blockedDomains.some(d => url.toLowerCase().includes(d));
        if (isBlocked) return false;
        
        return url.startsWith("http") && 
               !url.includes("favicon") &&
               !url.includes("logo") &&
               !url.includes("icon") &&
               !url.includes("avatar") &&
               !url.includes("thumbnail") &&
               !url.includes("sprite");
      })
      .map((img: any) => {
        let cleanUrl = (img[urlKey] || "").replace(/&amp;/g, "&");
        const isPreferred = preferredDomains.some(d => cleanUrl.toLowerCase().includes(d));
        return {
          imageUrl: cleanUrl,
          title: img.title || "Hairstyle reference",
          source: img.source || "web",
          priority: isPreferred ? 0 : 1 // 0=preferred (reliable), 1=other
        };
      })
      .sort((a: any, b: any) => a.priority - b.priority)
      .slice(0, maxResults)
      .map(({ imageUrl, title, source }: any) => ({ imageUrl, title, source }));
  };
  
  // Try SerpAPI first (primary - Google Images search)
  if (SERPAPI_KEY) {
    try {
      const perPage = 100;
      const pages = Math.max(1, Math.ceil(maxResults / perPage));
      const allImages: any[] = [];
      for (let page = 0; page < pages; page++) {
        const serpApiUrl = new URL("https://serpapi.com/search.json");
        serpApiUrl.searchParams.set("api_key", SERPAPI_KEY);
        serpApiUrl.searchParams.set("engine", "google_images");
        serpApiUrl.searchParams.set("q", searchQuery);
        serpApiUrl.searchParams.set("num", String(perPage));
        serpApiUrl.searchParams.set("safe", "active");
        serpApiUrl.searchParams.set("ijn", String(page));
        
        const response = await fetch(serpApiUrl.toString());
        if (!response.ok) break;

        const data = await response.json();
        const images = data.images_results || [];
        if (images.length === 0) break;
        allImages.push(...images);
        if (images.length < perPage) break;
      }
      
      if (allImages.length > 0) {
        const results = processAndFilterImages(allImages, "original");
        if (results.length > 0) {
          return results;
        }
      }
    } catch (error) {
      console.error("SerpAPI error:", error);
    }
  }
  
  // Fallback to Serper API (different service)
  if (SERPER_API_KEY) {
    try {
      const response = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: searchQuery,
          num: Math.min(maxResults * 3, 100)
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const images = data.images || [];
        
        if (images.length > 0) {
          const results = processAndFilterImages(images, "imageUrl");
          if (results.length > 0) {
            return results;
          }
        }
      }
    } catch (error) {
      console.error("Serper API error:", error);
    }
  }
  
  // Fallback: Use DuckDuckGo (no API key required, but less reliable)
  try {
    // DuckDuckGo instant answers API (limited but free)
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&iax=images&ia=images`;
    const response = await fetch(ddgUrl, {
      headers: { "User-Agent": "Auren/1.0" }
    });
    
    if (response.ok) {
      const data = await response.json();
      // DuckDuckGo returns limited image data through instant answers
      if (data.Image) {
        return [{
          imageUrl: data.Image,
          title: data.Heading || "Hairstyle reference",
          source: "duckduckgo"
        }];
      }
    }
  } catch (error) {
  }
  
  return [];
}

// Simplified search function that uses a pre-optimized search query directly
async function searchWebForHairstyleImagesWithQuery(
  searchQuery: string,
  maxResults: number = 5
): Promise<WebSearchResult[]> {
  
  console.log(`[SEARCH] Using optimized query: "${searchQuery}"`);
  
  const blockedDomains = [
    "tiktok.com", "tiktokcdn", "tiktokcdn-us.com",
    "instagram.com", "cdninstagram", "fbcdn.net", "fbcdn.com",
    "twitter.com", "twimg.com", "x.com",
    "snapchat.com", "sc-cdn.net"
  ];
  
  const preferredDomains = [
    // Beauty/fashion magazines and blogs
    "allure.com", "byrdie.com", "cosmopolitan.com", "elle.com", "vogue.com",
    "harpersbazaar.com", "glamour.com", "refinery29.com", "thecut.com",
    "menshealth.com", "gq.com", "esquire.com",
    // Professional hairstyle sites
    "matrix.com", "redken.com", "loreal.com", "schwarzkopf.com",
    "behindthechair.com", "modernsalon.com", "hairdresserjournal.com",
    // E-commerce and CDNs (usually accessible)
    "shopify.com", "shopifycdn.com", "amazonaws.com", "cloudinary.com",
    "cloudfront.net", "imgix.net", "akamaized.net",
    // CMS platforms
    "wordpress.com", "wp.com", "wixstatic.com", "squarespace.com",
    "squarespace-cdn.com", "weebly.com", "medium.com",
    // Image hosts
    "imgur.com", "flickr.com", "staticflickr.com",
    // General reliable sources
    "wikimedia.org", "wikipedia.org"
  ];

  // Helper function to filter and process images
  const processImages = (images: any[], urlKey: string = "link") => {
    const filtered = images
      .filter((img: any) => {
        let url = img[urlKey] || "";
        url = url.replace(/&amp;/g, "&");
        
        const isBlocked = blockedDomains.some(d => url.toLowerCase().includes(d));
        if (isBlocked) return false;
        
        return url.startsWith("http") && 
               !url.includes("favicon") &&
               !url.includes("logo") &&
               !url.includes("icon") &&
               (url.includes(".jpg") || url.includes(".jpeg") || 
                url.includes(".png") || url.includes(".webp") ||
                !url.match(/\.(svg|gif|ico)$/i));
      })
      .map((img: any) => {
        let cleanUrl = (img[urlKey] || "").replace(/&amp;/g, "&");
        const isPreferred = preferredDomains.some(d => cleanUrl.toLowerCase().includes(d));
        return {
          imageUrl: cleanUrl,
          title: img.title || img.snippet || "Hairstyle reference",
          source: img.displayLink || img.source || "web",
          priority: isPreferred ? 0 : 1
        };
      });
    
    filtered.sort((a: any, b: any) => a.priority - b.priority);
    return filtered.slice(0, maxResults).map(({ imageUrl, title, source }: any) => ({ imageUrl, title, source }));
  };

  // Try SerpAPI first (primary - Google Images search)
  if (SERPAPI_KEY) {
    try {
      const perPage = 100;
      const pages = Math.max(1, Math.ceil(maxResults / perPage));
      const allImages: any[] = [];

      for (let page = 0; page < pages; page++) {
        const serpApiUrl = new URL("https://serpapi.com/search.json");
        serpApiUrl.searchParams.set("api_key", SERPAPI_KEY);
        serpApiUrl.searchParams.set("engine", "google_images");
        serpApiUrl.searchParams.set("q", searchQuery);
        serpApiUrl.searchParams.set("num", String(perPage));
        serpApiUrl.searchParams.set("safe", "active");
        serpApiUrl.searchParams.set("ijn", String(page));

        const response = await fetch(serpApiUrl.toString());

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[SEARCH] SerpAPI error on page ${page + 1}: ${response.status} - ${errorText}`);
          break;
        }

        const data = await response.json();
        const images = data.images_results || [];
        if (images.length === 0) break;
        allImages.push(...images);
        if (images.length < perPage) break;
      }

      if (allImages.length > 0) {
        const results = processImages(allImages, "original");
        if (results.length > 0) {
          return results;
        }
      }
    } catch (error) {
      console.error("[SEARCH] SerpAPI exception:", error);
    }
  } else {
    console.log("[SEARCH] SerpAPI not configured, trying fallbacks...");
  }

  // Fallback to Google Custom Search API
  if (GOOGLE_API_KEY && GOOGLE_CSE_ID) {
    try {
      const googleUrl = new URL("https://www.googleapis.com/customsearch/v1");
      googleUrl.searchParams.set("key", GOOGLE_API_KEY);
      googleUrl.searchParams.set("cx", GOOGLE_CSE_ID);
      googleUrl.searchParams.set("q", searchQuery);
      googleUrl.searchParams.set("searchType", "image");
      googleUrl.searchParams.set("num", String(Math.min(maxResults * 2, 10))); // Google max is 10 per request
      googleUrl.searchParams.set("imgType", "photo");
      googleUrl.searchParams.set("safe", "active");
      
      const response = await fetch(googleUrl.toString());
      
      if (response.ok) {
        const data = await response.json();
        const items = data.items || [];
        
        if (items.length > 0) {
          const results = processImages(items, "link");
          if (results.length > 0) {
            return results;
          }
        }
      } else {
        const errorText = await response.text();
        console.error(`[SEARCH] Google CSE error: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error("[SEARCH] Google CSE exception:", error);
    }
  }

  // Fallback to Serper API
  if (SERPER_API_KEY) {
    try {
      const response = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: searchQuery,
          num: Math.min(maxResults * 4, 100)
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const images = data.images || [];
        
        if (images.length > 0) {
          const results = processImages(images, "imageUrl");
          return results;
        }
      } else {
        const errorText = await response.text();
        console.error(`[SEARCH] Serper API error: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error("[SEARCH] Serper API exception:", error);
    }
  }
  
  console.log("[SEARCH] All search methods exhausted, returning empty results");
  return [];
}

// Score how well a reference matches user features
function scoreReferenceMatch(
  reference: { skinTone: string; faceShape: string; gender: string; styleKeywords: string[] | null },
  userAnalysis: UserPhotoAnalysis,
  keywords: string[]
): number {
  let score = 0;

  // Skin tone matching (highest weight)
  const skinToneOrder = ["light", "medium-light", "medium", "medium-dark", "dark"];
  const userToneIdx = skinToneOrder.indexOf(userAnalysis.skinTone);
  const refToneIdx = skinToneOrder.indexOf(reference.skinTone);
  const toneDiff = Math.abs(userToneIdx - refToneIdx);
  
  if (toneDiff === 0) score += 40; // Exact match
  else if (toneDiff === 1) score += 25; // Close match
  else if (toneDiff === 2) score += 10; // Moderate difference
  // Farther differences get no points

  // Face shape matching (medium weight)
  if (reference.faceShape === userAnalysis.faceShape) {
    score += 25;
  } else {
    // Give partial points for "compatible" shapes
    const compatibleShapes: Record<string, string[]> = {
      oval: ["round", "heart"],
      round: ["oval", "square"],
      square: ["round", "oblong"],
      heart: ["oval", "diamond"],
      oblong: ["oval", "square"],
      diamond: ["heart", "oval"],
    };
    if (compatibleShapes[userAnalysis.faceShape]?.includes(reference.faceShape)) {
      score += 10;
    }
  }

  // Gender matching (important)
  if (reference.gender === userAnalysis.gender || reference.gender === "unisex") {
    score += 20;
  }

  // Keyword matching (style relevance)
  if (keywords.length > 0 && reference.styleKeywords) {
    const refKeywords = reference.styleKeywords.map(k => k.toLowerCase());
    const matchedKeywords = keywords.filter(k => 
      refKeywords.some(rk => rk.includes(k.toLowerCase()) || k.toLowerCase().includes(rk))
    );
    score += Math.min(15, matchedKeywords.length * 5);
  }

  return score;
}

// Initialize Stripe only if API key is available
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-11-17.clover",
    })
  : null;

// Generate hairstyle image using BFL FLUX 2 Pro (text mode)
// referenceImageUrl: optional reference image for better results (matched to user's skin tone/face shape)
interface DualImageResult {
  frontImageUrl: string | null;
  sideImageUrl?: string | null; // Side view generation removed - kept for backward compatibility
  debugData?: {
    userMaskUrl?: string;
    refHairMaskUrl?: string;
  };
}

// Use vision model to describe hairstyle in reference image
async function describeHairstyleFromReference(referenceImageUrl: string): Promise<string | null> {
  const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  
  if (!openaiApiKey) {
    console.error("OpenAI API key not configured for hairstyle description");
    return null;
  }
  
  try {
    console.log("=== Describing Hairstyle from Reference Image ===");
    
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: GENERATION_CONFIG.VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Describe this hairstyle in detail for an AI image generator. Focus on:
- Hair length (short, medium, long)
- Hair texture (straight, wavy, curly, coily)
- Style name if recognizable (fade, bob, undercut, etc.)
- Hair color
- Any specific features (layers, bangs, parting, fade type)

Respond with ONLY a concise description of the hairstyle, no other text. Example: "short low taper fade with textured curls on top, clean sides fading to skin"`
              },
              {
                type: "image_url",
                image_url: { url: referenceImageUrl }
              }
            ]
          }
        ],
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Hairstyle description error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim();
    console.log("Hairstyle description:", description);
    return description || null;
  } catch (error) {
    console.error("Error describing hairstyle:", error);
    return null;
  }
}

// ChatGPT-based hairstyle generation using gpt-image-1
// Simple pipeline: user photo + text prompt → gpt-image-1 → result (no masks, no references)
async function generateHairstyleWithChatGPT(
  photoUrl: string,
  hairstylePrompt: string,
  options?: {
    promptTemplate?: string;
    imageSize?: ChatGPTImageSize;
    quality?: ChatGPTImageQuality;
    secondaryImageUrl?: string;
    tertiaryImageUrl?: string;
    additionalImageUrls?: string[];
  }
): Promise<string | null> {
  try {
    const generationStartMs = Date.now();
    const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    
    if (!openaiApiKey) {
      console.error("AI_INTEGRATIONS_OPENAI_API_KEY not configured, skipping ChatGPT generation");
      return null;
    }

    // Mock generation for testing without API calls
    if (GENERATION_CONFIG.MOCK_GENERATION) {
      console.log("MOCK: Generating hairstyle with ChatGPT (mock mode)");
      return "https://via.placeholder.com/1024x1024?text=ChatGPT+Generated";
    }

    console.log(`=== ChatGPT Image Generation (${GENERATION_CONFIG.CHATGPT_MODEL}) ===`);
    console.log("Image 1 (primary):", photoUrl.substring(0, 50) + "...");
    if (options?.secondaryImageUrl) {
      console.log("Image 2 (secondary):", options.secondaryImageUrl.substring(0, 50) + "...");
    }
    if (options?.tertiaryImageUrl) {
      console.log("Image 3 (tertiary):", options.tertiaryImageUrl.substring(0, 50) + "...");
    }
    if (options?.additionalImageUrls?.length) {
      options.additionalImageUrls.forEach((url, idx) => {
        console.log(`Image ${idx + 4} (additional):`, url.substring(0, 50) + "...");
      });
    }
    console.log("Hairstyle prompt:", hairstylePrompt);
    const promptTemplate = options?.promptTemplate || GENERATION_CONFIG.CHATGPT_DESCRIBE_PROMPT_TEMPLATE;
    const imageSize = options?.imageSize || GENERATION_CONFIG.CHATGPT_IMAGE_SIZE;
    const quality = options?.quality || GENERATION_CONFIG.CHATGPT_IMAGE_QUALITY;
    console.log(`Model: ${GENERATION_CONFIG.CHATGPT_MODEL}`);
    console.log(`Size: ${imageSize}`);
    console.log(`Quality: ${quality}`);

    // Build the prompt from template
    const prompt = promptTemplate.replace("{hairstyle}", hairstylePrompt);
    console.log("Full prompt:", prompt);

    const loadImageBuffer = async (imageSource: string): Promise<Buffer> => {
      if (imageSource.startsWith("data:")) {
        const base64Data = imageSource.replace(/^data:image\/\w+;base64,/, "");
        return Buffer.from(base64Data, "base64");
      }
      const imageResponse = await fetch(imageSource);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image source (${imageResponse.status})`);
      }
      const arrayBuffer = await imageResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    };

    // Get image buffers for multipart upload.
    const imageSources = [
      photoUrl,
      options?.secondaryImageUrl,
      options?.tertiaryImageUrl,
      ...(options?.additionalImageUrls || []),
    ].filter((src): src is string => Boolean(src));
    const imageBuffers = await Promise.all(imageSources.map(loadImageBuffer));

    // Use OpenAI SDK with proper multipart form-data for images/edits
    const OpenAI = await import("openai");
    const { toFile } = await import("openai/uploads");
    const openai = new OpenAI.default({
      apiKey: openaiApiKey,
      baseURL: openaiBaseUrl,
    });

    // Convert buffers to File-like objects for OpenAI SDK using toFile helper.
    const imageFiles = await Promise.all(
      imageBuffers.map((buffer, idx) =>
        toFile(buffer, `image_${idx + 1}.png`, { type: "image/png" })
      )
    );
    const imagePayload = imageFiles.length === 1 ? imageFiles[0] : (imageFiles as any);

    console.log(`Calling OpenAI images.edit with ${GENERATION_CONFIG.CHATGPT_MODEL}...`);
    
    const response = await openai.images.edit({
      model: GENERATION_CONFIG.CHATGPT_MODEL,
      image: imagePayload as any,
      prompt: prompt,
      n: 1,
      size: imageSize,
      quality,
    });

    console.log("OpenAI images.edit response received");
    console.log(`ChatGPT image edit total time: ${((Date.now() - generationStartMs) / 1000).toFixed(2)}s`);

    if (response.data && response.data[0]) {
      // gpt-image-1 returns base64 by default
      if (response.data[0].b64_json) {
        const base64Result = `data:image/png;base64,${response.data[0].b64_json}`;
        console.log("ChatGPT generation successful, got base64 image");
        return base64Result;
      }
      if (response.data[0].url) {
        console.log("ChatGPT generation successful, got URL");
        return response.data[0].url;
      }
    }

    console.error("ChatGPT generation: No image in response");
    return null;
  } catch (error: any) {
    console.error("ChatGPT hairstyle generation error:", error?.message || error);
    
    // If images.edit fails, the feature is not available - don't fall back to text-only generation
    // since that won't preserve the user's identity
    console.log("ChatGPT image edit not available for this model/API - returning null");
    return null;
  }
}


async function generateHairstyleDual(photoUrl: string, hairstylePrompt: string, referenceImageBase64?: string | null): Promise<DualImageResult> {
  // Reference should already be base64 (pre-fetched by caller) or null
  const refs = referenceImageBase64 ? [referenceImageBase64] : [];
  const frontResult = await generateHairstyleSingleView(photoUrl, hairstylePrompt, refs);
  
  return {
    frontImageUrl: frontResult,
    sideImageUrl: null
  };
}

// Generate with separate reference image (legacy compatibility)
async function generateHairstyleDualWithSeparateRefs(
  photoUrl: string, 
  hairstylePrompt: string, 
  frontReferenceBase64?: string | null,
  _sideReferenceBase64?: string | null // Kept for backward compatibility
): Promise<DualImageResult> {
  const frontRefs = frontReferenceBase64 ? [frontReferenceBase64] : [];
  const frontResult = await generateHairstyleSingleView(photoUrl, hairstylePrompt, frontRefs);
  
  return {
    frontImageUrl: frontResult,
    sideImageUrl: null
  };
}

// Generate hairstyle with reference images
async function generateHairstyleSequential(
  photoUrl: string,
  hairstylePrompt: string,
  referenceImages: (string | null)[] = [],
  maskedUserPhoto?: string | null,
  userRace: string = "person",
  userGender: string = ""
): Promise<DualImageResult> {
  const validRefs = referenceImages.filter(r => r !== null);
  
  console.log(`[GEN] Generating hairstyle with ${validRefs.length} reference images`);
  
  const frontImageUrl = await generateHairstyleSingleView(photoUrl, hairstylePrompt, referenceImages, maskedUserPhoto, userRace, userGender);
  
  if (!frontImageUrl) {
    console.error("Generation failed");
    return { frontImageUrl: null, sideImageUrl: null };
  }
  
  return {
    frontImageUrl,
    sideImageUrl: null
  };
}

// Generate hairstyle using BFL FLUX 2 Pro
async function generateHairstyleSingleView(
  photoUrl: string, 
  hairstylePrompt: string, 
  referenceImages: (string | null)[] = [],
  maskedUserPhoto?: string | null,
  userRace: string = "person",
  userGender: string = ""
): Promise<string | null> {
  try {
    if (!BFL_API_KEY) {
      console.error("BFL_API_KEY not configured, skipping AI generation");
      return null;
    }

    // Mock generation for testing without API calls
    if (GENERATION_CONFIG.MOCK_GENERATION) {
      console.log("MOCK: Generating hairstyle (mock mode)");
      return "https://via.placeholder.com/1024x1024?text=Generated+Look";
    }

    // Filter out null references
    const validRefs = referenceImages.filter((r): r is string => r !== null);

    console.log(`=== BFL FLUX 2 Pro Generation ===`);
    console.log("Photo:", photoUrl.substring(0, 50) + "...");
    console.log("Masked user photo:", maskedUserPhoto ? `${maskedUserPhoto.length} chars` : "not provided");
    console.log(`Reference images: ${validRefs.length}`);
    
    // Build prompt based on whether we have reference images
    let prompt: string;
    if (validRefs.length > 0) {
      // With reference images: Apply the hairstyle from references using dynamic prompt
      prompt = buildGenerationPrompt(
        GENERATION_CONFIG.TEXT_MODE_FRONT_PROMPT_TEMPLATE,
        hairstylePrompt,
        userRace,
        userGender
      );
    } else {
      // Without reference images (fallback)
      prompt = `Preserve the person's face and change their hair to: ${hairstylePrompt}. Show the person facing the camera directly.`;
    }

    const safety_tolerance = GENERATION_CONFIG.TEXT_MODE_SAFETY_TOLERANCE;
    
    console.log("Prompt:", prompt);
    console.log("Safety Tolerance:", safety_tolerance);
    console.log("Using reference images:", validRefs.length);

    // Normalize image orientation (physically rotate pixels based on EXIF)
    // This ensures FLUX sees correctly oriented pixels, not raw EXIF-rotated data
    let normalizedPhotoUrl = photoUrl;
    if (photoUrl.startsWith("data:")) {
      normalizedPhotoUrl = await normalizeImageOrientation(photoUrl);
    }
    
    // Extract dimensions from normalized photo to preserve aspect ratio
    let outputWidth = 1024;
    let outputHeight = 1024;
    if (normalizedPhotoUrl.startsWith("data:")) {
      const inputDims = await getImageDimensions(normalizedPhotoUrl);
      if (inputDims) {
        const fluxDims = calculateFluxDimensions(inputDims.width, inputDims.height);
        outputWidth = fluxDims.width;
        outputHeight = fluxDims.height;
      }
    }
    console.log(`Output dimensions: ${outputWidth}×${outputHeight}`);

    // Save debug images
    try {
      const fsDebug = await import("fs/promises");
      
      // Save user photo
      if (photoUrl.startsWith("data:")) {
        const userBuffer = Buffer.from(
          photoUrl.replace(/^data:image\/\w+;base64,/, ''),
          'base64'
        );
        await fsDebug.writeFile("/tmp/debug_user_image.jpg", userBuffer);
        console.log("✓ Saved user photo to /tmp/debug_user_image.jpg");
      }
      
      // Save masked user photo
      if (maskedUserPhoto && maskedUserPhoto.startsWith("data:")) {
        const maskedUserBuffer = Buffer.from(
          maskedUserPhoto.replace(/^data:image\/\w+;base64,/, ''),
          'base64'
        );
        await fsDebug.writeFile("/tmp/debug_user_mask.jpg", maskedUserBuffer);
        console.log("✓ Saved user mask to /tmp/debug_user_mask.jpg");
      }
    } catch (debugErr) {
      console.warn("Failed to save debug images:", debugErr);
    }

    // Build request body - use normalized photo with correct orientation
    // Note: FLUX.2 Pro API only supports: prompt, input_image*, seed, width, height, safety_tolerance, output_format
    const requestBody: any = {
      prompt: prompt,
      input_image: normalizedPhotoUrl,
      width: outputWidth,
      height: outputHeight,
      safety_tolerance,
    };

    // 3-IMAGE PIPELINE for FLUX 2 Pro:
    // input_image (1) = user mask (face + ears visible, hair grayed)
    // input_image_2 (2) = hair-only reference mask (shows hair, facial features blotted)
    // input_image_3 (3) = original user photo (full reference for background)
    
    const useStage2Image3 = GENERATION_CONFIG.KONTEXT_STAGE2_USE_IMAGE3;
    console.log(`📦 Building ${useStage2Image3 ? "3-image" : "2-image"} pipeline for FLUX 2 Pro...`);
    
    // In 3-image mode, use:
    // img1=user mask, img2=hair-only reference, img3=full user photo.
    // In 2-image mode, use:
    // img1=full user photo, img2=hair-only reference.
    if (useStage2Image3) {
      if (maskedUserPhoto) {
        requestBody.input_image = maskedUserPhoto;
        console.log(`  📤 input_image (user mask): ${maskedUserPhoto.length} chars`);
      } else {
        console.warn("  ⚠️ No user mask available");
      }
      if (validRefs.length > 0) {
        requestBody.input_image_2 = validRefs[0];
        console.log(`  📤 input_image_2 (hair-only ref): ${validRefs[0].length} chars`);
      }
    } else {
      requestBody.input_image = normalizedPhotoUrl;
      console.log(`  📤 input_image (full user photo): ${normalizedPhotoUrl.length} chars`);
      requestBody.input_image_2 = validRefs.length > 0 ? validRefs[0] : undefined;
      if (validRefs.length > 0) {
        console.log(`  📤 input_image_2 (hair-only ref): ${validRefs[0].length} chars`);
      }
    }
    if (validRefs.length === 0) {
      console.warn("  ⚠️ No reference image available");
    }
    
    // In 3-image mode, image 3 is the full user photo.
    if (useStage2Image3) {
      requestBody.input_image_3 = normalizedPhotoUrl;
      console.log(`  📤 input_image_3 (full user photo): ${normalizedPhotoUrl.length} chars`);
    } else {
      console.log("  🚫 input_image_3 disabled (2-image mode)");
    }
    
    console.log(`✓ ${useStage2Image3 ? "3-image" : "2-image"} pipeline ready`);
    console.log("Request keys:", Object.keys(requestBody));

    // Submit the generation request
    const submitResponse = await fetch(BFL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(`BFL submission error: ${submitResponse.status} - ${errorText}`);
      return null;
    }

    const submitData = await submitResponse.json();
    console.log("BFL submission ID:", submitData.id);

    const pollingUrl = submitData.polling_url;
    if (!pollingUrl) {
      console.error("No polling URL returned from BFL");
      return null;
    }

    // Poll for result (65 second timeout - prompts user to retry if exceeded)
    const maxAttempts = GENERATION_TIMEOUT_SECONDS;
    let attempts = 0;
    const startTime = Date.now();
    let lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(pollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      
      // Log status every 10 seconds
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        console.log(`   ⏳ Generating... ${elapsed}s (${result.status})`);
        lastLogTime = elapsed;
      }

      // BFL API returns "Ready" or "succeeded" when complete
      if (result.status === "Ready" || result.status === "succeeded") {
        const imageUrl = result.result?.sample || null;
        if (imageUrl) {
          console.log(`   ✓ Generation complete (${elapsed}s)`);
          return imageUrl;
        }
        console.error("   ✗ Generation failed: no image URL");
        return null;
      } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error(`   ✗ Generation failed: ${result.status}`);
        return null;
      }

      attempts++;
    }

    console.error(`   ✗ BFL FLUX 2 Pro timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
    generationMetrics.timeouts++;
    return null;
  } catch (error) {
    console.error("Error generating hairstyle with BFL FLUX 2 Pro:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
    }
    return null;
  }
}

// ============================================
// KONTEXT REFINED PIPELINE: Two-stage generation
// Stage 1: Provider-selected generation (GPT Image edit, FLUX Kontext Pro, or FLUX 2 Klein)
// Stage 2: FLUX 2 Pro (user mask + hair-only mask from Stage 1 + full user photo)
// ============================================
async function generateWithKontextRefined(
  photoUrl: string,
  hairstylePrompt: string,
  referenceBase64: string,
  maskedUserPhoto: string,
  userRace: string = "person",
  userGender: string = "",
  options?: {
    promptOnlyMode?: boolean;
    stage1Provider?: KontextStage1Provider;
    kontextReferenceImageForKleinMask?: string;
    debugIndex?: number;
  }
): Promise<string | null> {
  try {
    if (!BFL_API_KEY) {
      console.error("[KONTEXT REFINED] BFL_API_KEY not configured");
      return null;
    }

    console.log(`\n============================================================`);
    console.log(`🎯 KONTEXT REFINED PIPELINE (Two-Stage)`);
    console.log(`============================================================`);
    
    // Get image processing functions
    const { createHairOnlyImage, createUserMaskedImage } = await import("./imageProcessing");
    
    // Normalize user photo orientation
    let normalizedPhotoUrl = photoUrl;
    if (photoUrl.startsWith("data:")) {
      normalizedPhotoUrl = await normalizeImageOrientation(photoUrl);
    }
    
    // NOTE: Stage 1 now uses ONLY the reference image - no user mask sent to Kontext
    // The user mask is only used in Stage 2 (FLUX 2 Pro) for face preservation
    
    // Extract dimensions for output
    let outputWidth = 1024;
    let outputHeight = 1024;
    let sourceWidth = outputWidth;
    let sourceHeight = outputHeight;
    if (normalizedPhotoUrl.startsWith("data:")) {
      const inputDims = await getImageDimensions(normalizedPhotoUrl);
      if (inputDims) {
        sourceWidth = inputDims.width;
        sourceHeight = inputDims.height;
        const fluxDims = calculateFluxDimensions(inputDims.width, inputDims.height);
        outputWidth = fluxDims.width;
        outputHeight = fluxDims.height;
      }
    }
    console.log(`📐 Output dimensions: ${outputWidth}×${outputHeight}`);
    
    const debugIndex = options?.debugIndex;
    const promptOnlyMode = options?.promptOnlyMode === true;
    const stage1Provider = resolveKontextStage1Provider(
      options?.stage1Provider || GENERATION_CONFIG.TEXT_MODE_STAGE1_PROVIDER
    );
    const stage1Template = stage1Provider === "gpt_image" || stage1Provider === "flux_klein"
      ? GENERATION_CONFIG.CHATGPT_STAGE1_PROMPT_TEMPLATE
      : (promptOnlyMode ? GENERATION_CONFIG.KONTEXT_STAGE1_PROMPT_DIRECT_TEMPLATE : GENERATION_CONFIG.KONTEXT_STAGE1_PROMPT);
    const stage1Prompt = buildGenerationPrompt(
      stage1Template,
      hairstylePrompt,
      userRace,
      userGender
    );
    const stage1ProviderLabel = getKontextStage1ProviderLabel(stage1Provider);
    const stage1InputLabel = stage1Provider === "gpt_image"
      ? "image 1 reference only"
      : stage1Provider === "flux_klein"
      ? "full user photo"
      : (promptOnlyMode ? "user image" : "reference image");

    console.log(`🧭 Stage 1 provider: ${stage1ProviderLabel}`);
    console.log(`📝 Stage 1 prompt: ${stage1Prompt}`);

    const stage1PrimaryImage = stage1Provider === "gpt_image"
      ? referenceBase64
      : (stage1Provider === "flux_klein" || promptOnlyMode)
      ? normalizedPhotoUrl
      : referenceBase64;

    // ============================================
    // STAGE 1: Provider-selected generation (Kontext or GPT Image)
    // ============================================
    console.log(`\n━━━ STAGE 1: ${stage1ProviderLabel} ━━━`);
    
    console.log(`📸 Stage 1 input summary:`);
    console.log(`   - selected input: ${stage1InputLabel}`);
    console.log(`   - user photo provided: ${photoUrl.startsWith('data:') ? 'base64' : 'URL'}`);
    console.log(`   - reference image provided: ${referenceBase64.startsWith('data:') ? 'base64' : 'URL'}`);
    console.log(`   - stage2 user mask provided: ${maskedUserPhoto ? 'yes' : 'no'}`);
    console.log(`   - stage1 image 1 preview: ${stage1PrimaryImage.substring(0, 100)}...`);

    console.log(`  📤 input_image (${stage1InputLabel}): ${stage1PrimaryImage.length} chars`);
    
    // DEBUG: Save Stage 1 input for verification (only reference image now)
    const fsDebugInputs = await import("fs/promises");
    try {
      if (stage1PrimaryImage.startsWith('data:')) {
        const refInputBuffer = Buffer.from(
          stage1PrimaryImage.replace(/^data:image\/\w+;base64,/, ''),
          'base64'
        );
        const debugPath = stage1Provider === "flux_klein"
          ? "/tmp/debug_kontext_stage1_input_user.jpg"
          : "/tmp/debug_kontext_stage1_input_ref.jpg";
        await fsDebugInputs.writeFile(debugPath, refInputBuffer);
        if (debugIndex) {
          const indexedPath = stage1Provider === "flux_klein"
            ? `/tmp/debug_kontext_stage1_input_user_${debugIndex}.jpg`
            : `/tmp/debug_kontext_stage1_input_ref_${debugIndex}.jpg`;
          await fsDebugInputs.writeFile(indexedPath, refInputBuffer);
        }
        console.log(`   ✓ Saved Stage 1 input to ${debugPath}`);
      }
    } catch (e) {
      console.warn("Could not save Stage 1 input debug image:", e);
    }

    try {
      const stage1Metadata = {
        generatedAt: new Date().toISOString(),
        provider: stage1Provider,
        providerLabel: stage1ProviderLabel,
        inputLabel: stage1InputLabel,
        prompt: stage1Prompt,
        inputLength: stage1PrimaryImage.length,
        inputPreview: stage1PrimaryImage.substring(0, 160),
      };
      await fsDebugInputs.writeFile(
        "/tmp/debug_kontext_stage1_metadata.json",
        JSON.stringify(stage1Metadata, null, 2)
      );
      if (debugIndex) {
        await fsDebugInputs.writeFile(
          `/tmp/debug_kontext_stage1_metadata_${debugIndex}.json`,
          JSON.stringify(stage1Metadata, null, 2)
        );
      }
    } catch (e) {
      console.warn("Could not save Stage 1 metadata:", e);
    }
    
    let kontextResultUrl: string | null = null;
    const maxAttempts = GENERATION_TIMEOUT_SECONDS;
    let attempts = 0;
    let lastLogTime = 0;
    const startTime = Date.now();
    if (stage1Provider === "gpt_image") {
      const stage1Size = selectChatGPTImageSize(sourceWidth, sourceHeight);
      const stage1Quality = GENERATION_CONFIG.CHATGPT_IMAGE_QUALITY;
      console.log(`📦 Stage 1 model: ${GENERATION_CONFIG.CHATGPT_MODEL}`);
      console.log(`📦 Stage 1 image options: size=${stage1Size}, quality=${stage1Quality}`);
      kontextResultUrl = await generateHairstyleWithChatGPT(stage1PrimaryImage, stage1Prompt, {
        promptTemplate: "{hairstyle}",
        imageSize: stage1Size,
        quality: stage1Quality,
      });
      if (!kontextResultUrl) {
        console.error("[GPT STAGE 1] Failed to generate stage 1 image");
        return null;
      }

      // Force exact user-photo dimensions for downstream masking quality.
      const resizedStage1 = await resizeImageToDimensions(kontextResultUrl, sourceWidth, sourceHeight);
      if (resizedStage1) {
        kontextResultUrl = resizedStage1;
        console.log(`   ✓ Stage 1 resized to user dimensions: ${sourceWidth}x${sourceHeight}`);
      } else {
        console.warn("[GPT STAGE 1] Could not enforce exact user dimensions; using original GPT image");
      }
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`   ✓ Stage 1 complete (${elapsed}s)`);
    } else if (stage1Provider === "flux_klein") {
      console.log(`📦 Stage 1 model: ${MODEL_ID_FLUX_KLEIN_STAGE1}`);
      const stage1RequestBody: any = {
        prompt: stage1Prompt,
        input_image: stage1PrimaryImage,
        width: outputWidth,
        height: outputHeight,
        safety_tolerance: 0,
      };
      console.log(`📦 Stage 1 request keys (Flux Klein): ${Object.keys(stage1RequestBody).join(", ")}`);

      const stage1SubmitResponse = await fetch(BFL_FLUX_KLEIN_STAGE1_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-key": BFL_API_KEY!,
        },
        body: JSON.stringify(stage1RequestBody),
      });

      if (!stage1SubmitResponse.ok) {
        const errorText = await stage1SubmitResponse.text();
        console.error(`[FLUX KLEIN STAGE 1] Submission error: ${stage1SubmitResponse.status} - ${errorText}`);
        return null;
      }

      const stage1SubmitData = await stage1SubmitResponse.json();
      console.log(`🎫 Stage 1 submission ID: ${stage1SubmitData.id}`);

      const stage1PollingUrl = stage1SubmitData.polling_url;
      if (!stage1PollingUrl) {
        console.error("[FLUX KLEIN STAGE 1] No polling URL returned");
        return null;
      }

      attempts = 0;
      lastLogTime = 0;
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pollResponse = await fetch(stage1PollingUrl, {
          headers: { "x-key": BFL_API_KEY! },
        });

        if (!pollResponse.ok) {
          attempts++;
          continue;
        }

        const result = await pollResponse.json();
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed - lastLogTime >= 10) {
          console.log(`   ⏳ Stage 1 generating... ${elapsed}s (${result.status})`);
          lastLogTime = elapsed;
        }

        if (result.status === "Ready" || result.status === "succeeded") {
          kontextResultUrl = result.result?.sample || null;
          if (kontextResultUrl) {
            console.log(`   ✓ Stage 1 complete (${elapsed}s)`);
            break;
          }
          console.error("   ✗ Stage 1 failed: no image URL");
          return null;
        } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
          console.error(`   ✗ Stage 1 failed: ${result.status}`);
          return null;
        }

        attempts++;
      }

      if (kontextResultUrl) {
        const resizedStage1 = await resizeImageToDimensions(kontextResultUrl, sourceWidth, sourceHeight);
        if (resizedStage1) {
          kontextResultUrl = resizedStage1;
          console.log(`   ✓ Stage 1 resized to user dimensions: ${sourceWidth}x${sourceHeight}`);
        } else {
          console.warn("[FLUX KLEIN STAGE 1] Could not enforce exact user dimensions; using original output");
        }
      }
    } else {
      const kontextRequestBody: any = {
        prompt: stage1Prompt,
        input_image: stage1PrimaryImage,
        width: outputWidth,
        height: outputHeight,
        guidance: GENERATION_CONFIG.KONTEXT_STAGE1_GUIDANCE,
        safety_tolerance: 0,
        prompt_upsampling: false,
      };
      
      console.log(`📦 Stage 1 request keys (Kontext): ${Object.keys(kontextRequestBody).join(", ")}`);

      // Submit Stage 1
      const kontextSubmitResponse = await fetch(BFL_KONTEXT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-key": BFL_API_KEY!,
        },
        body: JSON.stringify(kontextRequestBody),
      });

      if (!kontextSubmitResponse.ok) {
        const errorText = await kontextSubmitResponse.text();
        console.error(`[KONTEXT] Stage 1 submission error: ${kontextSubmitResponse.status} - ${errorText}`);
        return null;
      }

      const kontextSubmitData = await kontextSubmitResponse.json();
      console.log(`🎫 Kontext submission ID: ${kontextSubmitData.id}`);

      const kontextPollingUrl = kontextSubmitData.polling_url;
      if (!kontextPollingUrl) {
        console.error("[KONTEXT] No polling URL returned");
        return null;
      }

      attempts = 0;
      lastLogTime = 0;
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pollResponse = await fetch(kontextPollingUrl, {
          headers: { "x-key": BFL_API_KEY! },
        });

        if (!pollResponse.ok) {
          attempts++;
          continue;
        }

        const result = await pollResponse.json();
        
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed - lastLogTime >= 10) {
          console.log(`   ⏳ Stage 1 generating... ${elapsed}s (${result.status})`);
          lastLogTime = elapsed;
        }

        if (result.status === "Ready" || result.status === "succeeded") {
          kontextResultUrl = result.result?.sample || null;
          if (kontextResultUrl) {
            console.log(`   ✓ Stage 1 complete (${elapsed}s)`);
            break;
          }
          console.error("   ✗ Stage 1 failed: no image URL");
          return null;
        } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
          console.error(`   ✗ Stage 1 failed: ${result.status}`);
          return null;
        }

        attempts++;
      }
    }

    if (!kontextResultUrl) {
      console.error(`[STAGE 1] ${stage1ProviderLabel} timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
      generationMetrics.timeouts++;
      return null;
    }

    // Save Stage 1 result for debugging
    const fsDebug = await import("fs/promises");
    try {
      const kontextImageResponse = await fetch(kontextResultUrl);
      const kontextImageBuffer = Buffer.from(await kontextImageResponse.arrayBuffer());
      await fsDebug.writeFile("/tmp/debug_kontext_stage1_result.jpg", kontextImageBuffer);
      if (debugIndex) {
        await fsDebug.writeFile(`/tmp/debug_kontext_stage1_result_${debugIndex}.jpg`, kontextImageBuffer);
      }
      console.log(`✓ Saved Stage 1 result to /tmp/debug_kontext_stage1_result.jpg`);
    } catch (e) {
      console.warn("Could not save Stage 1 debug image:", e);
    }
    
    // DEBUG: If KONTEXT_STAGE1_ONLY is enabled, stop here and return Kontext result
    if (GENERATION_CONFIG.KONTEXT_STAGE1_ONLY) {
      console.log(`\n🧪 KONTEXT_STAGE1_ONLY mode - returning Stage 1 result directly (skipping FLUX 2 Pro)`);
      console.log(`✅ Stage 1 complete. Returning Kontext result.`);
      return kontextResultUrl;
    }
    
    // Continue with FLUX 2 Pro using hair+face mask (eyes grayed) - only when KONTEXT_STAGE1_ONLY is false
    if (false) { // Disabled - this was the old KONTEXT_STAGE1_ONLY behavior
      console.log(`\n🧪 Running FLUX 2 Pro with hair+face mask`);
      
      // Convert Kontext result to base64 for masking
      console.log(`🔄 Converting Stage 1 result to base64...`);
      const kontextBase64ForMask = await fetchImageAsBase64(kontextResultUrl);
      if (!kontextBase64ForMask) {
        console.error("[KONTEXT] Failed to fetch Stage 1 result as base64");
        return kontextResultUrl;
      }
      console.log(`   ✓ Stage 1 result converted: ${kontextBase64ForMask.length} chars`);
      
      // Create hair-only mask from Kontext result (only hair visible, face grayed out)
      console.log(`🎭 Creating hair-only mask from Stage 1 result (face grayed out)...`);
      const stage1HairOnlyMask = await createHairOnlyImage(kontextBase64ForMask, 0);
      if (!stage1HairOnlyMask) {
        console.error("[KONTEXT] Failed to create hair-only mask from Stage 1");
        return kontextResultUrl;
      }
      console.log(`   ✓ Hair-only mask created: ${stage1HairOnlyMask.length} chars`);
      
      // Save hair-only mask for debugging
      try {
        const hairOnlyMaskBuffer = Buffer.from(
          stage1HairOnlyMask.replace(/^data:image\/\w+;base64,/, ''),
          'base64'
        );
        await fsDebug.writeFile("/tmp/debug_kontext_stage1_hair_face_mask.png", hairOnlyMaskBuffer);
        if (debugIndex) {
          await fsDebug.writeFile(`/tmp/debug_kontext_stage1_hair_face_mask_${debugIndex}.png`, hairOnlyMaskBuffer);
        }
        console.log(`✓ Saved Stage 1 hair-only mask to /tmp/debug_kontext_stage1_hair_face_mask.png`);
      } catch (e) {
        console.warn("Could not save hair-only mask debug image:", e);
      }
      
      // ============================================
      // FLUX 2 Pro: 2 images (full user photo + hair mask)
      // ============================================
      console.log(`\n━━━ FLUX 2 Pro: Two-Image Pipeline ━━━`);
      const stage2Prompt = normalizeKontextStage2PromptForHairColorMask(
        GENERATION_CONFIG.KONTEXT_STAGE2_PROMPT.replace('{ethnicity}', getRegionBasedEthnicity(userRace))
      );
      console.log(`📝 Prompt: ${stage2Prompt}`);
      
      const fluxRequestBody: any = {
        prompt: stage2Prompt,
        input_image: normalizedPhotoUrl,        // Image 1: Full user photo
        input_image_2: stage1HairOnlyMask,      // Image 2: Hair-only mask from Stage 1
        width: outputWidth,
        height: outputHeight,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      };
      
      console.log(`📦 FLUX request: full user photo (img1) + hair mask (img2)`);
      
      const fluxSubmitResponse = await fetch(BFL_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-key": BFL_API_KEY!,
        },
        body: JSON.stringify(fluxRequestBody),
      });

      let fluxResultUrl: string | null = null;
      if (fluxSubmitResponse.ok) {
        const fluxSubmitData = await fluxSubmitResponse.json();
        console.log(`🎫 FLUX submission ID: ${fluxSubmitData.id}`);
        
        const fluxPollingUrl = fluxSubmitData.polling_url;
        if (fluxPollingUrl) {
          let fluxAttempts = 0;
          const fluxStartTime = Date.now();
          while (fluxAttempts < 120) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const pollResponse = await fetch(fluxPollingUrl, {
              headers: { "x-key": BFL_API_KEY! },
            });
            if (pollResponse.ok) {
              const result = await pollResponse.json();
              if (result.status === "Ready" || result.status === "succeeded") {
                fluxResultUrl = result.result?.sample || null;
                const elapsed = Math.floor((Date.now() - fluxStartTime) / 1000);
                console.log(`   ✓ FLUX complete (${elapsed}s)`);
                break;
              } else if (result.status === "Error" || result.status === "Failed") {
                console.error(`   ✗ FLUX failed: ${result.status}`);
                break;
              }
            }
            fluxAttempts++;
          }
        }
      } else {
        console.error(`   ✗ FLUX submit failed: ${fluxSubmitResponse.status}`);
      }
      
      // Save FLUX result
      if (fluxResultUrl) {
        try {
          const fluxImageResponse = await fetch(fluxResultUrl);
          const fluxImageBuffer = Buffer.from(await fluxImageResponse.arrayBuffer());
          await fsDebug.writeFile("/tmp/debug_flux_stage2_result.jpg", fluxImageBuffer);
          console.log(`✓ Saved FLUX result to /tmp/debug_flux_stage2_result.jpg`);
        } catch (e) {
          console.warn("Could not save FLUX debug image:", e);
        }
      }
      
      console.log(`\n✅ Generation complete. View results at /api/debug/overview`);
      console.log(`   - Stage 1 (Kontext): /api/debug/kontext-stage1-result`);
      console.log(`   - Hair-only mask: /api/debug/kontext-stage1-hair-face-mask`);
      console.log(`   - FLUX 2 Pro result: /api/debug/flux-stage2-result`);
      console.log(`============================================================\n`);
      
      // Apply watermark to final result
      const finalUrl = fluxResultUrl || kontextResultUrl;
      if (finalUrl) {
        const watermarked = await addWatermark(finalUrl);
        console.log(`🖼️ Added watermark to generated image`);
        return watermarked;
      }
      return null;
    }
    
    // ============================================
    // STAGE 2: Create hair-only mask from Stage 1 result, then call FLUX 2 Pro
    // ============================================
    console.log(`\n━━━ STAGE 2: Backend Processing (with hair-only mask from Stage 1) ━━━`);
    
    // Convert Stage 1 result URL to base64
    console.log(`🔄 Converting Stage 1 output to base64...`);
    let kontextBase64 = await fetchImageAsBase64(kontextResultUrl);
    if (!kontextBase64) {
      console.error("[STAGE 2] Failed to fetch Stage 1 output as base64");
      return null;
    }
    
    if (stage1Provider === "gpt_image") {
      console.log(`✨ Skipping sharpening for GPT Stage 1 result mask input.`);
    } else {
      // Keep sharpening for Kontext Stage 1 outputs.
      console.log(`✨ Sharpening Stage 1 output for mask accuracy...`);
      try {
        const kontextBuffer = Buffer.from(
          kontextBase64.replace(/^data:image\/\w+;base64,/, ''),
          'base64'
        );
        const sharpenedBuffer = await sharp(kontextBuffer)
          .sharpen({ sigma: 1.0, m1: 1.0, m2: 2.0 })
          .jpeg({ quality: 95 })
          .toBuffer();
        kontextBase64 = `data:image/jpeg;base64,${sharpenedBuffer.toString('base64')}`;
        console.log(`   ✓ Stage 1 result sharpened: ${kontextBase64.length} chars`);
      } catch (e) {
        console.log(`   ⚠ Sharpening failed, using original: ${(e as Error).message}`);
      }
    }
    
    const stage2Backend = resolveKontextStage2Backend(GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND);
    const includeFaceInStage1ResultMask = false;
    let kontextHairMask = "";
    const providedKleinMask = options?.kontextReferenceImageForKleinMask;
    if (stage2Backend === "flux_klein" && providedKleinMask) {
      kontextHairMask = providedKleinMask;
      console.log("🎭 Using provided reference mask for Klein Stage 2 input.");
    } else {
      console.log(
        `🎭 Creating Stage 1 result mask (pipeline: kontext_result_mask_test, includeFace=${includeFaceInStage1ResultMask}, grayOutEarrings=true)...`
      );
      const generatedKontextHairMask = await createKontextResultMaskTest(
        kontextBase64,
        0,
        includeFaceInStage1ResultMask,
        true
      );
      if (!generatedKontextHairMask) {
        console.error("[STAGE 2] Failed to create Stage 1 result mask");
        return null;
      }
      kontextHairMask = generatedKontextHairMask;
    }
    console.log(`   ✓ Stage 1 result mask prepared: ${kontextHairMask.length} chars`);

    // Save hair-only mask for debugging
    try {
      const hairMaskBuffer = Buffer.from(
        kontextHairMask.replace(/^data:image\/\w+;base64,/, ''),
        'base64'
      );
      await fsDebug.writeFile("/tmp/debug_kontext_stage1_hair_face_mask.png", hairMaskBuffer);
      if (debugIndex) {
        await fsDebug.writeFile(`/tmp/debug_kontext_stage1_hair_face_mask_${debugIndex}.png`, hairMaskBuffer);
      }
      console.log(`✓ Saved Stage 1 hair-only mask to /tmp/debug_kontext_stage1_hair_face_mask.png`);
    } catch (e) {
      console.warn("Could not save hair-only mask debug image:", e);
    }
    
    const { template: stage2PromptTemplate } = getKontextStage2PromptTemplateForBackend(stage2Backend);
    const normalizedStage2Template = stage2PromptTemplate
      .replace("{ethnicity}", getRegionBasedEthnicity(userRace))
      .replace("{hairstyle name}", hairstylePrompt)
      .replace("{hairstyle}", hairstylePrompt);
    const stage2Prompt = buildKontextStage2PromptForBackend(
      normalizedStage2Template,
      stage2Backend
    );
    const stage2FillPrompt = buildGenerationPrompt(
      GENERATION_CONFIG.KONTEXT_FILL_PROMPT,
      hairstylePrompt,
      userRace,
      userGender
    );

    console.log(`📝 Stage 2 Prompt: ${stage2Prompt}`);



    // Save debug files for debug overview page
    try {
      // Save user mask
      const userMaskBuffer = Buffer.from(
        maskedUserPhoto.replace(/^data:image\/\w+;base64,/, ''),
        'base64'
      );
      await fsDebug.writeFile("/tmp/debug_user_mask.jpg", userMaskBuffer);
      
      // Save full user photo
      const userImageBuffer = Buffer.from(
        normalizedPhotoUrl.replace(/^data:image\/\w+;base64,/, ''),
        'base64'
      );
      await fsDebug.writeFile("/tmp/debug_user_image.jpg", userImageBuffer);
      
      console.log(`✓ Saved debug files: user_mask.jpg, user_image.jpg`);
    } catch (e) {
      console.warn("Could not save debug files:", e);
    }

    console.log(`🧭 Stage 2 backend: ${stage2Backend}`);

    if (stage2Backend === "fal_redux_fill") {
      const falReduxFillStage2Result = await runFalReduxFillStage2(
        stage2FillPrompt,
        normalizedPhotoUrl,
        kontextHairMask,
        sourceWidth,
        sourceHeight
      );
      if (!falReduxFillStage2Result) {
        console.error("[FAL REDUX+FILL] Failed to produce Stage 2 result");
        return null;
      }

      try {
        await saveDebugImageFromAnySource("/tmp/debug_flux_stage2_result.jpg", falReduxFillStage2Result);
        await saveDebugImageFromAnySource("/tmp/debug_flux_fill_stage2_result.jpg", falReduxFillStage2Result);
        console.log("✓ Saved Stage 2 fal.ai redux+fill result to /tmp/debug_flux_stage2_result.jpg");
      } catch (error) {
        console.warn("Could not save Stage 2 fal.ai redux+fill debug image:", error);
      }

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ REFINED PIPELINE COMPLETE (fal_redux_fill) - Total time: ${totalTime}s`);
      console.log("🖼️ Returning fal.ai Redux+Fill Stage 2 output");
      return falReduxFillStage2Result;
    }

    if (stage2Backend === "flux_fill") {
      const fluxFillStage2Result = await runFluxFillStage2(
        stage2FillPrompt,
        normalizedPhotoUrl
      );
      if (!fluxFillStage2Result) {
        console.error("[FLUX FILL] Failed to produce Stage 2 result");
        return null;
      }

      try {
        await saveDebugImageFromAnySource("/tmp/debug_flux_stage2_result.jpg", fluxFillStage2Result);
        await saveDebugImageFromAnySource("/tmp/debug_flux_fill_stage2_result.jpg", fluxFillStage2Result);
        console.log("✓ Saved Stage 2 FLUX fill result to /tmp/debug_flux_stage2_result.jpg");
      } catch (error) {
        console.warn("Could not save Stage 2 FLUX fill debug image:", error);
      }

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ REFINED PIPELINE COMPLETE (flux_fill) - Total time: ${totalTime}s`);
      console.log("🖼️ Returning FLUX Fill Stage 2 output");
      return fluxFillStage2Result;
    }

    if (stage2Backend === "gpt_fill") {
      const gptFillStage2Result = await runGptFillStage2(
        stage2FillPrompt,
        normalizedPhotoUrl,
        kontextHairMask,
        sourceWidth,
        sourceHeight
      );
      if (!gptFillStage2Result) {
        console.error("[GPT FILL] Failed to produce Stage 2 result");
        return null;
      }

      try {
        await saveBase64DebugImage("/tmp/debug_flux_stage2_result.jpg", gptFillStage2Result);
        console.log("✓ Saved Stage 2 GPT fill result to /tmp/debug_flux_stage2_result.jpg");
      } catch (error) {
        console.warn("Could not save Stage 2 GPT fill debug image:", error);
      }

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ REFINED PIPELINE COMPLETE (gpt_fill) - Total time: ${totalTime}s`);
      console.log("🖼️ Returning GPT Fill Stage 2 output");
      return gptFillStage2Result;
    }

    if (stage2Backend === "blend_inpaint") {
      const blendedStage2Result = await runKontextStage2BlendBackend(
        normalizedPhotoUrl,
        kontextBase64,
        kontextHairMask,
        "kontext"
      );
      if (!blendedStage2Result) {
        console.error("[STAGE2 BLEND] Failed to produce final blended result");
        return null;
      }

      try {
        await saveBase64DebugImage("/tmp/debug_flux_stage2_result.jpg", blendedStage2Result);
        console.log("✓ Saved Stage 2 blend result to /tmp/debug_flux_stage2_result.jpg");
      } catch (error) {
        console.warn("Could not save Stage 2 blend debug image:", error);
      }

      await fsPromises.unlink("/tmp/debug_flux_fill_stage2_result.jpg").catch(() => {});
      const comparisonStart = Date.now();
      const fluxFillComparison = await runFluxFillComparisonForDebug(
        stage2FillPrompt,
        normalizedPhotoUrl
      );
      const comparisonMs = Date.now() - comparisonStart;
      if (fluxFillComparison) {
        try {
          await saveDebugImageFromAnySource("/tmp/debug_flux_fill_stage2_result.jpg", fluxFillComparison);
          console.log(`[STAGE2 COMPARE] Saved FLUX comparison result to /tmp/debug_flux_fill_stage2_result.jpg (${comparisonMs}ms)`);
        } catch (error) {
          console.warn("[STAGE2 COMPARE] Failed to save FLUX comparison debug image:", error);
        }
      } else {
        console.warn(`[STAGE2 COMPARE] No FLUX comparison result generated (${comparisonMs}ms)`);
      }

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ REFINED PIPELINE COMPLETE (blend_inpaint) - Total time: ${totalTime}s`);
      console.log("🖼️ Returning native blended Stage 2 output");
      return blendedStage2Result;
    }

    let stage2UserHairMaskGray: string | null = null;
    if (stage2Backend !== "flux_klein") {
      console.log(`🎭 Creating Stage 2 user hair color mask (hair color preserved, gray background)...`);
      stage2UserHairMaskGray = await createHairOnlyImage(normalizedPhotoUrl, 10);
      if (!stage2UserHairMaskGray) {
        console.error("[FLUX STAGE 2] Failed to create user hair mask");
        return null;
      }
      try {
        await saveBase64DebugImage("/tmp/debug_stage2_user_hair_color_mask.jpg", stage2UserHairMaskGray);
        if (debugIndex) {
          await saveBase64DebugImage(`/tmp/debug_stage2_user_hair_color_mask_${debugIndex}.jpg`, stage2UserHairMaskGray);
        }
      } catch (error) {
        console.warn("Could not save Stage 2 user hair color mask debug image:", error);
      }
    } else {
      console.log(`🎭 Using Flux Klein Stage 2 contract (no user hair color mask input).`);
    }

    console.log(`🎭 Creating Stage 2 face+neck mask (image 2, user_mask includeHair=false)...`);
    let stage2FaceNeckMask = await buildStage2FaceNeckMaskFromHairPipeline(normalizedPhotoUrl);
    if (!stage2FaceNeckMask) {
      console.warn("[FLUX STAGE 2] Failed to create face+neck mask with user_mask(includeHair=false); retrying direct call");
      stage2FaceNeckMask = await createUserMaskedImage(
        normalizedPhotoUrl,
        0,
        false,
        0,
        true,
        true,
        false
      );
    }
    if (!stage2FaceNeckMask) {
      console.error("[FLUX STAGE 2] Failed to create Stage 2 face+neck mask");
      return null;
    }
    try {
      await saveBase64DebugImage("/tmp/debug_stage2_user_face_neck_mask.jpg", stage2FaceNeckMask);
      if (debugIndex) {
        await saveBase64DebugImage(`/tmp/debug_stage2_user_face_neck_mask_${debugIndex}.jpg`, stage2FaceNeckMask);
      }
    } catch (error) {
      console.warn("Could not save Stage 2 face+neck mask debug image:", error);
    }

    let stage2RequestBody: any;
    if (stage2Backend === "flux_klein") {
      // Flux Klein contract:
      // image 1 = full user photo (base/background source)
      // image 1 = full user photo (base/background source)
      // image 2 = user face+neck mask (identity lock)
      // image 3 = provided reference hair mask (or GPT/Kontext Stage 1 result mask fallback)
      stage2RequestBody = {
        prompt: stage2Prompt,
        input_image: normalizedPhotoUrl,
        input_image_2: stage2FaceNeckMask,
        input_image_3: kontextHairMask,
        width: outputWidth,
        height: outputHeight,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      };
    } else {
      // Flux 2 Pro contract:
      // image 1 = full user photo (base/background source)
      // image 2 = user face+neck mask (identity lock, no hair)
      // image 3 = user hair color mask (editable hair region)
      // image 4 = GPT/Kontext Stage 1 hair-only mask (hair source)
      stage2RequestBody = {
        prompt: stage2Prompt,
        input_image: normalizedPhotoUrl,
        input_image_2: stage2FaceNeckMask,
        input_image_3: stage2UserHairMaskGray,
        input_image_4: kontextHairMask,
        width: outputWidth,
        height: outputHeight,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      };
    }
    const stage2ApiUrl = getKontextStage2BflApiUrl(stage2Backend);
    console.log(`🛰️ Stage 2 endpoint: ${stage2ApiUrl}`);

    console.log(`📦 Stage 2 request keys: ${Object.keys(stage2RequestBody).join(", ")}`);
    console.log(`  📤 input_image (full user photo): ${normalizedPhotoUrl.length} chars`);
    console.log(`  📤 input_image_2 (user face+neck mask): ${stage2FaceNeckMask.length} chars`);
    if (stage2Backend === "flux_klein") {
      const kleinMaskSource = providedKleinMask ? "reference hair mask (20px buffer)" : "stage1 result mask";
      console.log(`  📤 input_image_3 (${kleinMaskSource}): ${kontextHairMask.length} chars`);
    } else {
      console.log(`  📤 input_image_3 (user hair color mask): ${stage2UserHairMaskGray!.length} chars`);
      console.log(`  📤 input_image_4 (stage1 hair-only mask): ${kontextHairMask.length} chars`);
    }
    
    // Submit Stage 2
    const stage2SubmitResponse = await fetch(stage2ApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify(stage2RequestBody),
    });

    if (!stage2SubmitResponse.ok) {
      const errorText = await stage2SubmitResponse.text();
      console.error(`[FLUX STAGE 2] Submission error: ${stage2SubmitResponse.status} - ${errorText}`);
      return null;
    }

    const stage2SubmitData = await stage2SubmitResponse.json();
    console.log(`🎫 Stage 2 submission ID: ${stage2SubmitData.id}`);

    const stage2PollingUrl = stage2SubmitData.polling_url;
    if (!stage2PollingUrl) {
      console.error("[FLUX STAGE 2] No polling URL returned");
      return null;
    }

    // Poll Stage 2
    attempts = 0;
    const stage2StartTime = Date.now();
    lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(stage2PollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      
      const elapsed = Math.floor((Date.now() - stage2StartTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        console.log(`   ⏳ Stage 2 generating... ${elapsed}s (${result.status})`);
        lastLogTime = elapsed;
      }

      if (result.status === "Ready" || result.status === "succeeded") {
        const finalImageUrl = result.result?.sample || null;
        if (finalImageUrl) {
          const totalTime = Math.floor((Date.now() - startTime) / 1000);
          console.log(`   ✓ Stage 2 complete (${elapsed}s)`);
          console.log(`\n✅ REFINED PIPELINE COMPLETE - Total time: ${totalTime}s`);
          console.log(`============================================================\n`);
          
          // Save FLUX Stage 2 result for debug page
          try {
            const stage2Response = await fetch(finalImageUrl);
            if (stage2Response.ok) {
              const stage2Buffer = Buffer.from(await stage2Response.arrayBuffer());
              await fsPromises.writeFile("/tmp/debug_flux_stage2_result.jpg", stage2Buffer);
              if (debugIndex) {
                await fsPromises.writeFile(`/tmp/debug_flux_stage2_result_${debugIndex}.jpg`, stage2Buffer);
              }
              console.log(`✓ Saved Stage 2 result to /tmp/debug_flux_stage2_result.jpg`);
            }
          } catch (e) {
            console.log(`⚠ Failed to save Stage 2 result for debug:`, e);
          }
          
          // Keep native FLUX quality: return raw Stage 2 output with no post-processing.
          // No resize and no watermark to avoid any re-encoding quality loss.
          console.log("🖼️ Returning native FLUX Stage 2 output (no resize, no watermark)");
          return finalImageUrl;
        }
        console.error("   ✗ Stage 2 failed: no image URL");
        return null;
      } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error(`   ✗ Stage 2 failed: ${result.status}`);
        return null;
      }

      attempts++;
    }

    console.error(`[FLUX STAGE 2] Timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
    generationMetrics.timeouts++;
    return null;
  } catch (error) {
    console.error("[KONTEXT REFINED] Error:", error);
    if (error instanceof Error) {
      console.error("[KONTEXT REFINED] Details:", error.message);
    }
    return null;
  }
}

type StyleType = "hairstyle";

// Generate hairstyle using FLUX 2 Pro with Replicate's visual mask
// NEW APPROACH: Send Replicate's raw RGB output (white=hair) to FLUX 2 Pro
// and prompt it to only modify the white/masked region
async function generateWithFluxFillMask(
  userPhotoUrl: string,
  hairstylePrompt: string,
  referenceImages: string[] = [],
  sessionId?: string,  // Optional session ID to cache/retrieve Replicate mask
  debugIndex?: number  // Optional index for saving debug images (1, 2, 3)
): Promise<string | null> {
  // Clear previous debug log for fresh run
  try { fs.writeFileSync(DEBUG_LOG_FILE, ""); } catch {}
  
  try {
    if (!BFL_API_KEY) {
      debugLog("ERROR: BFL_API_KEY not configured");
      return null;
    }

    debugLog("=== FLUX 2 Pro with Visual Mask (Replicate RGB) ===");
    debugLog("User photo URL (truncated)", userPhotoUrl.substring(0, 80));
    debugLog("Prompt", hairstylePrompt);
    debugLog("Reference images count", referenceImages.length);
    debugLog("Session ID for caching", sessionId || "none");

    // Step 1: Convert user photo to base64
    let userImageBase64 = userPhotoUrl;
    if (!userPhotoUrl.startsWith("data:")) {
      debugLog("Converting user photo URL to base64...");
      const converted = await fetchImageAsBase64(userPhotoUrl);
      if (!converted) {
        debugLog("ERROR: Failed to convert user photo to base64");
        return null;
      }
      userImageBase64 = converted;
      debugLog("✓ User photo converted to base64", { length: converted.length });
    }
    
    // Save user photo for debug page
    const fsDebugUser = await import("fs/promises");
    const userBuffer = Buffer.from(
      userImageBase64.replace(/^data:image\/\w+;base64,/, ''),
      'base64'
    );
    await fsDebugUser.writeFile("/tmp/debug_user_image.jpg", userBuffer);
    debugLog("✓ Saved user photo to /tmp/debug_user_image.jpg");
    
    // Step 2: Process reference image (user photo stays UNTOUCHED)
    debugLog("Step 2: Processing reference image (user photo stays ORIGINAL)...");
    
    const { createHairOnlyImage, createUserMaskedImage } = await import("./imageProcessing");
    
    // Strip data URI prefix helper
    const stripDataUri = (dataUri: string): string => {
      if (dataUri.startsWith("data:")) {
        const base64Match = dataUri.match(/base64,(.+)/);
        return base64Match ? base64Match[1] : dataUri;
      }
      return dataUri;
    };
    
    // Process user mask and reference mask (4-image pipeline)
    const startTime = Date.now();
    let userMasked: string | null = null;
    let referenceHairOnly: string | null = null;  // Image 3: hair only with 30px buffer
    
    // Create user mask (everything visible except hair - shows FLUX where to apply new hair)
    userMasked = await createUserMaskedImage(userImageBase64);
    debugLog(userMasked ? "✓ Created user mask (hair region grayed)" : "⚠ User mask creation failed");
    
    // Create hair-only reference mask (just the hairstyle with 30px buffer)
    if (referenceImages.length > 0) {
      referenceHairOnly = await createHairOnlyImage(referenceImages[0], 30);
      debugLog(referenceHairOnly ? "✓ Created hair-only reference (image 3)" : "⚠ Hair-only mask creation failed");
    }
    
    debugLog(`✓ Image processing completed in ${Date.now() - startTime}ms`);
    
    // Save debug images
    const fsDebug = await import("fs/promises");
    if (userMasked) {
      const userMaskBuffer = Buffer.from(
        userMasked.replace(/^data:image\/\w+;base64,/, ''),
        'base64'
      );
      await fsDebug.writeFile("/tmp/debug_user_mask.jpg", userMaskBuffer);
      debugLog("✓ Saved user mask to /tmp/debug_user_mask.jpg");
    }
    if (referenceHairOnly) {
      const refBuffer = Buffer.from(
        referenceHairOnly.replace(/^data:image\/\w+;base64,/, ''),
        'base64'
      );
      const debugFilename = debugIndex 
        ? `/tmp/debug_reference_hair_only_${debugIndex}.jpg`
        : "/tmp/debug_reference_hair_only.jpg";
      await fsDebug.writeFile(debugFilename, refBuffer);
      debugLog(`✓ Saved hair-only reference (image 3) to ${debugFilename}`);
    }
    // Step 3: Build the prompt for FLUX 2 Pro
    // 3-IMAGE PIPELINE:
    // input_image = user mask (image 1 - face to preserve with hair grayed)
    // input_image_2 = full user photo (image 2 - complete reference)
    // input_image_3 = hair-only reference (image 3 - hairstyle with facial features blotted)
    // Use dynamic prompt with hairstyle description (hairstylePrompt param) and generic race/gender
    const fluxPrompt = buildGenerationPrompt(
      GENERATION_CONFIG.TEXT_MODE_FRONT_PROMPT_TEMPLATE,
      hairstylePrompt,
      "person",
      ""
    );

    debugLog("Step 3: Calling FLUX 2 Pro API...");
    debugLog("Prompt", fluxPrompt);
    
    // Normalize image orientation (physically rotate pixels based on EXIF)
    // This ensures FLUX sees correctly oriented pixels, not raw EXIF-rotated data
    const normalizedUserImage = await normalizeImageOrientation(userImageBase64);
    
    // Extract dimensions from normalized photo to preserve aspect ratio
    let outputWidth = 1024;
    let outputHeight = 1024;
    const inputDims = await getImageDimensions(normalizedUserImage);
    if (inputDims) {
      const fluxDims = calculateFluxDimensions(inputDims.width, inputDims.height);
      outputWidth = fluxDims.width;
      outputHeight = fluxDims.height;
      debugLog("Output dimensions (aspect ratio preserved)", `${outputWidth}×${outputHeight}`);
    }
    
    // Send normalized user photo with correct orientation
    const userInputImage = stripDataUri(normalizedUserImage);
    debugLog("User image (normalized orientation)", { length: userInputImage.length });

    // Build request body for FLUX 2 Pro with 3 images
    // Note: FLUX.2 Pro API only supports: prompt, input_image*, seed, width, height, safety_tolerance, output_format
    // Order: Image 1 = user mask, Image 2 = full user photo, Image 3 = hair-only ref
    const requestBody: any = {
      prompt: fluxPrompt,
      input_image: userMasked ? stripDataUri(userMasked) : userInputImage,  // Image 1: User mask (face visible, hair grayed)
      width: outputWidth,
      height: outputHeight,
      safety_tolerance: GENERATION_CONFIG.TEXT_MODE_SAFETY_TOLERANCE,
    };

    // Add full user photo as input_image_2 (complete reference)
    requestBody.input_image_2 = userInputImage;
    debugLog("✓ Added full user photo as input_image_2");

    // Add hair-only reference as input_image_3 (hairstyle with facial features blotted)
    if (referenceImages.length > 0 && referenceHairOnly) {
      requestBody.input_image_3 = stripDataUri(referenceHairOnly);
      debugLog("✓ Added hair-only reference as input_image_3");
    } else if (referenceImages.length > 0) {
      // Fall back to raw reference if hair extraction failed
      requestBody.input_image_3 = stripDataUri(referenceImages[0]);
      debugLog("⚠ Hair extraction failed, using raw reference as input_image_3");
    }

    debugLog("FLUX 2 Pro API URL", BFL_API_URL);
    debugLog("Request body keys", Object.keys(requestBody));
    
    // PROOF LOG: Exactly what we're sending to FLUX 2 Pro
    console.log("========================================");
    console.log("FLUX 2 PRO REQUEST (3-image pipeline):");
    console.log("- Prompt:", fluxPrompt);
    console.log("- Dimensions:", `${outputWidth}×${outputHeight}`);
    console.log("- Guidance:", requestBody.guidance);
    console.log("- input_image (1):", userMasked ? "user mask (face+ears visible)" : "ORIGINAL user photo");
    console.log("- input_image_2 (2): full user photo, length:", userInputImage.length);
    console.log("- input_image_3 (3):", referenceHairOnly ? "hair-only reference" : "raw reference (fallback)");
    console.log("- safety_tolerance:", requestBody.safety_tolerance);
    console.log("========================================");

    const submitResponse = await fetch(BFL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify(requestBody),
    });

    debugLog("Submit response status", submitResponse.status);
    
    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      debugLog("FLUX 2 Pro submission ERROR", { status: submitResponse.status, error: errorText });
      return null;
    }

    const submitData = await submitResponse.json();
    debugLog("FLUX 2 Pro submission response", submitData);

    const pollingUrl = submitData.polling_url;
    if (!pollingUrl) {
      debugLog("ERROR: No polling URL returned from FLUX 2 Pro", submitData);
      return null;
    }
    debugLog("Polling URL", pollingUrl);

    // Poll for result (max 300 seconds)
    const maxAttempts = 300;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(pollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      
      if (attempts % 5 === 0) {
        debugLog(`Polling attempt ${attempts}`, { status: result.status });
      }

      if (result.status === "Ready" || result.status === "succeeded") {
        debugLog("FLUX 2 Pro COMPLETED - Full response", result);
        const imageUrl = result.result?.sample || result.sample || null;
        if (imageUrl) {
          debugLog("✓ SUCCESS - Image URL obtained", { url: imageUrl.substring(0, 100) });
          return imageUrl;
        }
        debugLog("ERROR: Success status but no image URL", { keys: Object.keys(result), result });
        return null;
      } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        debugLog("FLUX 2 Pro FAILED", result);
        return null;
      }

      attempts++;
    }

    debugLog("ERROR: Polling timeout after 300s");
    return null;
  } catch (error) {
    debugLog("=== FLUX Fill CRITICAL ERROR ===", {
      type: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : "No stack"
    });
    return null;
  }
}

// Generate a single image using BFL FLUX 2 Pro
async function generateSingleBflImage(
  userPhotoUrl: string,
  inspirationPhotoUrl: string,
  prompt: string
): Promise<string | null> {
  try {
    const safety_tolerance = GENERATION_CONFIG.INSPIRATION_SAFETY_TOLERANCE;
    
    console.log(`BFL FLUX 2 Pro request...`);
    console.log(`Prompt: ${prompt}`);
    console.log(`Parameters: safety_tolerance=${safety_tolerance}`);

    const submitResponse = await fetch(BFL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify({
        prompt: prompt,
        input_image: userPhotoUrl,
        input_image_2: inspirationPhotoUrl,
        safety_tolerance,
      }),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(`BFL submission error: ${submitResponse.status} - ${errorText}`);
      return null;
    }

    const submitData = await submitResponse.json();
    console.log(`BFL submission:`, submitData.id);

    const pollingUrl = submitData.polling_url;
    if (!pollingUrl) {
      console.error("No polling URL returned from BFL");
      return null;
    }

    // Poll for result (65 second timeout - prompts user to retry if exceeded)
    const maxAttempts = GENERATION_TIMEOUT_SECONDS;
    let attempts = 0;
    const startTime = Date.now();
    let lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(pollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      
      // Log status every 10 seconds
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        console.log(`   ⏳ Generating... ${elapsed}s (${result.status})`);
        lastLogTime = elapsed;
      }

      // BFL API returns "Ready" or "succeeded" when complete
      if (result.status === "Ready" || result.status === "succeeded") {
        const imageUrl = result.result?.sample || null;
        if (imageUrl) {
          console.log(`   ✓ Generation complete (${elapsed}s)`);
          return imageUrl;
        }
        console.error("   ✗ Generation failed: no image URL");
        return null;
      } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error(`   ✗ Generation failed: ${result.status}`);
        return null;
      }

      attempts++;
    }

    console.error(`   ✗ BFL text-mode timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
    generationMetrics.timeouts++;
    return null;
  } catch (error) {
    console.error(`Error with BFL:`, error);
    return null;
  }
}

async function generateSingleFluxKleinFromReferenceMask(
  userPhotoBase64: string,
  userFaceMaskBase64: string,
  referenceHairMaskBase64: string,
  debugIndex?: number
): Promise<string | null> {
  try {
    if (!BFL_API_KEY) {
      console.error("[KLEIN SINGLE] BFL_API_KEY is not configured.");
      return null;
    }

    let outputWidth = 1024;
    let outputHeight = 1024;
    const userDims = await getImageDimensions(userPhotoBase64);
    if (userDims) {
      const fluxDims = calculateFluxDimensions(userDims.width, userDims.height);
      outputWidth = fluxDims.width;
      outputHeight = fluxDims.height;
    }

    const requestBody = {
      prompt: KLEIN_SINGLE_STAGE_REFERENCE_PROMPT,
      input_image: userPhotoBase64,
      input_image_2: referenceHairMaskBase64,
      input_image_3: userFaceMaskBase64,
      width: outputWidth,
      height: outputHeight,
      safety_tolerance: GENERATION_CONFIG.TEXT_MODE_SAFETY_TOLERANCE,
    };

    console.log("🛰️ Klein single-stage endpoint:", BFL_FLUX_KLEIN_STAGE2_API_URL);
    console.log("📦 Klein single-stage request keys:", Object.keys(requestBody).join(", "));
    console.log(`  📤 input_image (full user photo): ${userPhotoBase64.length} chars`);
    console.log(`  📤 input_image_2 (reference mannequin hair mask): ${referenceHairMaskBase64.length} chars`);
    console.log(`  📤 input_image_3 (user face mask): ${userFaceMaskBase64.length} chars`);
    console.log(`📝 Klein single-stage prompt: ${KLEIN_SINGLE_STAGE_REFERENCE_PROMPT}`);

    const submitResponse = await fetch(BFL_FLUX_KLEIN_STAGE2_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(`[KLEIN SINGLE] Submission error: ${submitResponse.status} - ${errorText}`);
      return null;
    }

    const submitData = await submitResponse.json();
    console.log(`🎫 Klein single-stage submission ID: ${submitData.id}`);

    const pollingUrl = submitData.polling_url;
    if (!pollingUrl) {
      console.error("[KLEIN SINGLE] No polling URL returned.");
      return null;
    }

    const maxAttempts = GENERATION_TIMEOUT_SECONDS;
    let attempts = 0;
    const startTime = Date.now();
    let lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const pollResponse = await fetch(pollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        console.log(`   ⏳ Klein single-stage generating... ${elapsed}s (${result.status})`);
        lastLogTime = elapsed;
      }

      if (result.status === "Ready" || result.status === "succeeded") {
        const finalImageUrl = result.result?.sample || null;
        if (!finalImageUrl) {
          console.error("[KLEIN SINGLE] Completed without image URL.");
          return null;
        }
        console.log(`   ✓ Klein single-stage complete (${elapsed}s)`);
        try {
          const stage2Response = await fetch(finalImageUrl);
          if (stage2Response.ok) {
            const stage2Buffer = Buffer.from(await stage2Response.arrayBuffer());
            await fsPromises.writeFile("/tmp/debug_flux_stage2_result.jpg", stage2Buffer);
            if (debugIndex) {
              await fsPromises.writeFile(`/tmp/debug_flux_stage2_result_${debugIndex}.jpg`, stage2Buffer);
            }
            console.log("✓ Saved Klein single-stage result to /tmp/debug_flux_stage2_result.jpg");
          }
        } catch (e) {
          console.warn("[KLEIN SINGLE] Could not save debug output:", e);
        }
        return finalImageUrl;
      }

      if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error(`   ✗ Klein single-stage failed: ${result.status}`);
        return null;
      }

      attempts++;
    }

    console.error(`[KLEIN SINGLE] Timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
    return null;
  } catch (error) {
    console.error("[KLEIN SINGLE] Unexpected error:", error);
    return null;
  }
}

async function generateKontextStage1FromReference(
  referenceImage: string,
  prompt: string,
): Promise<string | null> {
  try {
    if (!BFL_API_KEY) {
      console.error("[KONTEXT STAGE 1] BFL_API_KEY is not configured.");
      return null;
    }

    let outputWidth = 1024;
    let outputHeight = 1024;
    const referenceDims = await getImageDimensions(referenceImage);
    if (referenceDims) {
      const fluxDims = calculateFluxDimensions(referenceDims.width, referenceDims.height);
      outputWidth = fluxDims.width;
      outputHeight = fluxDims.height;
    }

    const requestBody = {
      prompt,
      input_image: referenceImage,
      width: outputWidth,
      height: outputHeight,
      guidance: GENERATION_CONFIG.KONTEXT_STAGE1_GUIDANCE,
      safety_tolerance: 0,
      prompt_upsampling: false,
    };

    console.log("🛰️ Kontext Stage 1 endpoint:", BFL_KONTEXT_API_URL);
    console.log("📦 Kontext Stage 1 request keys:", Object.keys(requestBody).join(", "));
    console.log(`  📤 input_image (reference): ${referenceImage.length} chars`);
    console.log(`📝 Kontext Stage 1 prompt: ${prompt}`);

    const submitResponse = await fetch(BFL_KONTEXT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(`[KONTEXT STAGE 1] Submission error: ${submitResponse.status} - ${errorText}`);
      return null;
    }

    const submitData = await submitResponse.json();
    console.log(`🎫 Kontext Stage 1 submission ID: ${submitData.id}`);

    const pollingUrl = submitData.polling_url;
    if (!pollingUrl) {
      console.error("[KONTEXT STAGE 1] No polling URL returned.");
      return null;
    }

    const maxAttempts = GENERATION_TIMEOUT_SECONDS;
    let attempts = 0;
    const startTime = Date.now();
    let lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const pollResponse = await fetch(pollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        console.log(`   ⏳ Kontext Stage 1 generating... ${elapsed}s (${result.status})`);
        lastLogTime = elapsed;
      }

      if (result.status === "Ready" || result.status === "succeeded") {
        const finalImageUrl = result.result?.sample || null;
        if (!finalImageUrl) {
          console.error("[KONTEXT STAGE 1] Completed without image URL.");
          return null;
        }
        console.log(`   ✓ Kontext Stage 1 complete (${elapsed}s)`);
        return finalImageUrl;
      }

      if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error(`   ✗ Kontext Stage 1 failed: ${result.status}`);
        return null;
      }

      attempts++;
    }

    console.error(`[KONTEXT STAGE 1] Timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
    return null;
  } catch (error) {
    console.error("[KONTEXT STAGE 1] Unexpected error:", error);
    return null;
  }
}

// Generate a single image using BFL FLUX 2 Pro with 3 images (user, user mask, inspiration hair-only)
async function generateSingleBflImageWithMasks(
  userPhotoBase64: string,
  userMaskBase64: string,
  inspirationHairOnlyBase64: string,
  prompt: string,
  seed: number
): Promise<string | null> {
  try {
    console.log(`BFL 3-image request with seed ${seed}...`);

    const submitResponse = await fetch(BFL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify({
        prompt: prompt,
        input_image: userPhotoBase64,
        input_image_2: userMaskBase64,
        input_image_3: inspirationHairOnlyBase64,
        seed: seed,
        width: 1024,
        height: 1024,
        safety_tolerance: GENERATION_CONFIG.TEXT_MODE_SAFETY_TOLERANCE,
      }),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(`BFL 3-image submission error (seed ${seed}): ${submitResponse.status} - ${errorText}`);
      return null;
    }

    const submitData = await submitResponse.json();
    console.log(`BFL 3-image submission (seed ${seed}):`, submitData.id);

    const pollingUrl = submitData.polling_url;
    if (!pollingUrl) {
      console.error("No polling URL returned from BFL");
      return null;
    }

    // Poll for result (max 600 seconds / 10 minutes - BFL FLUX 2 Pro is slow but high quality)
    const maxAttempts = GENERATION_TIMEOUT_SECONDS;
    let attempts = 0;
    const pollStartTime = Date.now();
    let lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(pollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      
      // Log status every 10 seconds (time-based)
      const elapsedSeconds = Math.floor((Date.now() - pollStartTime) / 1000);
      if (elapsedSeconds >= lastLogTime + 10) {
        console.log(`   ⏳ 4-image generating... ${elapsedSeconds}s (${result.status})`);
        lastLogTime = elapsedSeconds;
      }

      // BFL API returns "Ready" or "succeeded" when complete
      if (result.status === "Ready" || result.status === "succeeded") {
        const imageUrl = result.result?.sample || null;
        if (imageUrl) {
          console.log(`   ✓ 4-image complete (${elapsedSeconds}s)`);
          return imageUrl;
        }
        console.error("BFL returned success but no image URL:", result);
        return null;
      } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error(`BFL 4-image generation failed (seed ${seed}):`, result);
        return null;
      }

      attempts++;
    }

    console.error(`BFL 4-image polling timeout after ${GENERATION_TIMEOUT_SECONDS}s (seed ${seed})`);
    generationMetrics.timeouts++;
    return null;
  } catch (error) {
    console.error(`Error with BFL 4-image (seed ${seed}):`, error);
    return null;
  }
}

// Generate single image using BFL FLUX 2 Pro with 3-image pipeline (same as text mode)
// Pipeline: masked user (image 1) + masked inspiration hair (image 2) + full user (image 3)
async function generateStyleFromInspirationDual(
  userPhotoUrl: string, 
  inspirationPhotoUrl: string, 
  styleType: StyleType
): Promise<DualImageResult> {
  try {
    console.log("\n============================================================");
    console.log("🎯 INSPIRATION MODE: KONTEXT REFINED PIPELINE (Two-Stage)");
    console.log("============================================================");
    console.log("Style type:", styleType);
    console.log("User photo:", userPhotoUrl.substring(0, 100) + "...");
    console.log("Inspiration photo (reference):", inspirationPhotoUrl.substring(0, 100) + "...");

    if (!BFL_API_KEY) {
      console.error("BFL_API_KEY not configured");
      return { frontImageUrl: null, sideImageUrl: null };
    }
    
    const { createUserMaskedImage } = await import("./imageProcessing");
    const fsDebug = await import("fs/promises");

    // If inspiration photo is a URL (not base64), fetch and convert to base64
    let inspirationBase64 = inspirationPhotoUrl;
    if (!inspirationPhotoUrl.startsWith("data:")) {
      console.log("Fetching inspiration image to convert to base64...");
      const fetched = await fetchImageAsBase64(inspirationPhotoUrl);
      if (fetched) {
        inspirationBase64 = fetched;
        console.log("✓ Successfully converted inspiration image to base64");
      } else {
        console.error("Failed to fetch inspiration image");
        return { frontImageUrl: null, sideImageUrl: null };
      }
    }

    // Normalize user photo orientation
    let normalizedUserPhoto = userPhotoUrl;
    if (userPhotoUrl.startsWith("data:")) {
      normalizedUserPhoto = await normalizeImageOrientation(userPhotoUrl);
    }
    
    // Check cache for user analysis
    const maskCacheKey = generateCacheKey(normalizedUserPhoto);
    const cachedPreprocess = await preprocessCache.get(maskCacheKey);
    console.log(`Cache key lookup: ${maskCacheKey.substring(0, 60)}...`);
    
    let userRace = "person";
    let userGender = "";
    let maskedUserPhoto: string | null = null;
    
    if (cachedPreprocess?.maskedUserPhoto && cachedPreprocess?.visionResult) {
      console.log("✓ Using cached preprocessing results");
      maskedUserPhoto = cachedPreprocess.maskedUserPhoto;
      userRace = cachedPreprocess.visionResult.raceEthnicity || "person";
      userGender = cachedPreprocess.visionResult.gender || "";
    } else {
      // Generate user mask fresh
      console.log("📦 Creating user mask...");
      const userMaskResult = await createUserMaskedImage(normalizedUserPhoto, 10, true);
      if (userMaskResult && typeof userMaskResult === 'object' && 'image' in userMaskResult && userMaskResult.image) {
        maskedUserPhoto = userMaskResult.image;
      } else if (typeof userMaskResult === 'string') {
        maskedUserPhoto = userMaskResult;
      } else {
        console.warn("⚠️ Failed to create user mask, using original photo");
        maskedUserPhoto = normalizedUserPhoto;
      }
      console.log(`✓ User mask created: ${maskedUserPhoto.length} chars`);
      
      // Analyze user photo
      const userAnalysis = await analyzeUserPhoto(normalizedUserPhoto);
      userRace = userAnalysis?.raceEthnicity || "person";
      userGender = userAnalysis?.gender || "";
    }
    console.log(`✓ User analysis: ${userRace} ${userGender}`);

    // Extract dimensions from user photo
    let outputWidth = 1024;
    let outputHeight = 1024;
    let sourceWidth = outputWidth;
    let sourceHeight = outputHeight;
    if (normalizedUserPhoto.startsWith("data:")) {
      const inputDims = await getImageDimensions(normalizedUserPhoto);
      if (inputDims) {
        sourceWidth = inputDims.width;
        sourceHeight = inputDims.height;
        const fluxDims = calculateFluxDimensions(inputDims.width, inputDims.height);
        outputWidth = fluxDims.width;
        outputHeight = fluxDims.height;
      }
    }
    console.log(`📐 Output dimensions: ${outputWidth}×${outputHeight}`);

    // ============================================
    // STAGE 1: FLUX Kontext Pro (using inspiration as reference)
    // ============================================
    console.log(`\n━━━ STAGE 1: FLUX Kontext Pro (Inspiration as Reference) ━━━`);
    console.log(`📌 NOTE: Using user's inspiration photo directly as reference (no search needed)`);
    
    const kontextPrompt = buildGenerationPrompt(
      GENERATION_CONFIG.KONTEXT_STAGE1_PROMPT,
      "the shown hairstyle",
      userRace,
      userGender
    );
    console.log(`📝 Prompt: ${kontextPrompt}`);
    
    // Build Kontext Pro request (SINGLE image: inspiration photo as reference)
    const kontextRequestBody: any = {
      prompt: kontextPrompt,
      input_image: inspirationBase64,    // Single image: Inspiration photo as reference
      width: outputWidth,
      height: outputHeight,
      guidance: GENERATION_CONFIG.KONTEXT_STAGE1_GUIDANCE,
      safety_tolerance: 0,
      prompt_upsampling: false,
    };
    
    console.log(`📦 Kontext request: inspiration photo as reference`);
    console.log(`  📤 input_image (inspiration): ${inspirationBase64.length} chars`);
    
    // Save debug image
    try {
      if (inspirationBase64.startsWith('data:')) {
        const refBuffer = Buffer.from(inspirationBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        await fsDebug.writeFile("/tmp/debug_inspiration_stage1_input.jpg", refBuffer);
        console.log(`   ✓ Saved Stage 1 inspiration input to /tmp/debug_inspiration_stage1_input.jpg`);
      }
    } catch (e) {
      console.warn("Could not save Stage 1 input debug image:", e);
    }
    
    // Submit Stage 1
    const kontextSubmitResponse = await fetch(BFL_KONTEXT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify(kontextRequestBody),
    });

    if (!kontextSubmitResponse.ok) {
      const errorText = await kontextSubmitResponse.text();
      console.error(`[KONTEXT] Stage 1 submission error: ${kontextSubmitResponse.status} - ${errorText}`);
      return { frontImageUrl: null, sideImageUrl: null };
    }

    const kontextSubmitData = await kontextSubmitResponse.json();
    console.log(`🎫 Kontext submission ID: ${kontextSubmitData.id}`);

    const kontextPollingUrl = kontextSubmitData.polling_url;
    if (!kontextPollingUrl) {
      console.error("[KONTEXT] No polling URL returned");
      return { frontImageUrl: null, sideImageUrl: null };
    }

    // Poll Stage 1
    let kontextResultUrl: string | null = null;
    const maxAttempts = GENERATION_TIMEOUT_SECONDS;
    let attempts = 0;
    const startTime = Date.now();
    let lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(kontextPollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        console.log(`   ⏳ Stage 1 generating... ${elapsed}s (${result.status})`);
        lastLogTime = elapsed;
      }

      if (result.status === "Ready" || result.status === "succeeded") {
        kontextResultUrl = result.result?.sample || null;
        if (kontextResultUrl) {
          console.log(`   ✓ Stage 1 complete (${elapsed}s)`);
          break;
        }
        console.error("   ✗ Stage 1 failed: no image URL");
        return { frontImageUrl: null, sideImageUrl: null };
      } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error(`   ✗ Stage 1 failed: ${result.status}`);
        return { frontImageUrl: null, sideImageUrl: null };
      }

      attempts++;
    }

    if (!kontextResultUrl) {
      console.error(`[KONTEXT] Stage 1 timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
      generationMetrics.timeouts++;
      return { frontImageUrl: null, sideImageUrl: null };
    }

    // Save Stage 1 result
    try {
      const kontextImageResponse = await fetch(kontextResultUrl);
      const kontextImageBuffer = Buffer.from(await kontextImageResponse.arrayBuffer());
      await fsDebug.writeFile("/tmp/debug_inspiration_stage1_result.jpg", kontextImageBuffer);
      console.log(`✓ Saved Stage 1 result to /tmp/debug_inspiration_stage1_result.jpg`);
    } catch (e) {
      console.warn("Could not save Stage 1 debug image:", e);
    }
    
    // ============================================
    // STAGE 2: FLUX 2 Pro (same as text mode)
    // ============================================
    console.log(`\n━━━ STAGE 2: Backend Processing (with hair mask from Stage 1) ━━━`);
    
    // Convert Kontext result to base64
    console.log(`🔄 Converting Stage 1 result to base64...`);
    let kontextBase64 = await fetchImageAsBase64(kontextResultUrl);
    if (!kontextBase64) {
      console.error("[KONTEXT] Failed to fetch Stage 1 result as base64");
      return { frontImageUrl: null, sideImageUrl: null };
    }
    
    // Sharpen Kontext result before masking
    console.log(`✨ Sharpening Stage 1 result for better mask accuracy...`);
    try {
      const kontextBuffer = Buffer.from(kontextBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const sharpenedBuffer = await sharp(kontextBuffer)
        .sharpen({ sigma: 1.0, m1: 1.0, m2: 2.0 })
        .jpeg({ quality: 95 })
        .toBuffer();
      kontextBase64 = `data:image/jpeg;base64,${sharpenedBuffer.toString('base64')}`;
      console.log(`   ✓ Stage 1 result sharpened: ${kontextBase64.length} chars`);
    } catch (e) {
      console.log(`   ⚠ Sharpening failed, using original: ${(e as Error).message}`);
    }
    
    // Inspiration mode keeps Stage 1 mask in hair-only mode.
    console.log(`🎭 Creating Kontext HAIR-ONLY mask from Stage 1 result (hair_only)...`);
    const kontextHairMask = await createHairOnlyImage(kontextBase64, 0);
    if (!kontextHairMask) {
      console.error("[KONTEXT] Failed to create hair mask from Stage 1");
      return { frontImageUrl: null, sideImageUrl: null };
    }
    console.log(`   ✓ Hair mask created: ${kontextHairMask.length} chars`);

    // Save hair mask for debugging
    try {
      const hairMaskBuffer = Buffer.from(kontextHairMask.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      await fsDebug.writeFile("/tmp/debug_inspiration_stage1_hair_mask.png", hairMaskBuffer);
      console.log(`✓ Saved Stage 1 hair mask to /tmp/debug_inspiration_stage1_hair_mask.png`);
    } catch (e) {
      console.warn("Could not save hair mask debug image:", e);
    }

    const stage2Backend = resolveKontextStage2Backend(GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND);
    const { template: stage2PromptTemplate } = getKontextStage2PromptTemplateForBackend(stage2Backend);
    const stage2Prompt = buildKontextStage2PromptForBackend(
      stage2PromptTemplate.replace('{ethnicity}', getRegionBasedEthnicity(userRace)),
      stage2Backend
    );
    const stage2FillPrompt = buildGenerationPrompt(
      GENERATION_CONFIG.KONTEXT_FILL_PROMPT,
      "the shown hairstyle",
      userRace,
      userGender
    );
    console.log(`📝 Stage 2 Prompt: ${stage2Prompt}`);

    // Save debug files
    try {
      if (maskedUserPhoto?.startsWith("data:")) {
        const buf = Buffer.from(maskedUserPhoto.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        await fsDebug.writeFile("/tmp/debug_inspiration_user_mask.png", buf);
      }
      console.log("✓ Debug images saved");
    } catch (e) {
      console.warn("Failed to save debug images:", e);
    }

    console.log(`🧭 Stage 2 backend: ${stage2Backend}`);

    if (stage2Backend === "fal_redux_fill") {
      const falReduxFillStage2Result = await runFalReduxFillStage2(
        stage2FillPrompt,
        normalizedUserPhoto,
        kontextHairMask,
        sourceWidth,
        sourceHeight
      );
      if (!falReduxFillStage2Result) {
        console.error("[FAL REDUX+FILL] Failed to produce inspiration Stage 2 result");
        return { frontImageUrl: null, sideImageUrl: null };
      }

      try {
        await saveDebugImageFromAnySource("/tmp/debug_inspiration_stage2_result.jpg", falReduxFillStage2Result);
        await saveDebugImageFromAnySource("/tmp/debug_flux_stage2_result.jpg", falReduxFillStage2Result);
        await saveDebugImageFromAnySource("/tmp/debug_flux_fill_stage2_result.jpg", falReduxFillStage2Result);
        console.log("✓ Saved Stage 2 fal.ai redux+fill inspiration result");
      } catch (error) {
        console.warn("Could not save Stage 2 fal.ai redux+fill inspiration debug image:", error);
      }

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ INSPIRATION KONTEXT REFINED COMPLETE (fal_redux_fill) - Total time: ${totalTime}s`);
      return {
        frontImageUrl: falReduxFillStage2Result,
        sideImageUrl: null,
        maskImageUrl: kontextHairMask,
        raceEthnicity: userRace
      };
    }

    if (stage2Backend === "flux_fill") {
      const fluxFillStage2Result = await runFluxFillStage2(
        stage2FillPrompt,
        normalizedUserPhoto
      );
      if (!fluxFillStage2Result) {
        console.error("[FLUX FILL] Failed to produce inspiration Stage 2 result");
        return { frontImageUrl: null, sideImageUrl: null };
      }

      try {
        await saveDebugImageFromAnySource("/tmp/debug_inspiration_stage2_result.jpg", fluxFillStage2Result);
        await saveDebugImageFromAnySource("/tmp/debug_flux_stage2_result.jpg", fluxFillStage2Result);
        await saveDebugImageFromAnySource("/tmp/debug_flux_fill_stage2_result.jpg", fluxFillStage2Result);
        console.log("✓ Saved Stage 2 FLUX fill inspiration result");
      } catch (error) {
        console.warn("Could not save Stage 2 FLUX fill inspiration debug image:", error);
      }

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ INSPIRATION KONTEXT REFINED COMPLETE (flux_fill) - Total time: ${totalTime}s`);
      return {
        frontImageUrl: fluxFillStage2Result,
        sideImageUrl: null,
        maskImageUrl: kontextHairMask,
        raceEthnicity: userRace
      };
    }

    if (stage2Backend === "gpt_fill") {
      const gptFillStage2Result = await runGptFillStage2(
        stage2FillPrompt,
        normalizedUserPhoto,
        kontextHairMask,
        sourceWidth,
        sourceHeight
      );
      if (!gptFillStage2Result) {
        console.error("[GPT FILL] Failed to produce inspiration Stage 2 result");
        return { frontImageUrl: null, sideImageUrl: null };
      }

      try {
        await saveBase64DebugImage("/tmp/debug_inspiration_stage2_result.jpg", gptFillStage2Result);
        await saveBase64DebugImage("/tmp/debug_flux_stage2_result.jpg", gptFillStage2Result);
        console.log("✓ Saved Stage 2 GPT fill inspiration result");
      } catch (error) {
        console.warn("Could not save Stage 2 GPT fill inspiration debug image:", error);
      }

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ INSPIRATION KONTEXT REFINED COMPLETE (gpt_fill) - Total time: ${totalTime}s`);
      return {
        frontImageUrl: gptFillStage2Result,
        sideImageUrl: null,
        maskImageUrl: kontextHairMask,
        raceEthnicity: userRace
      };
    }

    if (stage2Backend === "blend_inpaint") {
      const blendedStage2Result = await runKontextStage2BlendBackend(
        normalizedUserPhoto,
        kontextBase64,
        kontextHairMask,
        "inspiration"
      );
      if (!blendedStage2Result) {
        console.error("[STAGE2 BLEND] Failed to produce inspiration blended result");
        return { frontImageUrl: null, sideImageUrl: null };
      }

      try {
        await saveBase64DebugImage("/tmp/debug_inspiration_stage2_result.jpg", blendedStage2Result);
        console.log("✓ Saved Stage 2 blend result to /tmp/debug_inspiration_stage2_result.jpg");
      } catch (error) {
        console.warn("Could not save Stage 2 blend debug image:", error);
      }

      await fsPromises.unlink("/tmp/debug_flux_fill_stage2_result.jpg").catch(() => {});
      const comparisonStart = Date.now();
      const fluxFillComparison = await runFluxFillComparisonForDebug(
        stage2FillPrompt,
        normalizedUserPhoto
      );
      const comparisonMs = Date.now() - comparisonStart;
      if (fluxFillComparison) {
        try {
          await saveDebugImageFromAnySource("/tmp/debug_flux_fill_stage2_result.jpg", fluxFillComparison);
          await saveDebugImageFromAnySource("/tmp/debug_inspiration_stage2_flux_fill_result.jpg", fluxFillComparison);
          console.log(`[STAGE2 COMPARE] Saved inspiration FLUX comparison result (${comparisonMs}ms)`);
        } catch (error) {
          console.warn("[STAGE2 COMPARE] Failed to save inspiration FLUX comparison debug image:", error);
        }
      } else {
        console.warn(`[STAGE2 COMPARE] No inspiration FLUX comparison result generated (${comparisonMs}ms)`);
      }

      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ INSPIRATION KONTEXT REFINED COMPLETE (blend_inpaint) - Total time: ${totalTime}s`);
      return {
        frontImageUrl: blendedStage2Result,
        sideImageUrl: null,
        maskImageUrl: kontextHairMask,
        raceEthnicity: userRace
      };
    }

    let stage2UserHairMaskGray: string | null = null;
    if (stage2Backend !== "flux_klein") {
      console.log(`🎭 Creating Stage 2 user hair color mask (hair color preserved, gray background)...`);
      stage2UserHairMaskGray = await createHairOnlyImage(normalizedUserPhoto, 10);
      if (!stage2UserHairMaskGray) {
        console.error("[KONTEXT] Failed to create Stage 2 user hair mask");
        return { frontImageUrl: null, sideImageUrl: null };
      }
      try {
        await saveBase64DebugImage("/tmp/debug_stage2_user_hair_color_mask.jpg", stage2UserHairMaskGray);
      } catch (error) {
        console.warn("Could not save Stage 2 user hair color mask debug image:", error);
      }
    } else {
      console.log(`🎭 Using Flux Klein Stage 2 contract (no user hair color mask input).`);
    }

    console.log(`🎭 Creating Stage 2 face+neck mask (image 2, user_mask includeHair=false)...`);
    let stage2FaceNeckMask = await buildStage2FaceNeckMaskFromHairPipeline(normalizedUserPhoto);
    if (!stage2FaceNeckMask) {
      console.warn("[KONTEXT] Failed to create face+neck mask with user_mask(includeHair=false); retrying direct call");
      stage2FaceNeckMask = await createUserMaskedImage(
        normalizedUserPhoto,
        0,
        false,
        0,
        true,
        true,
        false
      );
    }
    if (!stage2FaceNeckMask) {
      console.error("[KONTEXT] Failed to create Stage 2 face+neck mask");
      return { frontImageUrl: null, sideImageUrl: null };
    }
    try {
      await saveBase64DebugImage("/tmp/debug_stage2_user_face_neck_mask.jpg", stage2FaceNeckMask);
    } catch (error) {
      console.warn("Could not save Stage 2 face+neck mask debug image:", error);
    }

    let stage2RequestBody: any;
    if (stage2Backend === "flux_klein") {
      // Flux Klein contract:
      // image 1 = full user photo (base/background source)
      // image 2 = user face+neck mask (identity lock)
      // image 3 = GPT/Kontext Stage 1 result mask (hair source guidance)
      stage2RequestBody = {
        prompt: stage2Prompt,
        input_image: normalizedUserPhoto,
        input_image_2: stage2FaceNeckMask,
        input_image_3: kontextHairMask,
        width: outputWidth,
        height: outputHeight,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      };
    } else {
      // Flux 2 Pro contract:
      // image 1 = full user photo (base/background source)
      // image 2 = user face+neck mask (identity lock, no hair)
      // image 3 = user hair color mask (editable hair region)
      // image 4 = GPT/Kontext Stage 1 hair-only mask (hair source)
      stage2RequestBody = {
        prompt: stage2Prompt,
        input_image: normalizedUserPhoto,
        input_image_2: stage2FaceNeckMask,
        input_image_3: stage2UserHairMaskGray,
        input_image_4: kontextHairMask,
        width: outputWidth,
        height: outputHeight,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      };
    }
    const stage2ApiUrl = getKontextStage2BflApiUrl(stage2Backend);
    console.log(`🛰️ Stage 2 endpoint: ${stage2ApiUrl}`);
    
    if (stage2Backend === "flux_klein") {
      console.log(`📦 Stage 2 request (flux_klein): img1 full user + img2 face+neck + img3 stage1 result mask`);
      console.log(`  📤 input_image (full user): ${normalizedUserPhoto.length} chars`);
      console.log(`  📤 input_image_2 (user face+neck mask): ${stage2FaceNeckMask.length} chars`);
      console.log(`  📤 input_image_3 (stage1 result mask): ${kontextHairMask.length} chars`);
    } else {
      console.log(`📦 Stage 2 request: img1 full user + img2 face+neck + img3 user hair color mask + img4 stage1 hair-only`);
      console.log(`  📤 input_image (full user): ${normalizedUserPhoto.length} chars`);
      console.log(`  📤 input_image_2 (user face+neck mask): ${stage2FaceNeckMask.length} chars`);
      console.log(`  📤 input_image_3 (user hair color mask): ${stage2UserHairMaskGray!.length} chars`);
      console.log(`  📤 input_image_4 (stage1 hair-only mask): ${kontextHairMask.length} chars`);
    }

    // Submit Stage 2
    const stage2SubmitResponse = await fetch(stage2ApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify(stage2RequestBody),
    });

    if (!stage2SubmitResponse.ok) {
      const errorText = await stage2SubmitResponse.text();
      console.error(`[KONTEXT] Stage 2 submission error: ${stage2SubmitResponse.status} - ${errorText}`);
      return { frontImageUrl: null, sideImageUrl: null };
    }

    const stage2SubmitData = await stage2SubmitResponse.json();
    console.log(`🎫 Stage 2 submission ID: ${stage2SubmitData.id}`);

    const stage2PollingUrl = stage2SubmitData.polling_url;
    if (!stage2PollingUrl) {
      console.error("[KONTEXT] Stage 2: No polling URL returned");
      return { frontImageUrl: null, sideImageUrl: null };
    }

    // Poll Stage 2
    attempts = 0;
    const stage2StartTime = Date.now();
    lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(stage2PollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      
      const elapsed = Math.floor((Date.now() - stage2StartTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        console.log(`   ⏳ Stage 2 generating... ${elapsed}s (${result.status})`);
        lastLogTime = elapsed;
      }

      if (result.status === "Ready" || result.status === "succeeded") {
        const finalImageUrl = result.result?.sample || null;
        if (finalImageUrl) {
          const totalTime = Math.floor((Date.now() - startTime) / 1000);
          console.log(`   ✓ Stage 2 complete (${elapsed}s)`);
          console.log(`\n✅ INSPIRATION KONTEXT REFINED COMPLETE - Total time: ${totalTime}s`);
          console.log(`============================================================\n`);
          
          // Save Stage 2 result for debug
          try {
            const stage2Response = await fetch(finalImageUrl);
            if (stage2Response.ok) {
              const stage2Buffer = Buffer.from(await stage2Response.arrayBuffer());
              await fsDebug.writeFile("/tmp/debug_inspiration_stage2_result.jpg", stage2Buffer);
              console.log(`✓ Saved Stage 2 result to /tmp/debug_inspiration_stage2_result.jpg`);
            }
          } catch (e) {
            console.warn("Could not save Stage 2 debug image:", e);
          }
          
          // Return front image with debug data for masks and ethnicity
          return {
            frontImageUrl: finalImageUrl,
            sideImageUrl: null,
            debugData: {
              userMaskUrl: maskedUserPhoto || undefined,
              refHairMaskUrl: kontextHairMask || undefined,
              userRace: userRace,
              userGender: userGender
            }
          };
        }
        console.error("Stage 2 returned success but no image URL:", result);
        return { frontImageUrl: null, sideImageUrl: null };
      } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error("Stage 2 generation failed:", result);
        return { frontImageUrl: null, sideImageUrl: null };
      }

      attempts++;
    }

    console.error(`[KONTEXT] Stage 2 timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
    generationMetrics.timeouts++;
    return { frontImageUrl: null, sideImageUrl: null };
  } catch (error) {
    console.error("[INSPIRATION KONTEXT] Error:", error);
    if (error instanceof Error) {
      console.error("[INSPIRATION KONTEXT] Details:", error.message);
    }
    return { frontImageUrl: null, sideImageUrl: null };
  }
}

// Generate using pre-computed masks (for regeneration without re-creating masks)
async function generateWithPrecomputedMasks(
  userPhotoUrl: string,
  _maskedUserPhoto: string,
  hairOnlyMask: string,
  userRace: string,
  userGender: string
): Promise<DualImageResult> {
  try {
    console.log("=== Starting Generation with Pre-computed Masks ===");
    
    if (!BFL_API_KEY) {
      console.error("BFL_API_KEY not configured");
      return { frontImageUrl: null, sideImageUrl: null };
    }

    // Normalize user photo orientation
    let normalizedUserPhoto = userPhotoUrl;
    if (userPhotoUrl.startsWith("data:")) {
      normalizedUserPhoto = await normalizeImageOrientation(userPhotoUrl);
    }

    const stage2Backend = resolveKontextStage2Backend(GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND);

    // Build prompt using backend-specific Stage 2 image contracts.
    const { template: stage2PromptTemplate } = getKontextStage2PromptTemplateForBackend(stage2Backend);
    const prompt = buildGenerationPrompt(
      buildKontextStage2PromptForBackend(stage2PromptTemplate, stage2Backend),
      "the shown hairstyle",
      userRace,
      userGender
    );
    console.log("Prompt:", prompt);

    // Extract dimensions from user photo
    let outputWidth = 1024;
    let outputHeight = 1024;
    if (normalizedUserPhoto.startsWith("data:")) {
      const inputDims = await getImageDimensions(normalizedUserPhoto);
      if (inputDims) {
        const fluxDims = calculateFluxDimensions(inputDims.width, inputDims.height);
        outputWidth = fluxDims.width;
        outputHeight = fluxDims.height;
      }
    }
    console.log(`Output dimensions: ${outputWidth}×${outputHeight}`);

    if (stage2Backend === "fal_redux_fill") {
      const fillPrompt = buildGenerationPrompt(
        GENERATION_CONFIG.KONTEXT_FILL_PROMPT,
        "the shown hairstyle",
        userRace,
        userGender
      );
      console.log(`🧭 Regeneration Stage 2 backend: fal_redux_fill`);
      console.log(`📝 Stage 2 Fill Prompt: ${fillPrompt}`);
      const falReduxFillResult = await runFalReduxFillStage2(
        fillPrompt,
        normalizedUserPhoto,
        hairOnlyMask,
        sourceWidth,
        sourceHeight
      );
      if (!falReduxFillResult) {
        return { frontImageUrl: null, sideImageUrl: null };
      }
      return {
        frontImageUrl: falReduxFillResult,
        sideImageUrl: null,
      };
    }

    if (stage2Backend === "flux_fill") {
      const fillPrompt = buildGenerationPrompt(
        GENERATION_CONFIG.KONTEXT_FILL_PROMPT,
        "the shown hairstyle",
        userRace,
        userGender
      );
      console.log(`🧭 Regeneration Stage 2 backend: flux_fill`);
      console.log(`📝 Stage 2 Fill Prompt: ${fillPrompt}`);
      const fluxFillResult = await runFluxFillStage2(
        fillPrompt,
        normalizedUserPhoto
      );
      if (!fluxFillResult) {
        return { frontImageUrl: null, sideImageUrl: null };
      }
      return {
        frontImageUrl: fluxFillResult,
        sideImageUrl: null,
      };
    }

    // Build Stage 2 request:
    // flux2: image1 full user, image2 face+neck, image3 user hair color mask, image4 GPT/Kontext hair-only mask
    // flux_klein: image1 full user, image2 face+neck, image3 GPT/Kontext result mask
    let stage2UserHairMaskGray: string | null = null;
    if (stage2Backend !== "flux_klein") {
      console.log(`🎭 Building Stage 2 user hair color mask (hair color preserved, gray background)...`);
      stage2UserHairMaskGray = await createHairOnlyImage(normalizedUserPhoto, 10);
      if (!stage2UserHairMaskGray) {
        console.error("[REGENERATE] Failed to create Stage 2 user hair mask");
        return { frontImageUrl: null, sideImageUrl: null };
      }
      try {
        await saveBase64DebugImage("/tmp/debug_stage2_user_hair_color_mask.jpg", stage2UserHairMaskGray);
      } catch (error) {
        console.warn("Could not save Stage 2 user hair color mask debug image:", error);
      }
    } else {
      console.log(`🎭 Using Flux Klein Stage 2 contract (no user hair color mask input).`);
    }

    let stage2FaceNeckMask = await buildStage2FaceNeckMaskFromHairPipeline(normalizedUserPhoto);
    if (!stage2FaceNeckMask) {
      console.warn("[REGENERATE] Failed to create face+neck mask with user_mask(includeHair=false); retrying direct call");
      stage2FaceNeckMask = await createUserMaskedImage(
        normalizedUserPhoto,
        0,
        false,
        0,
        true,
        true,
        false
      );
    }
    if (!stage2FaceNeckMask) {
      console.error("[REGENERATE] Failed to create Stage 2 face+neck mask");
      return { frontImageUrl: null, sideImageUrl: null };
    }
    try {
      await saveBase64DebugImage("/tmp/debug_stage2_user_face_neck_mask.jpg", stage2FaceNeckMask);
    } catch (error) {
      console.warn("Could not save Stage 2 face+neck mask debug image:", error);
    }

    let requestBody: any;
    if (stage2Backend === "flux_klein") {
      console.log(`📦 Building 3-image Flux Klein request...`);
      requestBody = {
        prompt: prompt,
        input_image: normalizedUserPhoto,
        input_image_2: stage2FaceNeckMask,
        input_image_3: hairOnlyMask,
        width: outputWidth,
        height: outputHeight,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      };
    } else {
      console.log(`📦 Building 4-image Flux 2 Pro request...`);
      requestBody = {
        prompt: prompt,
        input_image: normalizedUserPhoto,
        input_image_2: stage2FaceNeckMask,
        input_image_3: stage2UserHairMaskGray,
        input_image_4: hairOnlyMask,
        width: outputWidth,
        height: outputHeight,
        safety_tolerance: GENERATION_CONFIG.KONTEXT_STAGE2_SAFETY_TOLERANCE,
      };
    }
    const stage2ApiUrl = getKontextStage2BflApiUrl(stage2Backend);
    console.log(`🛰️ Regeneration Stage 2 endpoint: ${stage2ApiUrl}`);
    
    if (stage2Backend === "flux_klein") {
      console.log(`  📤 input_image (full user photo): ${normalizedUserPhoto.length} chars`);
      console.log(`  📤 input_image_2 (user face+neck mask): ${stage2FaceNeckMask.length} chars`);
      console.log(`  📤 input_image_3 (stage1 result mask): ${hairOnlyMask.length} chars`);
      console.log(`✓ 3-image Stage 2 Klein pipeline ready`);
    } else {
      console.log(`  📤 input_image (full user photo): ${normalizedUserPhoto.length} chars`);
      console.log(`  📤 input_image_2 (user face+neck mask): ${stage2FaceNeckMask.length} chars`);
      console.log(`  📤 input_image_3 (user hair color mask): ${stage2UserHairMaskGray!.length} chars`);
      console.log(`  📤 input_image_4 (stage1 hair-only mask): ${hairOnlyMask.length} chars`);
      console.log(`✓ 4-image Stage 2 pipeline ready`);
    }

    // Submit the generation request
    const submitResponse = await fetch(stage2ApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY!,
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(`BFL submission error: ${submitResponse.status} - ${errorText}`);
      return { frontImageUrl: null, sideImageUrl: null };
    }

    const submitData = await submitResponse.json();
    console.log(`BFL submission ID:`, submitData.id);

    const pollingUrl = submitData.polling_url;
    if (!pollingUrl) {
      console.error("No polling URL returned from BFL");
      return { frontImageUrl: null, sideImageUrl: null };
    }

    // Poll for result (max 600 seconds)
    const maxAttempts = GENERATION_TIMEOUT_SECONDS;
    let attempts = 0;
    const pollStartTime = Date.now();
    let lastLogTime = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(pollingUrl, {
        headers: { "x-key": BFL_API_KEY! },
      });

      if (!pollResponse.ok) {
        attempts++;
        continue;
      }

      const result = await pollResponse.json();
      
      // Log status every 10 seconds (time-based)
      const elapsedSeconds = Math.floor((Date.now() - pollStartTime) / 1000);
      if (elapsedSeconds >= lastLogTime + 10) {
        console.log(`   ⏳ Regeneration... ${elapsedSeconds}s (${result.status})`);
        lastLogTime = elapsedSeconds;
      }

      if (result.status === "Ready" || result.status === "succeeded") {
        const imageUrl = result.result?.sample || null;
        if (imageUrl) {
          console.log(`   ✓ Regeneration complete (${elapsedSeconds}s)`);
          return {
            frontImageUrl: imageUrl,
            sideImageUrl: null,
            debugData: {
              userMaskUrl: maskedUserPhoto,
              refHairMaskUrl: hairOnlyMask,
              userRace: userRace,
              userGender: userGender
            }
          };
        }
        console.error("BFL returned success but no image URL:", result);
        return { frontImageUrl: null, sideImageUrl: null };
      } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
        console.error("BFL regeneration failed:", result);
        return { frontImageUrl: null, sideImageUrl: null };
      }

      attempts++;
    }

    console.log(`BFL regeneration polling timeout after ${GENERATION_TIMEOUT_SECONDS}s`);
    generationMetrics.timeouts++;
    return { frontImageUrl: null, sideImageUrl: null };
  } catch (error) {
    console.error("Error generating with pre-computed masks:", error);
    return { frontImageUrl: null, sideImageUrl: null };
  }
}

// Helper function to get user ID from session
function getUserId(req: any): string | null {
  if (typeof req.isAuthenticated !== "function" || !req.isAuthenticated()) return null;
  return req.user?.claims?.sub || null;
}

// Anonymous device credits tracking - Daily limit with 24hr reset
const ANONYMOUS_CREDITS_LIMIT = 15; // 15 generations per day
const ANONYMOUS_CREDITS_COOKIE = "auren_daily_credits";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

interface DailyCreditsData {
  used: number;
  resetAt: number; // timestamp when credits should reset
}

function parseDailyCredits(cookie: string | undefined): DailyCreditsData {
  if (!cookie) {
    return { used: 0, resetAt: Date.now() + TWENTY_FOUR_HOURS_MS };
  }
  try {
    const data = JSON.parse(cookie);
    // Check if reset time has passed
    if (Date.now() >= data.resetAt) {
      // Reset credits - new 24hr period
      return { used: 0, resetAt: Date.now() + TWENTY_FOUR_HOURS_MS };
    }
    return { used: data.used || 0, resetAt: data.resetAt };
  } catch {
    return { used: 0, resetAt: Date.now() + TWENTY_FOUR_HOURS_MS };
  }
}

function getAnonymousCreditsUsed(req: any): number {
  const cookie = req.cookies?.[ANONYMOUS_CREDITS_COOKIE];
  const data = parseDailyCredits(cookie);
  return data.used;
}

function setAnonymousCreditsUsed(res: any, count: number, req?: any): void {
  // Get existing reset time or create new one
  const existingCookie = req?.cookies?.[ANONYMOUS_CREDITS_COOKIE];
  const existingData = parseDailyCredits(existingCookie);
  
  const data: DailyCreditsData = {
    used: count,
    resetAt: existingData.resetAt
  };
  
  // Cookie expires in 24 hours (aligns with credit reset)
  res.cookie(ANONYMOUS_CREDITS_COOKIE, JSON.stringify(data), {
    maxAge: TWENTY_FOUR_HOURS_MS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function getAnonymousCreditsRemaining(req: any): number {
  const cookie = req.cookies?.[ANONYMOUS_CREDITS_COOKIE];
  const data = parseDailyCredits(cookie);
  return Math.max(0, ANONYMOUS_CREDITS_LIMIT - data.used);
}

function getCreditsResetTime(req: any): number {
  const cookie = req.cookies?.[ANONYMOUS_CREDITS_COOKIE];
  const data = parseDailyCredits(cookie);
  return data.resetAt;
}

// Anonymous device ID for favorites tracking
const DEVICE_ID_COOKIE = "auren_device_id";

function getOrCreateDeviceId(req: any, res: any): string {
  let deviceId = req.cookies?.[DEVICE_ID_COOKIE];
  if (!deviceId) {
    // Generate a unique device ID
    deviceId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    // Set persistent cookie (1 year) - must set path to "/" for all routes
    res.cookie(DEVICE_ID_COOKIE, deviceId, {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: true,
      sameSite: "lax",
      path: "/", // CRITICAL: Cookie must be available for all paths
      secure: process.env.NODE_ENV === "production",
    });
  }
  return deviceId;
}

function getDeviceId(req: any): string | null {
  return req.cookies?.[DEVICE_ID_COOKIE] || null;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Log configuration on startup
  logConfig();
  
  // Setup authentication first
  await setupAuth(app);
  
  // Whitelist of emails allowed to have admin access
  const ADMIN_ALLOWED_EMAILS = [
    "fayfayu132@gmail.com",
    "ohdeborah5@gmail.com",
  ];
  
  // Check if a user's email is in the admin whitelist
  const isAdminWhitelisted = (email: string | null | undefined): boolean => {
    if (!email) return false;
    return ADMIN_ALLOWED_EMAILS.includes(email.toLowerCase());
  };
  
  // TEST ENDPOINT: Generate hair mask using optimized pipeline
  // POST /api/test-mask with { imageUrl: "..." }
  app.post("/api/test-mask", async (req, res) => {
    try {
      const { imageUrl, dilationKernel, dilationIterations, featherSize } = req.body;
      
      if (!imageUrl) {
        return res.status(400).json({ error: "imageUrl is required" });
      }
      
      console.log("=== Testing Hair Mask Generation ===");
      console.log(`Image: ${imageUrl.substring(0, 80)}...`);
      console.log(`Config: dilation=${dilationKernel || GENERATION_CONFIG.MASK_DILATION_KERNEL}, iterations=${dilationIterations || GENERATION_CONFIG.MASK_DILATION_ITERATIONS}, feather=${featherSize || GENERATION_CONFIG.MASK_FEATHER_SIZE}`);
      
      // Use the optimized single-process pipeline
      const mask = await generateHairMask(imageUrl, {
        dilationKernel: dilationKernel ?? GENERATION_CONFIG.MASK_DILATION_KERNEL,
        dilationIterations: dilationIterations ?? GENERATION_CONFIG.MASK_DILATION_ITERATIONS,
        featherSize: featherSize ?? GENERATION_CONFIG.MASK_FEATHER_SIZE,
      });
      
      if (!mask) {
        return res.status(500).json({ error: "Failed to generate mask" });
      }
      
      console.log("=== Mask Generation Test Complete ===");
      res.json({
        success: true,
        mask,
        config: {
          dilationKernel: dilationKernel ?? GENERATION_CONFIG.MASK_DILATION_KERNEL,
          dilationIterations: dilationIterations ?? GENERATION_CONFIG.MASK_DILATION_ITERATIONS,
          featherSize: featherSize ?? GENERATION_CONFIG.MASK_FEATHER_SIZE,
        }
      });
    } catch (error) {
      console.error("Mask test error:", error);
      res.status(500).json({ error: "Failed to test mask generation" });
    }
  });
  
  // Serve test mask images and page
  app.use("/test-masks", (await import("express")).default.static("public/test-masks"));
  
  // Get credits status - works for both anonymous and authenticated users
  app.get("/api/credits", async (req, res) => {
    try {
      const userId = getUserId(req);
      
      // Dev mode: Unlimited credits for everyone
      if (GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
        if (userId) {
          res.json({
            isAuthenticated: true,
            currentCredits: 999,
            plan: "unlimited-dev",
            unlimitedCredits: true
          });
        } else {
          res.json({
            isAuthenticated: false,
            anonymousCreditsRemaining: 999,
            anonymousCreditsLimit: 999,
            requiresSignup: false
          });
        }
        return;
      }
      
      if (userId) {
        // Authenticated user - check for daily reset and return current credits
        await storage.resetDailyCredits(userId);
        const user = await storage.getUser(userId);
        
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        
        res.json({
          isAuthenticated: true,
          currentCredits: user.credits,
          plan: user.plan,
          unlimitedCredits: user.plan === "business"
        });
      } else {
        // Anonymous user - return device credits remaining with reset time
        const remaining = getAnonymousCreditsRemaining(req);
        const resetAt = getCreditsResetTime(req);
        
        res.json({
          isAuthenticated: false,
          anonymousCreditsRemaining: remaining,
          anonymousCreditsLimit: ANONYMOUS_CREDITS_LIMIT,
          creditsResetAt: resetAt,
          requiresSignup: remaining <= 0
        });
      }
    } catch (error) {
      console.error("Error fetching credits:", error);
      res.status(500).json({ error: "Failed to fetch credits" });
    }
  });
  
  // Generation metrics endpoint for monitoring
  app.get("/api/metrics/generation", async (req, res) => {
    try {
      const successRate = generationMetrics.totalRequests > 0 
        ? ((generationMetrics.successfulGenerations / generationMetrics.totalRequests) * 100).toFixed(1)
        : "N/A";
      
      res.json({
        totalRequests: generationMetrics.totalRequests,
        successfulGenerations: generationMetrics.successfulGenerations,
        failedGenerations: generationMetrics.failedGenerations,
        successRate: successRate + "%",
        timeouts: generationMetrics.timeouts,
        retries: generationMetrics.retries,
        averageGenerationTimeMs: Math.round(generationMetrics.averageGenerationTimeMs),
        averageGenerationTimeSec: (generationMetrics.averageGenerationTimeMs / 1000).toFixed(1),
        lastUpdated: generationMetrics.lastUpdated,
        apiErrors: generationMetrics.apiErrors,
      });
    } catch (error) {
      console.error("Error fetching metrics:", error);
      res.status(500).json({ error: "Failed to fetch metrics" });
    }
  });

  // Beta feedback endpoints with Zod validation
  const feedbackRequestSchema = z.object({
    rating: z.number().int().min(1).max(5).optional().nullable(),
    overallRating: z.number().int().min(1).max(5).optional().nullable(),
    usability: z.number().int().min(1).max(5).optional().nullable(),
    usabilityRating: z.number().int().min(1).max(7).optional().nullable(),
    imageQuality: z.number().int().min(1).max(5).optional().nullable(),
    imageQualityRating: z.number().int().min(1).max(5).optional().nullable(),
    wouldRecommend: z.boolean().optional().nullable(),
    favoriteFeature: z.string().max(500).optional().nullable(),
    favoriteFeatures: z.string().max(500).optional().nullable(),
    improvementSuggestion: z.string().max(2000).optional().nullable(),
    improvements: z.string().max(2000).optional().nullable(),
    additionalComments: z.string().max(2000).optional().nullable(),
    generationCount: z.number().int().min(0).max(10000).optional().nullable(),
    sessionId: z.string().max(100).optional().nullable(),
    pricingPreference: z.string().max(50).optional().nullable(),
    monthlyBudget: z.string().max(50).optional().nullable(),
    // Survey-specific fields
    mostUsedFeature: z.string().max(50).optional().nullable(),
    frustration: z.string().max(2000).optional().nullable(),
    missingFeature: z.string().max(2000).optional().nullable(),
    problemSolved: z.string().max(2000).optional().nullable(),
    aurenRating: z.number().int().min(1).max(7).optional().nullable(),
  });

  app.post("/api/feedback", async (req, res) => {
    try {
      // Validate request body with Zod
      const parseResult = feedbackRequestSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid feedback data", 
          details: parseResult.error.issues.map(i => i.message) 
        });
      }
      
      const data = parseResult.data;
      const deviceId = getOrCreateDeviceId(req, res);
      
      const feedback = await storage.createBetaFeedback({
        deviceId,
        sessionId: data.sessionId || null,
        rating: data.rating || data.overallRating || 3,
        usability: data.usability || data.usabilityRating,
        imageQuality: data.imageQuality || data.imageQualityRating,
        wouldRecommend: data.wouldRecommend,
        favoriteFeature: data.favoriteFeature || data.favoriteFeatures,
        improvementSuggestion: data.improvementSuggestion || data.improvements,
        additionalComments: data.additionalComments,
        generationCount: data.generationCount,
        pricingPreference: data.pricingPreference,
        monthlyBudget: data.monthlyBudget,
        // Survey-specific fields
        mostUsedFeature: data.mostUsedFeature,
        frustration: data.frustration,
        missingFeature: data.missingFeature,
        problemSolved: data.problemSolved,
        aurenRating: data.aurenRating,
      });
      
      res.json({ success: true, id: feedback.id });
    } catch (error) {
      console.error("Error submitting feedback:", error);
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  });

  app.get("/api/feedback/should-prompt", async (req, res) => {
    try {
      const deviceId = getOrCreateDeviceId(req, res);
      const sessionId = req.query.sessionId as string;
      const generationCount = parseInt(req.query.generationCount as string) || 0;
      
      // Show feedback prompt after 10-15 generations
      const shouldPrompt = generationCount >= 10 && generationCount <= 15;
      
      // Check if device has already given feedback
      let alreadyGiven = false;
      if (deviceId) {
        const feedbackCount = await storage.getDeviceFeedbackCount(deviceId);
        alreadyGiven = feedbackCount > 0;
      }
      
      res.json({
        shouldPrompt: shouldPrompt && !alreadyGiven,
        generationCount,
        alreadyGiven,
      });
    } catch (error) {
      console.error("Error checking feedback prompt:", error);
      res.status(500).json({ error: "Failed to check feedback status" });
    }
  });

  // Serve debug mask image for visualization
  // ?type=processed (default) - mask sent to FLUX Fill
  // ?type=replicate - raw Replicate output
  // ?type=local - local BiSeNet mask
  app.get("/api/debug/mask", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const type = req.query.type || (req.query.original === "true" ? "replicate" : "processed");
      
      let maskPath: string;
      switch (type) {
        case "replicate":
          maskPath = "/tmp/debug_mask_original.png";
          break;
        case "local":
          maskPath = "/tmp/debug_mask_local.png";
          break;
        default:
          maskPath = "/tmp/debug_mask.png";
      }
      
      try {
        const maskBuffer = await fsPromises.readFile(maskPath);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
        res.send(maskBuffer);
      } catch {
        res.status(404).json({ error: `No ${type} mask available yet` });
      }
    } catch (error) {
      console.error("Error serving debug mask:", error);
      res.status(500).json({ error: "Failed to serve mask" });
    }
  });
  
  // Debug comparison page showing all masks
  app.get("/api/debug/compare", async (req, res) => {
    const overviewStage2Backend = resolveKontextStage2Backend(GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND);
    const { template: overviewStage2PromptTemplate } = getKontextStage2PromptTemplateForBackend(overviewStage2Backend);
    const stage2DebugPrompt = buildKontextStage2PromptForBackend(
      overviewStage2PromptTemplate,
      overviewStage2Backend
    );

    res.setHeader("Content-Type", "text/html");
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Hair Mask Debug</title>
        <style>
          body { font-family: sans-serif; padding: 20px; background: #1a1a1a; color: white; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
          .item { text-align: center; background: #2a2a2a; padding: 15px; border-radius: 10px; }
          img { max-width: 100%; border: 2px solid #444; border-radius: 8px; }
          h3 { margin-bottom: 10px; color: #7c3aed; }
          h1 { color: #a855f7; }
          .section { margin-top: 30px; }
          .highlight { border-color: #22c55e !important; }
          .note { font-size: 0.9em; color: #888; margin-top: 5px; }
        </style>
      </head>
      <body>
        <h1>Hair Mask Debug Comparison</h1>
        <p>Refresh after running a generation to see updated images</p>
        
        <div class="section">
          <h2>Input Images</h2>
          <div class="grid">
            <div class="item">
              <h3>Original User Photo</h3>
              <img src="/api/debug/user-image" onerror="this.alt='Not available'"/>
            </div>
            <div class="item">
              <h3>Hair-Erased Input (sent to FLUX)</h3>
              <img src="/api/debug/hair-erased" class="highlight" onerror="this.alt='Not available (fallback to original)'"/>
              <p class="note">This is the key - hair region neutralized for inpainting</p>
            </div>
          </div>
        </div>
        
        <div class="section">
          <h2>Masks</h2>
          <div class="grid">
            <div class="item">
              <h3>Binary Mask (sent to FLUX)</h3>
              <img src="/api/debug/mask?type=processed" class="highlight" onerror="this.alt='Not available'"/>
              <p class="note">White = area to regenerate</p>
            </div>
            <div class="item">
              <h3>Replicate Raw Output</h3>
              <img src="/api/debug/mask?type=replicate" onerror="this.alt='Not available'"/>
              <p class="note">Raw RGB output from hair-segment model</p>
            </div>
            <div class="item">
              <h3>Local BiSeNet (fallback)</h3>
              <img src="/api/debug/mask?type=local" onerror="this.alt='Not available'"/>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
  });
  
  // Serve debug hair-erased image
  app.get("/api/debug/hair-erased", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      try {
        const buffer = await fsPromises.readFile("/tmp/debug_hair_erased.png");
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
        res.send(buffer);
      } catch {
        res.status(404).json({ error: "No hair-erased image available yet" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to serve image" });
    }
  });

  // Serve debug user image for comparison
  app.get("/api/debug/user-image", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");

      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(`/tmp/debug_user_image_${requestedIndex}.jpg`);
      }
      candidates.push("/tmp/debug_user_image.jpg");

      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next candidate
        }
      }
      if (!selectedPath) {
        return res.status(404).json({ error: "No image available yet" });
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch (error) {
      console.error("Error serving debug image:", error);
      res.status(500).json({ error: "Failed to serve image" });
    }
  });

  // Serve Replicate raw output (visual mask: white=hair, original=rest)
  app.get("/api/debug/replicate-raw", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const imageBuffer = await fsPromises.readFile("/tmp/debug_replicate_raw.jpg");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Replicate output available yet. Run a generation first." });
    }
  });

  // Serve validation debug images (from /api/validate-photo attempts)
  app.get("/api/debug/validate-image", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const imageBuffer = await fsPromises.readFile("/tmp/debug_validate_user_image.jpg");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No validation image available yet. Upload a photo first." });
    }
  });

  app.get("/api/debug/validate-mask", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const imageBuffer = await fsPromises.readFile("/tmp/debug_validate_user_mask.jpg");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No validation mask available yet. Upload a photo first." });
    }
  });

  app.get("/api/debug/validate-metadata", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const data = await fsPromises.readFile("/tmp/debug_validate_metadata.json", "utf-8");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(data);
    } catch {
      res.status(404).json({ error: "No validation metadata available yet. Upload a photo first." });
    }
  });

  // Debug page for validation attempts
  app.get("/api/debug-validation", async (req, res) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Auren - Photo Validation Debug</title>
        <style>
          body { font-family: system-ui; max-width: 1200px; margin: 0 auto; padding: 20px; background: #1a1a1a; color: #fff; }
          h1 { color: #f0f0f0; }
          h2 { color: #888; margin-top: 30px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
          .card { background: #2a2a2a; border-radius: 12px; padding: 20px; }
          img { max-width: 100%; height: auto; border-radius: 8px; }
          .meta { background: #333; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 12px; white-space: pre-wrap; margin-top: 20px; }
          .status-valid { color: #4ade80; }
          .status-invalid { color: #f87171; }
          .refresh-btn { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; margin-bottom: 20px; }
          .refresh-btn:hover { background: #2563eb; }
          .dim { font-size: 11px; color: #666; margin-top: 5px; }
        </style>
      </head>
      <body>
        <h1>Photo Validation Debug</h1>
        <button class="refresh-btn" onclick="location.reload()">Refresh</button>
        
        <div class="grid">
          <div class="card">
            <h2>Original Photo</h2>
            <img src="/api/debug/validate-image?t=\${Date.now()}" onerror="this.alt='Not available'" id="img1"/>
            <div class="dim" id="d1"></div>
          </div>
          <div class="card">
            <h2>Generated Mask</h2>
            <img src="/api/debug/validate-mask?t=\${Date.now()}" onerror="this.alt='Not available'" id="img2"/>
            <div class="dim" id="d2"></div>
          </div>
        </div>
        
        <h2>Validation Results</h2>
        <div class="meta" id="metadata">Loading...</div>
        
        <script>
          document.getElementById('img1').onload = function() {
            document.getElementById('d1').textContent = this.naturalWidth + 'x' + this.naturalHeight;
          };
          document.getElementById('img2').onload = function() {
            document.getElementById('d2').textContent = this.naturalWidth + 'x' + this.naturalHeight;
          };
          
          fetch('/api/debug/validate-metadata?t=' + Date.now())
            .then(r => r.json())
            .then(data => {
              const el = document.getElementById('metadata');
              if (data.error) {
                el.textContent = 'No validation data available yet.';
              } else {
                const statusClass = data.photoQualityValid ? 'status-valid' : 'status-invalid';
                el.innerHTML = '<span class="' + statusClass + '">Photo Quality: ' + (data.photoQualityValid ? 'PASSED' : 'FAILED') + '</span>\\n\\n' +
                  JSON.stringify(data, null, 2);
              }
            })
            .catch(() => {
              document.getElementById('metadata').textContent = 'Failed to load metadata';
            });
        </script>
      </body>
      </html>
    `;
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  // Serve user identity mask used across pipelines
  app.get("/api/debug/user-mask", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const imageBuffer = await fsPromises.readFile("/tmp/debug_user_mask.jpg");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No user mask available yet. Run a text mode generation first." });
    }
  });
  
  // Force regeneration of user mask (clears cache and regenerates)
  app.post("/api/debug/regenerate-user-mask/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await storage.getUserSession(sessionId);
      
      if (!session || !session.originalPhotoUrl) {
        return res.status(404).json({ error: "Session not found or no photo uploaded" });
      }
      
      console.log(`🔄 [DEBUG] Force regenerating user mask for session ${sessionId}...`);
      
      // Regenerate the mask with latest code (includeValidation=false to get string result)
      const maskedResult = await createUserMaskedImage(session.originalPhotoUrl, 10, false);
      
      if (!maskedResult) {
        return res.status(500).json({ error: "Failed to regenerate user mask" });
      }
      
      // Save to debug file
      const fsPromises = await import("fs/promises");
      const base64Data = maskedResult.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      await fsPromises.writeFile("/tmp/debug_user_mask.jpg", imageBuffer);
      
      // Also save to cache for future generations (overwrite existing)
      const cacheKey = generateCacheKey(session.originalPhotoUrl);
      memoryFallbackCache.delete(cacheKey);
      await preprocessCache.set(cacheKey, {
        maskedImage: maskedResult,
        maskedUserPhoto: maskedResult,
        timestamp: Date.now()
      });
      
      console.log(`✓ [DEBUG] User mask regenerated and saved to cache`);
      
      res.json({ success: true, message: "User mask regenerated with latest code" });
    } catch (error) {
      console.error(`[DEBUG] Error regenerating mask:`, error);
      res.status(500).json({ error: "Failed to regenerate user mask" });
    }
  });

  // Canonical mask debug endpoint (3 supported pipelines only)
  app.post("/api/debug/compare-masks", async (req, res) => {
    // Prevent any caching of comparison results
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    try {
      const { imageUrl } = req.body;
      
      if (!imageUrl) {
        return res.status(400).json({ error: "imageUrl is required" });
      }
      
      console.log(`🔬 [MASK DEBUG] Running canonical 3-pipeline mask debug...`);

      const [userWhiteHairMask, userFaceNeckMask, kontextHairOnlyMask] = await Promise.all([
        createHairOnlyImage(imageUrl, 10),
        buildStage2FaceNeckMaskFromHairPipeline(imageUrl),
        createKontextResultMaskTest(imageUrl, 30),
      ]);

      res.json({
        success: true,
        pipelines: {
          userWhiteHairMask: {
            success: !!userWhiteHairMask,
            image: userWhiteHairMask,
          },
          userFaceNeckMask: {
            success: !!userFaceNeckMask,
            image: userFaceNeckMask,
          },
          gptKontextHairOnlyMask: {
            success: !!kontextHairOnlyMask,
            image: kontextHairOnlyMask,
          },
        },
      });
    } catch (error: any) {
      console.error(`[MASK DEBUG] Error:`, error);
      res.status(500).json({ error: error.message || "Mask debug failed" });
    }
  });

  // Debug masks page - shows user mask, reference masks, and regenerate button
  app.get("/api/debug-masks", async (req, res) => {
    // Try to get session ID from query param or use empty string
    const sessionId = (req.query.session as string) || '';
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Auren - Debug Masks</title>
        <style>
          body { font-family: system-ui; max-width: 1400px; margin: 0 auto; padding: 20px; background: #1a1a1a; color: #fff; }
          h1 { color: #f0f0f0; }
          h2 { color: #888; margin-top: 30px; font-size: 16px; }
          .controls { display: flex; gap: 10px; margin-bottom: 20px; }
          .btn { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; }
          .btn:hover { background: #2563eb; }
          .btn.regenerate { background: #f59e0b; }
          .btn.regenerate:hover { background: #d97706; }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px; }
          .card { background: #2a2a2a; border-radius: 12px; padding: 15px; }
          img { max-width: 100%; height: auto; border-radius: 8px; }
          .dim { font-size: 11px; color: #666; margin-top: 5px; }
          .status { padding: 10px; border-radius: 8px; margin-top: 10px; display: none; }
          .status.success { background: #065f46; display: block; }
          .status.error { background: #991b1b; display: block; }
          .session-id { font-family: monospace; font-size: 12px; color: #888; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
          .session-id input { background: #333; border: 1px solid #555; color: #fff; padding: 5px 10px; border-radius: 4px; font-family: monospace; width: 320px; }
        </style>
      </head>
      <body>
        <h1>Debug Masks</h1>
        <div class="session-id">
          Session ID: <input type="text" id="sessionId" value="${sessionId}" placeholder="Enter session ID from URL or logs"/>
        </div>
        
        <div class="controls">
          <button class="btn" onclick="refresh()">Refresh Images</button>
          <button class="btn regenerate" id="regenBtn" onclick="regenerateMask()">Regenerate User Mask</button>
        </div>
        <div id="status" class="status"></div>
        
        <h2>Stage 2 Inputs (Flux 2 Pro)</h2>
        <div class="grid">
          <div class="card">
            <h2>input_image (Full User Photo)</h2>
            <img src="/api/debug/user-image?t=${Date.now()}" onerror="this.alt='Not available'" id="userImg"/>
            <div class="dim" id="userDim"></div>
          </div>
          <div class="card">
            <h2>input_image_2 (User White Hair Mask)</h2>
            <img src="/api/debug/fill-mask-binary?t=${Date.now()}" onerror="this.alt='Not available'" id="maskImg"/>
            <div class="dim" id="maskDim"></div>
          </div>
        </div>
        
        <h2>input_image_3 (GPT Stage 1 Hair-Only Mask)</h2>
        <div class="grid">
          <div class="card">
            <h2>Kontext Stage 1 Hair-Only Mask</h2>
            <img src="/api/debug/kontext-stage1-hair-face-mask?t=${Date.now()}" onerror="this.alt='Run generation first'" id="kontextMaskImg"/>
            <div class="dim" id="kontextMaskDim"></div>
          </div>
        </div>
        
        <script>
          document.getElementById('userImg').onload = function() {
            document.getElementById('userDim').textContent = this.naturalWidth + 'x' + this.naturalHeight;
          };
          document.getElementById('maskImg').onload = function() {
            document.getElementById('maskDim').textContent = this.naturalWidth + 'x' + this.naturalHeight;
          };
          document.getElementById('kontextMaskImg').onload = function() {
            document.getElementById('kontextMaskDim').textContent = this.naturalWidth + 'x' + this.naturalHeight;
          };
          
          function refresh() {
            const t = Date.now();
            document.getElementById('userImg').src = '/api/debug/user-image?t=' + t;
            document.getElementById('maskImg').src = '/api/debug/fill-mask-binary?t=' + t;
            document.getElementById('kontextMaskImg').src = '/api/debug/kontext-stage1-hair-face-mask?t=' + t;
          }
          
          async function regenerateMask() {
            const sessionId = document.getElementById('sessionId').value.trim();
            if (!sessionId) {
              showStatus('Please enter a session ID (copy from your browser URL after /results/)', false);
              return;
            }
            
            const btn = document.getElementById('regenBtn');
            btn.disabled = true;
            btn.textContent = 'Regenerating...';
            
            try {
              const res = await fetch('/api/debug/regenerate-user-mask/' + sessionId, { method: 'POST' });
              const data = await res.json();
              
              if (res.ok) {
                showStatus('User mask regenerated! Refreshing...', true);
                setTimeout(refresh, 500);
              } else {
                showStatus('Error: ' + (data.error || 'Unknown error'), false);
              }
            } catch (err) {
              showStatus('Error: ' + err.message, false);
            } finally {
              btn.disabled = false;
              btn.textContent = 'Regenerate User Mask';
            }
          }
          
          function showStatus(msg, success) {
            const el = document.getElementById('status');
            el.textContent = msg;
            el.className = 'status ' + (success ? 'success' : 'error');
            setTimeout(() => { el.className = 'status'; }, 3000);
          }
        </script>
      </body>
      </html>
    `;
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  // Legacy endpoint - keeping for backwards compatibility
  app.get("/api/debug/user-hair-only", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const imageBuffer = await fsPromises.readFile("/tmp/debug_user_mask.jpg");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No masked user photo available yet. Run a text mode generation first." });
    }
  });

  // Serve reference hair-only image (hair visible, rest gray 230,230,230)
  app.get("/api/debug/reference-hair-only", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const imageBuffer = await fsPromises.readFile("/tmp/debug_reference_hair_only.jpg");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No reference hair-only image available yet. Run a generation first." });
    }
  });

  // Serve reference hair-only images for all 3 variants
  app.get("/api/debug/reference-hair-only/:index", async (req, res) => {
    try {
      const index = parseInt(req.params.index) || 1;
      const fsPromises = await import("fs/promises");
      // Try PNG first (text mode), then JPG (inspiration mode)
      let imageBuffer: Buffer;
      let contentType = "image/png";
      try {
        imageBuffer = await fsPromises.readFile(`/tmp/debug_reference_hair_only_${index}.png`);
      } catch {
        imageBuffer = await fsPromises.readFile(`/tmp/debug_reference_hair_only_${index}.jpg`);
        contentType = "image/jpeg";
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: `No reference hair-only image for variant ${req.params.index} available yet.` });
    }
  });

  // Serve full reference image (unmasked)
  app.get("/api/debug/reference-full/:index", async (req, res) => {
    try {
      const index = parseInt(req.params.index) || 1;
      const fsPromises = await import("fs/promises");
      const imageBuffer = await fsPromises.readFile(`/tmp/debug_reference_full_${index}.jpg`);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: `No full reference image for variant ${req.params.index} available yet.` });
    }
  });

  // Serve Stage 1 input image (reference only).
  app.get("/api/debug/gpt-ref-input/:index", async (req, res) => {
    try {
      const index = parseInt(req.params.index);
      if (Number.isNaN(index) || index < 1) {
        return res.status(400).json({ error: "index must be >= 1" });
      }

      const fsPromises = await import("fs/promises");
      const candidates = [
        `/tmp/debug_gpt_ref_input_${index}.jpg`,
        `/tmp/debug_gpt_ref_input_${index}.png`,
        `/tmp/debug_gpt_ref_input_${index}.webp`,
      ];
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }

      if (!selectedPath) {
        return res.status(404).json({ error: `No GPT reference-fusion input image ${index} available yet.` });
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      const contentType = selectedPath.endsWith(".png")
        ? "image/png"
        : selectedPath.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: `No GPT reference-fusion input image ${req.params.index} available yet.` });
    }
  });

  // Serve Stage 1 Kontext fusion output image.
  app.get("/api/debug/gpt-ref-result", async (_req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const candidates = [
        "/tmp/debug_stage1_kontext_fusion_result.jpg",
        "/tmp/debug_stage1_kontext_fusion_result.png",
        "/tmp/debug_stage1_kontext_fusion_result.webp",
        "/tmp/debug_gpt_reference_fusion_result.jpg",
        "/tmp/debug_gpt_reference_fusion_result.png",
        "/tmp/debug_gpt_reference_fusion_result.webp",
      ];
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }

      if (!selectedPath) {
        return res.status(404).json({ error: "No GPT reference-fusion result available yet." });
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      const contentType = selectedPath.endsWith(".png")
        ? "image/png"
        : selectedPath.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Stage 1 Kontext fusion result available yet." });
    }
  });

  // Serve Stage 1 Kontext fusion output image (explicit endpoint).
  app.get("/api/debug/stage1-kontext-result", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(
          `/tmp/debug_stage1_kontext_fusion_result_${requestedIndex}.jpg`,
          `/tmp/debug_stage1_kontext_fusion_result_${requestedIndex}.png`,
          `/tmp/debug_stage1_kontext_fusion_result_${requestedIndex}.webp`
        );
      } else {
        candidates.push(
          "/tmp/debug_stage1_kontext_fusion_result.jpg",
          "/tmp/debug_stage1_kontext_fusion_result.png",
          "/tmp/debug_stage1_kontext_fusion_result.webp",
          "/tmp/debug_gpt_reference_fusion_result.jpg",
          "/tmp/debug_gpt_reference_fusion_result.png",
          "/tmp/debug_gpt_reference_fusion_result.webp",
        );
      }
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }

      if (!selectedPath) {
        return res.status(404).json({ error: "No Stage 1 Kontext fusion result available yet." });
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      const contentType = selectedPath.endsWith(".png")
        ? "image/png"
        : selectedPath.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Stage 1 Kontext fusion result available yet." });
    }
  });

  // Serve Stage 1 GPT output image.
  app.get("/api/debug/stage1-gpt-result", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(
          `/tmp/debug_stage1_gpt_fusion_result_${requestedIndex}.jpg`,
          `/tmp/debug_stage1_gpt_fusion_result_${requestedIndex}.png`,
          `/tmp/debug_stage1_gpt_fusion_result_${requestedIndex}.webp`
        );
      } else {
        candidates.push(
          "/tmp/debug_stage1_gpt_fusion_result.jpg",
          "/tmp/debug_stage1_gpt_fusion_result.png",
          "/tmp/debug_stage1_gpt_fusion_result.webp",
        );
      }
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }

      if (!selectedPath) {
        return res.status(404).json({ error: "No Stage 1 GPT result available yet." });
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      const contentType = selectedPath.endsWith(".png")
        ? "image/png"
        : selectedPath.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Stage 1 GPT result available yet." });
    }
  });

  // Serve Kontext Stage 1 INPUT: User photo (what was actually sent to Kontext)
  app.get("/api/debug/kontext-stage1-input-user", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(`/tmp/debug_kontext_stage1_input_user_${requestedIndex}.jpg`);
      }
      candidates.push("/tmp/debug_kontext_stage1_input_user.jpg");
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!selectedPath) {
        return res.status(404).json({ error: "No Stage 1 user input available yet." });
      }
      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Stage 1 user input available yet." });
    }
  });

  // Serve Kontext Stage 1 INPUT: Reference photo (what was actually sent to Kontext)
  app.get("/api/debug/kontext-stage1-input-ref", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(`/tmp/debug_kontext_stage1_input_ref_${requestedIndex}.jpg`);
      }
      candidates.push("/tmp/debug_kontext_stage1_input_ref.jpg");
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!selectedPath) {
        return res.status(404).json({ error: "No Stage 1 reference input available yet." });
      }
      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Stage 1 reference input available yet." });
    }
  });

  app.get("/api/debug/kontext-stage1-metadata", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(`/tmp/debug_kontext_stage1_metadata_${requestedIndex}.json`);
      }
      candidates.push("/tmp/debug_kontext_stage1_metadata.json");
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!selectedPath) {
        return res.status(404).json({ error: "No Stage 1 metadata available yet." });
      }
      const raw = await fsPromises.readFile(selectedPath, "utf8");
      const payload = JSON.parse(raw);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.json(payload);
    } catch {
      res.status(404).json({ error: "No Stage 1 metadata available yet." });
    }
  });

  // Serve Kontext Stage 1 result (from two-stage pipeline)
  app.get("/api/debug/kontext-stage1-result", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(`/tmp/debug_kontext_stage1_result_${requestedIndex}.jpg`);
      }
      candidates.push("/tmp/debug_kontext_stage1_result.jpg");
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!selectedPath) {
        return res.status(404).json({ error: "No Kontext Stage 1 result available. Run a generation with kontext_refined pipeline first." });
      }
      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Kontext Stage 1 result available. Run a generation with kontext_refined pipeline first." });
    }
  });

  // Serve Kontext Stage 1 hair+face mask (extracted from Stage 1 result, eyes grayed)
  app.get("/api/debug/kontext-stage1-hair-face-mask", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(`/tmp/debug_kontext_stage1_hair_face_mask_${requestedIndex}.png`);
      }
      candidates.push("/tmp/debug_kontext_stage1_hair_face_mask.png");
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!selectedPath) {
        return res.status(404).json({ error: "No hair+face mask available. Run a generation with KONTEXT_STAGE1_ONLY=true first." });
      }
      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No hair+face mask available. Run a generation with KONTEXT_STAGE1_ONLY=true first." });
    }
  });

  // Serve FLUX Stage 2 result
  app.get("/api/debug/flux-stage2-result", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      const candidates: string[] = [];
      if (requestedIndex) {
        candidates.push(
          `/tmp/debug_flux_stage2_result_${requestedIndex}.jpg`,
          `/tmp/debug_flux_stage2_result_${requestedIndex}.png`,
          `/tmp/debug_flux_stage2_result_${requestedIndex}.webp`
        );
      }
      candidates.push(
        "/tmp/debug_flux_stage2_result.jpg",
        "/tmp/debug_flux_stage2_result.png",
        "/tmp/debug_flux_stage2_result.webp"
      );
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!selectedPath) {
        return res.status(404).json({ error: "No FLUX result available. Run a generation first." });
      }
      const imageBuffer = await fsPromises.readFile(selectedPath);
      const contentType = selectedPath.endsWith(".png")
        ? "image/png"
        : selectedPath.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No FLUX result available. Run a generation first." });
    }
  });

  // Serve FLUX fill comparison result (debug-only, app still returns local blend)
  app.get("/api/debug/flux-fill-stage2-result", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const imageBuffer = await fsPromises.readFile("/tmp/debug_flux_fill_stage2_result.jpg");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No FLUX fill comparison result available yet." });
    }
  });

  // Serve explicit fill base image (what FLUX fill edits)
  app.get("/api/debug/fill-base-image", async (req, res) => {
    try {
      let imageBuffer: Buffer | null = null;
      let contentType = "image/jpeg";
      try {
        imageBuffer = await fsPromises.readFile("/tmp/debug_fill_base_image.png");
        contentType = "image/png";
      } catch {
        try {
          imageBuffer = await fsPromises.readFile("/tmp/debug_fill_base_image.jpg");
          contentType = "image/jpeg";
        } catch {
          imageBuffer = await fsPromises.readFile("/tmp/debug_user_image.jpg");
          contentType = "image/jpeg";
        }
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No fill base image available yet." });
    }
  });

  // Serve explicit fill binary edit mask (white = editable hair region)
  app.get("/api/debug/fill-mask-binary", async (req, res) => {
    try {
      const candidates = [
        "/tmp/debug_stage2_user_white_hair_mask.png",
        "/tmp/debug_fill_mask_binary.png",
        "/tmp/debug_kontext_stage1_hair_mask_binary.png",
        "/tmp/debug_inspiration_stage1_hair_mask_binary.png",
      ];

      let selectedPath: string | null = null;
      let latestMtime = 0;
      for (const p of candidates) {
        try {
          const stat = await fsPromises.stat(p);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            selectedPath = p;
          }
        } catch {
          // ignore missing file
        }
      }

      if (!selectedPath) {
        return res.status(404).json({ error: "No fill binary mask available yet." });
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No fill binary mask available yet." });
    }
  });

  // Serve Stage 2 input_image hair color mask (hair preserved, non-hair gray)
  app.get("/api/debug/stage2-user-hair-color-mask", async (req, res) => {
    try {
      const requestedIndex = getRequestedDebugIndex(req);
      if (requestedIndex) {
        const indexedCandidates = [
          `/tmp/debug_stage2_user_hair_color_mask_${requestedIndex}.jpg`,
          `/tmp/debug_stage2_user_hair_color_mask_${requestedIndex}.png`
        ];
        for (const candidate of indexedCandidates) {
          try {
            const imageBuffer = await fsPromises.readFile(candidate);
            const contentType = candidate.endsWith(".png") ? "image/png" : "image/jpeg";
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            return res.send(imageBuffer);
          } catch {
            // try next indexed candidate
          }
        }
        return res.status(404).json({ error: `No Stage 2 user hair color mask for index ${requestedIndex}.` });
      }

      const candidates = [
        "/tmp/debug_stage2_user_hair_color_mask.jpg",
        "/tmp/debug_stage2_user_hair_color_mask.png",
      ];
      let selectedPath: string | null = null;
      let latestMtime = 0;
      for (const p of candidates) {
        try {
          const stat = await fsPromises.stat(p);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            selectedPath = p;
          }
        } catch {
          // ignore missing file
        }
      }

      if (!selectedPath) {
        res.status(404).json({ error: "No Stage 2 user hair color mask available yet." });
        return;
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      const contentType = selectedPath.endsWith(".png") ? "image/png" : "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Stage 2 user hair color mask available yet." });
    }
  });

  // Serve Stage 2 face+neck mask used as input_image_2 in 4-image FLUX 2 Pro mode
  app.get("/api/debug/stage2-face-neck-mask", async (req, res) => {
    try {
      const requestedIndex = getRequestedDebugIndex(req);
      if (requestedIndex) {
        const indexedPath = `/tmp/debug_stage2_user_face_neck_mask_${requestedIndex}.jpg`;
        try {
          const imageBuffer = await fsPromises.readFile(indexedPath);
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          return res.send(imageBuffer);
        } catch {
          return res.status(404).json({ error: `No Stage 2 face mask for index ${requestedIndex}.` });
        }
      }

      const candidates: string[] = ["/tmp/debug_stage2_user_face_neck_mask.jpg"];
      let selectedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await fsPromises.stat(candidate);
          selectedPath = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!selectedPath) {
        return res.status(404).json({ error: "No Stage 2 face+neck mask available yet." });
      }
      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No Stage 2 face+neck mask available yet." });
    }
  });

  // Serve the latest Stage 2 guidance mask (Klein reference hair mask)
  app.get("/api/debug/stage2-reference-mask", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const requestedIndex = getRequestedDebugIndex(req);
      if (requestedIndex) {
        const indexedCandidates = [
          `/tmp/debug_stage2_klein_reference_mask_${requestedIndex}.png`,
          `/tmp/debug_stage2_klein_reference_mask_${requestedIndex}.jpg`,
          `/tmp/debug_stage2_klein_reference_mask_${requestedIndex}.jpeg`,
        ];
        for (const candidate of indexedCandidates) {
          try {
            const imageBuffer = await fsPromises.readFile(candidate);
            const contentType = candidate.endsWith(".png") ? "image/png" : "image/jpeg";
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            return res.send(imageBuffer);
          } catch {
            // try next
          }
        }
        return res.status(404).json({ error: `No stage2 reference mask for index ${requestedIndex}.` });
      }
      const candidates: string[] = [];
      const tmpFiles = await fsPromises.readdir("/tmp");
      for (const file of tmpFiles) {
        if (file.startsWith("debug_stage2_klein_reference_mask_") && (file.endsWith(".png") || file.endsWith(".jpg") || file.endsWith(".jpeg"))) {
          candidates.push(`/tmp/${file}`);
        }
      }

      let selectedPath: string | null = null;
      let latestMtime = 0;
      for (const p of candidates) {
        try {
          const stat = await fsPromises.stat(p);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            selectedPath = p;
          }
        } catch {
          // ignore missing file
        }
      }

      if (!selectedPath) {
        try {
          selectedPath = "/tmp/debug_kontext_stage1_hair_face_mask.png";
          await fsPromises.stat(selectedPath);
        } catch {
          selectedPath = null;
        }
      }

      if (!selectedPath) {
        res.status(404).json({ error: "No stage2 reference mask available yet." });
        return;
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", selectedPath.endsWith(".png") ? "image/png" : "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No stage2 reference mask available yet." });
    }
  });

  // Serve explicit fill style reference (GPT/Kontext hair mask reference)
  app.get("/api/debug/fill-style-reference", async (req, res) => {
    try {
      const candidates = [
        "/tmp/debug_fill_style_reference.jpg",
        "/tmp/debug_fill_style_reference.png",
        "/tmp/debug_kontext_stage1_hair_face_mask.png",
        "/tmp/debug_inspiration_stage1_hair_mask.png",
      ];

      let selectedPath: string | null = null;
      let latestMtime = 0;
      for (const p of candidates) {
        try {
          const stat = await fsPromises.stat(p);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            selectedPath = p;
          }
        } catch {
          // ignore missing file
        }
      }

      if (!selectedPath) {
        return res.status(404).json({ error: "No fill style reference available yet." });
      }

      const imageBuffer = await fsPromises.readFile(selectedPath);
      res.setHeader("Content-Type", selectedPath.endsWith(".png") ? "image/png" : "image/jpeg");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: "No fill style reference available yet." });
    }
  });

  // DEBUG: View all fetched reference images
  app.get("/api/debug/fetched-images", async (req, res) => {
    const images = await loadFetchedImages();
    res.json({
      count: images.length,
      timestamp: images[0]?.timestamp || null,
      images: images.map((img, i) => ({
        index: i + 1,
        source: img.source,
        url: img.url,
        base64Preview: img.base64.substring(0, 100) + '...'
      }))
    });
  });

  // DEBUG: Serve individual fetched image by index
  app.get("/api/debug/fetched-image/:index", async (req, res) => {
    const images = await loadFetchedImages();
    const index = parseInt(req.params.index) - 1;
    if (index < 0 || index >= images.length) {
      return res.status(404).json({ error: `Image ${req.params.index} not found. Available: 1-${images.length}` });
    }
    const img = images[index];
    const base64Data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64;
    const buffer = Buffer.from(base64Data, 'base64');
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  });

  // DEBUG: Run Kontext Stage 1 only (no FLUX 2 Pro Stage 2)
  // Uses cached user photo and searches for references, then runs only Kontext
  app.post("/api/debug/kontext-test", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
      }

      console.log(`\n============================================================`);
      console.log(`🧪 DEBUG: KONTEXT STAGE 1 ONLY TEST`);
      console.log(`============================================================`);
      console.log(`📝 Prompt: "${prompt}"`);

      const fsPromises = await import("fs/promises");

      // Get cached user photo
      let userPhotoBase64: string;
      try {
        const userImageBuffer = await fsPromises.readFile("/tmp/debug_user_image.jpg");
        userPhotoBase64 = `data:image/jpeg;base64,${userImageBuffer.toString('base64')}`;
        console.log(`✓ Loaded cached user photo (${userPhotoBase64.length} chars)`);
      } catch {
        return res.status(400).json({ error: "No cached user photo. Upload a photo first via the normal flow." });
      }

      // Get user analysis from preprocess cache
      let userRace = "person";
      let userGender = "";
      const cacheEntries = Array.from(preprocessCache.entries());
      if (cacheEntries.length > 0) {
        const sorted = cacheEntries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        const [, cached] = sorted[0];
        if (cached.userAnalysis) {
          userRace = cached.userAnalysis.race || "person";
          userGender = cached.userAnalysis.gender || "";
          console.log(`✓ User analysis: ${userGender} ${userRace}`);
        }
      }

      // Search for reference images
      console.log(`\n🔍 Searching for reference images...`);
      const searchQuery = `${prompt} hairstyle ${userGender} front facing`;
      const { searchHairstyleImages } = await import("./imageProcessing");
      const searchResults = await searchHairstyleImages(searchQuery, 20);
      
      if (!searchResults || searchResults.length === 0) {
        return res.status(500).json({ error: "No reference images found" });
      }
      console.log(`✓ Found ${searchResults.length} reference images`);

      // Get first valid reference
      let referenceBase64: string | null = null;
      for (const result of searchResults.slice(0, 5)) {
        try {
          const refResponse = await fetch(result.imageUrl);
          if (refResponse.ok) {
            const buffer = Buffer.from(await refResponse.arrayBuffer());
            const mimeType = refResponse.headers.get("content-type") || "image/jpeg";
            referenceBase64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
            console.log(`✓ Loaded reference from: ${result.title || result.imageUrl.substring(0, 50)}...`);
            
            // Save reference for debug
            await fsPromises.writeFile("/tmp/debug_kontext_test_reference.jpg", buffer);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!referenceBase64) {
        return res.status(500).json({ error: "Could not load any reference images" });
      }

      // Run Kontext Stage 1 only
      console.log(`\n━━━ KONTEXT STAGE 1 (Test Mode) ━━━`);
      
      if (!BFL_API_KEY) {
        return res.status(500).json({ error: "BFL_API_KEY not configured" });
      }

      // Normalize user photo
      const normalizedPhotoUrl = await normalizeImageOrientation(userPhotoBase64);
      
      // Get dimensions
      let outputWidth = 1024;
      let outputHeight = 1024;
      const inputDims = await getImageDimensions(normalizedPhotoUrl);
      if (inputDims) {
        const fluxDims = calculateFluxDimensions(inputDims.width, inputDims.height);
        outputWidth = fluxDims.width;
        outputHeight = fluxDims.height;
      }
      console.log(`📐 Output dimensions: ${outputWidth}×${outputHeight}`);

      // Build prompt
      const kontextPrompt = buildGenerationPrompt(
        GENERATION_CONFIG.KONTEXT_STAGE1_PROMPT,
        prompt,
        userRace,
        userGender
      );
      console.log(`📝 Full prompt: ${kontextPrompt}`);

      // Submit to Kontext (single image: reference only)
      const kontextRequestBody = {
        prompt: kontextPrompt,
        input_image: referenceBase64,       // Only the reference hairstyle image
        width: outputWidth,
        height: outputHeight,
        guidance: GENERATION_CONFIG.KONTEXT_STAGE1_GUIDANCE,
        safety_tolerance: 0,
        prompt_upsampling: false,
      };

      console.log(`📦 Request keys: ${Object.keys(kontextRequestBody).join(", ")}`);
      console.log(`  📤 input_image (reference only): ${referenceBase64.length} chars`);

      const submitResponse = await fetch(BFL_KONTEXT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-key": BFL_API_KEY!,
        },
        body: JSON.stringify(kontextRequestBody),
      });

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        console.error(`[KONTEXT TEST] Submit error: ${submitResponse.status} - ${errorText}`);
        return res.status(500).json({ error: `Kontext submit failed: ${errorText}` });
      }

      const submitData = await submitResponse.json();
      console.log(`🎫 Submission ID: ${submitData.id}`);

      const pollingUrl = submitData.polling_url;
      if (!pollingUrl) {
        return res.status(500).json({ error: "No polling URL returned" });
      }

      // Poll for result
      let resultUrl: string | null = null;
      const startTime = Date.now();
      let lastLogTime = 0;

      for (let attempts = 0; attempts < 300; attempts++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pollResponse = await fetch(pollingUrl, {
          headers: { "x-key": BFL_API_KEY! },
        });

        if (!pollResponse.ok) continue;

        const result = await pollResponse.json();
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        
        if (elapsed - lastLogTime >= 10) {
          console.log(`   ⏳ Generating... ${elapsed}s (${result.status})`);
          lastLogTime = elapsed;
        }

        if (result.status === "Ready" || result.status === "succeeded") {
          resultUrl = result.result?.sample || null;
          if (resultUrl) {
            console.log(`   ✓ Complete! (${elapsed}s)`);
            break;
          }
        } else if (result.status === "Error" || result.status === "Failed" || result.status === "Content Moderated") {
          console.error(`   ✗ Failed: ${result.status}`);
          return res.status(500).json({ error: `Generation failed: ${result.status}` });
        }
      }

      if (!resultUrl) {
        generationMetrics.timeouts++;
        return res.status(504).json({ 
          error: "GENERATION_TIMEOUT", 
          message: "Generation took too long. Please try again.",
          isTimeout: true 
        });
      }

      // Save result
      const imageResponse = await fetch(resultUrl);
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      await fsPromises.writeFile("/tmp/debug_kontext_stage1_result.jpg", imageBuffer);
      console.log(`✓ Saved result to /tmp/debug_kontext_stage1_result.jpg`);
      console.log(`============================================================\n`);

      res.json({ 
        success: true, 
        message: "Kontext Stage 1 complete. View result at /debug-partner",
        resultUrl,
        prompt: kontextPrompt 
      });

    } catch (error: any) {
      console.error("[KONTEXT TEST] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Test endpoint: Run createHairOnlyImage on user photo (same as reference pipeline)
  // This isolates whether BiSeNet works on user photo when using reference path
  app.get("/api/debug/user-as-reference", async (req, res) => {
    try {
      const fsPromises = await import("fs/promises");
      const userImageBuffer = await fsPromises.readFile("/tmp/debug_user_image.jpg");
      const userBase64 = `data:image/jpeg;base64,${userImageBuffer.toString('base64')}`;
      
      // Run the SAME function used for reference images
      const { createHairOnlyImage } = await import("./imageProcessing");
      const result = await createHairOnlyImage(userBase64);
      
      if (!result) {
        return res.status(500).json({ error: "createHairOnlyImage failed on user photo" });
      }
      
      // Return as image
      const base64Data = result.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch (error: any) {
      console.error("Debug user-as-reference failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Debug: Get cached preprocessed mask (from validation)
  app.get("/api/debug/preprocess-mask", async (req, res) => {
    try {
      // Return the first cached preprocess mask (most recent)
      const entries = Array.from(preprocessCache.entries());
      if (entries.length === 0) {
        return res.status(404).json({ error: "No cached preprocess mask available" });
      }
      
      // Get the most recent entry
      const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const [cacheKey, cached] = sorted[0];
      
      if (!cached.maskedImage) {
        return res.status(404).json({ error: "Cached entry has no mask image" });
      }
      
      const base64Data = cached.maskedImage.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");
      res.send(imageBuffer);
    } catch (error: any) {
      console.error("Debug preprocess-mask failed:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Debug: Get preprocess cache status
  app.get("/api/debug/preprocess-status", async (req, res) => {
    const entries = Array.from(preprocessCache.entries());
    const status = entries.map(([key, value]) => ({
      cacheKey: key.substring(0, 50) + (key.length > 50 ? '...' : ''),
      hasMask: !!value.maskedImage,
      maskLength: value.maskedImage?.length || 0,
      userAnalysis: value.userAnalysis,
      timestamp: new Date(value.timestamp).toISOString(),
      ageSeconds: Math.round((Date.now() - value.timestamp) / 1000)
    }));
    res.json({ entries: status, count: entries.length });
  });
  
  // Debug: Validation overview page showing mask created during validation
  app.get("/api/debug/validation", async (req, res) => {
    const entries = Array.from(preprocessCache.entries());
    const latestEntry = entries.length > 0 
      ? entries.sort((a, b) => b[1].timestamp - a[1].timestamp)[0]
      : null;
    
    const analysis = latestEntry?.[1]?.userAnalysis;
    const timestamp = latestEntry?.[1]?.timestamp 
      ? new Date(latestEntry[1].timestamp).toLocaleString()
      : 'N/A';
    const ageSeconds = latestEntry?.[1]?.timestamp 
      ? Math.round((Date.now() - latestEntry[1].timestamp) / 1000)
      : 0;
    
    const statusClass = entries.length > 0 ? 'ready' : 'empty';
    const statusText = entries.length > 0 ? entries.length + ' cached entry(s)' : 'No cached data - upload a photo first';
    
    const analysisHtml = analysis ? `
      <div class="analysis">
        <h3>Detected Features</h3>
        <p><span class="label">Race/Ethnicity:</span> <span class="value">${analysis.raceEthnicity || 'N/A'}</span></p>
        <p><span class="label">Gender:</span> <span class="value">${analysis.gender || 'N/A'}</span></p>
        <p><span class="label">Skin Tone:</span> <span class="value">${analysis.skinTone || 'N/A'}</span></p>
        <p><span class="label">Face Shape:</span> <span class="value">${analysis.faceShape || 'N/A'}</span></p>
        <p><span class="label">Face Angle:</span> <span class="value">${analysis.faceAngle || 'N/A'}</span></p>
        <p><span class="label">Current Hairstyle:</span> <span class="value">${analysis.currentHairstyle || 'N/A'}</span></p>
      </div>
    ` : `
      <div class="analysis">
        <p style="color: #888;">No analysis available - upload a valid photo first</p>
      </div>
    `;
    
    const debugStage2Backend = resolveKontextStage2Backend(GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND);
    const { template: debugStage2PromptTemplate } = getKontextStage2PromptTemplateForBackend(debugStage2Backend);
    const stage2DebugPrompt = buildKontextStage2PromptForBackend(debugStage2PromptTemplate, debugStage2Backend);

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Debug: Photo Validation & Preprocessing</title>
        <style>
          body { font-family: Arial; background: #0f0f1a; color: white; padding: 20px; margin: 0; }
          h1 { color: #4ecdc4; margin-bottom: 20px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1200px; }
          .card { background: #1a1a2e; padding: 20px; border-radius: 12px; }
          .card h2 { margin-top: 0; color: #eee; font-size: 18px; }
          .card img { width: 100%; max-height: 500px; object-fit: contain; border-radius: 8px; background: #111; }
          .analysis { background: #16213e; padding: 15px; border-radius: 8px; margin-top: 15px; }
          .analysis h3 { margin: 0 0 10px 0; color: #4ecdc4; }
          .analysis p { margin: 5px 0; font-size: 14px; }
          .label { color: #888; }
          .value { color: #4ecdc4; font-weight: bold; }
          .status { padding: 8px 16px; border-radius: 6px; display: inline-block; margin-bottom: 15px; }
          .status.ready { background: #27ae60; }
          .status.empty { background: #c0392b; }
          .refresh-btn { background: #4ecdc4; color: #0f0f1a; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 15px; }
          .refresh-btn:hover { background: #45b7aa; }
          .timestamp { color: #666; font-size: 12px; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h1>Photo Validation & Preprocessing Debug</h1>
        
        <div class="status ${statusClass}">
          ${entries.length > 0 ? '&#10003;' : '&#10007;'} ${statusText}
        </div>
        
        <div class="grid">
          <div class="card">
            <h2>User Mask (Hair Grayed Out)</h2>
            <img src="/api/debug/preprocess-mask?t=${Date.now()}" onerror="this.alt='No mask available - upload a valid photo first'" />
            <p class="timestamp">Created: ${timestamp} (${ageSeconds}s ago)</p>
          </div>
          
          <div class="card">
            <h2>Vision Analysis</h2>
            ${analysisHtml}
          </div>
        </div>
        
        <button class="refresh-btn" onclick="location.reload()">Refresh</button>
        <p style="color: #666; font-size: 13px; margin-top: 20px;">
          Upload a photo on the main page, then refresh this debug page to see the mask and analysis.
        </p>
      </body>
      </html>
    `);
  });

  // Visual overview page showing all debug images
  app.get("/api/debug/overview", async (req, res) => {
    // Prevent caching so we always see fresh debug images
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const fsPromises = await import("fs/promises");
    const requestedIndex = getRequestedDebugIndex(req);
    let tmpFilesForOverview: string[] = [];
    try {
      tmpFilesForOverview = await fsPromises.readdir("/tmp");
    } catch {
      tmpFilesForOverview = [];
    }

    const availableIndexSet = new Set<number>();
    const latestIndexMtime = new Map<number, number>();
    const latestResultIndexMtime = new Map<number, number>();
    for (const file of tmpFilesForOverview) {
      const match = file.match(
        /^(?:debug_flux_stage2_result|debug_reference_full|debug_gpt_ref_input|debug_stage2_klein_reference_mask|debug_stage1_kontext_fusion_result|debug_stage1_gpt_fusion_result|debug_kontext_stage1_result|debug_kontext_stage1_hair_face_mask|debug_stage2_user_face_neck_mask|debug_stage2_user_hair_color_mask)_(\d+)\.(?:jpg|jpeg|png|webp|json)$/i
      );
      if (!match) continue;
      const idx = Number.parseInt(match[1], 10);
      if (Number.isFinite(idx) && idx > 0) {
        availableIndexSet.add(idx);
        try {
          const stat = await fsPromises.stat(`/tmp/${file}`);
          const prev = latestIndexMtime.get(idx) || 0;
          if (stat.mtimeMs > prev) {
            latestIndexMtime.set(idx, stat.mtimeMs);
          }
          if (/^debug_flux_stage2_result_\d+\.(?:jpg|jpeg|png|webp)$/i.test(file)) {
            const prevResult = latestResultIndexMtime.get(idx) || 0;
            if (stat.mtimeMs > prevResult) {
              latestResultIndexMtime.set(idx, stat.mtimeMs);
            }
          }
        } catch {
          // Ignore stat errors and keep index entry.
        }
      }
    }
    const availableIndexes = Array.from(availableIndexSet).sort((a, b) => a - b);
    const latestResultIndexByTime = Array.from(latestResultIndexMtime.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const latestDebugIndexByTime = Array.from(latestIndexMtime.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const selectedDebugIndex = requestedIndex || latestResultIndexByTime || latestDebugIndexByTime || (availableIndexes.length > 0 ? availableIndexes[availableIndexes.length - 1] : null);
    const selectedIndexQuery = selectedDebugIndex ? `index=${selectedDebugIndex}&` : "";

    const hasSelectedKleinReferenceMask = selectedDebugIndex
      ? [
          `/tmp/debug_stage2_klein_reference_mask_${selectedDebugIndex}.png`,
          `/tmp/debug_stage2_klein_reference_mask_${selectedDebugIndex}.jpg`,
          `/tmp/debug_stage2_klein_reference_mask_${selectedDebugIndex}.jpeg`,
        ].some((candidate) => tmpFilesForOverview.includes(candidate.split("/tmp/")[1]))
      : false;
    const hasSelectedTwoStageArtifacts = selectedDebugIndex
      ? (
          tmpFilesForOverview.includes(`debug_kontext_stage1_hair_face_mask_${selectedDebugIndex}.png`) ||
          tmpFilesForOverview.includes(`debug_kontext_stage1_result_${selectedDebugIndex}.jpg`)
        )
      : false;
    const selectedGenerationMode: "single_stage_klein" | "two_stage_refined" =
      hasSelectedKleinReferenceMask && !hasSelectedTwoStageArtifacts
        ? "single_stage_klein"
        : "two_stage_refined";

    let stage1Metadata: { prompt?: string; inputLabel?: string; inputLength?: number; inputPreview?: string; provider?: string; generatedAt?: string } = {};
    try {
      const metadataPath = selectedDebugIndex
        ? `/tmp/debug_kontext_stage1_metadata_${selectedDebugIndex}.json`
        : "/tmp/debug_kontext_stage1_metadata.json";
      const rawStage1Meta = await fsPromises.readFile(metadataPath, "utf8");
      stage1Metadata = JSON.parse(rawStage1Meta);
    } catch {
      try {
        const rawStage1Meta = await fsPromises.readFile("/tmp/debug_kontext_stage1_metadata.json", "utf8");
        stage1Metadata = JSON.parse(rawStage1Meta);
      } catch {
        stage1Metadata = {};
      }
    }
    
    const overviewStage2Backend = resolveKontextStage2Backend(GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND);
    const isKleinBackend = selectedGenerationMode === "single_stage_klein";
    const { template: overviewStage2PromptTemplate } = getKontextStage2PromptTemplateForBackend(overviewStage2Backend);
    const stage2DebugPrompt = isKleinBackend
      ? KLEIN_SINGLE_STAGE_REFERENCE_PROMPT
      : buildKontextStage2PromptForBackend(
          overviewStage2PromptTemplate,
          overviewStage2Backend
        );
    const stage2BackendSummary = isKleinBackend
      ? "FLUX 2 Klein single-stage with 3 image inputs"
      : "Kontext Refined two-stage with 3 image inputs to FLUX 2 Klein";
    const stage2BackendLabel = isKleinBackend ? "FLUX 2 Klein (Single-Stage)" : "Kontext Refined (Two-Stage)";

    // Find Kontext result masks in /tmp (kontext stage 1 hair-only masks)
    const kontextMasks: { file: string; mtime: Date }[] = [];
    try {
      const files = tmpFilesForOverview;
      for (const file of files) {
        const selectedFile = selectedDebugIndex
          ? `debug_kontext_stage1_hair_face_mask_${selectedDebugIndex}.png`
          : "debug_kontext_stage1_hair_face_mask.png";
        if (file === selectedFile || (!selectedDebugIndex && file === "debug_kontext_stage1_hair_face_mask.png")) {
          const stat = await fsPromises.stat(`/tmp/${file}`);
          kontextMasks.push({ file, mtime: stat.mtime });
        }
      }
    } catch (e) {
      // Ignore errors
    }
    
    // Build HTML for kontext result masks
    let kontextMasksHtml = '';
    if (kontextMasks.length === 0) {
      kontextMasksHtml = `
        <div class="step sent">
          <h3 style="color: #ff6b6b;">No Kontext masks yet</h3>
          <p>Run a generation to see Kontext result masks here</p>
        </div>
      `;
    } else {
      for (const mask of kontextMasks) {
        const timeAgo = Math.round((Date.now() - mask.mtime.getTime()) / 1000);
        kontextMasksHtml += `
          <div class="step sent">
            <h3 style="color: #ff6b6b;">Kontext Result Mask</h3>
            <img src="/api/debug/kontext-stage1-hair-face-mask?t=${Date.now()}" onerror="this.alt='Not available'" />
            <p class="timestamp" style="color: #888; font-size: 10px;">${timeAgo}s ago</p>
            <p>Hair-only mask from GPT/Kontext Stage 1<br>(sent to ${stage2BackendLabel} as input_image_${isKleinBackend ? "2" : "4"})</p>
          </div>
        `;
      }
    }

    const gptReferenceFusionCardsHtml = `
      <div class="grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="step sent">
          <h3 style="color: #4ecdc4;">Image 1 (Reference)</h3>
          <img src="${selectedDebugIndex ? `/api/debug/reference-full/${selectedDebugIndex}` : "/api/debug/gpt-ref-input/1"}?t=${Date.now()}" onerror="this.alt='Not available yet'" onload="document.getElementById('gr1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
          <p class="dims" id="gr1" style="color: #4ecdc4;">-</p>
          <p>Reference image for selected generation.</p>
        </div>
        <div class="step sent">
          <h3 style="color: #ff9f43;">Kontext Stage 1 Output (Used)</h3>
          <img id="stage1-kontext-result-img" src="/api/debug/stage1-kontext-result?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available yet'" onload="document.getElementById('gr6').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
          <p class="dims" id="gr6" style="color: #ff9f43;">-</p>
          <p>Used for generation pipeline.</p>
        </div>
        <div class="step sent">
          <h3 style="color: #a29bfe;">GPT Stage 1 Output (Compare)</h3>
          <img id="stage1-gpt-result-img" src="/api/debug/stage1-gpt-result?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available yet'" onload="document.getElementById('gr7').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
          <p class="dims" id="gr7" style="color: #a29bfe;">-</p>
          <p>Primary Stage 1 source for generation (Kontext is fallback).</p>
        </div>
      </div>
    `;

    const userInputCardsHtml = isKleinBackend
      ? `
          <div class="grid" style="grid-template-columns: repeat(3, 1fr);">
            <div class="step sent">
              <h3 style="color: #4ecdc4;">1. input_image</h3>
              <img src="/api/debug/user-image?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('d1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
              <p class="dims" id="d1" style="color: #4ecdc4;">-</p>
              <p>Full user photo (base/background source)</p>
            </div>
            <div class="step sent">
              <h3 style="color: #9b59b6;">2. input_image_2</h3>
              <img src="/api/debug/stage2-reference-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('d2').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
              <p class="dims" id="d2" style="color: #9b59b6;">-</p>
              <p>Reference mannequin hair guidance mask</p>
            </div>
            <div class="step sent">
              <h3 style="color: #55efc4;">3. input_image_3</h3>
              <img src="/api/debug/stage2-face-neck-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('d3').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
              <p class="dims" id="d3" style="color: #55efc4;">-</p>
              <p>User face mask (identity lock)</p>
            </div>
          </div>
        `
      : `
          <div class="grid" style="grid-template-columns: repeat(4, 1fr);">
            <div class="step sent">
              <h3 style="color: #4ecdc4;">1. input_image</h3>
              <img src="/api/debug/user-image?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('d1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
              <p class="dims" id="d1" style="color: #4ecdc4;">-</p>
              <p>Full user photo (base/background source)</p>
            </div>
            <div class="step sent">
              <h3 style="color: #9b59b6;">2. input_image_2</h3>
              <img src="/api/debug/stage2-face-neck-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('d2').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
              <p class="dims" id="d2" style="color: #9b59b6;">-</p>
              <p>User face+neck mask (identity lock)</p>
            </div>
            <div class="step sent">
              <h3 style="color: #55efc4;">3. input_image_3</h3>
              <img src="/api/debug/stage2-user-hair-color-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('d3').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
              <p class="dims" id="d3" style="color: #55efc4;">-</p>
              <p>User hair color mask (editable hair)</p>
            </div>
            <div class="step sent">
              <h3 style="color: #fd79a8;">4. input_image_4</h3>
              <img src="/api/debug/kontext-stage1-hair-face-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('d4').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
              <p class="dims" id="d4" style="color: #fd79a8;">-</p>
              <p>GPT/Kontext Stage 1 hair-only mask</p>
            </div>
          </div>
        `;
    const stage2InputCardsHtml = isKleinBackend
      ? `
            <h3 style="color: #00cec9; margin: 30px 0 10px;">Stage 2 INPUTS (what FLUX 2 Klein receives)</h3>
            <div class="grid" style="grid-template-columns: repeat(3, 1fr);">
              <div class="step sent">
                <h3 style="color: #4ecdc4;">input_image (Full User Photo)</h3>
                <img id="stage2-full-user-img" src="/api/debug/user-image?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('ds1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="ds1" style="color: #4ecdc4;">-</p>
                <p>Image 1: full user photo (base/background source)</p>
              </div>
              <div class="step sent">
                <h3 style="color: #9b59b6;">input_image_2 (Reference Mannequin Hair Mask)</h3>
                <img id="stage2-gpt-hair-only-img" src="/api/debug/stage2-reference-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('ds2').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="ds2" style="color: #9b59b6;">-</p>
                <p>Image 2: Stage 1-derived mannequin hair guidance mask</p>
              </div>
              <div class="step sent">
                <h3 style="color: #55efc4;">input_image_3 (User Face Mask)</h3>
                <img id="stage2-face-mask-img" src="/api/debug/stage2-face-neck-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('ds3').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="ds3" style="color: #55efc4;">-</p>
                <p>Image 3: user face mask (identity lock)</p>
              </div>
            </div>
          `
      : `
            <h3 style="color: #00cec9; margin: 30px 0 10px;">Stage 2 INPUTS (what FLUX 2 Pro receives)</h3>
            <div class="grid" style="grid-template-columns: repeat(4, 1fr);">
              <div class="step sent">
                <h3 style="color: #4ecdc4;">input_image (Full User Photo)</h3>
                <img id="stage2-full-user-img" src="/api/debug/user-image?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('ds1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="ds1" style="color: #4ecdc4;">-</p>
                <p>Image 1: full user photo (base/background source)</p>
              </div>
              <div class="step sent">
                <h3 style="color: #fd79a8;">input_image_2 (User Face+Neck Mask)</h3>
                <img id="stage2-face-neck-img" src="/api/debug/stage2-face-neck-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('ds2').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="ds2" style="color: #fd79a8;">-</p>
                <p>Image 2: user face+neck mask (identity lock)</p>
              </div>
              <div class="step sent">
                <h3 style="color: #55efc4;">input_image_3 (User Hair Color Mask)</h3>
                <img id="stage2-user-hair-color-img" src="/api/debug/stage2-user-hair-color-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('ds3').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="ds3" style="color: #55efc4;">-</p>
                <p>Image 3: user hair color mask (hair editable, non-hair gray)</p>
              </div>
              <div class="step sent">
                <h3 style="color: #74b9ff;">input_image_4 (GPT/Kontext Hair-Only)</h3>
                <img id="stage2-gpt-hair-only-img" src="/api/debug/kontext-stage1-hair-face-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('ds4').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="ds4" style="color: #74b9ff;">-</p>
                <p>Image 4: hairstyle source from Stage 1</p>
              </div>
            </div>
          `;
    const stage2OutputCardsHtml = isKleinBackend
      ? `
          <h3 style="color: #27ae60; margin: 30px 0 10px;">Stage 2 OUTPUTS (comparison view)</h3>
          <div class="grid" style="grid-template-columns: repeat(2, 1fr);">
            <div class="step sent" style="border-color: #74b9ff;">
              <h3 style="color: #74b9ff; font-size: 16px;">Original Input (Image 1)</h3>
              <img src="/api/debug/user-image?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='No input image'" onload="document.getElementById('dout1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
              <p class="dims" id="dout1" style="color: #74b9ff;">-</p>
              <p>Active backend input 1 reference.</p>
            </div>
            <div class="step sent" style="border-color: #27ae60;">
              <h3 style="color: #27ae60; font-size: 16px;">Stage 2 Result (Returned to App)</h3>
              <img id="flux-result-img" src="/api/debug/flux-stage2-result?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Run generation first'" onload="document.getElementById('df1').textContent = this.naturalWidth + 'x' + this.naturalHeight" style="max-height: 400px;"/>
              <p class="dims" id="df1" style="color: #27ae60;">-</p>
              <p>This image is the final Stage 2 output returned to the app.</p>
            </div>
          </div>
        `
      : `
          <h3 style="color: #27ae60; margin: 30px 0 10px;">Stage 2 OUTPUTS (comparison view)</h3>
          <div class="grid" style="grid-template-columns: repeat(2, 1fr);">
            <div class="step sent" style="border-color: #27ae60;">
              <h3 style="color: #27ae60; font-size: 16px;">Stage 2 Result (Returned to App)</h3>
              <img id="flux-result-img" src="/api/debug/flux-stage2-result?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Run generation first'" onload="document.getElementById('df1').textContent = this.naturalWidth + 'x' + this.naturalHeight" style="max-height: 400px;"/>
              <p class="dims" id="df1" style="color: #27ae60;">-</p>
              <p>This image is the final Stage 2 output returned to the app for the active backend.</p>
            </div>
            <div class="step sent" style="border-color: #f39c12;">
              <h3 style="color: #f39c12; font-size: 16px;">FLUX Fill Comparison (Debug Only)</h3>
              <img id="flux-fill-result-img" src="/api/debug/flux-fill-stage2-result?t=${Date.now()}" onerror="this.alt='No comparison image yet'" onload="document.getElementById('df2').textContent = this.naturalWidth + 'x' + this.naturalHeight" style="max-height: 400px;"/>
              <p class="dims" id="df2" style="color: #f39c12;">-</p>
              <p>Run in parallel for quality comparison. Not returned to app.</p>
            </div>
          </div>
        `;

    const generationPickerHtml = availableIndexes.length > 0
      ? `
          <div style="margin: 16px 0 8px;">
            <h3 style="color:#4ecdc4; margin: 0 0 8px 0;">Generation Selector</h3>
            <p style="margin: 0 0 10px 0; color:#9aa0b5;">Showing generation <strong>#${selectedDebugIndex ?? availableIndexes[availableIndexes.length - 1]}</strong>.</p>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${availableIndexes.map((idx) => {
                const active = idx === selectedDebugIndex;
                return `<a href="/api/debug/overview?index=${idx}" style="text-decoration:none; padding:6px 10px; border-radius:6px; border:1px solid ${active ? '#4ecdc4' : '#3a3f55'}; color:${active ? '#0f0f1a' : '#c8d0ea'}; background:${active ? '#4ecdc4' : '#1a1a2e'}; font-size:12px;">#${idx}</a>`;
              }).join("")}
            </div>
          </div>
        `
      : `
          <div style="margin: 16px 0 8px; color:#9aa0b5;">No indexed generations yet. Run a generation first.</div>
        `;

    const allGenerationCardsHtml = availableIndexes.length > 0
      ? availableIndexes
          .slice()
          .reverse()
          .map((idx) => {
            const singleStage = (
              tmpFilesForOverview.includes(`debug_stage2_klein_reference_mask_${idx}.png`) ||
              tmpFilesForOverview.includes(`debug_stage2_klein_reference_mask_${idx}.jpg`) ||
              tmpFilesForOverview.includes(`debug_stage2_klein_reference_mask_${idx}.jpeg`)
            ) && !tmpFilesForOverview.includes(`debug_kontext_stage1_hair_face_mask_${idx}.png`);

            const modeLabel = singleStage
              ? "Single-stage Klein"
              : "Two-stage refined";

            const secondInputCard = singleStage
              ? `
                  <div class="step sent">
                    <h3 style="color: #9b59b6;">input_image_2</h3>
                    <img src="/api/debug/stage2-reference-mask?index=${idx}&t=${Date.now()}" onerror="this.alt='Not available'"/>
                    <p>Reference mannequin mask</p>
                  </div>
                  <div class="step sent">
                    <h3 style="color: #55efc4;">input_image_3</h3>
                    <img src="/api/debug/stage2-face-neck-mask?index=${idx}&t=${Date.now()}" onerror="this.alt='Not available'"/>
                    <p>User face mask</p>
                  </div>
                `
              : `
                  <div class="step sent">
                    <h3 style="color: #9b59b6;">input_image_2</h3>
                    <img src="/api/debug/stage2-face-neck-mask?index=${idx}&t=${Date.now()}" onerror="this.alt='Not available'"/>
                    <p>User face+neck mask</p>
                  </div>
                  <div class="step sent">
                    <h3 style="color: #fd79a8;">input_image_3</h3>
                    <img src="/api/debug/kontext-stage1-hair-face-mask?index=${idx}&t=${Date.now()}" onerror="this.alt='Not available'"/>
                    <p>Stage 1 result mask</p>
                  </div>
                `;

            return `
              <div style="border:1px solid #2e3447; border-radius:10px; padding:12px; margin-bottom:14px; background:#14192a;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                  <h3 style="margin:0; color:#e7ecff;">Generation #${idx}</h3>
                  <span style="font-size:11px; color:#8bd3dd; border:1px solid #2f5460; padding:2px 8px; border-radius:999px;">${modeLabel}</span>
                </div>
                <div class="grid" style="grid-template-columns: repeat(4, 1fr);">
                  <div class="step sent">
                    <h3 style="color: #4ecdc4;">input_image</h3>
                    <img src="/api/debug/user-image?index=${idx}&t=${Date.now()}" onerror="this.alt='Not available'"/>
                    <p>Full user photo</p>
                  </div>
                  ${secondInputCard}
                  <div class="step sent">
                    <h3 style="color: #a29bfe;">Reference</h3>
                    <img src="/api/debug/reference-full/${idx}?t=${Date.now()}" onerror="this.alt='Not available'"/>
                    <p>Reference used for this generation</p>
                  </div>
                  <div class="step sent">
                    <h3 style="color: #27ae60;">Result</h3>
                    <img src="/api/debug/flux-stage2-result?index=${idx}&t=${Date.now()}" onerror="this.alt='Not available'"/>
                    <p>Final generated output</p>
                  </div>
                </div>
              </div>
            `;
          })
          .join("")
      : "";
    
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Debug: ${stage2BackendLabel} Pipeline</title>
        <style>
          body { font-family: Arial; background: #0f0f1a; color: white; padding: 20px; margin: 0; }
          h1, h2 { color: #eee; margin-bottom: 10px; }
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
          .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
          .step { background: #1a1a2e; padding: 12px; border-radius: 8px; text-align: center; }
          .step img { width: 100%; max-height: 300px; object-fit: contain; border-radius: 6px; background: #111; }
          .step h3 { margin: 0 0 5px 0; font-size: 14px; }
          .step p { margin: 8px 0 0 0; font-size: 11px; color: #888; line-height: 1.3; }
          .dims { font-size: 11px; margin-top: 5px; font-weight: bold; }
          .explanation { background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
          .explanation h2 { margin-top: 0; color: #4ecdc4; }
          code { background: #0f0f1a; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
          .prompt-box { background: #1a1a2e; padding: 10px; border-radius: 6px; margin-top: 10px; font-family: monospace; font-size: 12px; color: #4ecdc4; }
          .section { margin-top: 25px; }
          .section-title { color: #4ecdc4; border-bottom: 2px solid #4ecdc4; padding-bottom: 8px; margin-bottom: 15px; }
          .section-title.not-sent { color: #666; border-bottom-color: #666; }
          .sent-badge { background: #27ae60; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 8px; }
          .not-sent-badge { background: #666; color: #ccc; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 8px; }
          .step.not-sent { opacity: 0.6; border: 2px dashed #666; }
          .step.sent { border: 2px solid #27ae60; }
          .ref-count { background: #ff6b6b; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-left: 8px; }
          .refresh-btn { background: #4ecdc4; color: #0f0f1a; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; }
          .refresh-btn:hover { background: #45b7aa; }
          @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } .grid-4 { grid-template-columns: repeat(2, 1fr); } }
        </style>
      </head>
      <body>
      <h1>Debug: ${stage2BackendLabel} Pipeline</h1>
        
        <div class="explanation">
          <h2>Pipeline Overview</h2>
          ${GENERATION_CONFIG.KONTEXT_STAGE1_ONLY
            ? "<p>Stage 2 is currently disabled. Running <strong>Stage 1 only</strong>.</p>"
            : `<p>Active Stage 2 backend uses <strong>${stage2BackendSummary}</strong> for controlled hair transfer:</p>`
          }
          <div class="prompt-box">
            <strong>Stage 1 Prompt:</strong> ${JSON.stringify(stage1Metadata.prompt || "No Stage 1 prompt yet.")}
          </div>
          <div class="prompt-box" style="margin-top: 10px;">
            <strong>Stage 1 Input:</strong> ${stage1Metadata.inputLabel || "No Stage 1 input yet."} (${stage1Metadata.inputLength || 0} chars)<br/>
            <strong>Input Preview:</strong> ${stage1Metadata.inputPreview || "No preview"}
          </div>
          <div class="prompt-box">
            <strong>Prompt:</strong> "${stage2DebugPrompt}"
          </div>
          ${generationPickerHtml}
        </div>

        <div class="section">
          <h2 class="section-title" style="color:#8bd3dd; border-bottom-color:#8bd3dd;">Per-Generation Inputs</h2>
          <p style="color:#8f95ac; margin-bottom: 12px;">Indexed debug inputs/outputs for each generation run.</p>
          ${allGenerationCardsHtml || '<p style="color:#8f95ac;">No indexed generations available yet.</p>'}
        </div>

        <div class="section">
          <h2 class="section-title" style="color: #74b9ff; border-bottom-color: #74b9ff;">STAGE 1 GPT (DEBUG)</h2>
          <p style="color: #888; margin-bottom: 15px;">Reference-only Stage 1: GPT receives only image 1 (reference). GPT output is used for generations.</p>
          ${gptReferenceFusionCardsHtml}
        </div>

        <div class="section">
          <h2 class="section-title">USER INPUTS <span class="sent-badge">SENT</span></h2>
          ${userInputCardsHtml}
        </div>

        <div class="section">
          <h2 class="section-title">STAGE 1 RESULT MASKS <span class="ref-count">${kontextMasks.length > 0 ? '1' : '0'}</span></h2>
          <p style="color: #888; margin-bottom: 15px;">Hair-only mask extracted from Stage 1 GPT result (sent to ${stage2BackendLabel} as input_image_${isKleinBackend ? "2" : "4"}).</p>
          <div class="grid-4">
            ${kontextMasksHtml}
          </div>
        </div>

        <div class="section">
          <h2 class="section-title" style="color: #ff9f43; border-bottom-color: #ff9f43;">${isKleinBackend ? "ACTIVE PIPELINE (GPT Stage 1 + FLUX 2 Klein)" : "KONTEXT REFINED (Two-Stage Pipeline)"}</h2>
          <p style="color: #888; margin-bottom: 15px;">${isKleinBackend
            ? "Stage 1: GPT receives only image 1 (reference). Stage 2: FLUX 2 Klein runs with image 1 (full user photo) + image 2 (reference mannequin mask) + image 3 (face mask)."
            : `Stage 1: GPT/Kontext generates hairstyle. Stage 2: ${stage2BackendLabel} applies that hairstyle while only editing masked hair.`}</p>
          
          ${isKleinBackend ? `
            <h3 style="color: #74b9ff; margin: 20px 0 10px;">Stage 1 INPUTS</h3>
            <p style="color: #888; margin-bottom: 12px;">See the <strong>STAGE 1 GPT (DEBUG)</strong> section above for exact Stage 1 input_image used by GPT.</p>
            <h3 style="color: #ff9f43; margin: 30px 0 10px;">Stage 1 OUTPUT</h3>
            <div class="grid" style="grid-template-columns: repeat(2, 1fr);">
              <div class="step sent">
                <h3 style="color: #ff9f43;">GPT Stage 1 Output</h3>
                <img id="kontext-result-img" src="/api/debug/stage1-gpt-result?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available yet'" onload="document.getElementById('dk1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="dk1" style="color: #ff9f43;">-</p>
                <p>Output of GPT Stage 1 (used to build Stage 2 reference mask).</p>
              </div>
              <div class="step sent">
                <h3 style="color: #fd79a8;">Stage 2 Reference Mask Source</h3>
                <img id="hair-face-mask-img" src="/api/debug/stage2-reference-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Run generation first'" onload="document.getElementById('dk3').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="dk3" style="color: #fd79a8;">-</p>
                <p>Final guidance mask sent to FLUX 2 Klein as input_image_2.</p>
              </div>
            </div>
          ` : `
            <h3 style="color: #74b9ff; margin: 20px 0 10px;">Stage 1 INPUTS (what was sent to Kontext)</h3>
            <div class="grid" style="grid-template-columns: repeat(2, 1fr);">
              <div class="step sent">
                <h3 style="color: #74b9ff;">input_image (User Photo)</h3>
                <img src="/api/debug/kontext-stage1-input-user?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available yet'" onload="document.getElementById('dku1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="dku1" style="color: #74b9ff;">-</p>
                <p>User photo sent to Kontext<br><strong>Should be UNMASKED</strong></p>
              </div>
              <div class="step sent">
                <h3 style="color: #a29bfe;">input_image_2 (Reference)</h3>
                <img src="/api/debug/kontext-stage1-input-ref?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available yet'" onload="document.getElementById('dku2').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="dku2" style="color: #a29bfe;">-</p>
                <p>Reference sent to Kontext<br><strong>Should be UNMASKED</strong></p>
              </div>
            </div>
            <h3 style="color: #ff9f43; margin: 30px 0 10px;">Stage 1 OUTPUT</h3>
            <div class="grid" style="grid-template-columns: repeat(2, 1fr);">
              <div class="step sent">
                <h3 style="color: #ff9f43;">Stage 1 Result (GPT/Kontext)</h3>
                <img id="kontext-result-img" src="/api/debug/kontext-stage1-result?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Not available - run kontext_refined first'" onload="document.getElementById('dk1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="dk1" style="color: #ff9f43;">-</p>
                <p>Initial generation from Kontext Pro<br>(unmasked user + unmasked ref)</p>
              </div>
              <div class="step sent">
                <h3 style="color: #fd79a8;">Stage 1 Hair-Only Mask</h3>
                <img id="hair-face-mask-img" src="/api/debug/kontext-stage1-hair-face-mask?${selectedIndexQuery}t=${Date.now()}" onerror="this.alt='Run generation first'" onload="document.getElementById('dk3').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
                <p class="dims" id="dk3" style="color: #fd79a8;">-</p>
                <p>Extracted from Stage 1 result<br>(sent to Stage 2 as input_image_4)</p>
              </div>
            </div>
          `}
          
                  ${stage2InputCardsHtml}

					          <h3 style="color: #f39c12; margin: 30px 0 10px;">FILL INPUTS (Only when fill backend is active)</h3>
					          <p style="color: #888; margin-bottom: 10px;">These are ignored in current ${stage2BackendLabel} mode.</p>
			          <div class="prompt-box">
			            <strong>Fill Prompt:</strong> ${GENERATION_CONFIG.KONTEXT_FILL_PROMPT}
			          </div>
			          <div class="grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 12px;">
				            <div class="step sent" style="border-color: #74b9ff;">
				              <h3 style="color: #74b9ff;">fill.image_1 (Full User Photo)</h3>
			              <img id="fill-base-img" src="/api/debug/fill-base-image?t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('fill1').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
				              <p class="dims" id="fill1" style="color: #74b9ff;">-</p>
				              <p>Image 1: full user photo</p>
				            </div>
				            <div class="step sent" style="border-color: #f1c40f;">
				              <h3 style="color: #f1c40f;">fill.mask (User White Hair Mask)</h3>
			              <img id="fill-mask-img" src="/api/debug/fill-mask-binary?t=${Date.now()}" onerror="this.alt='Not available'" onload="document.getElementById('fill2').textContent = this.naturalWidth + 'x' + this.naturalHeight"/>
				              <p class="dims" id="fill2" style="color: #f1c40f;">-</p>
					              <p>Image 2: white editable hair region, black preserve</p>
				            </div>
			          </div>
          ${stage2OutputCardsHtml}
        </div>

        <div class="section">
          <h2 class="section-title" style="color: #00b894; border-bottom-color: #00b894;">KONTEXT STAGE 1 TEST (No FLUX 2 Pro)</h2>
          <p style="color: #888; margin-bottom: 15px;">Run only Kontext Stage 1 without FLUX 2 Pro Stage 2. Uses cached user photo from last upload.</p>
          <div style="background: #1a1a2e; padding: 20px; border-radius: 8px;">
            <input type="text" id="kontext-prompt" placeholder="Enter hairstyle prompt (e.g., 'bob cut', 'high taper')" 
                   style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #333; background: #0f0f1a; color: white; font-size: 14px; box-sizing: border-box;" />
            <div style="margin-top: 15px; display: flex; gap: 10px; align-items: center;">
              <button id="run-kontext-btn" onclick="runKontextTest()" 
                      style="background: #00b894; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: bold;">
                Run Kontext Stage 1 Only
              </button>
              <span id="kontext-status" style="color: #888;"></span>
            </div>
          </div>
        </div>

        <script>
          const isKleinBackend = ${isKleinBackend ? "true" : "false"};

          async function runKontextTest() {
            const prompt = document.getElementById('kontext-prompt').value.trim();
            if (!prompt) {
              alert('Please enter a hairstyle prompt');
              return;
            }
            
            const btn = document.getElementById('run-kontext-btn');
            const status = document.getElementById('kontext-status');
            
            btn.disabled = true;
            btn.style.opacity = '0.6';
            status.textContent = 'Generating... (check server logs)';
            status.style.color = '#f39c12';
            
            try {
              const response = await fetch('/api/debug/kontext-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
              });
              
              const data = await response.json();
              
              if (data.success) {
                status.textContent = 'Success! Refreshing images...';
                status.style.color = '#00b894';
                const kontextResultImg = document.getElementById('kontext-result-img');
                if (kontextResultImg) {
                  kontextResultImg.src = (isKleinBackend ? '/api/debug/stage1-kontext-result?t=' : '/api/debug/kontext-stage1-result?t=') + Date.now();
                }
                const hairFaceMaskImg = document.getElementById('hair-face-mask-img');
                if (hairFaceMaskImg) {
                  hairFaceMaskImg.src = (isKleinBackend ? '/api/debug/stage2-reference-mask?t=' : '/api/debug/kontext-stage1-hair-face-mask?t=') + Date.now();
                }
                const stage1KontextResultImg = document.getElementById('stage1-kontext-result-img');
                if (stage1KontextResultImg) {
                  stage1KontextResultImg.src = '/api/debug/stage1-kontext-result?t=' + Date.now();
                }
                const stage1GptResultImg = document.getElementById('stage1-gpt-result-img');
                if (stage1GptResultImg) {
                  stage1GptResultImg.src = '/api/debug/stage1-gpt-result?t=' + Date.now();
                }
                const fluxResultImg = document.getElementById('flux-result-img');
                if (fluxResultImg) {
                  fluxResultImg.src = '/api/debug/flux-stage2-result?t=' + Date.now();
                }
                const fluxFillResultImg = document.getElementById('flux-fill-result-img');
                if (fluxFillResultImg) {
                  fluxFillResultImg.src = '/api/debug/flux-fill-stage2-result?t=' + Date.now();
                }
                const fillBaseImg = document.getElementById('fill-base-img');
                if (fillBaseImg) {
                  fillBaseImg.src = '/api/debug/fill-base-image?t=' + Date.now();
                }
                const fillMaskImg = document.getElementById('fill-mask-img');
                if (fillMaskImg) {
                  fillMaskImg.src = '/api/debug/fill-mask-binary?t=' + Date.now();
                }
                const stage2FaceNeckImg = document.getElementById('stage2-face-neck-img');
                if (stage2FaceNeckImg) {
                  stage2FaceNeckImg.src = '/api/debug/stage2-face-neck-mask?t=' + Date.now();
                }
                const stage2UserHairColorImg = document.getElementById('stage2-user-hair-color-img');
                if (stage2UserHairColorImg) {
                  stage2UserHairColorImg.src = '/api/debug/stage2-user-hair-color-mask?t=' + Date.now();
                }
                const stage2FullUserImg = document.getElementById('stage2-full-user-img');
                if (stage2FullUserImg) {
                  stage2FullUserImg.src = '/api/debug/user-image?${selectedIndexQuery}t=' + Date.now();
                }
                const stage2GptHairOnlyImg = document.getElementById('stage2-gpt-hair-only-img');
                if (stage2GptHairOnlyImg) {
                  const hairMaskPath = isKleinBackend
                    ? '/api/debug/stage2-reference-mask?t=' + Date.now()
                    : '/api/debug/kontext-stage1-hair-face-mask?t=' + Date.now();
                  stage2GptHairOnlyImg.src = hairMaskPath;
                }
                const fillStyleImg = document.getElementById('fill-style-img');
                if (fillStyleImg) {
                  fillStyleImg.src = '/api/debug/fill-style-reference?t=' + Date.now();
                }
              } else {
                status.textContent = 'Error: ' + (data.error || 'Unknown error');
                status.style.color = '#e74c3c';
              }
            } catch (err) {
              status.textContent = 'Error: ' + err.message;
              status.style.color = '#e74c3c';
            } finally {
              btn.disabled = false;
              btn.style.opacity = '1';
            }
          }
        </script>
        
        <div style="text-align: center; margin-top: 25px;">
          <button class="refresh-btn" onclick="location.reload()">Refresh</button>
        </div>
        <p style="text-align: center; color: #666; margin-top: 15px; font-size: 13px;">
          Run a "Describe Your Style" generation, then refresh this page to see all reference guidance inputs.
        </p>
      </body>
      </html>
    `);
  });

  // Analyze user photo for skin tone and face shape
  app.post("/api/analyze-photo", async (req, res) => {
    try {
      const { photoUrl } = req.body;
      
      if (!photoUrl) {
        return res.status(400).json({ error: "Photo URL is required" });
      }

      console.log("Analyzing photo for reference matching...");
      const analysis = await analyzeUserPhoto(photoUrl);
      
      if (!analysis) {
        return res.status(500).json({ error: "Failed to analyze photo" });
      }

      res.json({ analysis });
    } catch (error) {
      console.error("Error analyzing photo:", error);
      res.status(500).json({ error: "Failed to analyze photo" });
    }
  });

  // Admin endpoint to add hairstyle references (for building the catalog)
  app.post("/api/admin/hairstyle-references", async (req, res) => {
    try {
      const { references } = req.body;
      
      if (!Array.isArray(references)) {
        return res.status(400).json({ error: "References array is required" });
      }

      const created = [];
      for (const ref of references) {
        const newRef = await storage.createHairstyleReference(ref);
        created.push(newRef);
      }

      res.json({ created, count: created.length });
    } catch (error) {
      console.error("Error adding references:", error);
      res.status(500).json({ error: "Failed to add references" });
    }
  });

  // Get all hairstyle references
  app.get("/api/hairstyle-references", async (req, res) => {
    try {
      const references = await storage.getAllHairstyleReferences();
      res.json({ references });
    } catch (error) {
      console.error("Error fetching references:", error);
      res.status(500).json({ error: "Failed to fetch references" });
    }
  });

  // Validate photo quality during upload (before style selection)
  // Quality check order: 1) Format, 2) Dimensions (fast), 3) Face detection (expensive)
  app.post("/api/validate-photo", async (req, res) => {
    try {
      const { photoUrl } = req.body;

      if (!photoUrl) {
        return res.status(400).json({ error: "Photo URL is required" });
      }

      // Check 1: Validate photo URL format
      const isValidUrl = photoUrl.startsWith("data:image/") || 
                         photoUrl.startsWith("https://") || 
                         photoUrl.startsWith("http://");
      if (!isValidUrl) {
        return res.status(400).json({ 
          error: "Invalid photo format",
          valid: false,
          guidance: "Please upload a valid image file."
        });
      }

      console.log("[VALIDATE] Running photo quality validation...");
      
      // Check 2: Image dimensions (FAST - do this FIRST before expensive processing)
      console.log("[VALIDATE] Step 1: Checking image dimensions...");
      const MIN_USER_PHOTO_DIMENSION = 600; // Standard minimum dimension
      const RELAXED_MIN_DIMENSION = 499; // Relaxed minimum if mask score is high
      const HIGH_QUALITY_MASK_THRESHOLD = 0.95; // 95% mask score required for relaxed dimension
      
      let imageDimensions: { width: number; height: number } | null = null;
      let minDim = 0;
      let needsHighQualityMask = false; // Flag to track if we need 95%+ mask score
      
      try {
        imageDimensions = await getImageDimensions(photoUrl);
        if (imageDimensions) {
          minDim = Math.min(imageDimensions.width, imageDimensions.height);
          console.log(`[VALIDATE] Image dimensions: ${imageDimensions.width}x${imageDimensions.height} (min: ${minDim}px)`);
          
          // Hard reject if below relaxed minimum (499px)
          if (minDim < RELAXED_MIN_DIMENSION) {
            console.log(`[VALIDATE] REJECTED: Image too small (${minDim}px < ${RELAXED_MIN_DIMENSION}px absolute minimum)`);
            return res.status(400).json({
              valid: false,
              error: "Image resolution too low",
              qualityIssues: [`Image is too small (${imageDimensions.width}x${imageDimensions.height}). Minimum ${RELAXED_MIN_DIMENSION}px required.`],
              guidance: `Your image is ${imageDimensions.width}×${imageDimensions.height} pixels. Please upload a photo that's at least ${MIN_USER_PHOTO_DIMENSION}×${MIN_USER_PHOTO_DIMENSION} pixels for best results.`,
              metrics: { width: imageDimensions.width, height: imageDimensions.height, minDimension: minDim }
            });
          }
          
          // If between 499-599px, flag for high quality mask requirement
          if (minDim < MIN_USER_PHOTO_DIMENSION) {
            needsHighQualityMask = true;
            console.log(`[VALIDATE] Image is ${minDim}px (between ${RELAXED_MIN_DIMENSION}-${MIN_USER_PHOTO_DIMENSION}px) - will require ${HIGH_QUALITY_MASK_THRESHOLD * 100}%+ mask score`);
          }
        }
      } catch (dimError) {
        console.warn("[VALIDATE] Could not check dimensions (will proceed to face detection):", dimError);
      }
      
      // Check 3: Face detection and detailed validation (EXPENSIVE - do after dimension check)
      console.log("[VALIDATE] Step 2: Running face detection and mask validation...");
      const maskResult = await createUserMaskedImage(photoUrl, 10, true);
      
      // Save debug images for validation attempts (regardless of pass/fail)
      const fsDebug = await import("fs/promises");
      const sharp = (await import("sharp")).default;
      
      // Save original photo
      try {
        const base64Data = photoUrl.replace(/^data:image\/\w+;base64,/, "");
        const userBuffer = Buffer.from(base64Data, "base64");
        await fsDebug.writeFile("/tmp/debug_validate_user_image.jpg", userBuffer);
        console.log("[VALIDATE] Saved original photo to /tmp/debug_validate_user_image.jpg");
      } catch (e) {
        console.log("[VALIDATE] Could not save original photo debug image");
      }
      
      // Save mask result if available
      if (maskResult.image) {
        try {
          const maskBase64 = maskResult.image.replace(/^data:image\/\w+;base64,/, "");
          const maskBuffer = Buffer.from(maskBase64, "base64");
          await fsDebug.writeFile("/tmp/debug_validate_user_mask.jpg", maskBuffer);
          console.log("[VALIDATE] Saved user mask to /tmp/debug_validate_user_mask.jpg");
        } catch (e) {
          console.log("[VALIDATE] Could not save mask debug image");
        }
      }
      
      // Save validation metadata
      const validationData = {
        timestamp: new Date().toISOString(),
        dimensions: { width: maskResult.width, height: maskResult.height },
        maskValid: maskResult.validation?.valid ?? null,
        maskScore: maskResult.validation?.score ?? null,
        maskIssues: maskResult.validation?.issues ?? [],
        photoQualityValid: maskResult.photoQuality?.valid ?? null,
        photoQualityIssues: maskResult.photoQuality?.issues ?? [],
        photoQualityMetrics: maskResult.photoQuality?.metrics ?? {},
        photoQualityGuidance: maskResult.photoQuality?.guidance ?? null,
      };
      await fsDebug.writeFile("/tmp/debug_validate_metadata.json", JSON.stringify(validationData, null, 2));
      console.log("[VALIDATE] Saved validation metadata to /tmp/debug_validate_metadata.json");
      
      // Check if mask creation failed entirely
      if (!maskResult.image) {
        console.log("[VALIDATE] Photo processing failed - could not create mask");
        return res.status(400).json({ 
          valid: false,
          error: "Could not process photo",
          qualityIssues: ["Could not detect a face in the photo"],
          guidance: "We couldn't detect a face in your photo. Please upload a clear, front-facing photo."
        });
      }
      
      if (maskResult.photoQuality && !maskResult.photoQuality.valid) {
        console.log(`[VALIDATE] Photo quality check failed: ${maskResult.photoQuality.issues.join(', ')}`);
        return res.status(400).json({ 
          valid: false,
          error: "Photo quality check failed",
          qualityIssues: maskResult.photoQuality.issues,
          guidance: maskResult.photoQuality.guidance || "Please upload a clear, front-facing photo with your full face visible.",
          metrics: maskResult.photoQuality.metrics
        });
      }
      
      // Check 4: For images 499-599px, require 95%+ mask validation score
      if (needsHighQualityMask) {
        const maskScore = maskResult.validation?.score ?? 0;
        console.log(`[VALIDATE] Checking high-quality mask requirement: score=${maskScore}, threshold=${HIGH_QUALITY_MASK_THRESHOLD}`);
        
        if (maskScore < HIGH_QUALITY_MASK_THRESHOLD) {
          console.log(`[VALIDATE] REJECTED: Image ${minDim}px requires ${HIGH_QUALITY_MASK_THRESHOLD * 100}%+ mask score, got ${(maskScore * 100).toFixed(1)}%`);
          return res.status(400).json({
            valid: false,
            error: "Image resolution too low for this photo",
            qualityIssues: [`Image is ${imageDimensions?.width}x${imageDimensions?.height}px. For smaller images, we need a very clear face detection (${(HIGH_QUALITY_MASK_THRESHOLD * 100).toFixed(0)}%+ score), but only achieved ${(maskScore * 100).toFixed(1)}%.`],
            guidance: `Your image is ${imageDimensions?.width}×${imageDimensions?.height} pixels with a ${(maskScore * 100).toFixed(1)}% quality score. Please upload a larger photo (at least ${MIN_USER_PHOTO_DIMENSION}×${MIN_USER_PHOTO_DIMENSION} pixels) for best results.`,
            metrics: { 
              width: imageDimensions?.width, 
              height: imageDimensions?.height, 
              minDimension: minDim,
              maskScore: maskScore,
              requiredMaskScore: HIGH_QUALITY_MASK_THRESHOLD
            }
          });
        }
        console.log(`[VALIDATE] Small image (${minDim}px) ACCEPTED with high mask score: ${(maskScore * 100).toFixed(1)}%`);
      }
      
      console.log("[VALIDATE] Photo quality validation passed");
      res.json({ 
        valid: true,
        message: "Photo meets quality requirements"
      });
    } catch (error) {
      console.error("Error validating photo:", error);
      res.status(500).json({ 
        valid: false,
        error: "Photo validation failed",
        guidance: "Something went wrong while checking your photo. Please try again."
      });
    }
  });

  
  // Debug validation endpoint - returns detailed validation info with masks
  app.post("/api/debug-validate-photo", async (req, res) => {
    try {
      const { photoUrl } = req.body;

      if (!photoUrl) {
        return res.status(400).json({ error: "Photo URL is required" });
      }

      console.log("[DEBUG-VALIDATE] Running detailed validation...");
      const startTime = Date.now();
      
      // Get image dimensions
      let dimensions = null;
      try {
        dimensions = await getImageDimensions(photoUrl);
        console.log(`[DEBUG-VALIDATE] Dimensions: ${dimensions?.width}x${dimensions?.height}`);
      } catch (e) {
        console.log("[DEBUG-VALIDATE] Could not get dimensions");
      }
      
      // Run full mask creation with validation (processed mask)
      const maskResult = await createUserMaskedImage(photoUrl, 10, true);
      
      // Also get the canonical user white-hair mask for comparison
      let rawMaskBase64: string | null = null;
      try {
        const rawMask = await createHairOnlyImage(photoUrl, 10);
        if (rawMask) {
          rawMaskBase64 = rawMask;
          console.log("[DEBUG-VALIDATE] Got raw mask for comparison");
        }
      } catch (e) {
        console.log("[DEBUG-VALIDATE] Could not get raw mask:", e);
      }
      
      // Build response with all debug data
      const response: any = {
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        dimensions: dimensions || { width: maskResult.width, height: maskResult.height },
        
        // Mask creation result
        maskCreated: !!maskResult.image,
        userMaskBase64: maskResult.image || null,
        rawMaskBase64: rawMaskBase64,  // Raw mask without post-processing
        
        // Validation details
        maskValidation: maskResult.validation ? {
          valid: maskResult.validation.valid,
          score: maskResult.validation.score,
          issues: maskResult.validation.issues
        } : null,
        
        // Photo quality details
        photoQuality: maskResult.photoQuality ? {
          valid: maskResult.photoQuality.valid,
          issues: maskResult.photoQuality.issues,
          guidance: maskResult.photoQuality.guidance,
          metrics: maskResult.photoQuality.metrics
        } : null,
        
        // Final result
        overallValid: maskResult.image && (maskResult.photoQuality?.valid !== false)
      };
      
      console.log(`[DEBUG-VALIDATE] Completed in ${response.processingTimeMs}ms, valid: ${response.overallValid}`);
      res.json(response);
    } catch (error) {
      console.error("[DEBUG-VALIDATE] Error:", error);
      res.status(500).json({ 
        error: "Debug validation failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Preprocess photo: create mask and run vision analysis in background
  // This is called immediately after successful photo validation to speed up generation
  // Note: preprocessCache is defined at module level for cross-function access
  
  // Global counter for debug reference indices (persists across "Generate More")
  let debugRefIndexCounter = 0;
  
  app.post("/api/preprocess-photo", async (req, res) => {
    const { photoUrl } = req.body;
    
    if (!photoUrl) {
      return res.status(400).json({ error: "Photo URL is required" });
    }
    
    // Generate a cache key from the photo URL using consistent format
    const cacheKey = generateCacheKey(photoUrl);
    
    // Check if already cached
    const cached = await preprocessCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) { // 30 min cache
      console.log("[PREPROCESS] Returning cached results");
      return res.json({ 
        success: true, 
        cached: true,
        userAnalysis: cached.userAnalysis
      });
    }
    
    // Return immediately, process in background
    res.json({ success: true, processing: true });
    
    // Background processing - ONLY create mask, vision analysis happens on generate
    (async () => {
      try {
        console.log("[PREPROCESS] Starting background preprocessing (mask only, no vision)...");
        
        // Only create mask - vision analysis is deferred until generate to save costs
        const maskResult = await createUserMaskedImage(photoUrl, 10);
        
        // maskResult is a string (base64 image) when successful
        const maskedImageString = typeof maskResult === 'string' ? maskResult : null;
        
        if (maskedImageString) {
          console.log(`[PREPROCESS] Mask created successfully`);
          
          await preprocessCache.set(cacheKey, {
            maskedUserPhoto: maskedImageString,
            maskedImage: maskedImageString,
            // No vision analysis yet - will be done on generate
            timestamp: Date.now()
          });
        } else {
          console.log("[PREPROCESS] Mask creation failed");
        }
      } catch (error) {
        console.error("[PREPROCESS] Background processing error:", error);
      }
    })();
  });
  
  // Retrieve preprocessed data for a photo
  app.post("/api/get-preprocess-data", async (req, res) => {
    const { photoUrl } = req.body;
    
    if (!photoUrl) {
      return res.status(400).json({ error: "Photo URL is required" });
    }
    
    const cacheKey = generateCacheKey(photoUrl);
    
    const cached = await preprocessCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
      return res.json({
        ready: true,
        maskedImage: cached.maskedImage,
        userAnalysis: cached.userAnalysis
      });
    }
    
    res.json({ ready: false });
  });
  
  app.post("/api/upload-photo", async (req, res) => {
    try {
      const { photoUrl, hairstylePrompt, inspirationPhotoUrl, styleType, numImages } = req.body;

      if (!photoUrl) {
        return res.status(400).json({ error: "Photo URL is required" });
      }

      // Validate photo URL format
      const isValidUrl = photoUrl.startsWith("data:image/") || 
                         photoUrl.startsWith("https://") || 
                         photoUrl.startsWith("http://");
      if (!isValidUrl) {
        console.error(`Invalid photo URL format: "${photoUrl.substring(0, 50)}..."`);
        return res.status(400).json({ error: "Invalid photo URL format. Must be a data URL or http(s) URL." });
      }

      // Check minimum length for http URLs
      if ((photoUrl.startsWith("http://") || photoUrl.startsWith("https://")) && photoUrl.length < 10) {
        console.error(`Photo URL too short: "${photoUrl}"`);
        return res.status(400).json({ error: "Photo URL appears to be incomplete" });
      }

      if (!hairstylePrompt && !inspirationPhotoUrl) {
        return res.status(400).json({ error: "Either a hairstyle prompt or inspiration photo is required" });
      }

      // Photo quality is validated at upload time via /api/validate-photo
      // No duplicate validation here - trust the frontend validation

      // Both text mode and inspiration mode generate 1 image
      const requestedImages = 1;

      // Get logged-in user ID if available (for tracking partner generations)
      const userId = getUserId(req);
      // Get device ID for anonymous user history tracking
      const deviceId = getOrCreateDeviceId(req, res);

      const session = await storage.createUserSession({
        photoUrl,
        facialFeatures: JSON.stringify({ numImages: requestedImages }),
        userId: userId || undefined, // Link session to user if logged in
        deviceId, // Link session to device for anonymous history
      });

      if (hairstylePrompt) {
        // Text mode: single generation
        await storage.createGeneratedVariant({
          sessionId: session.id,
          hairstyleId: null,
          customPrompt: hairstylePrompt,
          inspirationPhotoUrl: null,
          styleType: styleType || "hairstyle",
          generatedImageUrl: null,
          status: "pending",
          variantIndex: null,
        });
      } else {
        // Inspiration mode: single generation (same pipeline as text mode)
        await storage.createGeneratedVariant({
          sessionId: session.id,
          hairstyleId: null,
          customPrompt: null,
          inspirationPhotoUrl: inspirationPhotoUrl || null,
          styleType: styleType || "hairstyle",
          generatedImageUrl: null,
          status: "pending",
          variantIndex: 0,
        });
      }

      res.json({ ...session, numImages: requestedImages });
    } catch (error) {
      console.error("Error uploading photo:", error);
      res.status(500).json({ error: "Failed to upload photo" });
    }
  });

  app.post("/api/generate-hairstyles/:sessionId", async (req, res) => {
    const generationStartTime = Date.now();
    try {
      const { sessionId } = req.params;
      
      // Check if this is an internal queue request (skip rate limiting and credit checks)
      const isInternalRequest = req.headers['x-internal-queue-request'] === 'true';
      
      // For internal requests, use the user ID from the header if provided
      const internalUserId = isInternalRequest ? (req.headers['x-internal-user-id'] as string) : null;
      const userId = internalUserId || getUserId(req);
      
      // Rate limiting: max 10 generation requests per minute per user/IP (skip for internal)
      if (!isInternalRequest) {
        const rateLimitKey = userId || req.ip || "unknown";
        if (isRateLimited(rateLimitKey, 10, 60000)) {
          recordGenerationFailure("rate_limited");
          return res.status(429).json({ 
            error: "Too many requests",
            message: "Please wait a moment before generating more styles."
          });
        }
      }
      
      const session = await storage.getUserSession(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      let isAnonymous = false;
      let creditsDeducted = false;
      const creditsNeeded = 1;

      // Dev mode or internal request: Skip all credit checks
      if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV && !isInternalRequest) {
        if (userId) {
          // Authenticated user - use normal credit system
          // Check for daily credit reset (free users only)
          await storage.resetDailyCredits(userId);

          // Get fresh user data after potential reset
          const updatedUser = await storage.getUser(userId);
          if (!updatedUser) {
            return res.status(404).json({ error: "User not found" });
          }

          // Check if user has enough credits (1 credit per generation)
          if (updatedUser.plan === "business") {
            // Business plan has unlimited credits - no deduction
          } else if (updatedUser.credits < creditsNeeded) {
            return res.status(402).json({ 
              error: "Insufficient credits",
              creditsNeeded,
              currentCredits: updatedUser.credits,
              isAuthenticated: true
            });
          } else {
            // Deduct credits for non-business plans
            await storage.deductCredits(userId, creditsNeeded);
            creditsDeducted = true;
          }
        } else {
          // Anonymous user - check device credits
          isAnonymous = true;
          const anonymousCreditsRemaining = getAnonymousCreditsRemaining(req);
          
          if (anonymousCreditsRemaining < creditsNeeded) {
            return res.status(402).json({ 
              error: "Daily limit reached",
              message: "You've used all 15 daily generations. Your credits will reset in 24 hours!",
              creditsNeeded,
              currentCredits: 0,
              anonymousCreditsRemaining: 0,
              isAuthenticated: false,
              requiresSignup: true
            });
          }
          
          // Will update cookie after successful generation
        }
      }

      const variants = await storage.getGeneratedVariantsBySessionId(sessionId);
      
      // Check if generation is locked (another generation in progress)
      if (!acquireGenerationLock(sessionId)) {
        // Add to queue and return queued status
        const pendingVariants = variants.filter(v => v.status === "pending");
        if (pendingVariants.length > 0) {
          // Mark variants as queued
          for (const variant of pendingVariants) {
            await storage.updateGeneratedVariant(variant.id, { status: "queued" });
            await addToQueue({
              userId: userId || null,
              sessionId: sessionId,
              variantId: variant.id,
            });
          }
        }
        
        // Return queue status
        const queueStatus = await getQueueStatusByVariant(pendingVariants[0]?.id || "");
        return res.json({ 
          queued: true,
          position: queueStatus?.position || 1,
          estimatedWaitSeconds: queueStatus?.estimatedWaitSeconds || 45,
          message: "Your generation is in queue. Another generation is in progress."
        });
      }

      // Get numImages from session facialFeatures
      let numImages = GENERATION_CONFIG.INSPIRATION_DEFAULT_NUM_IMAGES;
      if (session.facialFeatures) {
        try {
          const features = JSON.parse(session.facialFeatures);
          if (features.numImages) {
            numImages = features.numImages;
          }
        } catch (e) {
          // Ignore parse errors, use default
        }
      }

      let generationSucceeded = false;

      // Pre-fetch reference images for text mode variants.
      const textModeVariants = variants.filter(v => v.status === "pending" && v.customPrompt && !v.inspirationPhotoUrl);
      const CANDIDATES_TO_ANALYZE = GENERATION_CONFIG.TEXT_MODE_CANDIDATES_TO_ANALYZE;
      const TOP_TEXT_MODE_REFERENCES = 50;
      const PREFILTER_TOP_N = GENERATION_CONFIG.TEXT_MODE_PREFILTER_TOP_N || 16;
      const USE_VISION_SELECTION = GENERATION_CONFIG.TEXT_MODE_VISION_SELECTION;
      const USE_DIRECT_KONTEXT_TEXT_MODE = false;
      const TEXT_MODE_STAGE1_PROVIDER: KontextStage1Provider = resolveKontextStage1Provider(
        GENERATION_CONFIG.TEXT_MODE_STAGE1_PROVIDER
      );
      
      // Store pre-fetched references: { base64: string, url: string, source: string }[]
      let prefetchedRefs: { base64: string; url: string; source: string }[] = [];
      let userAnalysis: UserPhotoAnalysis | null = null;
      let visionHairstyleDescription: string = ""; // Vision model's interpretation of the hairstyle
      let storedSearchQuery: string = ""; // Store search query for auto-refresh
      
      if (textModeVariants.length > 0) {
        const firstVariantPrompt = textModeVariants[0].customPrompt!;

        if (USE_DIRECT_KONTEXT_TEXT_MODE) {
          console.log(
            `[TEXT MODE] Direct pipeline enabled: ${getKontextStage1ProviderLabel(TEXT_MODE_STAGE1_PROVIDER)} Stage 1 -> kontext_result_mask_test -> FLUX Stage 2 (web reference search disabled)`
          );
          visionHairstyleDescription = firstVariantPrompt;

          // Load existing user analysis if available; this only helps Stage 2 ethnicity replacement.
          const cacheKey = generateCacheKey(session.photoUrl);
          const cached = await preprocessCache.get(cacheKey);
          if (cached?.userAnalysis) {
            userAnalysis = cached.userAnalysis;
          } else if (session.facialFeatures) {
            try {
              const f = JSON.parse(session.facialFeatures);
              userAnalysis = {
                skinTone: f.skinTone || "medium",
                skinToneConfidence: 0.5,
                faceShape: f.faceShape || "oval",
                faceShapeConfidence: 0.5,
                gender: f.gender || "female",
                raceEthnicity: f.raceEthnicity || "natural",
                raceEthnicityConfidence: 0.5,
                hairTexture: f.hairTexture || null,
                currentHairLength: f.currentHairLength || null,
                faceAngle: f.faceAngle || "front",
                faceAngleConfidence: 0.5,
              };
            } catch {
              // Ignore malformed stored features.
            }
          }

          await storage.updateUserSession(sessionId, {
            hairstyleDescription: visionHairstyleDescription || firstVariantPrompt,
            customPrompt: firstVariantPrompt,
            rankedReferences: null,
            seenReferenceUrls: [],
            originalSearchQuery: null,
          });
        } else {
          console.log(`[REFS] Pre-fetching for ${textModeVariants.length} text variants (vision: ${USE_VISION_SELECTION ? 'on' : 'off'}, candidates: ${CANDIDATES_TO_ANALYZE})`);

          try {
          let optimizedSearchQuery = firstVariantPrompt; // Default to raw prompt
          
          // Check for cached preprocess data first
          const cacheKey = generateCacheKey(session.photoUrl);
          const cached = await preprocessCache.get(cacheKey);
          
          if (cached && cached.userAnalysis && Date.now() - cached.timestamp < 30 * 60 * 1000) {
            // Use cached user analysis
            console.log(`[REFS] Using cached user analysis - Race: ${cached.userAnalysis.raceEthnicity}, Gender: ${cached.userAnalysis.gender}`);
            userAnalysis = cached.userAnalysis;
            
            // Normalize prompt for cache lookup (lowercase, trimmed)
            const normalizedPrompt = firstVariantPrompt.trim().toLowerCase();
            const cachedPromptAnalysis = cached.promptAnalyses?.[normalizedPrompt];
            
            // Check if we have a cached vision analysis for THIS specific prompt
            if (cachedPromptAnalysis && Date.now() - cachedPromptAnalysis.updatedAt < 30 * 60 * 1000) {
              // Use cached prompt analysis from vision model
              console.log(`[REFS] Using cached prompt analysis for: "${firstVariantPrompt}"`);
              const cachedHairstyleName = normalizeHairstyleName(
                cachedPromptAnalysis.hairstyleInterpretation,
                firstVariantPrompt
              );
              visionHairstyleDescription = cachedHairstyleName;
              optimizedSearchQuery = buildBestHairstyleSearchQuery(cachedHairstyleName, userAnalysis);
            } else {
              // Call vision model to interpret the new prompt (reuse cached userAnalysis)
              console.log(`[REFS] New prompt - calling vision for interpretation: "${firstVariantPrompt}"`);
              const combinedResult = await analyzeUserPhotoWithPrompt(session.photoUrl, firstVariantPrompt);
              
              if (combinedResult) {
                optimizedSearchQuery = combinedResult.searchQuery;
                visionHairstyleDescription = combinedResult.hairstyleInterpretation;
                
                // Cache this prompt's analysis for future use
                const updatedPromptAnalyses = {
                  ...(cached.promptAnalyses || {}),
                  [normalizedPrompt]: {
                    searchQuery: combinedResult.searchQuery,
                    hairstyleInterpretation: combinedResult.hairstyleInterpretation,
                    updatedAt: Date.now()
                  }
                };
                
                await preprocessCache.set(cacheKey, {
                  ...cached,
                  promptAnalyses: updatedPromptAnalyses,
                  timestamp: Date.now()
                });
                console.log(`[REFS] Cached prompt analysis for: "${normalizedPrompt}"`);
              } else {
                // Fallback: use raw prompt if vision fails
                console.log(`[REFS] Vision failed for prompt, using raw prompt`);
              }
            }
          } else {
            // Use combined analysis - analyze user photo AND understand prompt together
            const combinedResult = await analyzeUserPhotoWithPrompt(session.photoUrl, firstVariantPrompt);
            
            if (combinedResult) {
              userAnalysis = combinedResult.userAnalysis;
              optimizedSearchQuery = combinedResult.searchQuery;
              visionHairstyleDescription = combinedResult.hairstyleInterpretation;
              
              // Normalize prompt for cache storage
              const normalizedPrompt = firstVariantPrompt.trim().toLowerCase();
              
              // Update cache with user analysis AND prompt analysis
              const existingCached = await preprocessCache.get(cacheKey);
              const updatedPromptAnalyses = {
                ...(existingCached?.promptAnalyses || {}),
                [normalizedPrompt]: {
                  searchQuery: combinedResult.searchQuery,
                  hairstyleInterpretation: combinedResult.hairstyleInterpretation,
                  updatedAt: Date.now()
                }
              };
              
              await preprocessCache.set(cacheKey, {
                ...(existingCached || {}),
                userAnalysis: combinedResult.userAnalysis,
                visionResult: combinedResult,
                promptAnalyses: updatedPromptAnalyses,
                timestamp: Date.now()
              });
              console.log(`[REFS] Cached user analysis and prompt analysis for: "${normalizedPrompt}"`);
            } else {
              // Fallback to separate analysis if combined fails
              console.log(`[REFS] Combined analysis failed, falling back to separate analysis`);
              userAnalysis = await analyzeUserPhoto(session.photoUrl);
            }
          }
          
          // Save user analysis to session for use in generate-more
          if (userAnalysis) {
            const existingFeatures = session.facialFeatures ? JSON.parse(session.facialFeatures) : {};
            await storage.updateUserSession(sessionId, {
              facialFeatures: JSON.stringify({
                ...existingFeatures,
                raceEthnicity: userAnalysis.raceEthnicity,
                gender: userAnalysis.gender,
                skinTone: userAnalysis.skinTone,
                faceShape: userAnalysis.faceShape,
                faceAngle: userAnalysis.faceAngle,
              })
            });
            console.log(`[REFS] User: ${userAnalysis.gender}, ${userAnalysis.raceEthnicity}`);
          }
          
          // Search for candidates with required SerpAPI query format:
          // "Best {hairstyle name} hairstyle for {users race} {users gender}"
          // Always prefer interpreted hairstyle name over raw user prompt text.
          const interpretedHairstyleName = normalizeHairstyleName(
            visionHairstyleDescription || firstVariantPrompt,
            firstVariantPrompt
          );
          const finalSearchQuery = userAnalysis
            ? buildBestHairstyleSearchQuery(interpretedHairstyleName, userAnalysis)
            : (optimizedSearchQuery || `Best ${interpretedHairstyleName} hairstyle`).replace(/\s+/g, " ").trim();
          console.log(`[REFS] Searching with query: "${finalSearchQuery}"`);
          const frontResults = await searchWebForHairstyleImagesWithQuery(finalSearchQuery, CANDIDATES_TO_ANALYZE);
          
          // Store the search query for later use in auto-refresh
          storedSearchQuery = finalSearchQuery;
          
          if (frontResults.length > 0) {
            
            // Fetch candidate images IN PARALLEL with concurrency limit for speed
            const CONCURRENT_FETCHES = 20; // Parallelize fetches more aggressively to reduce reference prefetch latency
            const toFetch = frontResults.slice(0, CANDIDATES_TO_ANALYZE);
            
            type FetchResult = {
              base64: string;
              imageUrl: string;
              title: string;
              source: string;
              index: number;
              width: number;
              height: number;
              minDimension: number;
            } | null;
            
            const allFetchedResults: FetchResult[] = [];
            
            const fetchOne = async (result: typeof toFetch[0], i: number): Promise<FetchResult> => {
              try {
                const base64 = await fetchFirstAccessibleImage([result.imageUrl]);
                if (base64) {
                  const dims = await getImageDimensions(base64);
                  if (dims) {
                    const minDim = Math.min(dims.width, dims.height);
                    return {
                      base64,
                      imageUrl: result.imageUrl,
                      title: result.title,
                      source: result.source,
                      index: i,
                      width: dims.width,
                      height: dims.height,
                      minDimension: minDim
                    };
                  }
                }
              } catch (e) {
                // Silently skip failed fetches
              }
              return null;
            };
            
            // Process in batches of CONCURRENT_FETCHES
            for (let i = 0; i < toFetch.length; i += CONCURRENT_FETCHES) {
              const batch = toFetch.slice(i, i + CONCURRENT_FETCHES);
              const batchResults = await Promise.all(batch.map((result, idx) => fetchOne(result, i + idx)));
              allFetchedResults.push(...batchResults);
            }
            
            const allFetched = allFetchedResults.filter((r): r is NonNullable<typeof r> => r !== null);
            
            // Minimal quality filter - just reject tiny images, vision model handles the rest
            const minSizeCandidates = allFetched.filter(r => r.minDimension >= 400);
            
            // Prioritize images with hairstyle name in filename/URL, then by dimension
            const hairstyleKeywords = firstVariantPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            const sortedByQuality = minSizeCandidates.sort((a, b) => {
              // Check if URL/title contains hairstyle keywords
              const aText = (a.imageUrl + ' ' + a.title).toLowerCase();
              const bText = (b.imageUrl + ' ' + b.title).toLowerCase();
              const aMatches = hairstyleKeywords.filter(kw => aText.includes(kw)).length;
              const bMatches = hairstyleKeywords.filter(kw => bText.includes(kw)).length;
              
              // Prioritize by keyword matches first, then by dimension
              if (bMatches !== aMatches) return bMatches - aMatches;
              return b.minDimension - a.minDimension;
            });
            const candidates: ReferenceCandidate[] = sortedByQuality.slice(0, PREFILTER_TOP_N);
            
            if (candidates.length > 0) {
              if (USE_VISION_SELECTION) {
                // Use vision to rank ALL valid references (no user photo, no artificial limit)
                const visionResult = await selectTopReferencesWithVision(
                  candidates,
                  firstVariantPrompt,
                  userAnalysis,
                  TOP_TEXT_MODE_REFERENCES,
                  visionHairstyleDescription  // Pass vision model's interpretation
                );
                
                // Store the vision model's hairstyle description for use in generation prompt
                visionHairstyleDescription = visionResult.hairstyleDescription;
                
                if (visionResult.candidates.length > 0) {
                  console.log(`[REFS] Vision selected ${visionResult.candidates.length} refs | Interpreted as: "${visionHairstyleDescription.substring(0, 60)}..."`);
                  // Store ALL selected references (up to 10)
                  for (const selectedCandidate of visionResult.candidates.slice(0, TOP_TEXT_MODE_REFERENCES)) {
                    prefetchedRefs.push({
                      base64: selectedCandidate.base64,
                      url: selectedCandidate.imageUrl,
                      source: selectedCandidate.title || selectedCandidate.source
                    });
                  }
                } else {
                  console.warn("[REFS] Vision selection failed, using first 10 candidates");
                  // Fallback: use first 10 candidates
                  for (let i = 0; i < Math.min(TOP_TEXT_MODE_REFERENCES, candidates.length); i++) {
                    prefetchedRefs.push({
                      base64: candidates[i].base64,
                      url: candidates[i].imageUrl,
                      source: candidates[i].title || candidates[i].source
                    });
                  }
                }
              } else {
                // No vision selection - use top capped candidates
                for (let i = 0; i < Math.min(TOP_TEXT_MODE_REFERENCES, candidates.length); i++) {
                  prefetchedRefs.push({
                    base64: candidates[i].base64,
                    url: candidates[i].imageUrl,
                    source: candidates[i].title || candidates[i].source
                  });
                }
                console.log(`[REFS] Using first ${prefetchedRefs.length} accessible references (vision disabled)`);
              }
            } else {
              console.warn("[REFS] No accessible candidate images found");
            }
          } else {
            console.warn("[REFS] No reference images found from web search");
          }
          } catch (refError) {
            console.warn("[REFS] Pre-fetch failed:", refError);
          }

          if (prefetchedRefs.length > 1) {
            prefetchedRefs = shuffleArray(prefetchedRefs);
            console.log(`[REFS] Shuffled ${prefetchedRefs.length} ranked references for randomized generation order`);
          }

          if (GENERATION_CONFIG.SAVE_FETCHED_REFERENCE_DEBUG && prefetchedRefs.length > 0) {
            await saveFetchedImages(
              prefetchedRefs.map(ref => ({
                url: ref.url,
                base64: ref.base64,
                source: ref.source || "Unknown",
                timestamp: new Date()
              }))
            );
          }

          // Store ranked references in session for generate-more feature
          if (prefetchedRefs.length > 0) {
            const seenUrls = prefetchedRefs.map(r => r.url);
            await storage.updateUserSession(sessionId, {
              rankedReferences: prefetchedRefs.map(r => ({ url: r.url, source: r.source })),
              hairstyleDescription: visionHairstyleDescription || firstVariantPrompt,
              customPrompt: firstVariantPrompt,
              seenReferenceUrls: seenUrls,
              originalSearchQuery: storedSearchQuery, // Store for future refresh searches
            });
            console.log(`[REFS] Stored ${prefetchedRefs.length} ranked references to session (${seenUrls.length} URLs tracked)`);
          }
        }
      }

      for (const variant of variants) {
        if (variant.status === "pending") {
          await storage.updateGeneratedVariant(variant.id, { status: "processing" });

          if (variant.inspirationPhotoUrl) {
            // Check if HYBRID mode is enabled
            if (isHybridModeEnabled()) {
              // HYBRID mode: 1 composite + 3 AI variants = 4 total results
              console.log("=== Using HYBRID mode for inspiration generation ===");
              
              const hybridResult = await runHybridPipeline(
                session.photoUrl,
                variant.inspirationPhotoUrl
              );
              
              if (hybridResult && hybridResult.compositeImageUrl) {
                const requiredVariantCount = GENERATION_CONFIG.HYBRID_VARIANT_COUNT;
                const actualVariantCount = hybridResult.aiVariantUrls.length;
                
                // Require ALL AI variants for hybrid mode success (strict 4-result contract)
                if (actualVariantCount >= requiredVariantCount) {
                  generationSucceeded = true;
                  
                  // Update primary variant with composite result
                  await storage.updateGeneratedVariant(variant.id, {
                    generatedImageUrl: hybridResult.compositeImageUrl,
                    renderType: "composite",
                    variantIndex: 0,
                    status: "completed",
                  });
                  
                  // Create additional variants for AI-generated results
                  for (let i = 0; i < hybridResult.aiVariantUrls.length; i++) {
                    const aiVariantUrl = hybridResult.aiVariantUrls[i];
                    await storage.createGeneratedVariant({
                      sessionId: session.id,
                      hairstyleId: null,
                      customPrompt: null,
                      inspirationPhotoUrl: variant.inspirationPhotoUrl,
                      styleType: variant.styleType || "hairstyle",
                      generatedImageUrl: aiVariantUrl,
                      renderType: "ai_variant",
                      variantIndex: i + 1,
                      status: "completed",
                    });
                  }
                  
                  console.log(`HYBRID mode complete: 1 composite + ${actualVariantCount} AI variants`);
                } else {
                  // Not enough AI variants - fall back to PURE_AI for reliability
                  console.log(`HYBRID mode: Only ${actualVariantCount}/${requiredVariantCount} AI variants generated, falling back to PURE_AI`);
                  const dualResult = await generateStyleFromInspirationDual(
                    session.photoUrl,
                    variant.inspirationPhotoUrl,
                    (variant.styleType || "hairstyle") as StyleType
                  );
                  
                  if (dualResult.frontImageUrl) {
                    generationSucceeded = true;
                    const modelDebug = buildKontextRefinedModelDebug("kontext", "KONTEXT_STAGE2_PROMPT");
                    // Save debug data (masks) to compositeData for debug page
                    const compositeDataBase = dualResult.debugData ? {
                      userMaskUrl: dualResult.debugData.userMaskUrl,
                      refHairMaskUrl: dualResult.debugData.refHairMaskUrl,
                      userRace: dualResult.debugData.userRace,
                      userGender: dualResult.debugData.userGender
                    } : {};
                    const compositeData = mergeCompositeData(
                      variant.compositeData,
                      { ...compositeDataBase, modelDebug }
                    );
                    await storage.updateGeneratedVariant(variant.id, {
                      generatedImageUrl: dualResult.frontImageUrl,
                      sideImageUrl: dualResult.sideImageUrl,
                      compositeData,
                      renderType: "ai",
                      variantIndex: null,
                      status: "completed",
                    });
                  } else {
                    await storage.updateGeneratedVariant(variant.id, {
                      renderType: "ai",
                      variantIndex: null,
                      status: "failed",
                    });
                  }
                }
              } else {
                console.log("HYBRID mode failed, falling back to PURE_AI mode");
                // Fallback to standard dual generation
                const dualResult = await generateStyleFromInspirationDual(
                  session.photoUrl,
                  variant.inspirationPhotoUrl,
                  (variant.styleType || "hairstyle") as StyleType
                );
                
                  if (dualResult.frontImageUrl) {
                    generationSucceeded = true;
                  const modelDebug = buildKontextRefinedModelDebug("kontext", "KONTEXT_STAGE2_PROMPT");
                  // Save debug data (masks) to compositeData for debug page
                  const compositeDataBase = dualResult.debugData ? {
                    userMaskUrl: dualResult.debugData.userMaskUrl,
                    refHairMaskUrl: dualResult.debugData.refHairMaskUrl,
                    userRace: dualResult.debugData.userRace,
                    userGender: dualResult.debugData.userGender
                  } : {};
                  const compositeData = mergeCompositeData(
                    variant.compositeData,
                    { ...compositeDataBase, modelDebug }
                  );
                  // Reset renderType to "ai" for fallback results
                  await storage.updateGeneratedVariant(variant.id, {
                    generatedImageUrl: dualResult.frontImageUrl,
                    sideImageUrl: dualResult.sideImageUrl,
                    compositeData,
                    renderType: "ai",
                    variantIndex: null,
                    status: "completed",
                  });
                } else {
                  await storage.updateGeneratedVariant(variant.id, {
                    renderType: "ai",
                    variantIndex: null,
                    status: "failed",
                  });
                }
              }
            } else {
              // PURE_AI mode: Standard generation
              console.log("=== INSPIRATION MODE: Using generateStyleFromInspirationDual ===");
              const dualResult = await generateStyleFromInspirationDual(
                session.photoUrl,
                variant.inspirationPhotoUrl,
                (variant.styleType || "hairstyle") as StyleType
              );
              
              if (dualResult.frontImageUrl) {
                generationSucceeded = true;
                const modelDebug = buildKontextRefinedModelDebug("kontext", "KONTEXT_STAGE2_PROMPT");
                
                // Save debug data (masks) to compositeData for debug page
                const compositeDataBase = dualResult.debugData ? {
                  userMaskUrl: dualResult.debugData.userMaskUrl,
                  refHairMaskUrl: dualResult.debugData.refHairMaskUrl,
                  userRace: dualResult.debugData.userRace,
                  userGender: dualResult.debugData.userGender
                } : {};
                const compositeData = mergeCompositeData(
                  variant.compositeData,
                  { ...compositeDataBase, modelDebug }
                );
                
                await storage.updateGeneratedVariant(variant.id, {
                  generatedImageUrl: dualResult.frontImageUrl,
                  sideImageUrl: null,
                  compositeData,
                  status: "completed",
                });
              } else {
                await storage.updateGeneratedVariant(variant.id, {
                  status: "failed",
                });
              }
            }
          } else if (variant.customPrompt) {
            // Text mode: Generate 1 result using top reference or ChatGPT
            console.log(`\n${'='.repeat(60)}`);
            console.log(`🎨 TEXT MODE GENERATION`);
            console.log(`${'='.repeat(60)}`);
            
            // Check if ChatGPT describe mode is enabled
            if (GENERATION_CONFIG.CHATGPT_DESCRIBE_MODE) {
              console.log(`📦 Pipeline: ChatGPT gpt-image-1 (no masks, no references)`);
              
              const chatgptResult = await generateHairstyleWithChatGPT(
                session.photoUrl,
                variant.customPrompt
              );
              
              if (chatgptResult) {
                generationSucceeded = true;
                await storage.updateGeneratedVariant(variant.id, {
                  generatedImageUrl: chatgptResult,
                  sideImageUrl: null,
                  compositeData: null,
                  renderType: "chatgpt",
                  status: "completed",
                });
                console.log(`✅ ChatGPT generation complete!`);
              } else {
                console.error(`❌ ChatGPT generation failed, falling back to BFL pipeline`);
                // Fall through to BFL pipeline as fallback
              }
            }
            
            // Skip BFL pipeline if ChatGPT succeeded
            if (GENERATION_CONFIG.CHATGPT_DESCRIBE_MODE && generationSucceeded) {
              console.log(`Skipping BFL pipeline - ChatGPT succeeded`);
            } else {
            
            // Reset and clear debug images so overview refresh always shows latest generation outputs.
            debugRefIndexCounter = 0;
            try {
              const fsDebugCleanup = await import("fs/promises");
              const tmpFiles = await fsDebugCleanup.readdir("/tmp");
              for (const file of tmpFiles) {
                if (
                  file.startsWith("debug_reference_") ||
                  file.startsWith("debug_gpt_ref_input_") ||
                  file.startsWith("debug_gpt_reference_fusion_result") ||
                  file.startsWith("debug_stage1_kontext_fusion_result") ||
                  file.startsWith("debug_stage1_gpt_fusion_result") ||
                  file.startsWith("debug_kontext_stage1_result") ||
                  file.startsWith("debug_kontext_stage1_hair_face_mask") ||
                  file.startsWith("debug_kontext_stage1_metadata") ||
                  file.startsWith("debug_stage2_user_face_neck_mask") ||
                  file.startsWith("debug_stage2_user_hair_color_mask") ||
                  file.startsWith("debug_stage2_klein_reference_mask_") ||
                  file.startsWith("debug_flux_stage2_result")
                ) {
                  await fsDebugCleanup.unlink(`/tmp/${file}`).catch(() => {});
                }
              }
              console.log(`🧹 Cleared old debug reference files`);
            } catch (cleanupErr) {
              // Ignore cleanup errors
            }
            
            if (GENERATION_CONFIG.TEXT_MODE_DIRECT_KONTEXT) {
              console.log(
                `📦 Pipeline: kontext_refined_direct (${getKontextStage1ProviderLabel(TEXT_MODE_STAGE1_PROVIDER)} Stage 1 -> kontext_result_mask_test -> FLUX Stage 2)`
              );
              console.log(`📚 Web reference search: skipped (TEXT_MODE_DIRECT_KONTEXT=true)`);
            } else {
              console.log(`📦 Pipeline: kontext_refined (reference-guided)`);
              console.log(`📚 Available references: ${prefetchedRefs.length}`);
              if (prefetchedRefs.length > 0) {
                console.log(`\n🎯 USING REFERENCE #1 (TOP RANKED):`);
                console.log(`   Source: "${prefetchedRefs[0].source}"`);
                console.log(`   URL: ${prefetchedRefs[0].url.substring(0, 60)}...`);
              }
            }
            
            // Use cached masked user photo if available, otherwise create it
            let maskedUserPhoto: string | null = null;
            
            // Check for cached mask from preprocessing (use consistent key format)
            const maskCacheKey = generateCacheKey(session.photoUrl);
            const cachedPreprocess = await preprocessCache.get(maskCacheKey);
            
            if (cachedPreprocess?.maskedImage && Date.now() - cachedPreprocess.timestamp < 30 * 60 * 1000) {
              console.log(`🎭 Using CACHED masked user photo (preprocessed during validation)`);
              maskedUserPhoto = cachedPreprocess.maskedImage;
              console.log(`✓ Cached masked user photo: ${maskedUserPhoto.length} chars`);
            } else {
              // Create masked user photo - cache miss
              console.log(`🎭 Creating masked user photo (cache miss - running now)...`);
              const userPhotoResponse2 = await fetch(session.photoUrl);
              const userPhotoBuffer2 = Buffer.from(await userPhotoResponse2.arrayBuffer());
              const userPhotoBase64 = `data:image/jpeg;base64,${userPhotoBuffer2.toString('base64')}`;
              maskedUserPhoto = await createUserMaskedImage(userPhotoBase64, 10);
              
              if (!maskedUserPhoto) {
                console.warn("⚠️ User photo masking failed");
              } else {
                console.log(`✓ Masked user photo created: ${maskedUserPhoto.length} chars`);
                // Save to cache for refinements
                // Get ethnicity from session facialFeatures or existing cache
                let cachedEthnicity: { raceEthnicity?: string; gender?: string } | undefined;
                try {
                  const features = JSON.parse(session.facialFeatures || "{}");
                  if (features.raceEthnicity) {
                    cachedEthnicity = { raceEthnicity: features.raceEthnicity, gender: features.gender };
                  }
                } catch (e) { /* ignore parse errors */ }
                
                const existingCache = await preprocessCache.get(maskCacheKey);
                await preprocessCache.set(maskCacheKey, {
                  maskedUserPhoto: maskedUserPhoto,
                  maskedImage: maskedUserPhoto,
                  visionResult: existingCache?.visionResult || cachedEthnicity,
                  userAnalysis: existingCache?.userAnalysis || cachedEthnicity,
                  timestamp: Date.now(),
                });
                console.log(`✓ Saved masked user photo to cache (key: ${maskCacheKey.substring(0, 40)}...)`);
              }
            }

            // Direct text-mode pipeline (enforced):
            // Selected Stage 1 provider on user image -> mask Stage 1 result -> FLUX Stage 2
            if (GENERATION_CONFIG.TEXT_MODE_DIRECT_KONTEXT) {
              const interpretedPrompt = visionHairstyleDescription || variant.customPrompt!;
              console.log(`📝 Interpreted prompt: "${interpretedPrompt}"`);
              console.log(`🧭 Stage 1 provider (forced): ${getKontextStage1ProviderLabel(TEXT_MODE_STAGE1_PROVIDER)}`);
              debugRefIndexCounter++;
              const debugIdx = debugRefIndexCounter;
              const frontImageUrl = await generateWithKontextRefined(
                session.photoUrl,
                interpretedPrompt,
                session.photoUrl,
                maskedUserPhoto!,
                userAnalysis?.raceEthnicity || "natural",
                userAnalysis?.gender || "",
                  { promptOnlyMode: true, stage1Provider: TEXT_MODE_STAGE1_PROVIDER, debugIndex: debugIdx }
              );

              if (frontImageUrl) {
                generationSucceeded = true;
                const modelDebug = buildKontextRefinedModelDebug(TEXT_MODE_STAGE1_PROVIDER, "KONTEXT_STAGE2_PROMPT");
                const compositeData = mergeCompositeData(variant.compositeData, { modelDebug });
                await storage.updateGeneratedVariant(variant.id, {
                  generatedImageUrl: frontImageUrl,
                  sideImageUrl: null,
                  webReferenceImageUrl: null,
                  webReferenceSource: null,
                  compositeData,
                  renderType: "ai",
                  variantIndex: 0,
                  referenceIndex: 0,
                  status: "completed",
                });
                console.log(`[MODEL DEBUG] Variant ${variant.id}: ${JSON.stringify(modelDebug)}`);
                console.log(
                  `✓ Text mode complete: direct ${getKontextStage1ProviderLabel(TEXT_MODE_STAGE1_PROVIDER)} Stage 1 + FLUX Stage 2 pipeline`
                );
              } else {
                await storage.updateGeneratedVariant(variant.id, {
                  status: "failed",
                });
              }
              continue;
            }
            
            // Generate using single-stage FLUX Klein:
            // input_image = full user photo, input_image_2 = reference mannequin mask,
            // input_image_3 = user face mask.
            const MAX_GENERATIONS = 1;
            const generatedResults: { url: string; refUrl?: string; refSource?: string; refIndex: number }[] = [];
            
            console.log(`🔄 Starting generation with ${prefetchedRefs.length} available references (need ${MAX_GENERATIONS})\n`);

            const userPhotoBase64ForKlein = session.photoUrl.startsWith("data:")
              ? await normalizeImageOrientation(session.photoUrl)
              : await fetchImageAsBase64(session.photoUrl);
            if (!userPhotoBase64ForKlein) {
              console.error("✗ Could not fetch/normalize user photo for Klein single-stage generation.");
              await storage.updateGeneratedVariant(variant.id, { status: "failed" });
              continue;
            }
            try {
              await saveBase64DebugImage("/tmp/debug_user_image.jpg", userPhotoBase64ForKlein);
            } catch {
              // Best-effort debug artifact.
            }

            const userFaceMaskForKlein = await buildStage2FaceMaskForKleinSingleStage(userPhotoBase64ForKlein);
            if (!userFaceMaskForKlein) {
              console.error("✗ Could not create user face mask for Klein single-stage generation.");
              await storage.updateGeneratedVariant(variant.id, { status: "failed" });
              continue;
            }
            try {
              await saveBase64DebugImage("/tmp/debug_stage2_user_face_neck_mask.jpg", userFaceMaskForKlein);
              console.log("✓ Saved user face mask to /tmp/debug_stage2_user_face_neck_mask.jpg");
            } catch (error) {
              console.warn("Could not save user face mask debug image:", error);
            }

            let stage1GptComparisonResult: string | null = null;
            let stage1PrimaryFusionResult: string | null = null;
            let stage1PrimaryProvider: KontextStage1Provider | null = null;
            const topReferenceForStage1 = prefetchedRefs[0];
            if (topReferenceForStage1) {
              const runtimeStage1Prompt = getCurrentChatGptStage1Prompt(
                visionHairstyleDescription || variant.customPrompt!,
                userAnalysis?.raceEthnicity,
                userAnalysis?.gender
              );
              const userPhotoDimsForStage1 = await getImageDimensions(userPhotoBase64ForKlein);
              const stage1Size = userPhotoDimsForStage1
                ? selectChatGPTImageSize(userPhotoDimsForStage1.width, userPhotoDimsForStage1.height)
                : GENERATION_CONFIG.CHATGPT_IMAGE_SIZE;
              try {
                await saveBase64DebugImage("/tmp/debug_gpt_ref_input_1.jpg", topReferenceForStage1.base64);
                console.log("✓ Saved Stage 1 reference-only input to /tmp/debug_gpt_ref_input_1.jpg");
              } catch (error) {
                console.warn("Could not save Stage 1 input debug images:", error);
              }
              try {
                await fsPromises.writeFile(
                  "/tmp/debug_kontext_stage1_metadata.json",
                  JSON.stringify(
                    {
                      generatedAt: new Date().toISOString(),
                      provider: "gpt_primary_only",
                      providerLabel: "GPT Stage 1 (primary only)",
                      inputLabel: "image 1 reference only",
                      prompt: runtimeStage1Prompt,
                      inputLength: topReferenceForStage1.base64.length,
                      inputPreview: topReferenceForStage1.base64.substring(0, 160),
                      imageSize: stage1Size,
                    },
                    null,
                    2
                  )
                );
              } catch (e) {
                console.warn("Could not save Stage 1 metadata:", e);
              }

              console.log("🧠 Running GPT Stage 1 (reference only, PRIMARY source)...");
              const stage1GptStartMs = Date.now();
              stage1GptComparisonResult = await generateHairstyleWithChatGPT(
                topReferenceForStage1.base64,
                runtimeStage1Prompt,
                {
                  promptTemplate: "{hairstyle}",
                  imageSize: stage1Size,
                }
              );
              const stage1GptElapsedMs = Date.now() - stage1GptStartMs;
              console.log(`⏱️ Stage 1 GPT generation time: ${(stage1GptElapsedMs / 1000).toFixed(2)}s`);
              if (stage1GptComparisonResult && !stage1GptComparisonResult.startsWith("data:")) {
                stage1GptComparisonResult = await fetchImageAsBase64(stage1GptComparisonResult);
              }
              if (stage1GptComparisonResult && userPhotoDimsForStage1) {
                const resizedStage1 = await resizeImageToDimensions(
                  stage1GptComparisonResult,
                  userPhotoDimsForStage1.width,
                  userPhotoDimsForStage1.height
                );
                if (resizedStage1) {
                  stage1GptComparisonResult = resizedStage1;
                  console.log(`✓ Stage 1 GPT resized to user dimensions: ${userPhotoDimsForStage1.width}x${userPhotoDimsForStage1.height}`);
                }
              }
              if (stage1GptComparisonResult) {
                try {
                  await saveBase64DebugImage("/tmp/debug_stage1_gpt_fusion_result.jpg", stage1GptComparisonResult);
                  console.log("✓ Saved Stage 1 GPT comparison result to /tmp/debug_stage1_gpt_fusion_result.jpg");
                } catch (error) {
                  console.warn("Could not save Stage 1 GPT comparison debug image:", error);
                }
              } else {
                console.warn("⚠️ GPT Stage 1 failed (generation falls back to raw reference mask source).");
              }

              stage1PrimaryFusionResult = stage1GptComparisonResult;
              stage1PrimaryProvider = stage1GptComparisonResult ? "gpt_image" : null;
              if (stage1PrimaryProvider) {
                console.log("✅ Stage 1 primary source for generation: GPT");
              }
            } else {
              console.warn("⚠️ Need at least 1 reference for Stage 1 reference-only call. Falling back to reference #1 mask source.");
            }

            const generateWithMask = async (
              ref: typeof prefetchedRefs[0],
              refIndex: number
            ): Promise<string | null> => {
              // Use global counter for debug indices (persists across "Generate More")
              debugRefIndexCounter++;
              const debugIdx = debugRefIndexCounter;
              
              // Save reference for debug page
              try {
                const fsDebug = await import("fs/promises");
                const originalRefBuffer = Buffer.from(
                  ref.base64.replace(/^data:image\/\w+;base64,/, ''),
                  'base64'
                );
                await fsDebug.writeFile(`/tmp/debug_reference_full_${debugIdx}.jpg`, originalRefBuffer);
                console.log(`✓ Saved reference to /tmp/debug_reference_full_${debugIdx}.jpg`);
                if (stage1GptComparisonResult) {
                  await saveDebugImageFromAnySource(`/tmp/debug_stage1_gpt_fusion_result_${debugIdx}.jpg`, stage1GptComparisonResult);
                }
              } catch (err) {
                console.warn(`Failed to save reference ${refIndex + 1}:`, err);
              }
              let frontImageUrl: string | null = null;
              let referenceGuidanceMask: string | null = null;
              const referenceMaskSource = stage1PrimaryFusionResult || ref.base64;

              try {
                referenceGuidanceMask = await createReferenceHairMaskForKleinSingleStage(referenceMaskSource);
                if (referenceGuidanceMask) {
                  await saveBase64DebugImage(`/tmp/debug_stage2_klein_reference_mask_${debugIdx}.jpg`, referenceGuidanceMask);
                  console.log(`   ✓ Saved reference hair guidance mask for klein: /tmp/debug_stage2_klein_reference_mask_${debugIdx}.jpg`);
                }
              } catch (error) {
                console.warn(`   ⚠️ Failed to prepare single-stage reference hair mask: ${error}`);
              }

              if (!referenceGuidanceMask) {
                console.warn(`   ⚠️ Could not build reference hair mask for generation ${debugIdx}, skipping ref ${refIndex + 1}`);
                return null;
              }
              
              try {
                console.log(`🎯 Using FLUX Klein single-stage pipeline`);
                try {
                  await saveBase64DebugImage(`/tmp/debug_user_image_${debugIdx}.jpg`, userPhotoBase64ForKlein);
                  await saveBase64DebugImage(`/tmp/debug_stage2_user_face_neck_mask_${debugIdx}.jpg`, userFaceMaskForKlein);
                } catch (e) {
                  console.warn(`   ⚠️ Could not save indexed Stage 2 face mask ${debugIdx}:`, e);
                }
                frontImageUrl = await generateSingleFluxKleinFromReferenceMask(
                  userPhotoBase64ForKlein,
                  userFaceMaskForKlein,
                  referenceGuidanceMask
                );
                if (frontImageUrl) {
                  try {
                    await saveDebugImageFromAnySource(`/tmp/debug_flux_stage2_result_${debugIdx}.jpg`, frontImageUrl);
                    console.log(`   ✓ Saved indexed Stage 2 result: /tmp/debug_flux_stage2_result_${debugIdx}.jpg`);
                  } catch (e) {
                    console.warn(`   ⚠️ Could not save indexed Stage 2 result ${debugIdx}:`, e);
                  }
                }
              } catch (err) {
                console.error(`Text mode generation failed:`, err);
              }
              
              return frontImageUrl;
            };
            
            // ========== Generate with reference #1 only ==========
            if (prefetchedRefs.length === 0) {
              console.warn("✗ No references available for single-stage generation.");
            } else {
              const refIndex = 0;
              const ref = prefetchedRefs[refIndex];
              console.log(`\n📸 Reference ${refIndex + 1}/${prefetchedRefs.length}: ${ref.source}`);
              const frontImageUrl = await generateWithMask(ref, refIndex);
              if (frontImageUrl) {
                generatedResults.push({
                  url: frontImageUrl,
                  refUrl: ref.url,
                  refSource: ref.source,
                  refIndex: refIndex
                });
                console.log(`✓ Generation ${generatedResults.length}/${MAX_GENERATIONS} completed (ref ${refIndex})`);
              } else {
                console.warn(`✗ Generation failed for ref ${refIndex + 1}`);
              }
            }
            
            if (generatedResults.length >= MAX_GENERATIONS) {
              console.log(`\n✅ All ${MAX_GENERATIONS} generations completed!`);
            }
            
            console.log(`\n🏁 Generation complete: ${generatedResults.length}/${MAX_GENERATIONS} successful`)
            
            // Store results: first one updates the original variant, others create new variants
            if (generatedResults.length > 0) {
              generationSucceeded = true;
              const modelDebug: ModelDebugInfo = {
                pipeline: stage1PrimaryProvider === "gpt_image"
                  ? "flux_klein_single_stage_with_gpt_stage1_fusion"
                  : "flux_klein_single_stage",
                stage1Provider: stage1PrimaryProvider || undefined,
                stage1Model: stage1PrimaryProvider === "gpt_image"
                  ? GENERATION_CONFIG.CHATGPT_MODEL
                  : undefined,
                stage2Model: MODEL_ID_FLUX_KLEIN_STAGE2,
                stage2Backend: "flux_klein",
                stage2PromptSource: stage1PrimaryProvider === "gpt_image"
                  ? "KLEIN_SINGLE_STAGE_REFERENCE_PROMPT + STAGE1_PROMPT_GPT"
                  : "KLEIN_SINGLE_STAGE_REFERENCE_PROMPT",
                maskPipeline: stage1PrimaryProvider === "gpt_image"
                  ? "gpt_stage1_fusion->stage1_feature_only_face_blot"
                  : "stage1_feature_only_face_blot",
                generatedAt: new Date().toISOString(),
              };
              
              // Get the ACTUAL reference index that was used (may not be 0 if earlier refs failed)
              const actualRefIndex = generatedResults[0].refIndex;
              
              // First result updates the original variant with the ACTUAL reference index used
              await storage.updateGeneratedVariant(variant.id, {
                generatedImageUrl: generatedResults[0].url,
                sideImageUrl: null,
                webReferenceImageUrl: generatedResults[0].refUrl,
                webReferenceSource: generatedResults[0].refSource,
                compositeData: mergeCompositeData(variant.compositeData, { modelDebug }),
                renderType: "ai",
                variantIndex: 0,
                referenceIndex: actualRefIndex,
                status: "completed",
              });
              console.log(`[MODEL DEBUG] Variant ${variant.id}: ${JSON.stringify(modelDebug)}`);
              
              // Update session's usedReferenceIndex to track which ref was actually used
              await storage.updateUserSession(sessionId, {
                usedReferenceIndex: actualRefIndex,
              });
              
              console.log(`✓ Result saved to original variant (referenceIndex: ${actualRefIndex})`);
              
              // Additional results (2 and 3) create new variants
              for (let i = 1; i < generatedResults.length; i++) {
                const result = generatedResults[i];
                await storage.createGeneratedVariant({
                  sessionId: session.id,
                  hairstyleId: null,
                  customPrompt: variant.customPrompt,
                  inspirationPhotoUrl: null,
                  styleType: variant.styleType || "hairstyle",
                  generatedImageUrl: result.url,
                  webReferenceImageUrl: result.refUrl,
                  webReferenceSource: result.refSource,
                  compositeData: mergeCompositeData(null, { modelDebug }),
                  renderType: "ai",
                  variantIndex: i,
                  status: "completed",
                });
                console.log(`✓ Result ${i + 1} saved as new variant`);
              }
              
              console.log(`✓ Text mode complete: ${generatedResults.length} distinct generations`);
            } else {
              await storage.updateGeneratedVariant(variant.id, {
                status: "failed",
              });
            }
            } // Close BFL pipeline else block
          }
        }
      }

      // Handle credits after generation attempt (skip if in dev unlimited mode or internal request)
      if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV && !isInternalRequest) {
        if (isAnonymous) {
          // Anonymous user - only deduct cookie credit if generation succeeded
          if (generationSucceeded) {
            const currentUsed = getAnonymousCreditsUsed(req);
            setAnonymousCreditsUsed(res, currentUsed + creditsNeeded, req);
          }
          // No refund needed for anonymous - we only deduct on success
        } else if (userId) {
          // Authenticated user - refund if generation failed
          const user = await storage.getUser(userId);
          if (!generationSucceeded && creditsDeducted && user && user.plan !== "business") {
            await storage.addCredits(userId, creditsNeeded, "refund", "Credit refund due to generation failure");
          }
        }
      }

      const updatedVariants = await storage.getGeneratedVariantsBySessionId(sessionId);
      
      // Include credits info in response
      let creditsInfo: any = {};
      if (isAnonymous) {
        const remaining = ANONYMOUS_CREDITS_LIMIT - getAnonymousCreditsUsed(req) - (generationSucceeded ? creditsNeeded : 0);
        creditsInfo = {
          isAuthenticated: false,
          anonymousCreditsRemaining: Math.max(0, remaining),
          anonymousCreditsLimit: ANONYMOUS_CREDITS_LIMIT
        };
      } else if (userId) {
        const user = await storage.getUser(userId);
        creditsInfo = {
          isAuthenticated: true,
          currentCredits: user?.credits ?? 0,
          plan: user?.plan ?? "free"
        };
      }
      
      // Record metrics for successful generation
      if (generationSucceeded) {
        recordGenerationSuccess(Date.now() - generationStartTime);
      } else {
        recordGenerationFailure("generation_failed");
      }
      
      // Release the generation lock so next queued item can proceed
      releaseGenerationLock(sessionId);
      
      res.json({ variants: updatedVariants, ...creditsInfo });
    } catch (error) {
      console.error("Error generating hairstyles:", error);
      recordGenerationFailure("exception");
      
      // Release the generation lock on error
      const sessionId = req.params.sessionId;
      if (sessionId) {
        releaseGenerationLock(sessionId);
      }
      
      // Mark all processing variants as failed to stop infinite polling
      try {
        if (sessionId) {
          const variants = await storage.getGeneratedVariantsBySessionId(sessionId);
          for (const v of variants) {
            if (v.status === "processing") {
              await storage.updateGeneratedVariant(v.id, { status: "failed" });
              console.log(`Marked variant ${v.id} as failed due to error`);
            }
          }
        }
      } catch (cleanupError) {
        console.error("Failed to cleanup variants:", cleanupError);
      }
      
      res.status(500).json({ error: "Failed to generate hairstyles" });
    }
  });


  // Toggle favorite status for a generated variant (works for both logged-in and anonymous users)
  app.post("/api/variant/:variantId/toggle-favorite", async (req, res) => {
    try {
      const deviceId = getOrCreateDeviceId(req, res); // Create device ID if not exists
      
      const { variantId } = req.params;
      
      console.log(`[TOGGLE-FAVORITE] variantId=${variantId}, deviceId=${deviceId}`);
      
      const variant = await storage.getGeneratedVariant(variantId);
      if (!variant) {
        return res.status(404).json({ error: "Variant not found" });
      }
      
      console.log(`[TOGGLE-FAVORITE] Current state: isFavorited=${variant.isFavorited}, favoritedByDeviceId=${variant.favoritedByDeviceId}`);
      
      // Check if currently favorited by this device
      const isCurrentlyFavoritedByThisDevice = deviceId && variant.favoritedByDeviceId === deviceId;
      
      const newFavoriteStatus = !isCurrentlyFavoritedByThisDevice;
      
      console.log(`[TOGGLE-FAVORITE] isCurrentlyFavoritedByThisDevice=${isCurrentlyFavoritedByThisDevice}, newFavoriteStatus=${newFavoriteStatus}`);
      
      await storage.updateGeneratedVariant(variantId, { 
        isFavorited: newFavoriteStatus,
        favoritedByDeviceId: newFavoriteStatus ? deviceId : null,
        favoritedAt: newFavoriteStatus ? new Date() : null,
      });
      
      console.log(`[TOGGLE-FAVORITE] Updated to: isFavorited=${newFavoriteStatus}, favoritedByDeviceId=${newFavoriteStatus ? deviceId : null}`);
      
      res.json({ success: true, isFavorited: newFavoriteStatus });
    } catch (error) {
      console.error("Error toggling favorite:", error);
      res.status(500).json({ error: "Failed to toggle favorite" });
    }
  });

  // Toggle dislike status for a generated variant (thumbs down rating)
  app.post("/api/variant/:variantId/toggle-dislike", async (req, res) => {
    try {
      const deviceId = getOrCreateDeviceId(req, res);
      
      const { variantId } = req.params;
      
      console.log(`[TOGGLE-DISLIKE] variantId=${variantId}, deviceId=${deviceId}`);
      
      const variant = await storage.getGeneratedVariant(variantId);
      if (!variant) {
        return res.status(404).json({ error: "Variant not found" });
      }
      
      console.log(`[TOGGLE-DISLIKE] Current state: isDisliked=${variant.isDisliked}, dislikedByDeviceId=${variant.dislikedByDeviceId}`);
      
      // Check if currently disliked by this device
      const isCurrentlyDisliked = variant.dislikedByDeviceId === deviceId;
      const newDislikeStatus = !isCurrentlyDisliked;
      
      console.log(`[TOGGLE-DISLIKE] isCurrentlyDisliked=${isCurrentlyDisliked}, newDislikeStatus=${newDislikeStatus}`);
      
      await storage.updateGeneratedVariant(variantId, { 
        isDisliked: newDislikeStatus,
        dislikedByDeviceId: newDislikeStatus ? deviceId : null,
        dislikedAt: newDislikeStatus ? new Date() : null,
      });
      
      console.log(`[TOGGLE-DISLIKE] Updated to: isDisliked=${newDislikeStatus}, dislikedByDeviceId=${newDislikeStatus ? deviceId : null}`);
      
      res.json({ success: true, isDisliked: newDislikeStatus });
    } catch (error) {
      console.error("Error toggling dislike:", error);
      res.status(500).json({ error: "Failed to toggle dislike" });
    }
  });

  // Refine a generated variant with a new prompt
  // Always tries current generation first, falls back to original photo if NSFW error
  app.post("/api/refine-generation/:variantId", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { variantId } = req.params;
      const { refinementPrompt } = req.body;

      if (!refinementPrompt) {
        return res.status(400).json({ error: "Refinement prompt is required" });
      }

      console.log(`Refine request: prompt="${refinementPrompt}"`);

      const variant = await storage.getGeneratedVariant(variantId);
      if (!variant) {
        return res.status(404).json({ error: "Variant not found" });
      }

      const session = await storage.getUserSession(variant.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Beta limit: Maximum 15 generations per session
      const sessionVariants = await storage.getGeneratedVariantsBySessionId(variant.sessionId);
      if (sessionVariants && sessionVariants.length >= MAX_GENERATIONS_PER_SESSION) {
        return res.status(400).json({ 
          error: "SESSION_LIMIT_REACHED",
          message: `You've reached the maximum of ${MAX_GENERATIONS_PER_SESSION} generations for this session. Start a new session to continue exploring styles.`,
          isSessionLimit: true
        });
      }

      const creditsNeeded = 1;

      // Check credits
      if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
        if (userId) {
          const user = await storage.getUser(userId);
          if (!user) {
            return res.status(404).json({ error: "User not found" });
          }

          if (user.plan === "business") {
            // Business plan has unlimited
          } else if (user.credits < creditsNeeded) {
            return res.status(402).json({ 
              error: "Insufficient credits",
              creditsNeeded,
              currentCredits: user.credits,
              isAuthenticated: true
            });
          } else {
            await storage.deductCredits(userId, creditsNeeded);
          }
        } else {
          // Anonymous user check
          const anonymousCreditsRemaining = getAnonymousCreditsRemaining(req);
          if (anonymousCreditsRemaining < creditsNeeded) {
            return res.status(402).json({ 
              error: "Daily limit reached",
              message: "Your 15 daily generations are used up. Credits reset in 24 hours!"
            });
          }
        }
      }

      // Calculate refinement number for this new variant
      const existingVariants = await storage.getGeneratedVariantsBySessionId(variant.sessionId);
      const maxRefinement = existingVariants.reduce((max, v) => {
        const refNum = (v as any).refinementNumber;
        return Math.max(max, typeof refNum === 'number' ? refNum : 0);
      }, 0);
      const newRefinementNumber = maxRefinement + 1;
      
      console.log(`Existing variants: ${existingVariants.length}, max refinement: ${maxRefinement}, new refinement: ${newRefinementNumber}`);

      // Create a NEW variant for this refinement
      const newVariant = await storage.createGeneratedVariant({
        sessionId: variant.sessionId,
        hairstyleId: variant.hairstyleId,
        customPrompt: refinementPrompt,
        inspirationPhotoUrl: variant.inspirationPhotoUrl,
        styleType: variant.styleType || "hairstyle",
        status: "processing",
        parentVariantId: variantId,
        refinementNumber: newRefinementNumber,
        refinementPrompt: refinementPrompt,
      });

      console.log(`Creating refinement #${newRefinementNumber} from variant ${variantId}, new variant: ${newVariant.id}`);
      console.log(`Parent variant has generatedImageUrl: ${variant.generatedImageUrl ? 'YES' : 'NO'}`);
      console.log(`Parent variant URL: ${variant.generatedImageUrl || 'NONE - will use original photo'}`);
      console.log(`Session original photo: ${session.photoUrl?.substring(0, 50)}...`);

      // Validate we have required images
      if (!variant.generatedImageUrl) {
        await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
        return res.status(400).json({ error: "Cannot refine - no generated image available" });
      }

      if (!session.photoUrl) {
        await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
        return res.status(400).json({ error: "Cannot refine - no original photo available" });
      }

      // === Build cache key matching the format used in /api/preprocess-photo ===
      // Format: For long URLs, use photo_${length}_${first50chars}, otherwise use the URL directly
      const maskCacheKey = session.photoUrl.length > 100 
        ? `photo_${session.photoUrl.length}_${session.photoUrl.slice(0, 50)}`
        : session.photoUrl;
      const cachedPreprocess = await preprocessCache.get(maskCacheKey);
      // Allow 2 hour expiry to match the database cache setting
      const cacheValid = cachedPreprocess && Date.now() - cachedPreprocess.timestamp < 2 * 60 * 60 * 1000;
      console.log(`[REFINE] Cache key: ${maskCacheKey.substring(0, 60)}..., cached: ${cacheValid ? 'YES' : 'NO'}`);

      // === STEP 1: Get user mask from cache or create new ===
      let userMask: string | null = null;
      if (cacheValid && cachedPreprocess.maskedImage) {
        userMask = cachedPreprocess.maskedImage;
        console.log(`[REFINE] Using cached user mask: ${userMask.length} chars`);
      } else {
        console.log(`[REFINE] Creating new user mask from original photo...`);
        userMask = await createUserMaskedImage(session.photoUrl, 10);
        if (!userMask) {
          console.error(`[REFINE] Failed to create user mask`);
          await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
          return res.status(500).json({ error: "Failed to create user mask" });
        }
        console.log(`[REFINE] User mask created: ${userMask.length} chars`);
        
        // Cache it for future use
        await preprocessCache.set(maskCacheKey, {
          ...cachedPreprocess,
          maskedUserPhoto: userMask,
          maskedImage: userMask,
          timestamp: Date.now(),
        });
        console.log(`[REFINE] Cached user mask for future use`);
      }

      // === STEP 2: Get full generated image ===
      console.log(`[REFINE] Fetching full generated image...`);
      let generatedImageBase64: string;
      try {
        const genImgResponse = await fetch(variant.generatedImageUrl);
        if (!genImgResponse.ok) {
          throw new Error(`Failed to fetch generated image: ${genImgResponse.status}`);
        }
        const genImgBuffer = await genImgResponse.arrayBuffer();
        generatedImageBase64 = `data:image/jpeg;base64,${Buffer.from(genImgBuffer).toString('base64')}`;
        console.log(`[REFINE] Full generated image fetched: ${generatedImageBase64.length} chars`);
      } catch (fetchErr) {
        console.error(`[REFINE] Failed to fetch generated image:`, fetchErr);
        await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
        return res.status(500).json({ error: "Failed to fetch generated image" });
      }

      // === STEP 2.5: Create hair-only mask from generated image ===
      console.log(`[REFINE] Creating hair-only mask from generated image...`);
      let generatedHairOnlyMask: string | null = null;
      try {
        const hairMaskResult = await createHairOnlyImage(generatedImageBase64, 30, true);
        if (hairMaskResult.image) {
          generatedHairOnlyMask = hairMaskResult.image;
          console.log(`[REFINE] ✓ Hair-only mask created: ${generatedHairOnlyMask.length} chars`);
        } else {
          console.log(`[REFINE] ⚠️ Hair-only mask creation failed, will use full generated image only`);
        }
      } catch (hairMaskErr) {
        console.log(`[REFINE] ⚠️ Hair-only mask creation error:`, hairMaskErr);
      }

      // === STEP 3: Get user ethnicity from cache (try multiple sources) ===
      let ethnicity = "";  // Empty default - will be handled in prompt construction
      // First try userAnalysis.raceEthnicity (even if cache expired, ethnicity is still valid)
      if (cachedPreprocess?.userAnalysis?.raceEthnicity) {
        ethnicity = cachedPreprocess.userAnalysis.raceEthnicity;
        console.log(`[REFINE] Using cached ethnicity from userAnalysis: ${ethnicity}`);
      } else if (cachedPreprocess?.visionResult?.raceEthnicity) {
        ethnicity = cachedPreprocess.visionResult.raceEthnicity;
        console.log(`[REFINE] Using cached ethnicity from visionResult: ${ethnicity}`);
      } else {
        // Try session's facialFeatures as next fallback
        try {
          const features = JSON.parse(session.facialFeatures || "{}");
          if (features.raceEthnicity) {
            ethnicity = features.raceEthnicity;
            console.log(`[REFINE] Using ethnicity from session facialFeatures: ${ethnicity}`);
          }
        } catch (e) { /* ignore parse errors */ }
        
        // If still no ethnicity, try database cache
        if (!ethnicity) {
          try {
            const dbCache = await storage.getPreprocessingCache(maskCacheKey);
            if (dbCache?.ethnicity) {
              ethnicity = dbCache.ethnicity;
              console.log(`[REFINE] Using ethnicity from database cache: ${ethnicity}`);
            } else {
              console.log(`[REFINE] No cached ethnicity found, using neutral prompt`);
            }
          } catch (e) {
            console.log(`[REFINE] No cached ethnicity, using neutral prompt`);
          }
        }
      }
      
      // Map ethnicity to hair type description (only if we have ethnicity)
      let hairTypeDescriptor = "";
      if (ethnicity) {
        const ethnicityToHairType: Record<string, string> = {
          "white": "European",
          "black": "African",
          "asian": "East Asian",
          "latino": "Latino",
          "middle_eastern": "Middle Eastern",
          "south_asian": "South Asian",
          "southeast_asian": "Southeast Asian",
          "mixed": "natural"
        };
        hairTypeDescriptor = ethnicityToHairType[ethnicity.toLowerCase()] || ethnicity;
        console.log(`[REFINE] Using hair type descriptor: ${hairTypeDescriptor}`);
      }
      
      // === STEP 3.5: Get original user photo (same as original generation uses for image 3) ===
      // Using original photo as input_image_3 allows the model to apply the refinement
      // rather than being constrained by the generated image as a reference
      const originalUserPhoto = session.photoUrl;
      console.log(`[REFINE] Using original user photo for image 3: ${originalUserPhoto?.substring(0, 50)}...`);
      
      if (!originalUserPhoto) {
        console.error(`[REFINE] No original user photo found in session`);
        await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
        return res.status(500).json({ error: "No original user photo found" });
      }

      // === STEP 4: Use GPT-4o-mini to understand refinement and create upsampled prompt ===
      // Format: "Preserve the exact person in image 1 and their face. {vision prompt}. Preserve the person's background in image 3. Preserve the person's {ethnicity} hairtype. Natural photorealistic look."
      console.log(`[REFINE] Using GPT-4o-mini to analyze hairstyle and create enhanced prompt...`);
      console.log(`[REFINE] 📝 User's refinement request: "${refinementPrompt}"`);
      
      let refinementFullPrompt: string;
      const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
      const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
      
      if (openaiApiKey && variant.generatedImageUrl) {
        try {
          const promptEnhanceStart = Date.now();
          const promptEnhanceResponse = await fetch(`${openaiBaseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiApiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `You are a world-class professional hairstylist with deep expertise in face shape analysis, hair type, and modern style trends.

The user wants to refine this hairstyle with: "${refinementPrompt}"

Your task is to:
1. Identify which SECTION of the hair the user wants to modify (e.g., top, sides, fade, color, texture, length, etc.)
2. Provide a DETAILED and SPECIFIC INSTRUCTION for that modification

CRITICAL SCOPE RESTRICTION:
- You may ONLY modify the specific section the user mentioned
- DO NOT touch, change, or suggest improvements to any other sections
- Everything the user didn't mention must stay EXACTLY the same

BILATERAL SYMMETRY RULE:
- When the user mentions "sides", "temples", "edges", or any paired feature, you MUST explicitly specify BOTH sides (e.g., "both the left and right sides")
- Example: "fade the sides" → "Fade both the left and right sides of the hair in image 2..."
- This ensures symmetrical application to both sides of the head

DETAIL REQUIREMENT:
- Your instruction MUST explicitly state the ACTION the AI should take (e.g., "lower", "raise", "add", "reduce", "shorten", "lengthen")
- Include specific positioning details (e.g., "approximately 1 inch above the ears")
- Do NOT mention or reference other areas of the hair that the user did not ask about
- Keep instructions focused ONLY on the section the user mentioned

OUTPUT FORMAT: Return exactly two lines:
SECTION: [the specific part of the hair the user wants to change]
INSTRUCTION: [action-oriented instruction starting with "[Action]..." referencing "the hair in image 2" with specific positioning details - NO period at the end]

Examples:
SECTION: sides
INSTRUCTION: Lower the position of the fade on both the left and right sides of the hair in image 2 to start approximately 1 inch above the ears

SECTION: top
INSTRUCTION: Add more volume to the hair in image 2 on top, making it appear fuller and lifted

SECTION: color
INSTRUCTION: Add subtle blonde highlights throughout the hair in image 2

Return ONLY these two lines. No explanations or preamble. Do NOT include a period at the end of the INSTRUCTION.`
                    },
                    {
                      type: "image_url",
                      image_url: { url: variant.generatedImageUrl }
                    }
                  ]
                }
              ],
              max_tokens: 200,
              temperature: 0.3,
            }),
          });

          if (promptEnhanceResponse.ok) {
            const promptData = await promptEnhanceResponse.json();
            let visionResponse = promptData.choices?.[0]?.message?.content?.trim();
            
            // Remove all quotation marks from vision response
            if (visionResponse) {
              visionResponse = visionResponse.replace(/["']/g, '');
            }
            
            // Parse SECTION and INSTRUCTION from response
            let section = "hairstyle"; // default fallback
            let instruction = "";
            
            if (visionResponse) {
              const sectionMatch = visionResponse.match(/SECTION:\s*(\w+)/i);
              const instructionMatch = visionResponse.match(/INSTRUCTION:\s*(.+)/i);
              
              if (sectionMatch) {
                section = sectionMatch[1].toLowerCase();
              }
              if (instructionMatch) {
                instruction = instructionMatch[1].trim();
              }
            }
            
            if (instruction && instruction.length > 10) {
              // Build the full prompt with 3-image refinement pipeline:
              // Image 1: user mask, Image 2: hair-only from generated, Image 3: full generated image
              // Remove trailing period from instruction if present
              const cleanInstruction = instruction.replace(/\.$/, '');
              refinementFullPrompt = `Preserve the exact face of the person in image 1. ${cleanInstruction} while preserving the person's overall hairstyle in image 2. Preserve the image background in image 3. Natural photorealistic look.`.replace(/\s+/g, ' ').trim();
              
              const promptEnhanceTime = Date.now() - promptEnhanceStart;
              console.log(`[REFINE] ✓ GPT-4o-mini enhanced prompt (${(promptEnhanceTime / 1000).toFixed(2)}s):`);
              console.log(`[REFINE]   Original: "${refinementPrompt}"`);
              console.log(`[REFINE]   Section: "${section}"`);
              console.log(`[REFINE]   Instruction: "${instruction}"`);
              console.log(`[REFINE]   Full prompt: "${refinementFullPrompt.substring(0, 180)}..."`);
            } else {
              console.log(`[REFINE] ⚠️ GPT-4o-mini response parsing failed, using fallback prompt`);
              console.log(`[REFINE]   Raw response: "${visionResponse}"`);
              refinementFullPrompt = `Preserve the exact face of the person in image 1. ${refinementPrompt} while preserving the person's overall hairstyle in image 2. Preserve the image background in image 3. Natural photorealistic look.`.replace(/\s+/g, ' ').trim();
            }
          } else {
            const errorText = await promptEnhanceResponse.text();
            console.log(`[REFINE] ⚠️ GPT-4o-mini prompt enhancement failed: ${promptEnhanceResponse.status} - ${errorText}`);
            refinementFullPrompt = `Preserve the exact face of the person in image 1. ${refinementPrompt} while preserving the person's overall hairstyle in image 2. Preserve the image background in image 3. Natural photorealistic look.`.replace(/\s+/g, ' ').trim();
          }
        } catch (promptError) {
          console.log(`[REFINE] ⚠️ GPT-4o-mini prompt enhancement error:`, promptError);
          refinementFullPrompt = `Preserve the exact face of the person in image 1. ${refinementPrompt} while preserving the person's overall hairstyle in image 2. Preserve the image background in image 3. Natural photorealistic look.`.replace(/\s+/g, ' ').trim();
        }
      } else {
        console.log(`[REFINE] No OpenAI API key or generated image, using basic prompt`);
        refinementFullPrompt = `Preserve the exact face of the person in image 1. ${refinementPrompt} while preserving the person's overall hairstyle in image 2. Preserve the image background in image 3. Natural photorealistic look.`.replace(/\s+/g, ' ').trim();
      }
      
      console.log(`[REFINE] Final BFL prompt: ${refinementFullPrompt}`);

      // Use BFL FLUX 2 Pro for refinement with 3-image pipeline
      const callBflRefinement = async (): Promise<{ success: boolean; imageUrl?: string; error?: string }> => {
        if (!BFL_API_KEY) {
          return { success: false, error: "BFL API key not configured" };
        }

        try {
          // Build request body with 3-image pipeline for refinement:
          // Image 1: User mask (face visible, hair grayed)
          // Image 2: Hair-only mask from generated image (hairstyle to preserve/modify)
          // Image 3: Full generated image (background reference)
          const requestBody: any = {
            prompt: refinementFullPrompt,
            input_image: userMask,              // User mask (face to preserve)
            input_image_2: generatedHairOnlyMask || generatedImageBase64, // Hair-only mask (or fallback to full)
            input_image_3: generatedImageBase64, // Full generated image (background)
            safety_tolerance: GENERATION_CONFIG.TEXT_MODE_SAFETY_TOLERANCE || 0,
          };

          console.log(`[REFINE] Sending 3-image pipeline to BFL:`);
          console.log(`  input_image (user mask): ${userMask.length} chars`);
          console.log(`  input_image_2 (hair-only mask): ${(generatedHairOnlyMask || generatedImageBase64).length} chars${generatedHairOnlyMask ? '' : ' (fallback: full image)'}`);
          console.log(`  input_image_3 (full generated): ${generatedImageBase64.length} chars`);

          const submitResponse = await fetch(BFL_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-key": BFL_API_KEY!,
            },
            body: JSON.stringify(requestBody),
          });

          if (!submitResponse.ok) {
            const errorText = await submitResponse.text();
            console.error(`BFL refinement submission error: ${submitResponse.status} - ${errorText}`);
            return { success: false, error: errorText };
          }

          const submitData = await submitResponse.json();
          console.log(`BFL refinement submission:`, submitData.id);

          const pollingUrl = submitData.polling_url;
          if (!pollingUrl) {
            return { success: false, error: "No polling URL returned from BFL" };
          }

          // Poll for result (max 600 seconds / 10 minutes)
          const maxAttempts = GENERATION_TIMEOUT_SECONDS;
          let attempts = 0;
          const pollStartTime = Date.now();
          let lastLogTime = 0;

          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const pollResponse = await fetch(pollingUrl, {
              headers: { "x-key": BFL_API_KEY! },
            });

            if (!pollResponse.ok) {
              attempts++;
              continue;
            }

            const result = await pollResponse.json();
            
            // Log status every 10 seconds (time-based)
            const elapsedSeconds = Math.floor((Date.now() - pollStartTime) / 1000);
            if (elapsedSeconds >= lastLogTime + 10) {
              console.log(`   ⏳ Refining... ${elapsedSeconds}s (${result.status})`);
              lastLogTime = elapsedSeconds;
            }

            if (result.status === "Ready" || result.status === "succeeded") {
              const resultImageUrl = result.result?.sample || null;
              if (resultImageUrl) {
                console.log(`   ✓ Refinement complete (${elapsedSeconds}s)`);
                return { success: true, imageUrl: resultImageUrl };
              }
              return { success: false, error: "No image URL in BFL response" };
            } else if (result.status === "Error" || result.status === "Failed" || result.status === "error" || result.status === "failed") {
              console.error(`BFL refinement failed:`, result);
              return { success: false, error: result.error || "BFL generation failed" };
            }

            attempts++;
          }

          generationMetrics.timeouts++;
          return { success: false, error: "GENERATION_TIMEOUT", isTimeout: true };
        } catch (error) {
          console.error("BFL refinement error:", error);
          return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
        }
      };

      console.log(`[REFINE] Starting BFL generation with 3-image pipeline...`);
      const result = await callBflRefinement();

      if (result.success && result.imageUrl) {
        // Log URL comparison to confirm new image was generated
        const originalUrl = variant.generatedImageUrl || '';
        const newUrl = result.imageUrl;
        console.log(`\n✅ [REFINE] URL COMPARISON:`);
        console.log(`   📸 ORIGINAL: ${originalUrl.substring(0, 80)}...`);
        console.log(`   🆕 NEW:      ${newUrl.substring(0, 80)}...`);
        console.log(`   🔄 DIFFERENT: ${originalUrl !== newUrl ? 'YES ✓' : 'NO ⚠️'}`);
        
        await storage.updateGeneratedVariant(newVariant.id, {
          generatedImageUrl: result.imageUrl,
          status: "completed",
        });

        // Update cookie for anonymous users
        if (!userId && !GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
          const currentUsed = getAnonymousCreditsUsed(req);
          setAnonymousCreditsUsed(res, currentUsed + creditsNeeded, req);
        }

        res.json({ 
          success: true, 
          variantId: newVariant.id, 
          refinementNumber: newRefinementNumber,
          generatedImageUrl: result.imageUrl
        });
      } else {
        await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
        throw new Error(result.error || "Generation failed");
      }
    } catch (error) {
      console.error("Error refining generation:", error);
      res.status(500).json({ error: "Failed to refine generation" });
    }
  });

  // AurenIQ - Initial generation using AI feature analysis
  // Analyzes user photo for features and finds trending celebrity haircuts that match
  app.post("/api/generate-aureniq/:sessionId", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { sessionId } = req.params;
      const forceNewMask = req.query.forceNewMask === "true";

      console.log("============================================================");
      console.log("🤖 AURENIQ GENERATION");
      console.log("============================================================");
      if (forceNewMask) {
        console.log("⚠️ Force new mask requested - bypassing cache");
      }

      const session = await storage.getUserSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const creditsNeeded = 1;
      let isAnonymous = false;

      // Check credits
      if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
        if (userId) {
          await storage.resetDailyCredits(userId);
          const user = await storage.getUser(userId);
          if (!user) {
            return res.status(404).json({ error: "User not found" });
          }

          if (user.plan === "business") {
            // Business plan has unlimited
          } else if (user.credits < creditsNeeded) {
            return res.status(402).json({ 
              error: "Insufficient credits",
              creditsNeeded,
              currentCredits: user.credits,
              isAuthenticated: true
            });
          } else {
            await storage.deductCredits(userId, creditsNeeded);
          }
        } else {
          isAnonymous = true;
          const anonymousCreditsRemaining = getAnonymousCreditsRemaining(req);
          if (anonymousCreditsRemaining < creditsNeeded) {
            return res.status(402).json({ 
              error: "Daily limit reached",
              message: "Your 15 daily generations are used up. Credits reset in 24 hours!"
            });
          }
        }
      }

      // Step 1: Analyze user's photo for features
      console.log("📊 Analyzing user features...");
      
      const maskCacheKey = generateCacheKey(session.photoUrl);
      const cachedPreprocess = await preprocessCache.get(maskCacheKey);
      
      let analysis: UserPhotoAnalysis | null = null;
      if (cachedPreprocess?.userAnalysis && Date.now() - cachedPreprocess.timestamp < 30 * 60 * 1000) {
        console.log("   ✓ Using cached user analysis");
        analysis = cachedPreprocess.userAnalysis;
      } else {
        analysis = await analyzeUserPhoto(session.photoUrl);
      }
      
      if (!analysis) {
        return res.status(500).json({ error: "Failed to analyze photo" });
      }

      console.log(`   👤 Detected: ${analysis.gender} ${analysis.raceEthnicity}, ${analysis.faceShape} face, ${analysis.skinTone} skin`);

      // Step 2: Build search query for trending celebrity haircuts
      // Format: "trending celebrity hairstyles for {race} {gender}"
      const genderTerms: Record<string, string> = { "male": "men", "female": "women" };
      const genderTerm = genderTerms[analysis.gender] || "";
      
      const raceTerms: Record<string, string> = {
        "asian": "asian",
        "black": "black",
        "white": "white",
        "latino": "latino",
        "middle_eastern": "middle eastern",
        "south_asian": "south asian",
        "southeast_asian": "southeast asian",
        "mixed": ""
      };
      const raceTerm = raceTerms[analysis.raceEthnicity] || "";
      
      const searchQuery = `trending celebrity hairstyles for ${raceTerm} ${genderTerm} 2024 2025`.trim().replace(/\s+/g, " ");
      console.log(`   🔍 Search: "${searchQuery}"`);

      // Step 3: Search for celebrity haircuts with vision selection (like text mode)
      const CANDIDATES_TO_ANALYZE = GENERATION_CONFIG.TEXT_MODE_CANDIDATES_TO_ANALYZE;
      const PREFILTER_TOP_N = GENERATION_CONFIG.TEXT_MODE_PREFILTER_TOP_N || 16;
      
      const frontResults = await searchWebForHairstyleImages(searchQuery, analysis, CANDIDATES_TO_ANALYZE, "front");
      
      if (frontResults.length === 0) {
        console.log("   ⚠️ No results, trying fallback search...");
        const fallbackResults = await searchWebForHairstyleImages(
          `best trending hairstyles for ${raceTerm} ${genderTerm} 2024`,
          analysis,
          CANDIDATES_TO_ANALYZE
        );
        frontResults.push(...fallbackResults);
      }
      
      if (frontResults.length === 0) {
        return res.status(500).json({ error: "Could not find matching celebrity haircuts" });
      }

      console.log(`   📷 Found ${frontResults.length} celebrity haircut images`);

      // Fetch and filter candidates (same as text mode)
      const CONCURRENT_FETCHES = 20;
      const toFetch = frontResults.slice(0, CANDIDATES_TO_ANALYZE);
      
      type FetchResult = {
        base64: string; imageUrl: string; title: string; source: string;
        index: number; width: number; height: number; minDimension: number;
      } | null;
      
      const allFetchedResults: FetchResult[] = [];
      
      const fetchOne = async (result: typeof toFetch[0], i: number): Promise<FetchResult> => {
        try {
          const base64 = await fetchFirstAccessibleImage([result.imageUrl]);
          if (base64) {
            const dims = await getImageDimensions(base64);
            if (dims) {
              return {
                base64, imageUrl: result.imageUrl, title: result.title, source: result.source,
                index: i, width: dims.width, height: dims.height, minDimension: Math.min(dims.width, dims.height)
              };
            }
          }
        } catch {}
        return null;
      };
      
      for (let i = 0; i < toFetch.length; i += CONCURRENT_FETCHES) {
        const batch = toFetch.slice(i, i + CONCURRENT_FETCHES);
        const batchResults = await Promise.all(batch.map((r, idx) => fetchOne(r, i + idx)));
        allFetchedResults.push(...batchResults);
      }
      
      const allFetched = allFetchedResults.filter((r): r is NonNullable<typeof r> => r !== null);
      const minSizeCandidates = allFetched.filter(r => r.minDimension >= 400);
      const candidates: ReferenceCandidate[] = minSizeCandidates.sort((a, b) => b.minDimension - a.minDimension).slice(0, PREFILTER_TOP_N);
      
      console.log(`   📥 Fetched ${allFetched.length}/${toFetch.length} → ${candidates.length} for vision`);

      let prefetchedRefs: { base64: string; url: string; source: string }[] = [];
      let visionHairstyleDescription = "";

      if (candidates.length > 0 && GENERATION_CONFIG.TEXT_MODE_VISION_SELECTION) {
        // Fetch user photo for vision comparison
        let userPhotoForRanking: string | undefined;
        try {
          const photoResponse = await fetch(session.photoUrl);
          if (photoResponse.ok) {
            const photoBuffer = await photoResponse.arrayBuffer();
            userPhotoForRanking = `data:image/jpeg;base64,${Buffer.from(photoBuffer).toString('base64')}`;
          }
        } catch (e) {
          console.log(`   Could not fetch user photo for ranking, continuing without it`);
        }
        
        // Use vision to select best references
        const visionResult = await selectTopReferencesWithVision(
          candidates,
          `Best trending celebrity hairstyle for ${analysis.gender} ${analysis.raceEthnicity} with ${analysis.faceShape} face`,
          analysis,
          10,
          ""  // No pre-existing hairstyle description for AurenIQ
        );
        
        visionHairstyleDescription = visionResult.hairstyleDescription;
        
        if (visionResult.candidates.length > 0) {
          console.log(`   🎯 Vision selected ${visionResult.candidates.length} refs: "${visionHairstyleDescription.substring(0, 50)}..."`);
          for (const c of visionResult.candidates) {
            prefetchedRefs.push({ base64: c.base64, url: c.imageUrl, source: c.title || c.source });
          }
        } else {
          for (let i = 0; i < Math.min(10, candidates.length); i++) {
            prefetchedRefs.push({ base64: candidates[i].base64, url: candidates[i].imageUrl, source: candidates[i].title || candidates[i].source });
          }
        }
      } else {
        for (let i = 0; i < Math.min(6, candidates.length); i++) {
          prefetchedRefs.push({ base64: candidates[i].base64, url: candidates[i].imageUrl, source: candidates[i].source });
        }
      }

      if (prefetchedRefs.length === 0) {
        return res.status(500).json({ error: "No usable reference images found" });
      }

      // Step 4: Get or create masked user photo
      let maskedUserPhoto: string | null = null;
      const shouldUseCache = !forceNewMask && cachedPreprocess?.maskedUserPhoto && Date.now() - cachedPreprocess.timestamp < 30 * 60 * 1000;
      if (shouldUseCache) {
        maskedUserPhoto = cachedPreprocess.maskedUserPhoto;
        console.log("   ✓ Using cached user mask");
        
        // Ensure analysis is cached for refinements (even if mask was cached)
        if (analysis && (!cachedPreprocess.userAnalysis || !cachedPreprocess.userAnalysis.raceEthnicity)) {
          await preprocessCache.set(maskCacheKey, {
            ...cachedPreprocess,
            userAnalysis: analysis,
            visionResult: analysis,
            timestamp: Date.now(),
          });
          console.log("   ✓ Updated cache with analysis for refinements");
        }
      } else {
        // Create user mask if not cached
        console.log("   🎭 Creating user mask...");
        maskedUserPhoto = await createUserMaskedImage(session.photoUrl, 10);
        if (maskedUserPhoto) {
          console.log("   ✓ Created user mask");
          // Cache it for future use - set both keys for compatibility AND include analysis for refinements
          await preprocessCache.set(maskCacheKey, {
            ...cachedPreprocess,
            maskedUserPhoto,
            maskedImage: maskedUserPhoto, // Also set maskedImage for Generate More / Refine compatibility
            userAnalysis: analysis, // Include analysis for ethnicity lookup in refinements
            visionResult: analysis, // Also set visionResult for compatibility
            timestamp: Date.now(),
          });
        } else {
          console.log("   ⚠️ Could not create user mask, proceeding without it");
        }
      }

      // Save features and references to session
      const existingFeatures = session.facialFeatures ? JSON.parse(session.facialFeatures) : {};
      await storage.updateUserSession(sessionId, {
        facialFeatures: JSON.stringify({
          ...existingFeatures,
          raceEthnicity: analysis.raceEthnicity,
          gender: analysis.gender,
          skinTone: analysis.skinTone,
          faceShape: analysis.faceShape,
          faceAngle: analysis.faceAngle,
        }),
        rankedReferences: prefetchedRefs.map(r => ({ url: r.url, source: r.source })),
        hairstyleDescription: visionHairstyleDescription || `Trending ${analysis.gender} ${analysis.raceEthnicity} hairstyle`,
        customPrompt: "AurenIQ: AI-matched celebrity hairstyle",
      });

      // Step 5: Find existing pending variant or create new one
      const sessionVariants = await storage.getGeneratedVariantsBySessionId(sessionId);
      const existingPendingVariant = sessionVariants.find(v => v.status === "pending");
      let variant;
      if (existingPendingVariant) {
        // Update existing pending variant
        await storage.updateGeneratedVariant(existingPendingVariant.id, {
          customPrompt: "AurenIQ: AI-matched celebrity hairstyle",
          status: "processing",
        });
        variant = { ...existingPendingVariant, status: "processing" };
      } else {
        // Create new variant if none exists
        variant = await storage.createGeneratedVariant({
          sessionId,
          hairstyleId: null,
          customPrompt: "AurenIQ: AI-matched celebrity hairstyle",
          inspirationPhotoUrl: null,
          styleType: "hairstyle",
          status: "processing",
        });
      }

      // Step 6: Generate using the same 3-image pipeline as text mode
      console.log("🎨 Starting AurenIQ generation...");
      console.log(`   🎯 Using reference #1: "${prefetchedRefs[0].source}"`);
      
      const userRace = analysis.raceEthnicity.charAt(0).toUpperCase() + analysis.raceEthnicity.slice(1);
      const userGender = analysis.gender;
      
      // Generate with retry across references using KONTEXT REFINED pipeline (same as text mode)
      let generationResult: DualImageResult | null = null;
      
      for (let refIdx = 0; refIdx < Math.min(10, prefetchedRefs.length); refIdx++) {
        const ref = prefetchedRefs[refIdx];
        
        console.log(`   📸 Trying reference ${refIdx + 1}/${prefetchedRefs.length}...`);
        
        // Save reference for debugging
        try {
          const fsDebug = await import("fs/promises");
          const refBuffer = Buffer.from(
            ref.base64.replace(/^data:image\/\w+;base64,/, ''),
            'base64'
          );
          await fsDebug.writeFile(`/tmp/debug_aureniq_reference_${refIdx + 1}.jpg`, refBuffer);
          console.log(`   ✓ Saved reference to /tmp/debug_aureniq_reference_${refIdx + 1}.jpg`);
        } catch (e) {
          console.log(`   ⚠ Could not save debug reference`);
        }
        
        // Use KONTEXT REFINED pipeline (same as text mode)
        const kontextResult = await generateWithKontextRefined(
          session.photoUrl,
          visionHairstyleDescription || `Trending ${userGender} ${userRace} hairstyle`,
          ref.base64,  // Reference used directly (not masked)
          maskedUserPhoto,
          userRace,
          userGender
        );
        
        if (kontextResult) {
          generationResult = { frontImageUrl: kontextResult, sideImageUrl: null };
          
          // Save reference info
          await storage.updateGeneratedVariant(variant.id, {
            webReferenceImageUrl: ref.url,
            webReferenceSource: ref.source,
          });
          
          console.log(`   ✓ Generation succeeded with reference ${refIdx + 1}`);
          break;
        } else {
          console.log(`   ✗ Generation failed for reference ${refIdx + 1}`);
        }
      }

      if (generationResult?.frontImageUrl) {
        const modelDebug = buildKontextRefinedModelDebug("kontext", "KONTEXT_STAGE2_PROMPT");
        const compositeData = mergeCompositeData(variant.compositeData, { modelDebug });
        await storage.updateGeneratedVariant(variant.id, {
          generatedImageUrl: generationResult.frontImageUrl,
          sideImageUrl: generationResult.sideImageUrl || null,
          compositeData,
          status: "completed",
        });
        console.log(`[MODEL DEBUG] Variant ${variant.id}: ${JSON.stringify(modelDebug)}`);

        // Update cookie for anonymous users
        if (isAnonymous && !GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
          const currentUsed = getAnonymousCreditsUsed(req);
          setAnonymousCreditsUsed(res, currentUsed + creditsNeeded, req);
        }

        console.log("✅ AurenIQ generation complete!");
        res.json({ 
          success: true, 
          sessionId,
          variantId: variant.id,
          matchedFeatures: {
            gender: analysis.gender,
            raceEthnicity: analysis.raceEthnicity,
            skinTone: analysis.skinTone,
            faceShape: analysis.faceShape
          },
          hairstyleDescription: visionHairstyleDescription
        });
      } else {
        await storage.updateGeneratedVariant(variant.id, { status: "failed" });
        throw new Error("AurenIQ generation failed after trying all references");
      }
    } catch (error) {
      console.error("Error in AurenIQ generation:", error);
      res.status(500).json({ error: "Failed to generate AurenIQ hairstyle" });
    }
  });

  // AI Polish - analyzes user features and finds trending/celebrity haircuts that match
  app.post("/api/ai-polish/:variantId", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { variantId } = req.params;

      console.log("=== AI Polish Request ===");

      const variant = await storage.getGeneratedVariant(variantId);
      if (!variant) {
        return res.status(404).json({ error: "Variant not found" });
      }

      const session = await storage.getUserSession(variant.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const creditsNeeded = 1;

      // Check credits
      if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
        if (userId) {
          const user = await storage.getUser(userId);
          if (!user) {
            return res.status(404).json({ error: "User not found" });
          }

          if (user.plan === "business") {
            // Business plan has unlimited
          } else if (user.credits < creditsNeeded) {
            return res.status(402).json({ 
              error: "Insufficient credits",
              creditsNeeded,
              currentCredits: user.credits,
              isAuthenticated: true
            });
          } else {
            await storage.deductCredits(userId, creditsNeeded);
          }
        } else {
          const anonymousCreditsRemaining = getAnonymousCreditsRemaining(req);
          if (anonymousCreditsRemaining < creditsNeeded) {
            return res.status(402).json({ 
              error: "Daily limit reached",
              message: "Your 15 daily generations are used up. Credits reset in 24 hours!"
            });
          }
        }
      }

      // Step 1: Analyze user's photo for features (check cache first)
      console.log("Analyzing user photo for AI Polish...");
      
      // Check preprocess cache for existing analysis (use consistent key format)
      const maskCacheKey = generateCacheKey(session.photoUrl);
      const cachedPreprocess = await preprocessCache.get(maskCacheKey);
      
      let analysis;
      if (cachedPreprocess?.userAnalysis && Date.now() - cachedPreprocess.timestamp < 30 * 60 * 1000) {
        console.log("✓ Using cached user analysis for AI Polish");
        analysis = cachedPreprocess.userAnalysis;
      } else {
        // Run fresh analysis
        analysis = await analyzeUserPhoto(session.photoUrl);
      }
      
      if (!analysis) {
        return res.status(500).json({ error: "Failed to analyze photo" });
      }

      console.log("User features:", analysis);

      // Step 2: Build search query for trending celebrity haircuts matching user features
      // Format: "trending celebrity hairstyles for {race} {gender}"
      const genderTerms: Record<string, string> = { "male": "men", "female": "women" };
      const genderTerm = genderTerms[analysis.gender] || "";
      
      const raceTerms: Record<string, string> = {
        "asian": "asian",
        "black": "black",
        "white": "white",
        "latino": "latino",
        "middle_eastern": "middle eastern",
        "south_asian": "south asian",
        "southeast_asian": "southeast asian",
        "mixed": ""
      };
      const raceTerm = raceTerms[analysis.raceEthnicity] || "";
      
      // Search for trending/celebrity haircuts matching user's features
      const searchQuery = `trending celebrity hairstyles for ${raceTerm} ${genderTerm} 2024 2025`.trim().replace(/\s+/g, " ");
      
      console.log("AI Polish search query:", searchQuery);

      // Step 3: Search web for celebrity/trending haircuts
      const webResults = await searchWebForHairstyleImages(
        searchQuery,
        analysis,
        5 // Get more options
      );

      if (webResults.length === 0) {
        console.log("No celebrity haircuts found, using generic trending search");
        // Fallback to more generic search
        const fallbackResults = await searchWebForHairstyleImages(
          `best trending hairstyles for ${raceTerm} ${genderTerm} 2024`,
          analysis,
          3
        );
        
        if (fallbackResults.length === 0) {
          return res.status(500).json({ error: "Could not find matching celebrity haircuts" });
        }
        
        webResults.push(...fallbackResults);
      }

      console.log(`Found ${webResults.length} celebrity/trending haircuts`);

      // Step 4: Calculate refinement number
      const existingVariants = await storage.getGeneratedVariantsBySessionId(variant.sessionId);
      const maxRefinement = existingVariants.reduce((max, v) => {
        const refNum = (v as any).refinementNumber;
        return Math.max(max, typeof refNum === 'number' ? refNum : 0);
      }, 0);
      const newRefinementNumber = maxRefinement + 1;

      // Step 5: Create new variant for AI Polish result
      const newVariant = await storage.createGeneratedVariant({
        sessionId: variant.sessionId,
        hairstyleId: null,
        customPrompt: `AI Polish: Trending hairstyle matching your features`,
        inspirationPhotoUrl: null,
        styleType: "hairstyle",
        status: "processing",
        parentVariantId: variantId,
        refinementNumber: newRefinementNumber,
        refinementPrompt: "AI Polish - find the best trending haircut for my features",
      });

      // Step 6: Generate dual images using the best celebrity reference
      const referenceImageUrl = webResults[0].imageUrl;
      console.log(`Using celebrity reference: ${webResults[0].title}`);
      console.log(`Reference URL: ${referenceImageUrl.substring(0, 80)}...`);

      const polishPrompt = `Transform to a trending, flattering hairstyle that complements ${analysis.faceShape} face shape and ${analysis.skinTone} skin tone`;

      const dualResult = await generateHairstyleDual(
        session.photoUrl,
        polishPrompt,
        referenceImageUrl
      );

      // Handle result - front image is required
      if (dualResult.frontImageUrl) {
        await storage.updateGeneratedVariant(newVariant.id, {
          generatedImageUrl: dualResult.frontImageUrl,
          sideImageUrl: null,
          webReferenceImageUrl: referenceImageUrl,
          webReferenceSource: webResults[0].title || webResults[0].source,
          status: "completed",
        });

        // Update cookie for anonymous users
        if (!userId && !GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
          const currentUsed = getAnonymousCreditsUsed(req);
          setAnonymousCreditsUsed(res, currentUsed + creditsNeeded, req);
        }

        res.json({ 
          success: true, 
          variantId: newVariant.id, 
          refinementNumber: newRefinementNumber,
          matchedFeatures: {
            skinTone: analysis.skinTone,
            faceShape: analysis.faceShape,
            raceEthnicity: analysis.raceEthnicity
          },
          referenceUsed: webResults[0].title,
          webReferenceImageUrl: referenceImageUrl
        });
      } else {
        await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
        throw new Error("AI Polish generation failed");
      }
    } catch (error) {
      console.error("Error in AI Polish:", error);
      res.status(500).json({ error: "Failed to generate AI Polish" });
    }
  });

  app.get("/api/session/:id", async (req, res) => {
    try {
      const session = await storage.getUserSession(req.params.id);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const variants = await storage.getGeneratedVariantsBySessionId(req.params.id);
      
      // Add user-specific favorite status
      const userId = getUserId(req);
      const deviceId = getOrCreateDeviceId(req, res);
      
      const variantsWithUserStatus = variants.map(variant => {
        let modelDebug: unknown = null;
        if (variant.compositeData) {
          try {
            const parsed = JSON.parse(variant.compositeData);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "modelDebug" in parsed) {
              modelDebug = (parsed as any).modelDebug;
            }
          } catch {
            // Ignore malformed compositeData
          }
        }

        // Check if THIS device favorited the variant (using device-based tracking only)
        const isFavoritedByCurrentDevice = deviceId && variant.favoritedByDeviceId === deviceId;
        
        // Check if THIS device disliked the variant
        const isDislikedByCurrentDevice = deviceId && variant.dislikedByDeviceId === deviceId;
        
        return {
          ...variant,
          modelDebug,
          // Override isFavorited to reflect current device's status
          isFavorited: isFavoritedByCurrentDevice,
          // Override isDisliked to reflect current device's status
          isDisliked: isDislikedByCurrentDevice,
        };
      });

      res.json({
        ...session,
        variants: variantsWithUserStatus,
      });
    } catch (error) {
      console.error("Error fetching session:", error);
      res.status(500).json({ error: "Failed to fetch session" });
    }
  });

  // Get sibling sessions (all sessions related through the same root session)
  app.get("/api/session/:id/siblings", async (req, res) => {
    try {
      const siblings = await storage.getSiblingSessions(req.params.id);
      
      // Return session IDs in order with the current session's position
      const sessionIds = siblings.map(s => s.id);
      const currentIndex = sessionIds.indexOf(req.params.id);
      
      res.json({
        sessions: sessionIds,
        currentIndex: currentIndex >= 0 ? currentIndex : 0,
        total: sessionIds.length,
      });
    } catch (error) {
      console.error("Error fetching sibling sessions:", error);
      res.status(500).json({ error: "Failed to fetch sibling sessions" });
    }
  });

  // Get variants for a session (used by debug page)
  app.get("/api/session/:id/variants", async (req, res) => {
    try {
      const variants = await storage.getGeneratedVariantsBySessionId(req.params.id);
      res.json(variants);
    } catch (error) {
      console.error("Error fetching variants:", error);
      res.status(500).json({ error: "Failed to fetch variants" });
    }
  });

  // Get queue status for a session's variants
  app.get("/api/session/:id/queue-status", async (req, res) => {
    try {
      const variants = await storage.getGeneratedVariantsBySessionId(req.params.id);
      
      // Find any queued variants
      const queuedVariants = variants.filter(v => v.status === "queued");
      
      if (queuedVariants.length === 0) {
        return res.json({
          queued: false,
          position: 0,
          totalInQueue: 0,
          estimatedWaitSeconds: 0,
        });
      }
      
      // Get queue status for the first queued variant
      const queueStatus = await getQueueStatusByVariant(queuedVariants[0].id);
      
      if (!queueStatus) {
        return res.json({
          queued: true,
          position: 1,
          totalInQueue: 1,
          estimatedWaitSeconds: 45,
        });
      }
      
      // Check if the lock is free - if so, they can retry generation
      const lockHolder = getCurrentLockHolder();
      const canRetry = !lockHolder && queueStatus.position <= 1;
      
      res.json({
        queued: true,
        position: queueStatus.position,
        totalInQueue: queueStatus.totalInQueue,
        estimatedWaitSeconds: queueStatus.estimatedWaitSeconds,
        status: queueStatus.status,
        canRetry, // true when it's their turn and lock is free
      });
    } catch (error) {
      console.error("Error fetching queue status:", error);
      res.status(500).json({ error: "Failed to fetch queue status" });
    }
  });

  // Get recent generations for a device (for home page "View Results" feature)
  app.get("/api/my-generations", async (req, res) => {
    try {
      const userId = getUserId(req);
      const deviceId = getOrCreateDeviceId(req, res);
      
      if (!userId && !deviceId) {
        return res.json({ sessions: [] });
      }

      // Get recent sessions with at least one completed variant
      const allSessions = await storage.getAllUserSessions();
      
      // Filter sessions by user or device, sort by recency, limit to 10
      const recentSessions = allSessions
        .filter((session: any) => {
          if (userId && session.userId === userId) return true;
          if (deviceId && session.deviceId === deviceId) return true;
          return false;
        })
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);

      // Get variants for each session to check for completed ones
      const sessionsWithVariants = await Promise.all(
        recentSessions.map(async (session: any) => {
          const variants = await storage.getGeneratedVariantsBySessionId(session.id);
          const completedVariants = variants.filter((v: any) => v.status === 'completed' && v.generatedImageUrl);
          
          if (completedVariants.length === 0) return null;
          
          return {
            id: session.id,
            photoUrl: session.photoUrl,
            createdAt: session.createdAt,
            variantCount: completedVariants.length,
            previewImage: completedVariants[0]?.generatedImageUrl,
            prompt: completedVariants[0]?.customPrompt,
            modelDebug: (() => {
              try {
                const raw = completedVariants[0]?.compositeData;
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                return parsed?.modelDebug || null;
              } catch {
                return null;
              }
            })(),
          };
        })
      );

      const validSessions = sessionsWithVariants.filter(Boolean);

      res.json({ sessions: validSessions });
    } catch (error) {
      console.error("Error fetching my generations:", error);
      res.status(500).json({ error: "Failed to fetch generations" });
    }
  });

  // Generate More endpoint - creates a NEW standalone session
  // For TEXT mode: uses next ranked reference
  // For INSPIRATION mode: regenerates with same inspiration photo
  app.post("/api/session/:id/generate-more", async (req, res) => {
    try {
      const sourceSessionId = req.params.id;
      const sourceSession = await storage.getUserSession(sourceSessionId);
      
      if (!sourceSession) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Check if this is an inspiration mode session by finding a variant with inspirationPhotoUrl
      const sourceVariants = await storage.getGeneratedVariantsBySessionId(sourceSessionId);
      
      // Beta limit: Maximum 15 generations per session
      if (sourceVariants && sourceVariants.length >= MAX_GENERATIONS_PER_SESSION) {
        return res.status(400).json({ 
          error: "SESSION_LIMIT_REACHED",
          message: `You've reached the maximum of ${MAX_GENERATIONS_PER_SESSION} generations for this session. Start a new session to continue exploring styles.`,
          isSessionLimit: true
        });
      }
      // Find the latest completed variant with inspiration photo, or fall back to the first one
      const sourceVariant = sourceVariants?.find(v => v.inspirationPhotoUrl && v.status === 'completed') 
        || sourceVariants?.find(v => v.inspirationPhotoUrl)
        || sourceVariants?.[0];
      const isInspirationMode = !!sourceVariant?.inspirationPhotoUrl;

      // Credit check (same as regular generation)
      const creditsNeeded = 1;
      const userId = getUserId(req);
      
      if (userId) {
        const currentCredits = await storage.getUserCredits(userId);
        if (currentCredits < creditsNeeded && !GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
          return res.status(402).json({ error: "Not enough credits" });
        }
      } else if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
        const anonymousUsed = getAnonymousCreditsUsed(req);
        if (anonymousUsed >= ANONYMOUS_CREDITS_LIMIT) {
          return res.status(402).json({ error: "Daily limit reached", message: "Your 15 daily generations are used up. Credits reset in 24 hours!" });
        }
      }

      // Parse user analysis from session (needed for generation)
      let userRace = "person";
      let userGender = "";
      try {
        const features = JSON.parse(sourceSession.facialFeatures || "{}");
        userRace = features.raceEthnicity || "person";
        userGender = features.gender || "";
      } catch (e) {
        // Ignore parse errors
      }

      // INSPIRATION MODE: Regenerate using same inspiration photo AND cached masks
      if (isInspirationMode && sourceVariant?.inspirationPhotoUrl) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔄 GENERATE MORE - INSPIRATION MODE REGENERATION`);
        console.log(`${'='.repeat(60)}`);
        console.log(`Using same inspiration photo for regeneration`);

        // Try to extract cached masks AND ethnicity from source variant's compositeData
        let cachedUserMask: string | null = null;
        let cachedHairMask: string | null = null;
        let cachedUserRace: string | null = null;
        let cachedUserGender: string | null = null;
        
        if (sourceVariant.compositeData) {
          try {
            const compositeObj = JSON.parse(sourceVariant.compositeData);
            cachedUserMask = compositeObj.userMaskUrl || null;
            cachedHairMask = compositeObj.refHairMaskUrl || null;
            cachedUserRace = compositeObj.userRace || null;
            cachedUserGender = compositeObj.userGender || null;
            if (cachedUserMask && cachedHairMask) {
              console.log(`✓ Found cached masks in compositeData`);
              console.log(`  User mask: ${cachedUserMask.length} chars`);
              console.log(`  Hair mask: ${cachedHairMask.length} chars`);
            }
            if (cachedUserRace) {
              console.log(`✓ Found cached ethnicity in compositeData: ${cachedUserRace} ${cachedUserGender || ''}`);
            }
          } catch (e) {
            console.log(`⚠️ Failed to parse compositeData, will regenerate masks`);
          }
        }
        
        // Use cached ethnicity if available, otherwise fall back to session facialFeatures
        if (cachedUserRace) {
          userRace = cachedUserRace;
        }
        if (cachedUserGender) {
          userGender = cachedUserGender;
        }

        // Determine the root session ID for linking related generations
        const rootSessionId = sourceSession.rootSessionId || sourceSessionId;
        // Inherit device ID from source session or get new one
        const deviceId = sourceSession.deviceId || getOrCreateDeviceId(req, res);

        // Create a NEW session for this generation
        const newSession = await storage.createUserSession({
          photoUrl: sourceSession.photoUrl,
          customPrompt: sourceSession.customPrompt,
          hairstyleDescription: sourceSession.hairstyleDescription,
          facialFeatures: sourceSession.facialFeatures,
          rootSessionId: rootSessionId,
          deviceId, // Link session to device for anonymous history
        });
        
        console.log(`📝 New session ${newSession.id} linked to root ${rootSessionId}`);

        // Create variant in the NEW session with the same inspiration photo
        const newVariant = await storage.createGeneratedVariant({
          sessionId: newSession.id,
          hairstyleId: null,
          customPrompt: sourceVariant.customPrompt,
          inspirationPhotoUrl: sourceVariant.inspirationPhotoUrl,
          styleType: sourceVariant.styleType || "hairstyle",
          generatedImageUrl: null,
          status: "processing",
          variantIndex: 0,
          referenceIndex: 0,
          renderType: "ai",
        });

        let dualResult: DualImageResult;

        // Use cached masks if available, otherwise regenerate
        if (cachedUserMask && cachedHairMask) {
          console.log(`🚀 [Generate More] Starting FLUX generation with CACHED masks...`);
          dualResult = await generateWithPrecomputedMasks(
            sourceSession.photoUrl,
            cachedUserMask,
            cachedHairMask,
            userRace,
            userGender
          );
        } else {
          console.log(`🚀 [Generate More] No cached masks, falling back to full generation...`);
          dualResult = await generateStyleFromInspirationDual(
            sourceSession.photoUrl,
            sourceVariant.inspirationPhotoUrl,
            (sourceVariant.styleType || "hairstyle") as StyleType
          );
        }

        if (dualResult.frontImageUrl) {
          // Deduct credits
          if (userId) {
            await storage.deductCredits(userId, creditsNeeded);
          } else if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
            const currentUsed = getAnonymousCreditsUsed(req);
            setAnonymousCreditsUsed(res, currentUsed + creditsNeeded, req);
          }

          // Save debug data (masks) to compositeData for debug page
          const modelDebug = buildKontextRefinedModelDebug("kontext", "KONTEXT_STAGE2_PROMPT");
          const compositeDataBase = dualResult.debugData ? {
            userMaskUrl: dualResult.debugData.userMaskUrl,
            refHairMaskUrl: dualResult.debugData.refHairMaskUrl,
            userRace: dualResult.debugData.userRace,
            userGender: dualResult.debugData.userGender
          } : {};
          const compositeData = mergeCompositeData(
            newVariant.compositeData,
            { ...compositeDataBase, modelDebug }
          );

          await storage.updateGeneratedVariant(newVariant.id, {
            generatedImageUrl: dualResult.frontImageUrl,
            sideImageUrl: dualResult.sideImageUrl,
            compositeData,
            status: "completed",
          });

          console.log(`✅ [Generate More] Inspiration mode completed: new session ${newSession.id}`);

          return res.json({
            success: true,
            newSessionId: newSession.id,
            referenceIndex: 0,
            remainingReferences: -1, // Unlimited for inspiration mode
            isInspirationMode: true,
          });
        } else {
          console.log(`❌ [Generate More] FLUX inspiration generation failed`);
          await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
          return res.status(500).json({ error: "Generation failed" });
        }
      }

      // TEXT MODE: Direct Kontext (no references)
      if (GENERATION_CONFIG.TEXT_MODE_DIRECT_KONTEXT) {
        // Use cached masked user photo if available, otherwise create it
        let maskedUserPhoto: string | null = null;
        const maskCacheKey = generateCacheKey(sourceSession.photoUrl);
        const cachedPreprocess = await preprocessCache.get(maskCacheKey);
        
        if (cachedPreprocess?.maskedImage && Date.now() - cachedPreprocess.timestamp < 30 * 60 * 1000) {
          console.log(`🎭 [Generate More] Using CACHED masked user photo`);
          maskedUserPhoto = cachedPreprocess.maskedImage;
        } else {
          console.log(`🎭 [Generate More] Creating masked user photo (cache miss)...`);
          const userPhotoResponse = await fetch(sourceSession.photoUrl);
          const userPhotoBuffer = Buffer.from(await userPhotoResponse.arrayBuffer());
          const userPhotoBase64 = `data:image/jpeg;base64,${userPhotoBuffer.toString('base64')}`;
          maskedUserPhoto = await createUserMaskedImage(userPhotoBase64, 10);
          
          if (maskedUserPhoto) {
            await preprocessCache.set(maskCacheKey, {
              ...cachedPreprocess,
              maskedUserPhoto,
              maskedImage: maskedUserPhoto,
              timestamp: Date.now(),
            });
          }
        }

        if (!maskedUserPhoto) {
          return res.status(500).json({ error: "Failed to create user mask" });
        }

        const rootSessionId = sourceSession.rootSessionId || sourceSessionId;
        const deviceId = sourceSession.deviceId || getOrCreateDeviceId(req, res);
        const basePrompt = sourceSession.customPrompt || sourceVariant.customPrompt || sourceSession.hairstyleDescription || "";
        const interpretedPrompt = basePrompt;
        const textModeStage1Provider: KontextStage1Provider = resolveKontextStage1Provider(
          GENERATION_CONFIG.TEXT_MODE_STAGE1_PROVIDER
        );

        const newSession = await storage.createUserSession({
          photoUrl: sourceSession.photoUrl,
          customPrompt: sourceSession.customPrompt,
          hairstyleDescription: interpretedPrompt,
          facialFeatures: sourceSession.facialFeatures,
          rankedReferences: null,
          usedReferenceIndex: 0,
          rootSessionId,
          deviceId,
        });

        const newVariant = await storage.createGeneratedVariant({
          sessionId: newSession.id,
          hairstyleId: null,
          customPrompt: sourceSession.customPrompt,
          inspirationPhotoUrl: null,
          styleType: "hairstyle",
          generatedImageUrl: null,
          status: "processing",
          referenceIndex: 0,
        });

        debugRefIndexCounter++;
        const debugIdx = debugRefIndexCounter;
        const kontextResult = await generateWithKontextRefined(
          sourceSession.photoUrl,
          interpretedPrompt,
          sourceSession.photoUrl,
          maskedUserPhoto,
          userRace,
          userGender,
          { promptOnlyMode: true, stage1Provider: textModeStage1Provider, debugIndex: debugIdx }
        );

        if (!kontextResult) {
          await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
          return res.status(500).json({ error: "Generation failed" });
        }

        if (userId) {
          await storage.deductCredits(userId, creditsNeeded);
        } else if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
          const currentUsed = getAnonymousCreditsUsed(req);
          setAnonymousCreditsUsed(res, currentUsed + creditsNeeded, req);
        }

        await storage.updateGeneratedVariant(newVariant.id, {
          generatedImageUrl: kontextResult,
          sideImageUrl: null,
          webReferenceImageUrl: null,
          webReferenceSource: null,
          compositeData: mergeCompositeData(
            newVariant.compositeData,
            { modelDebug: buildKontextRefinedModelDebug(textModeStage1Provider, "KONTEXT_STAGE2_PROMPT") }
          ),
          status: "completed",
        });

        console.log(
          `✅ [Generate More] Completed in direct ${getKontextStage1ProviderLabel(textModeStage1Provider)} Stage 1 + FLUX Stage 2 mode: new session ${newSession.id}`
        );
        return res.json({
          success: true,
          newSessionId: newSession.id,
          referenceIndex: 0,
          remainingReferences: -1,
          isInspirationMode: false,
          directKontextMode: true,
        });
      }

      // TEXT MODE: Use ranked references
      // Check for stored references
      const rankedReferences = sourceSession.rankedReferences as { url: string; source: string }[] | null;
      if (!rankedReferences || rankedReferences.length === 0) {
        return res.status(400).json({ error: "No references available for this session" });
      }

      // Track used reference index - this is stored per session
      // Find the next unused index based on the source session's usedReferenceIndex
      const usedIndex = sourceSession.usedReferenceIndex ?? 0;
      const nextReferenceIndex = usedIndex + 1;

      // If all references used, we'll try to fetch more during the mask validation loop
      // Don't return error here - let the sync refresh logic handle it

      // Use cached masked user photo if available, otherwise create it (use consistent key format)
      let maskedUserPhoto: string | null = null;
      const maskCacheKey = generateCacheKey(sourceSession.photoUrl);
      const cachedPreprocess = await preprocessCache.get(maskCacheKey);
      
      if (cachedPreprocess?.maskedImage && Date.now() - cachedPreprocess.timestamp < 30 * 60 * 1000) {
        console.log(`🎭 [Generate More] Using CACHED masked user photo`);
        maskedUserPhoto = cachedPreprocess.maskedImage;
      } else {
        console.log(`🎭 [Generate More] Creating masked user photo (cache miss)...`);
        const userPhotoResponse = await fetch(sourceSession.photoUrl);
        const userPhotoBuffer = Buffer.from(await userPhotoResponse.arrayBuffer());
        const userPhotoBase64 = `data:image/jpeg;base64,${userPhotoBuffer.toString('base64')}`;
        maskedUserPhoto = await createUserMaskedImage(userPhotoBase64, 10);
        
        // Cache it for future Generate More / Refine calls
        if (maskedUserPhoto) {
          await preprocessCache.set(maskCacheKey, {
            ...cachedPreprocess,
            maskedUserPhoto,
            maskedImage: maskedUserPhoto,
            timestamp: Date.now(),
          });
          console.log(`   ✓ Cached user mask for future use`);
        }
      }

      // Try references starting from nextReferenceIndex until we find one with a valid mask
      let validRefIndex = -1;
      let validReferenceMask: string | null = null;
      let validRefUrl = "";
      let validRefSource = "";
      let validRefStage1Provider: KontextStage1Provider | null = null;
      let generationDebugIdx = 0;

      const userPhotoBase64ForKlein = sourceSession.photoUrl.startsWith("data:")
        ? await normalizeImageOrientation(sourceSession.photoUrl)
        : await fetchImageAsBase64(sourceSession.photoUrl);
      if (!userPhotoBase64ForKlein) {
        return res.status(500).json({ error: "Failed to normalize user photo for Generate More" });
      }
      const userPhotoDimsForStage1 = await getImageDimensions(userPhotoBase64ForKlein);
      const stage1SizeForGenerateMore = userPhotoDimsForStage1
        ? selectChatGPTImageSize(userPhotoDimsForStage1.width, userPhotoDimsForStage1.height)
        : GENERATION_CONFIG.CHATGPT_IMAGE_SIZE;
      let sourceSessionFeatures: any = {};
      try {
        sourceSessionFeatures = sourceSession.facialFeatures ? JSON.parse(sourceSession.facialFeatures) : {};
      } catch {
        sourceSessionFeatures = {};
      }
      const runtimeGenerateMoreStage1Prompt = getCurrentChatGptStage1Prompt(
        sourceSession.hairstyleDescription || sourceSession.customPrompt || sourceVariant.customPrompt || "",
        sourceSessionFeatures.raceEthnicity,
        sourceSessionFeatures.gender
      );
      try {
        await saveBase64DebugImage("/tmp/debug_user_image.jpg", userPhotoBase64ForKlein);
      } catch {
        // Best-effort debug artifact.
      }
      const userFaceMaskForKlein = await buildStage2FaceMaskForKleinSingleStage(userPhotoBase64ForKlein);
      if (!userFaceMaskForKlein) {
        return res.status(500).json({ error: "Failed to create user face mask for Generate More" });
      }
      try {
        await saveBase64DebugImage("/tmp/debug_stage2_user_face_neck_mask.jpg", userFaceMaskForKlein);
      } catch {
        // Best-effort debug artifact.
      }
      
      console.log(`🔍 [Generate More] Searching for valid reference starting at index ${nextReferenceIndex + 1}/${rankedReferences.length}...`);
      
      for (let i = nextReferenceIndex; i < rankedReferences.length; i++) {
        const ref = rankedReferences[i];
        console.log(`📸 [Generate More] Trying reference ${i + 1}/${rankedReferences.length}: "${ref.source}"`);
        
        // Fetch the reference image
        let refBase64: string | null = null;
        try {
          refBase64 = await fetchFirstAccessibleImage([ref.url]);
        } catch (e) {
          console.log(`   ❌ Failed to fetch image - skipping`);
          continue;
        }
        
        if (!refBase64) {
          console.log(`   ❌ Image not accessible - skipping`);
          continue;
        }
        
        // Found an accessible reference: now build mask using the same pipeline as original generation.
        console.log(`   ✅ Reference fetched. Building mask with original-generation pipeline...`);
        validRefIndex = i;
        validRefUrl = ref.url;
        validRefSource = ref.source;
        debugRefIndexCounter++;
        generationDebugIdx = debugRefIndexCounter;
        
        // Save debug images for the debug page
        try {
          const fsDebug = await import("fs/promises");
          const debugIdx = generationDebugIdx;
          
          // Save original reference
          const originalRefBuffer = Buffer.from(
            refBase64.replace(/^data:image\/\w+;base64,/, ''),
            'base64'
          );
          await fsDebug.writeFile(`/tmp/debug_reference_full_${debugIdx}.jpg`, originalRefBuffer);
          await fsDebug.writeFile(`/tmp/debug_gpt_ref_input_${debugIdx}.jpg`, originalRefBuffer);
          
          console.log(`   📁 Saved reference image for debug index ${debugIdx}`);
        } catch (debugErr) {
          console.warn(`   ⚠️ Failed to save debug images:`, debugErr);
        }

        // Match original generation pipeline:
        // 1) Stage 1 GPT (reference-only)
        // 2) Build reference guidance mask via createReferenceHairMaskForKleinSingleStage
        let stage1GptComparisonResult: string | null = null;
        try {
          const stage1GptStartMs = Date.now();
          stage1GptComparisonResult = await generateHairstyleWithChatGPT(
            refBase64,
            runtimeGenerateMoreStage1Prompt,
            {
              promptTemplate: "{hairstyle}",
              imageSize: stage1SizeForGenerateMore,
            }
          );
          const stage1GptElapsedMs = Date.now() - stage1GptStartMs;
          console.log(`   ⏱️ Stage 1 GPT generation time: ${(stage1GptElapsedMs / 1000).toFixed(2)}s`);
          if (stage1GptComparisonResult && !stage1GptComparisonResult.startsWith("data:")) {
            stage1GptComparisonResult = await fetchImageAsBase64(stage1GptComparisonResult);
          }
          if (stage1GptComparisonResult && userPhotoDimsForStage1) {
            const resizedStage1 = await resizeImageToDimensions(
              stage1GptComparisonResult,
              userPhotoDimsForStage1.width,
              userPhotoDimsForStage1.height
            );
            if (resizedStage1) {
              stage1GptComparisonResult = resizedStage1;
            }
          }
          if (stage1GptComparisonResult) {
            await saveDebugImageFromAnySource(
              `/tmp/debug_stage1_gpt_fusion_result_${generationDebugIdx}.jpg`,
              stage1GptComparisonResult
            );
            await saveDebugImageFromAnySource("/tmp/debug_stage1_gpt_fusion_result.jpg", stage1GptComparisonResult);
          }
        } catch (stage1GptErr) {
          console.warn(`   ⚠️ Stage 1 GPT comparison failed for reference ${i + 1}.`, stage1GptErr);
        }

        const stage1PrimaryResult = stage1GptComparisonResult;
        const stage1PrimaryProvider: KontextStage1Provider | null = stage1GptComparisonResult
          ? "gpt_image"
          : null;
        validRefStage1Provider = stage1PrimaryProvider;
        const referenceMaskSource = stage1PrimaryResult || refBase64;
        try {
          validReferenceMask = await createReferenceHairMaskForKleinSingleStage(referenceMaskSource);
          if (validReferenceMask) {
            await saveBase64DebugImage(`/tmp/debug_stage2_klein_reference_mask_${generationDebugIdx}.jpg`, validReferenceMask);
            await saveBase64DebugImage("/tmp/debug_stage2_klein_reference_mask_1.jpg", validReferenceMask);
            console.log(`   ✅ Reference mask ready (original pipeline): /tmp/debug_stage2_klein_reference_mask_${generationDebugIdx}.jpg`);
            break;
          }
          console.log(`   ❌ Reference mask creation failed - trying next reference`);
        } catch (maskErr) {
          console.warn(`   ⚠️ Reference mask pipeline failed - trying next reference`, maskErr);
        }
        
        validRefIndex = -1;
        validRefUrl = "";
        validRefSource = "";
        validRefStage1Provider = null;
      }
      
      // If no valid reference found, return error (beta: no auto-refresh of references)
      if (validRefIndex === -1 || !validReferenceMask) {
        console.log(`❌ [Generate More] No valid references remaining`);
        return res.status(400).json({ 
          error: "NO_REFERENCES_LEFT",
          message: "No more reference images available for this style. Start a new session to explore different looks.",
          isReferencesExhausted: true
        });
      }
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔄 GENERATE MORE - NEW SESSION`);
      console.log(`${'='.repeat(60)}`);
      console.log(`\n🎯 USING REFERENCE #${validRefIndex + 1} of ${rankedReferences.length}:`);
      console.log(`   Source: "${validRefSource}"`);
      console.log(`   URL: ${validRefUrl.substring(0, 60)}...`);

      // Determine the root session ID for linking related generations
      const rootSessionId = sourceSession.rootSessionId || sourceSessionId;
      // Inherit device ID from source session or get new one
      const deviceId = sourceSession.deviceId || getOrCreateDeviceId(req, res);

      // Create a NEW session for this generation (standalone, not a variant)
      const newSession = await storage.createUserSession({
        photoUrl: sourceSession.photoUrl,
        customPrompt: sourceSession.customPrompt,
        hairstyleDescription: sourceSession.hairstyleDescription,
        facialFeatures: sourceSession.facialFeatures,
        rankedReferences: rankedReferences,
        usedReferenceIndex: validRefIndex,
        rootSessionId: rootSessionId,
        deviceId, // Link session to device for anonymous history
      });
      
      console.log(`📝 New session ${newSession.id} linked to root ${rootSessionId}`);

      // Create variant in the NEW session
      const newVariant = await storage.createGeneratedVariant({
        sessionId: newSession.id,
        hairstyleId: null,
        customPrompt: sourceSession.customPrompt,
        inspirationPhotoUrl: null,
        styleType: "hairstyle",
        generatedImageUrl: null,
        status: "processing",
        referenceIndex: validRefIndex,
      });

      // RETRY LOOP: Try FLUX Klein generation with current reference, if it fails try next references
      let generationSucceeded = false;
      let currentRefIndex = validRefIndex;
      let currentRefUrl = validRefUrl;
      let currentRefSource = validRefSource;
      let currentRefStage1Provider = validRefStage1Provider;
      let currentReferenceMask = validReferenceMask;
      const MAX_GENERATION_RETRIES = 3; // Try up to 3 different references
      let retryCount = 0;
      
      while (!generationSucceeded && retryCount < MAX_GENERATION_RETRIES && currentRefIndex < rankedReferences.length) {
        console.log(`🚀 [Generate More] Attempt ${retryCount + 1}/${MAX_GENERATION_RETRIES} - Running single-stage FLUX Klein with reference ${currentRefIndex + 1}...`);
        if (generationDebugIdx) {
          try {
            await saveBase64DebugImage(`/tmp/debug_user_image_${generationDebugIdx}.jpg`, userPhotoBase64ForKlein);
            await saveBase64DebugImage(`/tmp/debug_stage2_user_face_neck_mask_${generationDebugIdx}.jpg`, userFaceMaskForKlein);
          } catch {
            // Best-effort debug artifact.
          }
        }
        
        // Use same single-stage path as original generation.
        const kontextResult = await generateSingleFluxKleinFromReferenceMask(
          userPhotoBase64ForKlein,
          userFaceMaskForKlein,
          currentReferenceMask!,
          generationDebugIdx || undefined
        );
        
        // Convert Kontext result to match expected format
        const result = {
          frontImageUrl: kontextResult,
          sideImageUrl: null as string | null
        };

        if (result.frontImageUrl) {
          // SUCCESS! Deduct credits
          if (userId) {
            await storage.deductCredits(userId, creditsNeeded);
          } else if (!GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
            const currentUsed = getAnonymousCreditsUsed(req);
            setAnonymousCreditsUsed(res, currentUsed + creditsNeeded, req);
          }

          // Update source session to mark this reference as used
          await storage.updateUserSession(sourceSessionId, {
            usedReferenceIndex: currentRefIndex
          });

          await storage.updateGeneratedVariant(newVariant.id, {
            generatedImageUrl: result.frontImageUrl,
            sideImageUrl: result.sideImageUrl,
            webReferenceImageUrl: currentRefUrl,
            webReferenceSource: currentRefSource,
            compositeData: mergeCompositeData(
              newVariant.compositeData,
              {
                modelDebug: {
                  pipeline: currentRefStage1Provider === "gpt_image"
                    ? "flux_klein_single_stage_with_gpt_stage1_fusion"
                    : "flux_klein_single_stage",
                  stage1Provider: currentRefStage1Provider || undefined,
                  stage1Model: currentRefStage1Provider === "gpt_image"
                    ? GENERATION_CONFIG.CHATGPT_MODEL
                    : undefined,
                  stage2Model: MODEL_ID_FLUX_KLEIN_STAGE2,
                  stage2Backend: "flux_klein",
                  stage2PromptSource: currentRefStage1Provider === "gpt_image"
                    ? "KLEIN_SINGLE_STAGE_REFERENCE_PROMPT + STAGE1_PROMPT_GPT"
                    : "KLEIN_SINGLE_STAGE_REFERENCE_PROMPT",
                  maskPipeline: currentRefStage1Provider === "gpt_image"
                    ? "gpt_stage1_fusion->stage1_feature_only_face_blot"
                    : "stage1_feature_only_face_blot",
                  generatedAt: new Date().toISOString(),
                }
              }
            ),
            status: "completed",
          });

          const remainingRefs = rankedReferences.length - currentRefIndex - 1;
          console.log(`✅ [Generate More] Completed: new session ${newSession.id} using reference ${currentRefIndex + 1}/${rankedReferences.length}`);
          console.log(`   📊 Remaining untried references: ${remainingRefs}`);

          generationSucceeded = true;
          return res.json({
            success: true,
            newSessionId: newSession.id,
            referenceIndex: currentRefIndex,
            remainingReferences: remainingRefs,
            refreshingReferences: remainingRefs <= 2, // Tell client new refs are being fetched
          });
        } else {
          // FLUX Klein generation failed - try next reference
          console.log(`⚠️ [Generate More] FLUX Klein generation failed with reference ${currentRefIndex + 1}, trying next...`);
          retryCount++;
          
          // Find next valid reference
          let foundNext = false;
          for (let i = currentRefIndex + 1; i < rankedReferences.length && !foundNext; i++) {
            const ref = rankedReferences[i];
            console.log(`📸 [Generate More] Retry: Trying reference ${i + 1}/${rankedReferences.length}: "${ref.source}"`);
            
            let refBase64: string | null = null;
            try {
              refBase64 = await fetchFirstAccessibleImage([ref.url]);
            } catch (e) {
              console.log(`   ❌ Failed to fetch image - skipping`);
              continue;
            }
            
            if (!refBase64) {
              console.log(`   ❌ Image not accessible - skipping`);
              continue;
            }
            
            // Build next reference mask using the same original-generation mask pipeline.
            debugRefIndexCounter++;
            generationDebugIdx = debugRefIndexCounter;
            const debugIdx = generationDebugIdx;

            try {
              const originalRefBuffer = Buffer.from(
                refBase64.replace(/^data:image\/\w+;base64,/, ''),
                'base64'
              );
              await fsPromises.writeFile(`/tmp/debug_reference_full_${debugIdx}.jpg`, originalRefBuffer);
              await fsPromises.writeFile(`/tmp/debug_gpt_ref_input_${debugIdx}.jpg`, originalRefBuffer);
            } catch (saveErr) {
              console.warn(`   ⚠️ Could not save retry reference debug image`, saveErr);
            }

            let retryStage1Gpt: string | null = null;
            try {
              const retryStage1GptStartMs = Date.now();
              retryStage1Gpt = await generateHairstyleWithChatGPT(
                refBase64,
                runtimeGenerateMoreStage1Prompt,
                {
                  promptTemplate: "{hairstyle}",
                  imageSize: stage1SizeForGenerateMore,
                }
              );
              const retryStage1GptElapsedMs = Date.now() - retryStage1GptStartMs;
              console.log(`   ⏱️ Retry Stage 1 GPT generation time: ${(retryStage1GptElapsedMs / 1000).toFixed(2)}s`);
              if (retryStage1Gpt && !retryStage1Gpt.startsWith("data:")) {
                retryStage1Gpt = await fetchImageAsBase64(retryStage1Gpt);
              }
              if (retryStage1Gpt && userPhotoDimsForStage1) {
                const resizedStage1 = await resizeImageToDimensions(
                  retryStage1Gpt,
                  userPhotoDimsForStage1.width,
                  userPhotoDimsForStage1.height
                );
                if (resizedStage1) {
                  retryStage1Gpt = resizedStage1;
                }
              }
              if (retryStage1Gpt) {
                await saveDebugImageFromAnySource(
                  `/tmp/debug_stage1_gpt_fusion_result_${debugIdx}.jpg`,
                  retryStage1Gpt
                );
                await saveDebugImageFromAnySource("/tmp/debug_stage1_gpt_fusion_result.jpg", retryStage1Gpt);
              }
            } catch (retryStage1GptErr) {
              console.warn(`   ⚠️ Retry Stage 1 GPT comparison failed`, retryStage1GptErr);
            }

            const retryStage1Primary = retryStage1Gpt;
            const retryStage1Provider: KontextStage1Provider | null = retryStage1Gpt
              ? "gpt_image"
              : null;
            const retryMaskSource = retryStage1Primary || refBase64;
            const retryReferenceMask = await createReferenceHairMaskForKleinSingleStage(retryMaskSource);
            if (!retryReferenceMask) {
              console.log(`   ❌ Invalid reference mask - skipping`);
              continue;
            }
            await saveBase64DebugImage(`/tmp/debug_stage2_klein_reference_mask_${debugIdx}.jpg`, retryReferenceMask);
            console.log(`   ✅ VALID mask (original pipeline) - will retry with this reference`);

            currentRefIndex = i;
            currentRefUrl = ref.url;
            currentRefSource = ref.source;
            currentRefStage1Provider = retryStage1Provider;
            currentReferenceMask = retryReferenceMask;
            foundNext = true;
          }
          
          if (!foundNext) {
            // No more valid references to try
            console.log(`❌ [Generate More] No more valid references to retry`);
            break;
          }
        }
      }
      
      // If we get here, all retries failed
      console.log(`❌ [Generate More] All ${retryCount} generation attempts failed`);
      await storage.updateGeneratedVariant(newVariant.id, { status: "failed" });
      res.status(500).json({ error: "Generation failed after multiple attempts" });
    } catch (error) {
      console.error("Error in generate-more:", error);
      res.status(500).json({ error: "Failed to generate more" });
    }
  });

  // Proxy endpoint to fetch and serve reference images (bypasses CORS/blocking)
  app.get("/api/proxy-image", async (req, res) => {
    try {
      const { url } = req.query;
      
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL parameter required" });
      }

      // Decode URL
      const decodedUrl = decodeURIComponent(url)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
      
      console.log(`Proxying image: ${decodedUrl.substring(0, 60)}...`);
      
      // Check if this is a social media URL that needs ScreenshotOne
      if (isSocialMediaUrl(decodedUrl) && SCREENSHOTONE_ACCESS_KEY) {
        const base64 = await captureImageWithScreenshotOne(decodedUrl);
        if (base64) {
          // Extract the base64 data and convert to buffer
          const matches = base64.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const contentType = matches[1];
            const buffer = Buffer.from(matches[2], 'base64');
            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
            return res.send(buffer);
          }
        }
      }
      
      // Try direct fetch with domain-specific headers
      const headers = getHeadersForDomain(decodedUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(decodedUrl, {
        signal: controller.signal,
        headers
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch image" });
      }
      
      const contentType = response.headers.get("content-type") || "image/jpeg";
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch (error) {
      console.error("Error proxying image:", error);
      res.status(500).json({ error: "Failed to proxy image" });
    }
  });

  app.get("/api/hairstyles", async (req, res) => {
    try {
      const hairstyles = await storage.getAllHairstyles();
      res.json(hairstyles);
    } catch (error) {
      console.error("Error fetching hairstyles:", error);
      res.status(500).json({ error: "Failed to fetch hairstyles" });
    }
  });

  app.get("/api/salons", async (req, res) => {
    try {
      const { city } = req.query;
      
      const salons = city 
        ? await storage.getSalonsByCity(city as string)
        : await storage.getAllSalons();
        
      res.json(salons);
    } catch (error) {
      console.error("Error fetching salons:", error);
      res.status(500).json({ error: "Failed to fetch salons" });
    }
  });

  // Get all registered Auren businesses (replaces Google Places for beta)
  app.get("/api/registered-businesses", async (req, res) => {
    try {
      const { query } = req.query;
      
      let businessList: any[];
      if (query && typeof query === 'string' && query.length >= 2) {
        businessList = await storage.searchBusinessesByName(query);
      } else {
        businessList = await storage.getActiveBusinesses();
      }
      
      // Transform to salon-like format for frontend compatibility
      const formattedBusinesses = await Promise.all(businessList.map(async (biz) => {
        // Get stylists for this business
        const bizStylists = await storage.getBusinessStylistsByBusinessId(biz.id);
        const services = await storage.getServicesByBusinessId(biz.id);
        
        return {
          id: biz.id,
          placeId: biz.googlePlaceId || biz.id,
          name: biz.name,
          address: biz.address || "Address on file",
          city: biz.city || "Location",
          rating: biz.googlePlaceId === "demo-favours-shop" ? 4.9 : 4.8,
          reviewCount: biz.googlePlaceId === "demo-favours-shop" ? 127 : 50,
          imageUrl: biz.imageUrl || "https://images.pexels.com/photos/1813272/pexels-photo-1813272.jpeg?auto=compress&cs=tinysrgb&w=800",
          specialties: services.slice(0, 3).map(s => s.name),
          stylistCount: bizStylists.length,
          isVerified: biz.isVerified === 1,
          isRegistered: true,
        };
      }));
      
      res.json(formattedBusinesses);
    } catch (error) {
      console.error("Error fetching registered businesses:", error);
      res.status(500).json({ error: "Failed to fetch businesses" });
    }
  });

  // Helper function to calculate distance between two coordinates using Haversine formula
  function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10; // Round to 1 decimal place
  }

  // Address and location autocomplete using Google Places API
  app.get("/api/places/autocomplete", async (req, res) => {
    try {
      const { input } = req.query;
      
      if (!input || typeof input !== 'string' || input.length < 2) {
        return res.json([]);
      }

      const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
      if (!GOOGLE_PLACES_API_KEY) {
        return res.json([]);
      }

      // Include addresses, cities, and regions for full address suggestions
      const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        },
        body: JSON.stringify({
          input,
          includedPrimaryTypes: [
            "street_address",
            "route", 
            "subpremise",
            "premise",
            "geocode",
            "locality", 
            "sublocality",
            "neighborhood",
            "administrative_area_level_1", 
            "administrative_area_level_2",
            "postal_code"
          ],
          includedRegionCodes: ["us", "ca", "gb", "au"],
        })
      });

      if (!response.ok) {
        console.error("Autocomplete API error:", await response.text());
        return res.json([]);
      }

      const data = await response.json();
      const suggestions = (data.suggestions || []).map((s: any) => ({
        placeId: s.placePrediction?.placeId,
        description: s.placePrediction?.text?.text || s.placePrediction?.structuredFormat?.mainText?.text,
        mainText: s.placePrediction?.structuredFormat?.mainText?.text,
        secondaryText: s.placePrediction?.structuredFormat?.secondaryText?.text,
        type: "address"
      })).filter((s: any) => s.placeId && s.description);

      res.json(suggestions);
    } catch (error) {
      console.error("Autocomplete error:", error);
      res.json([]);
    }
  });

  // Business name search using Google Places text search
  app.get("/api/places/search-business", async (req, res) => {
    try {
      const { query, lat, lng } = req.query;
      
      if (!query || typeof query !== 'string' || query.length < 2) {
        return res.json([]);
      }

      // First, search internal registered businesses
      const internalBusinesses = await storage.searchBusinessesByName(query.toLowerCase());
      const internalResults = internalBusinesses.map(biz => ({
        placeId: biz.googlePlaceId,
        name: biz.name,
        address: biz.address || "Registered Business",
        rating: biz.googlePlaceId === "demo-favours-shop" ? 4.9 : 4.8,
        reviewCount: biz.googlePlaceId === "demo-favours-shop" ? 127 : 50,
        lat: undefined,
        lng: undefined,
        type: "business",
        isInternal: true
      }));

      const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
      if (!GOOGLE_PLACES_API_KEY) {
        // Return internal results only if no API key
        return res.json(internalResults);
      }

      // Search for hair salons and barbershops by name via Google
      const searchQuery = `${query} hair salon OR barbershop`;
      
      const requestBody: any = {
        textQuery: searchQuery,
        includedType: "hair_salon",
        maxResultCount: 10
      };

      // Add location bias if coordinates provided
      if (lat && lng) {
        requestBody.locationBias = {
          circle: {
            center: { latitude: parseFloat(lat as string), longitude: parseFloat(lng as string) },
            radius: 50000 // 50km radius
          }
        };
      }

      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        console.error("Business search API error:", await response.text());
        // Return internal results if Google search fails
        return res.json(internalResults);
      }

      const data = await response.json();
      const googleBusinesses = (data.places || []).map((place: any) => ({
        placeId: place.id,
        name: place.displayName?.text || "Unknown",
        address: place.formattedAddress || "",
        rating: place.rating || 0,
        reviewCount: place.userRatingCount || 0,
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        type: "business",
        isInternal: false
      }));

      // Combine internal businesses first, then Google results
      res.json([...internalResults, ...googleBusinesses]);
    } catch (error) {
      console.error("Business search error:", error);
      res.json([]);
    }
  });

  // Get detailed place info
  app.get("/api/places/:placeId", async (req, res) => {
    try {
      const { placeId } = req.params;
      
      const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
      if (!GOOGLE_PLACES_API_KEY) {
        return res.status(502).json({ error: "Google Places API not configured" });
      }

      const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location,rating,userRatingCount,types,websiteUri,nationalPhoneNumber,photos,currentOpeningHours,regularOpeningHours,reviews,priceLevel,googleMapsUri,businessStatus"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Place details error:", errorText);
        return res.status(502).json({ error: "Failed to fetch place details" });
      }

      const place = await response.json();
      
      // Transform photos to usable URLs
      const photos = (place.photos || []).slice(0, 6).map((photo: any) => ({
        url: `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=600&maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`,
        attribution: photo.authorAttributions?.[0]?.displayName || ""
      }));

      // Transform reviews
      const reviews = (place.reviews || []).slice(0, 5).map((review: any) => ({
        author: review.authorAttribution?.displayName || "Anonymous",
        authorPhoto: review.authorAttribution?.photoUri,
        rating: review.rating,
        text: review.text?.text || review.originalText?.text || "",
        time: review.relativePublishTimeDescription || ""
      }));

      // Parse opening hours
      const openingHours = place.currentOpeningHours?.weekdayDescriptions || 
                           place.regularOpeningHours?.weekdayDescriptions || [];
      const isOpen = place.currentOpeningHours?.openNow;

      // Map price level
      const priceLevelMap: Record<string, string> = {
        "PRICE_LEVEL_FREE": "Free",
        "PRICE_LEVEL_INEXPENSIVE": "$",
        "PRICE_LEVEL_MODERATE": "$$",
        "PRICE_LEVEL_EXPENSIVE": "$$$",
        "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$"
      };

      const result = {
        id: place.id,
        name: place.displayName?.text || "Unknown",
        address: place.formattedAddress || "",
        rating: place.rating || 0,
        reviewCount: place.userRatingCount || 0,
        phone: place.nationalPhoneNumber || "",
        website: place.websiteUri || "",
        googleMapsUrl: place.googleMapsUri || "",
        photos,
        reviews,
        openingHours,
        isOpen,
        priceLevel: priceLevelMap[place.priceLevel] || "",
        businessStatus: place.businessStatus || "OPERATIONAL"
      };

      res.json(result);
    } catch (error) {
      console.error("Place details error:", error);
      res.status(500).json({ error: "Failed to fetch place details" });
    }
  });

  // Get nearby salons using Google Places API
  app.get("/api/salons/nearby", async (req, res) => {
    try {
      const { lat, lng, radius = 5000 } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);

      const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
      if (!GOOGLE_PLACES_API_KEY) {
        console.error("GOOGLE_PLACES_API_KEY not configured");
        return res.status(502).json({ 
          error: "Unable to fetch nearby stylists. Please try searching by city instead.",
          fallback: true 
        });
      }

      // Use Google Places API (New) - Nearby Search
      const placesUrl = new URL("https://places.googleapis.com/v1/places:searchNearby");
      
      const requestBody = {
        includedTypes: ["hair_care", "barber_shop"],
        excludedTypes: ["nail_salon", "spa"],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: {
              latitude: userLat,
              longitude: userLng
            },
            radius: parseFloat(radius as string)
          }
        }
      };

      const response = await fetch(placesUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.websiteUri,places.nationalPhoneNumber,places.photos"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Google Places API error: ${response.status} - ${errorText}`);
        return res.status(502).json({ 
          error: "Unable to fetch nearby stylists from Google Places. Please try searching by city instead.",
          fallback: true 
        });
      }

      const data = await response.json();
      
      // Map raw Google types to friendly specialty tags (hair-related only)
      const typeMapping: Record<string, string> = {
        "hair_care": "Hair Care",
        "barber_shop": "Barber",
        "beauty_salon": "Salon",
      };
      
      // Filter out nail-related businesses by name
      const nailKeywords = ["nail", "nails", "manicure", "pedicure", "spa"];
      const isHairRelated = (place: any): boolean => {
        const name = (place.displayName?.text || "").toLowerCase();
        const types = place.types || [];
        
        // Exclude if name contains nail-related keywords
        if (nailKeywords.some(keyword => name.includes(keyword))) {
          return false;
        }
        
        // Exclude if it's marked as nail_salon or spa
        if (types.includes("nail_salon") || types.includes("spa")) {
          return false;
        }
        
        return true;
      };

      // Default placeholder salon image
      const defaultSalonImage = "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&h=600&fit=crop";
      
      // Transform Google Places data to match our salon schema, filtering out non-hair businesses
      const salons = (data.places || []).filter(isHairRelated).map((place: any) => {
        // Extract and normalize specialties
        const rawTypes = place.types || [];
        const specialties = rawTypes
          .map((t: string) => typeMapping[t])
          .filter((s: string | undefined) => s !== undefined);
        
        // If no mapped specialties, use "Stylist" as default
        if (specialties.length === 0) {
          specialties.push("Stylist");
        }

        // Get photo URL from Google Places if available
        let imageUrl = defaultSalonImage;
        if (place.photos && place.photos.length > 0) {
          const photoName = place.photos[0].name;
          imageUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=400&maxWidthPx=600&key=${GOOGLE_PLACES_API_KEY}`;
        }

        // Calculate distance from user
        const placeLat = place.location?.latitude;
        const placeLng = place.location?.longitude;
        const distance = (placeLat && placeLng) 
          ? calculateDistance(userLat, userLng, placeLat, placeLng)
          : null;

        return {
          id: place.id || crypto.randomUUID(),
          name: place.displayName?.text || "Unnamed Stylist",
          address: place.formattedAddress || "",
          city: place.formattedAddress?.split(",").slice(-2, -1)[0]?.trim() || "",
          rating: place.rating || 0,
          reviewCount: place.userRatingCount || 0,
          imageUrl,
          specialties,
          distance,
        };
      });

      // Get internal registered businesses from database
      const internalBusinesses = await storage.getActiveBusinesses();
      const internalSalons = internalBusinesses.map((biz: any) => ({
        id: biz.googlePlaceId || biz.id, // Use googlePlaceId for booking lookup
        name: biz.name,
        address: biz.address || "",
        city: biz.city || "",
        rating: biz.googlePlaceId === "demo-favours-shop" ? 4.9 : 4.8,
        reviewCount: biz.googlePlaceId === "demo-favours-shop" ? 127 : 0,
        imageUrl: biz.imageUrl || defaultSalonImage,
        specialties: biz.googlePlaceId === "demo-favours-shop" 
          ? ["Haircuts", "Fades", "Beard Styling", "Book Online"] 
          : ["Registered Business", "Book Online"],
        distance: 0.1, // Show internal businesses as very close
        isInternal: true,
      }));
      
      // Combine internal businesses with Google Places results
      const allSalons = [...internalSalons, ...salons];
      
      // Sort by distance (closest first) by default
      allSalons.sort((a: any, b: any) => {
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });

      res.json(allSalons);
    } catch (error) {
      console.error("Error fetching nearby stylists:", error);
      res.status(502).json({ 
        error: "Unable to fetch nearby stylists from Google Places. Please try searching by city instead.",
        fallback: true 
      });
    }
  });

  // Search salons by city using Google Places Text Search with pagination
  app.get("/api/salons/search", async (req, res) => {
    try {
      const { city, pageToken } = req.query;

      if (!city || typeof city !== "string") {
        return res.status(400).json({ error: "City is required" });
      }

      const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
      if (!GOOGLE_PLACES_API_KEY) {
        console.error("GOOGLE_PLACES_API_KEY not configured");
        return res.status(502).json({ error: "Unable to search stylists" });
      }

      // Use Google Places Text Search to find hair salons/barbers in the city
      const placesUrl = new URL("https://places.googleapis.com/v1/places:searchText");
      
      const requestBody: any = {
        textQuery: `hair salon barber shop in ${city}`,
        includedType: "hair_care",
        pageSize: 20,
      };
      
      // Add pageToken for pagination if provided
      if (pageToken && typeof pageToken === "string") {
        requestBody.pageToken = pageToken;
      }

      const response = await fetch(placesUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.websiteUri,places.nationalPhoneNumber,places.photos,nextPageToken"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Google Places API error: ${response.status} - ${errorText}`);
        return res.status(502).json({ error: "Unable to search stylists" });
      }

      const data = await response.json();
      
      // Map types and filter
      const typeMapping: Record<string, string> = {
        "hair_care": "Hair Care",
        "barber_shop": "Barber",
        "beauty_salon": "Salon",
      };
      
      const nailKeywords = ["nail", "nails", "manicure", "pedicure", "spa"];
      const isHairRelated = (place: any): boolean => {
        const name = (place.displayName?.text || "").toLowerCase();
        const types = place.types || [];
        if (nailKeywords.some(keyword => name.includes(keyword))) return false;
        if (types.includes("nail_salon") || types.includes("spa")) return false;
        return true;
      };

      const defaultSalonImage = "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&h=600&fit=crop";
      
      const salons = (data.places || []).filter(isHairRelated).map((place: any) => {
        const rawTypes = place.types || [];
        const specialties = rawTypes
          .map((t: string) => typeMapping[t])
          .filter((s: string | undefined) => s !== undefined);
        
        if (specialties.length === 0) {
          specialties.push("Stylist");
        }

        let imageUrl = defaultSalonImage;
        if (place.photos && place.photos.length > 0) {
          const photoName = place.photos[0].name;
          imageUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=400&maxWidthPx=600&key=${GOOGLE_PLACES_API_KEY}`;
        }

        return {
          id: place.id || crypto.randomUUID(),
          name: place.displayName?.text || "Unnamed Stylist",
          address: place.formattedAddress || "",
          city: place.formattedAddress?.split(",").slice(-2, -1)[0]?.trim() || "",
          rating: place.rating || 0,
          reviewCount: place.userRatingCount || 0,
          imageUrl,
          specialties,
          distance: null,
        };
      });

      // Sort by rating for city search
      salons.sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));

      // Return salons with pagination info
      res.json({
        salons,
        nextPageToken: data.nextPageToken || null,
      });
    } catch (error) {
      console.error("Error searching stylists:", error);
      res.status(502).json({ error: "Unable to search stylists" });
    }
  });

  // Get current user info including credits
  app.get("/api/user/me", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check for daily credit reset
      await storage.resetDailyCredits(user.id);

      // Get updated user data
      const updatedUser = await storage.getUser(user.id);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user data" });
    }
  });

  // Get comprehensive user profile data (for profile menu and dashboard)
  app.get("/api/me", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check for daily credit reset
      await storage.resetDailyCredits(user.id);
      const updatedUser = await storage.getUser(user.id);

      // Get upcoming appointments (bookings)
      const upcomingAppointments = await storage.getUserUpcomingBookings(userId);

      // Get user's saved transformations (recent generated variants)
      const savedTransformations = await storage.getUserTransformations(userId, 10);

      // Get user's reviews
      const reviews = await storage.getUserReviews(userId);

      res.json({
        user: updatedUser,
        upcomingAppointments,
        savedTransformations,
        reviews,
      });
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });

  // Get credit transaction history
  app.get("/api/user/transactions", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const transactions = await storage.getCreditTransactions(userId);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  // Get user's saved/favorited generations (device-based)
  app.get("/api/user/favorites", async (req, res) => {
    try {
      const deviceId = getOrCreateDeviceId(req, res);
      
      // Get favorites for anonymous device
      const favorites = await storage.getUserFavoritesWithDevice(null, deviceId);
      res.json(favorites);
    } catch (error) {
      console.error("Error fetching user favorites:", error);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });

  // Get user's generation history (device-based for anonymous users)
  app.get("/api/user/history", async (req, res) => {
    try {
      const deviceId = getOrCreateDeviceId(req, res);
      const userId = getUserId(req);
      const limit = parseInt(req.query.limit as string) || 50;
      
      // Get generation history for this device/user
      const history = await storage.getUserGenerationHistory(userId || null, deviceId, limit);
      res.json(history);
    } catch (error) {
      console.error("Error fetching user history:", error);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // Create payment intent for one-time credit purchase (Pay-as-you-go)
  app.post("/api/create-payment-intent", async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ error: "Payment processing not configured" });
      }

      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { credits } = req.body;

      if (!credits || credits < 1) {
        return res.status(400).json({ error: "Invalid credit amount" });
      }

      // $0.25 per credit
      const amount = Math.round(credits * 0.25 * 100); // Convert to cents

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        metadata: {
          userId,
          credits: credits.toString(),
          type: "purchase",
        },
      });

      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
      console.error("Error creating payment intent:", error);
      res.status(500).json({ error: "Failed to create payment intent: " + error.message });
    }
  });

  // Create subscription for monthly or business plan
  app.post("/api/create-subscription", async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ error: "Payment processing not configured" });
      }

      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { plan } = req.body; // "monthly" or "business"

      if (!plan || (plan !== "monthly" && plan !== "business")) {
        return res.status(400).json({ error: "Invalid plan" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      let customer: Stripe.Customer;

      // Get or create Stripe customer
      if (user.stripeCustomerId) {
        customer = await stripe.customers.retrieve(user.stripeCustomerId) as Stripe.Customer;
      } else {
        customer = await stripe.customers.create({
          email: user.email || undefined,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
        });
      }

      // Create subscription with inline pricing
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: plan === "monthly" ? "Monthly Plan" : "Business Plan",
              description: plan === "monthly" 
                ? "100 credits per month" 
                : "Unlimited credits",
            },
            recurring: {
              interval: "month",
            },
            unit_amount: plan === "monthly" ? 1999 : 3500, // $19.99 or $35.00
          } as any, // Type assertion for Stripe beta API version compatibility
        }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent"],
        metadata: {
          userId,
          plan,
        },
      });

      const latestInvoice: any = subscription.latest_invoice;
      const paymentIntent: any = latestInvoice?.payment_intent;

      res.json({
        subscriptionId: subscription.id,
        clientSecret: paymentIntent?.client_secret || null,
      });
    } catch (error: any) {
      console.error("Error creating subscription:", error);
      res.status(500).json({ error: "Failed to create subscription: " + error.message });
    }
  });

  // Stripe webhook handler
  app.post("/api/webhook/stripe", async (req, res) => {
    if (!stripe) {
      return res.status(503).send("Payment processing not configured");
    }

    const sig = req.headers["stripe-signature"];

    if (!sig) {
      return res.status(400).send("Missing stripe-signature header");
    }

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ""
      );

      // Handle the event
      switch (event.type) {
        case "payment_intent.succeeded":
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          const userId = paymentIntent.metadata.userId;
          const credits = parseInt(paymentIntent.metadata.credits || "0");

          if (userId && credits > 0) {
            await storage.addCredits(
              userId,
              credits,
              "purchase",
              `Purchased ${credits} credits`
            );
          }
          break;

        case "invoice.payment_succeeded":
          const invoice: any = event.data.object;
          const subscriptionObj = await stripe.subscriptions.retrieve(invoice.subscription);
          const subUserId = subscriptionObj.metadata.userId;
          const plan = subscriptionObj.metadata.plan;

          if (subUserId && plan) {
            // Add credits based on plan
            if (plan === "monthly") {
              await storage.addCredits(subUserId, 100, "subscription", "Monthly plan: 100 credits");
            }
            // Business plan gets unlimited, so no need to add credits
          }
          break;

        case "customer.subscription.deleted":
          const deletedSub = event.data.object as Stripe.Subscription;
          const delUserId = deletedSub.metadata.userId;

          if (delUserId) {
            const user = await storage.getUser(delUserId);
            if (user) {
              // Reset to free plan
              await storage.upsertUser({
                ...user,
                plan: "free",
                credits: 3,
              });
            }
          }
          break;
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error.message);
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  });

  // ========================================
  // Video Community (Explore) Routes
  // ========================================

  // Get video feed with pagination
  app.get("/api/videos", async (req, res) => {
    try {
      const { limit = "20", offset = "0" } = req.query;
      const userId = getUserId(req);

      const videos = await storage.getVideoFeed(
        parseInt(limit as string),
        parseInt(offset as string),
        userId || undefined
      );

      res.json(videos);
    } catch (error) {
      console.error("Error fetching video feed:", error);
      res.status(500).json({ error: "Failed to fetch video feed" });
    }
  });

  // Get single video by ID
  app.get("/api/videos/:id", async (req, res) => {
    try {
      const video = await storage.getVideoById(req.params.id);
      
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }

      res.json(video);
    } catch (error) {
      console.error("Error fetching video:", error);
      res.status(500).json({ error: "Failed to fetch video" });
    }
  });

  // Upload a new video (requires authentication)
  app.post("/api/videos", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { title, description, videoUrl, thumbnailUrl, generatedVariantId, duration, tags } = req.body;

      if (!videoUrl) {
        return res.status(400).json({ error: "Video URL is required" });
      }

      const video = await storage.createVideo({
        userId,
        title: title || null,
        description: description || null,
        videoUrl,
        thumbnailUrl: thumbnailUrl || null,
        generatedVariantId: generatedVariantId || null,
        duration: duration || null,
        tags: tags || null,
      });

      res.json(video);
    } catch (error) {
      console.error("Error creating video:", error);
      res.status(500).json({ error: "Failed to create video" });
    }
  });

  // Delete a video (requires ownership)
  app.delete("/api/videos/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const success = await storage.deleteVideo(req.params.id, userId);
      
      if (!success) {
        return res.status(404).json({ error: "Video not found or unauthorized" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting video:", error);
      res.status(500).json({ error: "Failed to delete video" });
    }
  });

  // Record a video view
  app.post("/api/videos/:id/view", async (req, res) => {
    try {
      await storage.incrementVideoViews(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error recording view:", error);
      res.status(500).json({ error: "Failed to record view" });
    }
  });

  // Like a video (requires authentication)
  app.post("/api/videos/:id/like", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      await storage.likeVideo(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error liking video:", error);
      res.status(500).json({ error: "Failed to like video" });
    }
  });

  // Unlike a video (requires authentication)
  app.delete("/api/videos/:id/like", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      await storage.unlikeVideo(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error unliking video:", error);
      res.status(500).json({ error: "Failed to unlike video" });
    }
  });

  // Get video comments
  app.get("/api/videos/:id/comments", async (req, res) => {
    try {
      const comments = await storage.getVideoComments(req.params.id);
      res.json(comments);
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  // Add a comment (requires authentication)
  app.post("/api/videos/:id/comments", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Comment content is required" });
      }

      const comment = await storage.createComment({
        videoId: req.params.id,
        userId,
        content: content.trim(),
      });

      res.json(comment);
    } catch (error) {
      console.error("Error creating comment:", error);
      res.status(500).json({ error: "Failed to create comment" });
    }
  });

  // Delete a comment (requires ownership)
  app.delete("/api/videos/:id/comments/:commentId", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const success = await storage.deleteComment(req.params.commentId, userId);
      
      if (!success) {
        return res.status(404).json({ error: "Comment not found or unauthorized" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  });

  // Get user's own videos
  app.get("/api/user/videos", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const videos = await storage.getUserVideos(userId);
      res.json(videos);
    } catch (error) {
      console.error("Error fetching user videos:", error);
      res.status(500).json({ error: "Failed to fetch user videos" });
    }
  });

  // Get all stylists with portfolios (beta demo stylists only for now)
  app.get("/api/stylists", async (req, res) => {
    try {
      const stylists = await storage.getBetaDemoStylists();
      res.json(stylists);
    } catch (error) {
      console.error("Error fetching stylists:", error);
      res.status(500).json({ error: "Failed to fetch stylists" });
    }
  });

  // Get single stylist with portfolio
  app.get("/api/stylists/:id", async (req, res) => {
    try {
      const stylist = await storage.getStylistById(req.params.id);
      if (!stylist) {
        return res.status(404).json({ error: "Stylist not found" });
      }
      res.json(stylist);
    } catch (error) {
      console.error("Error fetching stylist:", error);
      res.status(500).json({ error: "Failed to fetch stylist" });
    }
  });

  // Create appointment/booking (supports anonymous bookings via sessionId)
  app.post("/api/appointments", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { stylistId, variantId, sessionId, notes, attachedImages } = req.body;
      
      if (!stylistId) {
        return res.status(400).json({ error: "Stylist is required" });
      }

      // Allow anonymous bookings with sessionId, or authenticated bookings with userId
      if (!userId && !sessionId) {
        return res.status(400).json({ error: "Either user authentication or session ID is required" });
      }

      const appointment = await storage.createAppointment({
        userId: userId || null,
        sessionId: sessionId || null,
        stylistId,
        variantId: variantId || null,
        notes: notes || "",
        attachedImages: attachedImages || [],
        status: "pending",
      });

      res.json(appointment);
    } catch (error) {
      console.error("Error creating appointment:", error);
      res.status(500).json({ error: "Failed to create appointment" });
    }
  });

  // Get user's appointments
  app.get("/api/user/appointments", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const appointments = await storage.getUserAppointments(userId);
      res.json(appointments);
    } catch (error) {
      console.error("Error fetching appointments:", error);
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  // ===============================
  // BUSINESS BOOKING API ROUTES
  // ===============================

  // Register/claim a business (links Google Place ID to our system)
  app.post("/api/business/register", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { googlePlaceId, name, address, city, phone, website, description, imageUrl } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Business name is required" });
      }

      // Check if business already exists with this Google Place ID
      if (googlePlaceId) {
        const existing = await storage.getBusinessByGooglePlaceId(googlePlaceId);
        if (existing) {
          return res.status(400).json({ error: "This business is already registered" });
        }
      }

      // Check if user already owns a business
      const existingOwned = await storage.getBusinessByOwnerId(userId);
      if (existingOwned) {
        return res.status(400).json({ error: "You already have a registered business" });
      }

      const business = await storage.createBusiness({
        googlePlaceId: googlePlaceId || null,
        ownerId: userId,
        name,
        address: address || null,
        city: city || null,
        phone: phone || null,
        website: website || null,
        description: description || null,
        imageUrl: imageUrl || null,
        isVerified: 0,
        isActive: 1,
      });

      res.json(business);
    } catch (error) {
      console.error("Error registering business:", error);
      res.status(500).json({ error: "Failed to register business" });
    }
  });

  // Get current user's business
  app.get("/api/business/mine", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const business = await storage.getBusinessByOwnerId(userId);
      if (!business) {
        return res.json(null);
      }

      // Get full business details
      const businessWithDetails = await storage.getBusinessWithDetails(business.id);
      res.json(businessWithDetails);
    } catch (error) {
      console.error("Error fetching business:", error);
      res.status(500).json({ error: "Failed to fetch business" });
    }
  });

  // Get business by ID or Google Place ID (public - for customer booking)
  app.get("/api/business/:idOrPlaceId", async (req, res) => {
    try {
      const { idOrPlaceId } = req.params;

      // Try to find by ID first, then by Google Place ID
      let business = await storage.getBusinessById(idOrPlaceId);
      if (!business) {
        business = await storage.getBusinessByGooglePlaceId(idOrPlaceId);
      }

      if (!business) {
        return res.json(null);
      }

      const businessWithDetails = await storage.getBusinessWithDetails(business.id);
      
      // Add enhanced data for demo shop
      if (business.googlePlaceId === "demo-favours-shop") {
        const enhancedBusiness = {
          ...businessWithDetails,
          rating: 4.9,
          reviewCount: 127,
          photos: [
            { url: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800", attribution: "Interior view" },
            { url: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800", attribution: "Barber station" },
            { url: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=800", attribution: "Haircut in progress" },
            { url: "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=800", attribution: "Classic barbershop" },
            { url: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800", attribution: "Styling products" },
          ],
          openingHours: [
            "Monday: 9:00 AM - 7:00 PM",
            "Tuesday: 9:00 AM - 7:00 PM",
            "Wednesday: 9:00 AM - 7:00 PM",
            "Thursday: 9:00 AM - 8:00 PM",
            "Friday: 9:00 AM - 8:00 PM",
            "Saturday: 10:00 AM - 6:00 PM",
            "Sunday: Closed",
          ],
          reviews: [
            {
              author: "Michael T.",
              authorPhoto: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100",
              rating: 5,
              text: "Best barbershop in the city! Favour really knows what he's doing. Got an amazing fade and the atmosphere is super relaxed.",
              time: "2 weeks ago",
            },
            {
              author: "Sarah K.",
              authorPhoto: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100",
              rating: 5,
              text: "Brought my son here for his first haircut. Favour was so patient and did an amazing job. We'll definitely be back!",
              time: "1 month ago",
            },
            {
              author: "James L.",
              authorPhoto: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100",
              rating: 5,
              text: "Finally found my go-to barber! Great cuts, fair prices, and genuine attention to what you want. Highly recommend.",
              time: "1 month ago",
            },
            {
              author: "David W.",
              authorPhoto: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100",
              rating: 4,
              text: "Solid haircut every time. Sometimes there's a bit of a wait but the quality makes it worth it.",
              time: "2 months ago",
            },
          ],
          isOpen: true,
          priceLevel: "$$",
          website: "https://favoursshop.com",
        };
        return res.json(enhancedBusiness);
      }
      
      res.json(businessWithDetails);
    } catch (error) {
      console.error("Error fetching business:", error);
      res.status(500).json({ error: "Failed to fetch business" });
    }
  });

  // Update business info
  app.patch("/api/business/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { id } = req.params;
      const business = await storage.getBusinessById(id);

      if (!business || business.ownerId !== userId) {
        return res.status(403).json({ error: "Not authorized to update this business" });
      }

      const { name, address, city, phone, website, description, imageUrl, isActive } = req.body;

      const updated = await storage.updateBusiness(id, {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(phone !== undefined && { phone }),
        ...(website !== undefined && { website }),
        ...(description !== undefined && { description }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(isActive !== undefined && { isActive }),
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating business:", error);
      res.status(500).json({ error: "Failed to update business" });
    }
  });

  // ===== SERVICES =====

  // Add a service to business
  app.post("/api/business/:businessId/services", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { businessId } = req.params;
      const business = await storage.getBusinessById(businessId);

      if (!business || business.ownerId !== userId) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const { name, description, price, duration, category } = req.body;

      if (!name || price === undefined) {
        return res.status(400).json({ error: "Name and price are required" });
      }

      const service = await storage.createService({
        businessId,
        name,
        description: description || null,
        price: Math.round(price * 100), // Convert dollars to cents
        duration: duration || 30,
        category: category || null,
        isActive: 1,
      });

      res.json(service);
    } catch (error) {
      console.error("Error adding service:", error);
      res.status(500).json({ error: "Failed to add service" });
    }
  });

  // Get services for a business
  app.get("/api/business/:businessId/services", async (req, res) => {
    try {
      const { businessId } = req.params;
      const services = await storage.getServicesByBusinessId(businessId);
      res.json(services);
    } catch (error) {
      console.error("Error fetching services:", error);
      res.status(500).json({ error: "Failed to fetch services" });
    }
  });

  // Update a service
  app.patch("/api/services/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { id } = req.params;
      const { name, description, price, duration, category, isActive } = req.body;

      const updated = await storage.updateService(id, {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price: Math.round(price * 100) }),
        ...(duration !== undefined && { duration }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive }),
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating service:", error);
      res.status(500).json({ error: "Failed to update service" });
    }
  });

  // Delete a service
  app.delete("/api/services/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { id } = req.params;
      await storage.deleteService(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting service:", error);
      res.status(500).json({ error: "Failed to delete service" });
    }
  });

  // ===== STYLISTS =====

  // Add a stylist to business
  app.post("/api/business/:businessId/stylists", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { businessId } = req.params;
      const business = await storage.getBusinessById(businessId);

      if (!business || business.ownerId !== userId) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const { name, bio, profileImageUrl, specialty } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Stylist name is required" });
      }

      const stylist = await storage.createBusinessStylist({
        businessId,
        userId: null, // Will be linked if stylist creates account
        name,
        bio: bio || null,
        profileImageUrl: profileImageUrl || null,
        specialty: specialty || null,
        isActive: 1,
      });

      res.json(stylist);
    } catch (error) {
      console.error("Error adding stylist:", error);
      res.status(500).json({ error: "Failed to add stylist" });
    }
  });

  // Get stylists for a business
  app.get("/api/business/:businessId/stylists", async (req, res) => {
    try {
      const { businessId } = req.params;
      const stylists = await storage.getBusinessStylistsByBusinessId(businessId);
      res.json(stylists);
    } catch (error) {
      console.error("Error fetching stylists:", error);
      res.status(500).json({ error: "Failed to fetch stylists" });
    }
  });

  // Update stylist
  app.patch("/api/stylists/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { id } = req.params;
      const { name, bio, profileImageUrl, specialty, isActive } = req.body;

      const updated = await storage.updateBusinessStylist(id, {
        ...(name !== undefined && { name }),
        ...(bio !== undefined && { bio }),
        ...(profileImageUrl !== undefined && { profileImageUrl }),
        ...(specialty !== undefined && { specialty }),
        ...(isActive !== undefined && { isActive }),
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating stylist:", error);
      res.status(500).json({ error: "Failed to update stylist" });
    }
  });

  // Delete stylist
  app.delete("/api/stylists/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { id } = req.params;
      await storage.deleteBusinessStylist(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting stylist:", error);
      res.status(500).json({ error: "Failed to delete stylist" });
    }
  });

  // ===== STYLIST AVAILABILITY =====

  // Set stylist availability schedule
  app.put("/api/stylists/:stylistId/availability", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { stylistId } = req.params;
      const { availability } = req.body; // Array of { dayOfWeek, startTime, endTime, isAvailable }

      if (!Array.isArray(availability)) {
        return res.status(400).json({ error: "Availability must be an array" });
      }

      const result = await storage.setStylistAvailability(stylistId, availability);
      res.json(result);
    } catch (error) {
      console.error("Error setting availability:", error);
      res.status(500).json({ error: "Failed to set availability" });
    }
  });

  // Get stylist availability
  app.get("/api/stylists/:stylistId/availability", async (req, res) => {
    try {
      const { stylistId } = req.params;
      const availability = await storage.getStylistAvailability(stylistId);
      res.json(availability);
    } catch (error) {
      console.error("Error fetching availability:", error);
      res.status(500).json({ error: "Failed to fetch availability" });
    }
  });

  // Add time off for stylist
  app.post("/api/stylists/:stylistId/time-off", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { stylistId } = req.params;
      const { date, startTime, endTime, reason } = req.body;

      if (!date) {
        return res.status(400).json({ error: "Date is required" });
      }

      const timeOff = await storage.addStylistTimeOff({
        stylistId,
        date,
        startTime: startTime || null,
        endTime: endTime || null,
        reason: reason || null,
      });

      res.json(timeOff);
    } catch (error) {
      console.error("Error adding time off:", error);
      res.status(500).json({ error: "Failed to add time off" });
    }
  });

  // ===== BOOKINGS =====

  // Get available time slots for a stylist on a specific date
  app.get("/api/stylists/:stylistId/slots", async (req, res) => {
    try {
      const { stylistId } = req.params;
      const { date, duration } = req.query;

      if (!date || typeof date !== "string") {
        return res.status(400).json({ error: "Date is required (YYYY-MM-DD format)" });
      }

      const serviceDuration = parseInt(duration as string) || 30;
      const slots = await storage.getAvailableSlots(stylistId, date, serviceDuration);
      res.json(slots);
    } catch (error) {
      console.error("Error fetching slots:", error);
      res.status(500).json({ error: "Failed to fetch available slots" });
    }
  });

  // Create a booking
  app.post("/api/bookings", async (req, res) => {
    try {
      const userId = getUserId(req);

      const {
        businessId,
        stylistId,
        serviceId,
        date,
        startTime,
        customerName,
        customerEmail,
        customerPhone,
        notes,
        desiredHairstyle,
        attachedVariantId,
        attachedImageUrl,
        paymentIntentId,
      } = req.body;

      if (!businessId || !stylistId || !serviceId || !date || !startTime || !customerName) {
        return res.status(400).json({ 
          error: "Missing required fields: businessId, stylistId, serviceId, date, startTime, customerName" 
        });
      }

      // Verify payment was completed
      if (!paymentIntentId) {
        return res.status(400).json({ error: "Payment is required to complete booking" });
      }

      // Verify payment intent status with Stripe
      try {
        const stripe = await getUncachableStripeClient();
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status !== "succeeded") {
          return res.status(400).json({ error: "Payment has not been completed" });
        }
      } catch (stripeError: any) {
        console.error("Failed to verify payment intent:", stripeError);
        return res.status(400).json({ error: "Could not verify payment" });
      }

      // Get service to determine duration and price
      const services = await storage.getServicesByBusinessId(businessId);
      const service = services.find(s => s.id === serviceId);
      
      if (!service) {
        return res.status(400).json({ error: "Invalid service" });
      }

      // Calculate end time based on service duration
      const [hour, minute] = startTime.split(':').map(Number);
      const endMinutes = hour * 60 + minute + service.duration;
      const endHour = Math.floor(endMinutes / 60);
      const endMinute = endMinutes % 60;
      const endTime = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;

      // Check if slot is still available using scheduling service for robust conflict detection
      const { isSlotAvailable } = await import("./scheduling");
      const slotCheck = await isSlotAvailable(stylistId, date, startTime, endTime);

      if (!slotCheck.available) {
        return res.status(400).json({ 
          error: "This time slot is no longer available", 
          reason: slotCheck.reason,
          conflictWith: slotCheck.conflictWith
        });
      }

      try {
        const booking = await storage.createBooking({
          businessId,
          stylistId,
          serviceId,
          userId: userId || null,
          customerName,
          customerEmail: customerEmail || null,
          customerPhone: customerPhone || null,
          date,
          startTime,
          endTime,
          notes: notes || null,
          desiredHairstyle: desiredHairstyle || null,
          attachedVariantId: attachedVariantId || null,
          attachedImageUrl: attachedImageUrl || null,
          status: "confirmed", // Payment verified, booking is confirmed
          totalPrice: service.price,
          paymentIntentId: paymentIntentId,
          paymentStatus: "succeeded",
        });

        // Send booking confirmation notification
        if (userId) {
          const business = await storage.getBusinessById(businessId);
          const stylist = await storage.getBusinessStylistById(stylistId);
          
          await storage.createNotification({
            userId,
            type: 'booking_confirmed',
            title: 'Appointment Confirmed',
            body: `Your appointment at ${business?.name || 'the salon'} with ${stylist?.name || 'your stylist'} on ${date} at ${startTime} has been confirmed.`,
            data: { bookingId: booking.id, date, startTime, businessName: business?.name }
          });
        }

        res.json(booking);
      } catch (bookingError: any) {
        // Handle double-booking race condition
        if (bookingError.message?.includes("DOUBLE_BOOKING_CONFLICT")) {
          return res.status(409).json({ 
            error: "This time slot was just booked by someone else. Please choose a different time.",
            code: "DOUBLE_BOOKING"
          });
        }
        throw bookingError;
      }
    } catch (error) {
      console.error("Error creating booking:", error);
      res.status(500).json({ error: "Failed to create booking" });
    }
  });

  // Get user's bookings
  app.get("/api/bookings/mine", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const bookings = await storage.getBookingsByUserId(userId);
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching bookings:", error);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  // Beta demo booking endpoint - skips payment for demo businesses
  // Used to track user interest in booking without requiring actual payment
  app.post("/api/beta-booking", async (req, res) => {
    try {
      const userId = getUserId(req);
      const deviceId = getOrCreateDeviceId(req, res);
      
      const {
        stylistId,
        serviceName,
        servicePrice,
        appointmentDate,
        notes,
        attachedVariantId,
      } = req.body;

      if (!stylistId || !serviceName) {
        return res.status(400).json({ 
          error: "Missing required fields: stylistId, serviceName" 
        });
      }

      // Verify this is a beta demo stylist
      const stylist = await storage.getStylistById(stylistId);
      if (!stylist) {
        return res.status(404).json({ error: "Stylist not found" });
      }

      if (!stylist.isBetaDemo) {
        return res.status(400).json({ 
          error: "This endpoint is only for beta demo bookings" 
        });
      }

      // Create beta demo appointment (no payment required)
      const appointment = await storage.createAppointment({
        userId: userId || null,
        deviceId: deviceId,
        stylistId,
        variantId: attachedVariantId || null,
        serviceName,
        servicePrice: servicePrice || null,
        appointmentDate: appointmentDate ? new Date(appointmentDate) : null,
        notes: notes || null,
        status: "beta_booked",
        isBetaBooking: true,
      });

      console.log(`[BETA] Demo booking created: ${appointment.id} for stylist ${stylist.name}`);

      res.json({ 
        success: true, 
        message: "Demo booking recorded! This is a beta test - no actual appointment was made.",
        booking: {
          id: appointment.id,
          stylistName: stylist.name,
          service: serviceName,
          price: servicePrice,
          date: appointmentDate,
        }
      });
    } catch (error) {
      console.error("Error creating beta booking:", error);
      res.status(500).json({ error: "Failed to create beta booking" });
    }
  });

  // Get beta demo stylists
  app.get("/api/beta-stylists", async (req, res) => {
    try {
      const betaStylists = await storage.getBetaDemoStylists();
      res.json(betaStylists);
    } catch (error) {
      console.error("Error fetching beta stylists:", error);
      res.status(500).json({ error: "Failed to fetch beta stylists" });
    }
  });

  // Get user's current plan preference
  app.get("/api/plan-preference", async (req, res) => {
    try {
      const userId = getUserId(req);
      const deviceId = req.cookies?.auren_device_id;
      
      const plan = await storage.getUserPlanPreference(deviceId, userId || undefined);
      res.json({ plan });
    } catch (error) {
      console.error("Error fetching plan preference:", error);
      res.status(500).json({ error: "Failed to fetch plan preference" });
    }
  });

  // Track plan preference for beta analytics
  app.post("/api/plan-preference", async (req, res) => {
    try {
      const { plan } = req.body;
      const userId = getUserId(req);
      
      // Get or create device ID for anonymous tracking
      let deviceId = req.cookies?.auren_device_id;
      if (!deviceId) {
        deviceId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        res.cookie("auren_device_id", deviceId, {
          maxAge: 365 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          sameSite: "strict",
        });
      }

      await storage.recordPlanPreference({
        plan,
        deviceId,
        userId: userId || undefined,
      });

      res.json({ success: true, message: "Plan preference recorded", plan });
    } catch (error) {
      console.error("Error recording plan preference:", error);
      res.status(500).json({ error: "Failed to record plan preference" });
    }
  });

  // Get plan preference analytics (admin only)
  app.get("/api/admin/plan-preferences", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user?.email || !isAdminWhitelisted(user.email)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const analytics = await storage.getPlanPreferenceAnalytics();
      res.json(analytics);
    } catch (error) {
      console.error("Error fetching plan preference analytics:", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  // Get bookings for a business (owner only)
  app.get("/api/business/:businessId/bookings", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { businessId } = req.params;
      const { date } = req.query;

      const business = await storage.getBusinessById(businessId);
      if (!business || business.ownerId !== userId) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const bookings = await storage.getBookingsByBusinessId(businessId, date as string);
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching business bookings:", error);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  // Update booking status (business owner only)
  app.patch("/api/bookings/:id/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const booking = await storage.updateBookingStatus(id, status);
      res.json(booking);
    } catch (error) {
      console.error("Error updating booking:", error);
      res.status(500).json({ error: "Failed to update booking" });
    }
  });

  // Cancel a booking
  app.post("/api/bookings/:id/cancel", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;

      const booking = await storage.getBookingById(id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      // Allow cancellation by the booking user or business owner
      if (userId && (booking.userId === userId || booking.business.ownerId === userId)) {
        await storage.cancelBooking(id);
        res.json({ success: true });
      } else {
        return res.status(403).json({ error: "Not authorized to cancel this booking" });
      }
    } catch (error) {
      console.error("Error cancelling booking:", error);
      res.status(500).json({ error: "Failed to cancel booking" });
    }
  });

  // ===== STRIPE PAYMENT ROUTES =====

  // Get Stripe publishable key for client
  app.get("/api/stripe/publishable-key", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error) {
      console.error("Error getting Stripe publishable key:", error);
      res.status(500).json({ error: "Stripe is not configured" });
    }
  });

  // Create a payment intent for booking
  app.post("/api/stripe/create-payment-intent", async (req, res) => {
    try {
      const { amount, currency = "usd", metadata } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Valid amount is required" });
      }

      const stripe = await getUncachableStripeClient();
      
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        metadata: metadata || {},
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      });
    } catch (error: any) {
      console.error("Error creating payment intent:", error);
      res.status(500).json({ error: error.message || "Failed to create payment intent" });
    }
  });

  // Process cancellation with 20% fee if less than 3 hours before appointment
  app.post("/api/bookings/:id/cancel-with-fee", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;

      const booking = await storage.getBookingById(id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      // Check authorization
      if (userId && (booking.userId !== userId && booking.business.ownerId !== userId)) {
        return res.status(403).json({ error: "Not authorized to cancel this booking" });
      }

      // Check if within 3 hours of appointment
      const appointmentTime = new Date(`${booking.date}T${booking.startTime}`);
      const now = new Date();
      const hoursUntilAppointment = (appointmentTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      let cancellationFee = 0;
      let refundAmount = booking.totalPrice;
      
      if (hoursUntilAppointment < 3) {
        // 20% cancellation fee
        cancellationFee = Math.round(booking.totalPrice * 0.20 * 100) / 100;
        refundAmount = booking.totalPrice - cancellationFee;
      }

      await storage.cancelBooking(id);

      res.json({ 
        success: true,
        cancellationFee,
        refundAmount,
        message: hoursUntilAppointment < 3 
          ? `Booking cancelled. A 20% cancellation fee of $${cancellationFee.toFixed(2)} applies.`
          : "Booking cancelled. Full refund will be processed."
      });
    } catch (error) {
      console.error("Error cancelling booking:", error);
      res.status(500).json({ error: "Failed to cancel booking" });
    }
  });

  // Reschedule a booking
  app.post("/api/bookings/:id/reschedule", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { id } = req.params;
      const { newDate, newStartTime, newEndTime } = req.body;

      if (!newDate || !newStartTime || !newEndTime) {
        return res.status(400).json({ error: "newDate, newStartTime, and newEndTime are required" });
      }

      // Check if user owns this booking
      const booking = await storage.getBookingById(id);
      if (!booking || booking.userId !== userId) {
        return res.status(403).json({ error: "Not authorized to reschedule this booking" });
      }

      // Only pending or confirmed bookings can be rescheduled
      if (!['pending', 'confirmed'].includes(booking.status)) {
        return res.status(400).json({ error: "Only pending or confirmed bookings can be rescheduled" });
      }

      const updatedBooking = await storage.rescheduleBooking(id, newDate, newStartTime, newEndTime);
      
      // Send notification about reschedule
      await storage.createNotification({
        userId,
        type: 'booking_rescheduled',
        title: 'Appointment Rescheduled',
        body: `Your appointment has been moved to ${newDate} at ${newStartTime}`,
        data: { bookingId: id, newDate, newStartTime }
      });

      res.json(updatedBooking);
    } catch (error: any) {
      console.error("Error rescheduling booking:", error);
      if (error.message?.includes('SLOT_UNAVAILABLE')) {
        return res.status(409).json({ error: "The new time slot is not available" });
      }
      res.status(500).json({ error: "Failed to reschedule booking" });
    }
  });

  // Get user appointment history
  app.get("/api/appointments/history", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { status } = req.query;
      const appointments = await storage.getUserAppointmentHistory(userId, status as string | undefined);
      res.json(appointments);
    } catch (error) {
      console.error("Error getting appointment history:", error);
      res.status(500).json({ error: "Failed to get appointment history" });
    }
  });

  // ===========================================
  // REVIEWS ROUTES
  // ===========================================

  // Create a review for a booking (business + stylist)
  app.post("/api/reviews", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { bookingId, businessRating, stylistRating, comment } = req.body;

      if (!bookingId || (!businessRating && !stylistRating)) {
        return res.status(400).json({ error: "bookingId and at least one rating are required" });
      }

      // Check if user can review this booking
      const canReview = await storage.canUserReviewBooking(userId, bookingId);
      if (!canReview) {
        return res.status(400).json({ error: "Cannot review this booking. It may not be completed or already reviewed." });
      }

      const booking = await storage.getBookingById(bookingId);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      const results: any = {};

      // Create business review if provided
      if (businessRating) {
        const businessReview = await storage.createBusinessReview({
          userId,
          businessId: booking.businessId,
          bookingId,
          rating: businessRating,
          comment: comment || null,
        });
        results.businessReview = businessReview;
      }

      // Create stylist review if provided
      if (stylistRating) {
        const stylistReview = await storage.createStylistReview({
          userId,
          stylistId: booking.stylistId,
          bookingId,
          rating: stylistRating,
          comment: comment || null,
        });
        results.stylistReview = stylistReview;
      }

      res.json(results);
    } catch (error) {
      console.error("Error creating review:", error);
      res.status(500).json({ error: "Failed to create review" });
    }
  });

  // Get reviews for a business
  app.get("/api/businesses/:businessId/reviews", async (req, res) => {
    try {
      const { businessId } = req.params;
      const reviews = await storage.getBusinessReviews(businessId);
      const rating = await storage.getBusinessAverageRating(businessId);
      
      res.json({ reviews, averageRating: rating.average, reviewCount: rating.count });
    } catch (error) {
      console.error("Error getting business reviews:", error);
      res.status(500).json({ error: "Failed to get reviews" });
    }
  });

  // Get reviews for a stylist
  app.get("/api/stylists/:stylistId/reviews", async (req, res) => {
    try {
      const { stylistId } = req.params;
      const reviews = await storage.getStylistReviews(stylistId);
      const rating = await storage.getStylistAverageRating(stylistId);
      
      res.json({ reviews, averageRating: rating.average, reviewCount: rating.count });
    } catch (error) {
      console.error("Error getting stylist reviews:", error);
      res.status(500).json({ error: "Failed to get reviews" });
    }
  });

  // Check if user can review a booking
  app.get("/api/bookings/:id/can-review", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const canReview = await storage.canUserReviewBooking(userId, req.params.id);
      res.json({ canReview });
    } catch (error) {
      console.error("Error checking review eligibility:", error);
      res.status(500).json({ error: "Failed to check review eligibility" });
    }
  });

  // Get user's reviews
  app.get("/api/reviews/mine", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const businessReviews = await storage.getUserReviews(userId);
      const stylistReviews = await storage.getUserStylistReviews(userId);
      
      res.json({ businessReviews, stylistReviews });
    } catch (error) {
      console.error("Error getting user reviews:", error);
      res.status(500).json({ error: "Failed to get reviews" });
    }
  });

  // ===========================================
  // STYLIST AVAILABILITY CALENDAR (User-facing)
  // ===========================================

  // Get public availability calendar for a stylist
  app.get("/api/stylists/:stylistId/calendar", async (req, res) => {
    try {
      const { stylistId } = req.params;
      const { startDate, endDate, serviceId } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required" });
      }

      const { getStylistAvailability } = await import("./scheduling");
      const availability = await getStylistAvailability(
        stylistId, 
        startDate as string, 
        endDate as string,
        serviceId as string | undefined
      );

      res.json(availability);
    } catch (error) {
      console.error("Error getting stylist calendar:", error);
      res.status(500).json({ error: "Failed to get availability" });
    }
  });

  // Get public availability for all stylists at a business
  app.get("/api/businesses/:businessId/calendar", async (req, res) => {
    try {
      const { businessId } = req.params;
      const { startDate, endDate, serviceId } = req.query;

      if (!startDate || !endDate || !serviceId) {
        return res.status(400).json({ error: "startDate, endDate, and serviceId are required" });
      }

      const { getBusinessAvailableSlots } = await import("./scheduling");
      
      // Get availability for each day in range
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      const calendar: any[] = [];

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const slots = await getBusinessAvailableSlots(businessId, dateStr, serviceId as string);
        calendar.push({
          date: dateStr,
          slots: slots.map(s => ({
            startTime: s.startTime,
            endTime: s.endTime,
            stylistId: s.stylistId,
            stylistName: s.stylistName
          })),
          hasAvailability: slots.length > 0
        });
      }

      res.json(calendar);
    } catch (error) {
      console.error("Error getting business calendar:", error);
      res.status(500).json({ error: "Failed to get availability" });
    }
  });

  // ===========================================
  // ADVANCED SCHEDULING ROUTES
  // ===========================================

  // Get available slots for a business on a date (public for booking flow)
  app.get("/api/scheduling/slots/:businessId/:date", async (req, res) => {
    try {
      const { businessId, date } = req.params;
      const { serviceId } = req.query;
      
      if (!serviceId) {
        return res.status(400).json({ error: "serviceId is required" });
      }
      
      const { getBusinessAvailableSlots } = await import("./scheduling");
      const slots = await getBusinessAvailableSlots(businessId, date, serviceId as string);
      
      // Return only slot times without sensitive details for public access
      const publicSlots = slots.map(slot => ({
        startTime: slot.startTime,
        endTime: slot.endTime,
        stylistId: slot.stylistId,
        stylistName: slot.stylistName
      }));
      
      res.json(publicSlots);
    } catch (error) {
      console.error("Error getting slots:", error);
      res.status(500).json({ error: "Failed to get available slots" });
    }
  });

  // Check if a specific slot is available (public endpoint, limited response)
  app.post("/api/scheduling/check-slot", async (req, res) => {
    try {
      const { stylistId, date, startTime, endTime, excludeBookingId } = req.body;
      
      const { isSlotAvailable } = await import("./scheduling");
      const result = await isSlotAvailable(stylistId, date, startTime, endTime, excludeBookingId);
      
      // Only return availability status without sensitive conflict details for public access
      res.json({
        available: result.available,
        reason: result.available ? null : "Time slot is not available"
      });
    } catch (error) {
      console.error("Error checking slot:", error);
      res.status(500).json({ error: "Failed to check slot availability" });
    }
  });

  // Get calendar view for a business (requires business owner auth)
  app.get("/api/scheduling/calendar/:businessId", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const { businessId } = req.params;
      const { startDate, endDate } = req.query;
      
      // Verify user owns this business
      const business = await storage.getBusinessById(businessId);
      if (!business || business.ownerId !== userId) {
        return res.status(403).json({ error: "Not authorized to access this calendar" });
      }
      
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required" });
      }
      
      const { getBusinessCalendarView } = await import("./scheduling");
      const calendar = await getBusinessCalendarView(
        businessId, 
        startDate as string, 
        endDate as string
      );
      
      res.json(calendar);
    } catch (error) {
      console.error("Error getting calendar:", error);
      res.status(500).json({ error: "Failed to get calendar view" });
    }
  });

  // ===========================================
  // WAITLIST ROUTES
  // ===========================================

  // Join waitlist
  app.post("/api/waitlist", async (req, res) => {
    try {
      const userId = getUserId(req);
      const entry = await storage.createWaitlistEntry({
        ...req.body,
        userId,
      });
      res.status(201).json(entry);
    } catch (error) {
      console.error("Error creating waitlist entry:", error);
      res.status(500).json({ error: "Failed to join waitlist" });
    }
  });

  // Get user's waitlist entries
  app.get("/api/waitlist/mine", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const entries = await storage.getUserWaitlistEntries(userId);
      res.json(entries);
    } catch (error) {
      console.error("Error getting waitlist entries:", error);
      res.status(500).json({ error: "Failed to get waitlist entries" });
    }
  });

  // Cancel waitlist entry
  app.delete("/api/waitlist/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.updateWaitlistEntry(id, { status: 'cancelled' });
      res.json({ success: true });
    } catch (error) {
      console.error("Error cancelling waitlist entry:", error);
      res.status(500).json({ error: "Failed to cancel waitlist entry" });
    }
  });

  // ===========================================
  // RECURRING BOOKING ROUTES
  // ===========================================

  // Create recurring booking rule
  app.post("/api/recurring-bookings", async (req, res) => {
    try {
      const userId = getUserId(req);
      const rule = await storage.createRecurringRule({
        ...req.body,
        userId,
      });
      res.status(201).json(rule);
    } catch (error) {
      console.error("Error creating recurring rule:", error);
      res.status(500).json({ error: "Failed to create recurring booking" });
    }
  });

  // Get recurring rule preview (next occurrences)
  app.get("/api/recurring-bookings/:id/preview", async (req, res) => {
    try {
      const { id } = req.params;
      const { count } = req.query;
      
      const rule = await storage.getRecurringRuleById(id);
      if (!rule) {
        return res.status(404).json({ error: "Recurring booking not found" });
      }
      
      const { generateRecurringOccurrences } = await import("./scheduling");
      const occurrences = await generateRecurringOccurrences(rule, Number(count) || 4);
      
      res.json(occurrences);
    } catch (error) {
      console.error("Error getting recurring preview:", error);
      res.status(500).json({ error: "Failed to get recurring booking preview" });
    }
  });

  // Cancel recurring booking
  app.post("/api/recurring-bookings/:id/cancel", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.cancelRecurringRule(id);
      
      if (!success) {
        return res.status(404).json({ error: "Recurring booking not found" });
      }
      
      res.json({ success: true, message: "Recurring booking cancelled" });
    } catch (error) {
      console.error("Error cancelling recurring booking:", error);
      res.status(500).json({ error: "Failed to cancel recurring booking" });
    }
  });

  // ===========================================
  // PUSH NOTIFICATION ROUTES
  // ===========================================

  // Get VAPID public key for web push
  app.get("/api/push/vapid-key", (req, res) => {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      return res.status(503).json({ error: "Push notifications not configured" });
    }
    res.json({ publicKey: vapidPublicKey });
  });

  // Subscribe to push notifications
  app.post("/api/push/subscribe", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { endpoint, keys } = req.body;
      
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription data" });
      }
      
      const subscription = await storage.createPushSubscription({
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: req.headers['user-agent'] || null,
        isActive: 1,
      });
      
      res.status(201).json({ success: true, id: subscription.id });
    } catch (error) {
      console.error("Error creating push subscription:", error);
      res.status(500).json({ error: "Failed to subscribe to notifications" });
    }
  });

  // Unsubscribe from push notifications
  app.delete("/api/push/subscribe", async (req, res) => {
    try {
      const { endpoint } = req.body;
      
      if (!endpoint) {
        return res.status(400).json({ error: "Endpoint is required" });
      }
      
      await storage.deletePushSubscription(endpoint);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting push subscription:", error);
      res.status(500).json({ error: "Failed to unsubscribe from notifications" });
    }
  });

  // Get user notifications
  app.get("/api/notifications", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const { limit } = req.query;
      const notifications = await storage.getUserNotifications(userId, Number(limit) || 50);
      res.json(notifications);
    } catch (error) {
      console.error("Error getting notifications:", error);
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.markNotificationRead(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking notification read:", error);
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  // ============================================
  // ADMIN ROUTES - Monitoring & Analytics
  // ============================================
  
  // Admin middleware - checks if user has admin account type AND is whitelisted
  const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.accountType !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      // Double-check email is whitelisted
      if (!isAdminWhitelisted(user.email)) {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      next();
    } catch (error) {
      console.error("Admin auth error:", error);
      res.status(500).json({ error: "Authentication failed" });
    }
  };

  // Clear all mask cache (for development/debugging)
  app.delete("/api/cache/masks", async (req, res) => {
    try {
      const cleared = await preprocessCache.clearAll();
      console.log(`[API] Cleared all mask cache - ${cleared} entries removed`);
      res.json({ success: true, cleared });
    } catch (error) {
      console.error("[API] Error clearing mask cache:", error);
      res.status(500).json({ error: "Failed to clear cache" });
    }
  });

  // Check if current user is admin (must be whitelisted AND have admin account type)
  app.get("/api/admin/check", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.json({ isAdmin: false, canBecomeAdmin: false });
      }
      
      const user = await storage.getUser(userId);
      const isWhitelisted = isAdminWhitelisted(user?.email);
      const isAdmin = user?.accountType === "admin" && isWhitelisted;
      
      res.json({ 
        isAdmin, 
        canBecomeAdmin: isWhitelisted && user?.accountType !== "admin" 
      });
    } catch (error) {
      res.json({ isAdmin: false, canBecomeAdmin: false });
    }
  });

  // Admin dashboard overview - all key metrics
  app.get("/api/admin/overview", requireAdmin, async (req, res) => {
    try {
      const [
        userCount,
        feedbackCount,
        bookingCount,
        generationCount,
        favoritesCount,
        dislikesCount,
        betaBookingsCount,
        uniqueDeviceCount,
      ] = await Promise.all([
        storage.getUserCount(),
        storage.getFeedbackCount(),
        storage.getBookingCount(),
        storage.getGenerationCount(),
        storage.getFavoritedGenerationsCount(),
        storage.getDislikedGenerationsCount(),
        storage.getBetaBookingsCount(),
        storage.getUniqueDeviceCount(),
      ]);

      // Get counts for last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentUsers = await storage.getUsersCreatedAfter(oneDayAgo);
      const recentGenerations = await storage.getGenerationCountByDate(oneDayAgo, new Date());

      res.json({
        totalUsers: userCount,
        totalFeedback: feedbackCount,
        totalBookings: bookingCount,
        totalGenerations: generationCount,
        totalFavorites: favoritesCount,
        totalDislikes: dislikesCount,
        totalBetaBookings: betaBookingsCount,
        totalDevices: uniqueDeviceCount,
        usersLast24h: recentUsers.length,
        generationsLast24h: recentGenerations,
        generationMetrics: generationMetrics,
      });
    } catch (error) {
      console.error("Error fetching admin overview:", error);
      res.status(500).json({ error: "Failed to fetch overview" });
    }
  });

  // Get beta demo bookings for analytics
  app.get("/api/admin/beta-bookings", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const [bookings, total] = await Promise.all([
        storage.getBetaBookings(limit, offset),
        storage.getBetaBookingsCount(),
      ]);
      
      res.json({ data: bookings, total, limit, offset });
    } catch (error) {
      console.error("Error fetching beta bookings:", error);
      res.status(500).json({ error: "Failed to fetch beta bookings" });
    }
  });

  // Get all user feedback with pagination
  app.get("/api/admin/feedback", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const [feedback, total] = await Promise.all([
        storage.getAllFeedback(limit, offset),
        storage.getFeedbackCount(),
      ]);
      
      res.json({ data: feedback, total, limit, offset });
    } catch (error) {
      console.error("Error fetching feedback:", error);
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });

  // Get all users with pagination (excludes demo/test users)
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const [usersList, total] = await Promise.all([
        storage.getAllUsers(limit, offset),
        storage.getUserCount(),
      ]);
      
      // Filter out demo/test users for cleaner admin view
      const filteredUsers = usersList.filter(user => {
        const email = user.email?.toLowerCase() || '';
        return !email.includes('@demo.com') && 
               !email.includes('@example.com') && 
               !user.id.startsWith('demo-') &&
               !user.id.startsWith('test-') &&
               !user.id.startsWith('pre-auth-');
      });
      
      res.json({ data: filteredUsers, total: filteredUsers.length, limit, offset });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Get all bookings with pagination
  app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const [bookingsList, total] = await Promise.all([
        storage.getAllBookings(limit, offset),
        storage.getBookingCount(),
      ]);
      
      res.json({ data: bookingsList, total, limit, offset });
    } catch (error) {
      console.error("Error fetching bookings:", error);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  // Get recent generations
  app.get("/api/admin/generations", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      
      const [generations, total] = await Promise.all([
        storage.getRecentGenerations(limit),
        storage.getGenerationCount(),
      ]);
      
      res.json({ data: generations, total, limit });
    } catch (error) {
      console.error("Error fetching generations:", error);
      res.status(500).json({ error: "Failed to fetch generations" });
    }
  });

  // Get favorited/saved generations
  app.get("/api/admin/favorites", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const [favorites, total] = await Promise.all([
        storage.getFavoritedGenerations(limit, offset),
        storage.getFavoritedGenerationsCount(),
      ]);
      
      res.json({ data: favorites, total, limit, offset });
    } catch (error) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });

  // Get disliked generations
  app.get("/api/admin/dislikes", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const [dislikes, total] = await Promise.all([
        storage.getDislikedGenerations(limit, offset),
        storage.getDislikedGenerationsCount(),
      ]);
      
      res.json({ data: dislikes, total, limit, offset });
    } catch (error) {
      console.error("Error fetching dislikes:", error);
      res.status(500).json({ error: "Failed to fetch dislikes" });
    }
  });

  // Export feedback as CSV
  app.get("/api/admin/export/feedback", requireAdmin, async (req, res) => {
    try {
      const feedback = await storage.getAllFeedback(1000, 0);
      
      const csvRows = [
        ["ID", "User ID", "Overall Rating", "Usability Rating", "Image Quality Rating", "Recommendation", "Improvements", "Favorite Features", "Created At"].join(","),
        ...feedback.map(f => [
          f.id,
          f.userId || "anonymous",
          f.overallRating,
          f.usabilityRating || "",
          f.imageQualityRating || "",
          f.wouldRecommend ? "Yes" : "No",
          `"${(f.improvements || "").replace(/"/g, '""')}"`,
          `"${(f.favoriteFeatures || "").replace(/"/g, '""')}"`,
          f.createdAt,
        ].join(","))
      ];
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=feedback_export.csv");
      res.send(csvRows.join("\n"));
    } catch (error) {
      console.error("Error exporting feedback:", error);
      res.status(500).json({ error: "Failed to export feedback" });
    }
  });

  // Export users as CSV
  app.get("/api/admin/export/users", requireAdmin, async (req, res) => {
    try {
      const usersList = await storage.getAllUsers(5000, 0);
      
      const csvRows = [
        ["ID", "Email", "First Name", "Last Name", "Account Type", "Plan", "Credits", "Created At"].join(","),
        ...usersList.map(u => [
          u.id,
          u.email || "",
          u.firstName || "",
          u.lastName || "",
          u.accountType,
          u.plan,
          u.credits,
          u.createdAt,
        ].join(","))
      ];
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=users_export.csv");
      res.send(csvRows.join("\n"));
    } catch (error) {
      console.error("Error exporting users:", error);
      res.status(500).json({ error: "Failed to export users" });
    }
  });

  // Export bookings as CSV
  app.get("/api/admin/export/bookings", requireAdmin, async (req, res) => {
    try {
      const bookingsList = await storage.getAllBookings(5000, 0);
      
      const csvRows = [
        ["ID", "User ID", "Stylist ID", "Place ID", "Date", "Time", "Status", "Service", "Price", "Created At"].join(","),
        ...bookingsList.map(b => [
          b.id,
          b.userId || "",
          b.stylistId || "",
          b.placeId,
          b.date,
          b.time,
          b.status,
          `"${(b.service || "").replace(/"/g, '""')}"`,
          b.price || "",
          b.createdAt,
        ].join(","))
      ];
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=bookings_export.csv");
      res.send(csvRows.join("\n"));
    } catch (error) {
      console.error("Error exporting bookings:", error);
      res.status(500).json({ error: "Failed to export bookings" });
    }
  });

  // Daily metrics summary (for email notifications or manual checks)
  app.get("/api/admin/daily-summary", requireAdmin, async (req, res) => {
    try {
      const now = new Date();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalUsers,
        totalFeedback,
        totalBookings,
        totalGenerations,
        recentUsers,
        recentGenerations,
        recentFeedback,
      ] = await Promise.all([
        storage.getUserCount(),
        storage.getFeedbackCount(),
        storage.getBookingCount(),
        storage.getGenerationCount(),
        storage.getUsersCreatedAfter(oneDayAgo),
        storage.getGenerationCountByDate(oneDayAgo, now),
        storage.getAllFeedback(10, 0),
      ]);

      const weeklyUsers = await storage.getUsersCreatedAfter(oneWeekAgo);

      // Calculate average rating from recent feedback
      const avgRating = recentFeedback.length > 0
        ? (recentFeedback.reduce((sum, f) => sum + f.overallRating, 0) / recentFeedback.length).toFixed(1)
        : "N/A";

      const successRate = generationMetrics.totalRequests > 0
        ? ((generationMetrics.successfulGenerations / generationMetrics.totalRequests) * 100).toFixed(1)
        : "N/A";

      // Format as readable text report
      const textReport = `
AUREN BETA - DAILY METRICS SUMMARY
Generated: ${now.toISOString()}
========================================

OVERVIEW
--------
Total Users: ${totalUsers}
Total Feedback: ${totalFeedback}
Total Bookings: ${totalBookings}
Total Generations: ${totalGenerations}

LAST 24 HOURS
-------------
New Users: ${recentUsers.length}
AI Generations: ${recentGenerations}

LAST 7 DAYS
-----------
New Users: ${weeklyUsers.length}

GENERATION PERFORMANCE
----------------------
Success Rate: ${successRate}%
Total Requests: ${generationMetrics.totalRequests}
Successful: ${generationMetrics.successfulGenerations}
Failed: ${generationMetrics.failedGenerations}
Timeouts: ${generationMetrics.timeouts}
Avg Time: ${(generationMetrics.averageGenerationTimeMs / 1000).toFixed(1)}s

FEEDBACK SUMMARY
----------------
Average Rating: ${avgRating}/5
Recent Feedback Count: ${recentFeedback.length}

${recentFeedback.slice(0, 3).map((f, i) => 
  `${i + 1}. Rating: ${f.overallRating}/5 - ${f.improvements || "No comments"}`
).join("\n")}

========================================
View full dashboard at /admin
`.trim();

      // Return as JSON with text and structured data
      const format = req.query.format;
      if (format === "text") {
        res.setHeader("Content-Type", "text/plain");
        res.send(textReport);
      } else {
        res.json({
          generatedAt: now.toISOString(),
          summary: {
            totalUsers,
            totalFeedback,
            totalBookings,
            totalGenerations,
            usersLast24h: recentUsers.length,
            generationsLast24h: recentGenerations,
            usersLast7d: weeklyUsers.length,
            averageRating: avgRating,
          },
          generationMetrics: {
            successRate: successRate + "%",
            totalRequests: generationMetrics.totalRequests,
            successful: generationMetrics.successfulGenerations,
            failed: generationMetrics.failedGenerations,
            timeouts: generationMetrics.timeouts,
            avgTimeSeconds: (generationMetrics.averageGenerationTimeMs / 1000).toFixed(1),
          },
          recentFeedback: recentFeedback.slice(0, 5),
          textReport,
        });
      }
    } catch (error) {
      console.error("Error generating daily summary:", error);
      res.status(500).json({ error: "Failed to generate summary" });
    }
  });

  // ============================================
  // PARTNER DEBUG - Shared generations view
  // ============================================
  
  // Partner emails for shared viewing (you and Deborah)
  const PARTNER_EMAILS = [
    "fayfayu132@gmail.com",
    "ohdeborah5@gmail.com",
  ];
  
  // Get generations for both partners (no auth required - for debugging)
  app.get("/api/debug-partner/generations", async (req, res) => {
    try {
      // Get all partner users
      const partnerGenerations: any[] = [];
      
      for (const email of PARTNER_EMAILS) {
        // Find user by email
        const user = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user[0]) continue;
        
        // Get their sessions
        const sessions = await db.select().from(userSessions)
          .where(eq(userSessions.userId, user[0].id))
          .orderBy(desc(userSessions.createdAt))
          .limit(20);
        
        // Get variants for each session
        for (const session of sessions) {
          const variants = await db.select().from(generatedVariants)
            .where(eq(generatedVariants.sessionId, session.id))
            .orderBy(desc(generatedVariants.id));
          
          for (const variant of variants) {
            if (variant.generatedImageUrl && variant.status === "completed") {
              partnerGenerations.push({
                id: variant.id,
                imageUrl: variant.generatedImageUrl,
                userPhoto: session.photoUrl,
                prompt: variant.customPrompt || session.customPrompt,
                styleType: variant.styleType,
                renderType: variant.renderType,
                inspirationPhotoUrl: variant.inspirationPhotoUrl,
                referenceUrl: variant.webReferenceImageUrl,
                userEmail: email,
                userName: email === "fayfayu132@gmail.com" ? "Favour" : "Deborah",
                createdAt: session.createdAt,
              });
            }
          }
        }
      }
      
      // Sort by date, newest first
      partnerGenerations.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      res.json(partnerGenerations);
    } catch (error) {
      console.error("Error fetching partner generations:", error);
      res.status(500).json({ error: "Failed to fetch generations" });
    }
  });

  // Promote user to admin (only for whitelisted users)
  app.post("/api/admin/promote", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const currentUser = await storage.getUser(userId);
      
      // Only whitelisted emails can become admins
      if (!isAdminWhitelisted(currentUser?.email)) {
        return res.status(403).json({ error: "You are not authorized to become an admin" });
      }
      
      // Self-promotion for whitelisted users
      const updated = await storage.setUserAccountType(userId, "admin");
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json({ success: true, user: updated });
    } catch (error) {
      console.error("Error promoting user:", error);
      res.status(500).json({ error: "Failed to promote user" });
    }
  });

  const httpServer = createServer(app);
  
  // Start periodic queue processor (every 30 seconds as a safety net)
  setInterval(() => {
    processNextQueuedGeneration().catch(err => {
      console.error("[QUEUE] Periodic check error:", err);
    });
  }, 30000);
  console.log("[QUEUE] Periodic queue processor started (30s interval)");

  return httpServer;
}
