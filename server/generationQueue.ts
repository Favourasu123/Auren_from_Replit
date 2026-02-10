import { db } from "./db";
import { generationQueue, generatedVariants } from "@shared/schema";
import { eq, and, sql, asc, desc } from "drizzle-orm";

export interface QueueItemWithDetails {
  id: string;
  userId: string | null;
  sessionId: string | null;
  variantId: string | null;
  status: string;
  priority: number;
  position: number | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date | null;
}

export interface QueueStatus {
  position: number;
  totalInQueue: number;
  status: string;
  estimatedWaitSeconds: number;
}

export async function addToQueue(params: {
  userId?: string | null;
  sessionId?: string | null;
  variantId?: string | null;
  priority?: number;
}): Promise<string> {
  // Check if this variant is already in the queue (not completed/failed)
  if (params.variantId) {
    const existing = await db.query.generationQueue.findFirst({
      where: and(
        eq(generationQueue.variantId, params.variantId),
        sql`${generationQueue.status} IN ('queued', 'processing')`
      ),
    });
    
    if (existing) {
      console.log(`[QUEUE] Variant ${params.variantId} already in queue (${existing.status}), skipping`);
      return existing.id;
    }
  }
  
  const [item] = await db.insert(generationQueue).values({
    userId: params.userId || null,
    sessionId: params.sessionId || null,
    variantId: params.variantId || null,
    priority: params.priority || 0,
    status: "queued",
  }).returning();
  
  console.log(`[QUEUE] Added item ${item.id} for variant ${params.variantId}`);
  
  return item.id;
}

export async function getQueueStatus(queueId: string): Promise<QueueStatus | null> {
  const item = await db.query.generationQueue.findFirst({
    where: eq(generationQueue.id, queueId),
  });
  
  if (!item) return null;
  
  if (item.status === "completed" || item.status === "failed") {
    return {
      position: 0,
      totalInQueue: 0,
      status: item.status,
      estimatedWaitSeconds: 0,
    };
  }
  
  if (item.status === "processing") {
    return {
      position: 0,
      totalInQueue: await getQueuedCount(),
      status: "processing",
      estimatedWaitSeconds: 30,
    };
  }
  
  const position = await getPosition(queueId);
  const totalInQueue = await getQueuedCount();
  
  return {
    position,
    totalInQueue,
    status: item.status,
    estimatedWaitSeconds: position * 45,
  };
}

export async function getQueueStatusByVariant(variantId: string): Promise<QueueStatus | null> {
  const item = await db.query.generationQueue.findFirst({
    where: eq(generationQueue.variantId, variantId),
    orderBy: desc(generationQueue.createdAt),
  });
  
  if (!item) return null;
  
  return getQueueStatus(item.id);
}

async function getPosition(queueId: string): Promise<number> {
  const item = await db.query.generationQueue.findFirst({
    where: eq(generationQueue.id, queueId),
  });
  
  if (!item || item.status !== "queued") return 0;
  
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(generationQueue)
    .where(and(
      eq(generationQueue.status, "queued"),
      sql`${generationQueue.createdAt} < ${item.createdAt}`
    ));
  
  return (result[0]?.count || 0) + 1;
}

async function getQueuedCount(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(generationQueue)
    .where(eq(generationQueue.status, "queued"));
  
  return result[0]?.count || 0;
}

export async function getNextInQueue(): Promise<QueueItemWithDetails | null> {
  const item = await db.query.generationQueue.findFirst({
    where: eq(generationQueue.status, "queued"),
    orderBy: [desc(generationQueue.priority), asc(generationQueue.createdAt)],
  });
  
  return item as QueueItemWithDetails | null;
}

export async function markProcessing(queueId: string): Promise<void> {
  await db.update(generationQueue)
    .set({ 
      status: "processing", 
      startedAt: new Date() 
    })
    .where(eq(generationQueue.id, queueId));
  
  console.log(`[QUEUE] Started processing ${queueId}`);
}

export async function markCompleted(queueId: string): Promise<void> {
  await db.update(generationQueue)
    .set({ 
      status: "completed", 
      completedAt: new Date() 
    })
    .where(eq(generationQueue.id, queueId));
  
  console.log(`[QUEUE] Completed ${queueId}`);
}

export async function markFailed(queueId: string, errorMessage: string): Promise<void> {
  await db.update(generationQueue)
    .set({ 
      status: "failed", 
      errorMessage,
      completedAt: new Date() 
    })
    .where(eq(generationQueue.id, queueId));
  
  console.log(`[QUEUE] Failed ${queueId}: ${errorMessage}`);
}

export async function getQueueItemByVariant(variantId: string): Promise<QueueItemWithDetails | null> {
  const item = await db.query.generationQueue.findFirst({
    where: eq(generationQueue.variantId, variantId),
    orderBy: desc(generationQueue.createdAt),
  });
  
  return item as QueueItemWithDetails | null;
}

export async function cleanupOldQueueItems(): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const result = await db.delete(generationQueue)
    .where(and(
      sql`${generationQueue.status} IN ('completed', 'failed')`,
      sql`${generationQueue.completedAt} < ${oneDayAgo}`
    ))
    .returning();
  
  if (result.length > 0) {
    console.log(`[QUEUE] Cleaned up ${result.length} old queue items`);
  }
  
  return result.length;
}

setInterval(cleanupOldQueueItems, 60 * 60 * 1000);
