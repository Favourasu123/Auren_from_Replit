import sharp from "sharp";
import { spawn } from "child_process";
import Replicate from "replicate";
import { GENERATION_CONFIG } from "./config";

/**
 * Add a subtle watermark to a generated image
 * The watermark is very subtle (low opacity) and positioned in the bottom-right corner
 * @param imageData - Base64 image data or URL
 * @returns Base64 image with watermark
 */
export async function addWatermark(imageData: string): Promise<string> {
  try {
    // Convert URL to base64 if needed
    let imageBuffer: Buffer;
    if (imageData.startsWith("http")) {
      const response = await fetch(imageData);
      if (!response.ok) {
        console.warn("Failed to fetch image for watermark:", response.status);
        return imageData; // Return original if fetch fails
      }
      imageBuffer = Buffer.from(await response.arrayBuffer());
    } else if (imageData.startsWith("data:")) {
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
      imageBuffer = Buffer.from(base64Data, "base64");
    } else {
      imageBuffer = Buffer.from(imageData, "base64");
    }
    
    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;
    
    // Calculate watermark size (scales with image)
    const watermarkHeight = Math.floor(height * 0.025); // 2.5% of image height
    const fontSize = Math.max(12, Math.min(24, watermarkHeight)); // Clamp between 12-24px
    const padding = Math.floor(width * 0.02); // 2% padding from edges
    
    // Create SVG watermark - very subtle white text with low opacity
    const watermarkText = "Auren";
    const svgWatermark = Buffer.from(`
      <svg width="${width}" height="${height}">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="1" flood-opacity="0.3"/>
          </filter>
        </defs>
        <text 
          x="${width - padding}" 
          y="${height - padding}" 
          font-family="Arial, sans-serif" 
          font-size="${fontSize}" 
          font-weight="300"
          fill="white" 
          fill-opacity="0.25"
          text-anchor="end"
          filter="url(#shadow)"
        >${watermarkText}</text>
      </svg>
    `);
    
    // Composite watermark onto image
    const watermarkedBuffer = await sharp(imageBuffer)
      .composite([{
        input: svgWatermark,
        gravity: "southeast",
      }])
      .jpeg({ quality: 92 })
      .toBuffer();
    
    return `data:image/jpeg;base64,${watermarkedBuffer.toString("base64")}`;
  } catch (error) {
    console.warn("Failed to add watermark, returning original:", error);
    return imageData; // Return original if watermarking fails
  }
}

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const FAL_KEY = process.env.FAL_KEY;

interface ProcessedImages {
  userImageBase64: string;
  inspirationImageBase64: string;
  hairMaskBase64: string;
}

interface PreprocessedImage {
  base64: string;
  buffer: Buffer;
}

interface MaskRefinementOptions {
  dilationKernel?: number;
  dilationIterations?: number;
  featherSize?: number;
  createOverlay?: boolean;
  userImage?: string;
}

interface MaskRefinementResult {
  mask: string;
  overlay?: string;
}

interface LetterboxTransform {
  scale: number;
  resizedWidth: number;
  resizedHeight: number;
  left: number;
  top: number;
  targetSize: number;
}

interface BiSeNetMaskOptions {
  includeForehead?: boolean;
  aboveHair?: number;
  dilationKernel?: number;
  dilationIterations?: number;
  featherSize?: number;
  downwardOnly?: boolean;
}

interface BiSeNetResult {
  maskBuffer: Buffer;
  normalizedBuffer: Buffer;
  origWidth: number;
  origHeight: number;
}

/**
 * Compute letterbox transform parameters for resizing to square without distortion
 * Both image and mask MUST use the same transform for alignment
 */
function computeLetterboxTransform(width: number, height: number, targetSize: number = 1024): LetterboxTransform {
  const scale = Math.min(targetSize / width, targetSize / height);
  const resizedWidth = Math.round(width * scale);
  const resizedHeight = Math.round(height * scale);
  const left = Math.floor((targetSize - resizedWidth) / 2);
  const top = Math.floor((targetSize - resizedHeight) / 2);
  
  return { scale, resizedWidth, resizedHeight, left, top, targetSize };
}

/**
 * Apply letterbox transform to an image buffer
 * Pads to targetSize x targetSize with specified background color
 */
async function applyLetterboxToImage(
  buffer: Buffer, 
  transform: LetterboxTransform,
  background: { r: number; g: number; b: number } = { r: 128, g: 128, b: 128 }
): Promise<Buffer> {
  const { resizedWidth, resizedHeight, left, top, targetSize } = transform;
  
  // First resize to computed dimensions
  const resized = await sharp(buffer)
    .resize(resizedWidth, resizedHeight, { fit: 'fill' })  // Exact dimensions, no further fitting
    .toBuffer();
  
  // Then composite onto square canvas with padding
  const result = await sharp({
    create: {
      width: targetSize,
      height: targetSize,
      channels: 3,
      background
    }
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
  
  return result;
}

/**
 * Apply letterbox transform to a mask buffer
 * Uses nearest-neighbor interpolation and black padding to preserve mask edges
 */
async function applyLetterboxToMask(
  buffer: Buffer, 
  transform: LetterboxTransform
): Promise<Buffer> {
  const { resizedWidth, resizedHeight, left, top, targetSize } = transform;
  
  // First resize to computed dimensions with nearest-neighbor (preserves hard edges)
  // Also ensure it's grayscale for the mask
  const resized = await sharp(buffer)
    .grayscale()
    .resize(resizedWidth, resizedHeight, { fit: 'fill', kernel: 'nearest' })
    .toBuffer();
  
  // Then composite onto black square canvas (use RGB black, convert to grayscale after)
  const result = await sharp({
    create: {
      width: targetSize,
      height: targetSize,
      channels: 3,
      background: { r: 0, g: 0, b: 0 }
    }
  })
    .composite([{ input: resized, left, top }])
    .grayscale()
    .png()
    .toBuffer();
  
  return result;
}

/**
 * Reverse letterbox transform: crop out padding and resize back to original dimensions
 * Use this on FLUX output to restore original aspect ratio
 */
export async function removeLetterboxFromImage(
  imageUrl: string,
  origWidth: number,
  origHeight: number,
  targetSize: number = 1024
): Promise<string> {
  try {
    // Fetch the image
    let buffer: Buffer;
    if (imageUrl.startsWith("data:")) {
      buffer = Buffer.from(imageUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    } else {
      const response = await fetch(imageUrl);
      buffer = Buffer.from(await response.arrayBuffer());
    }
    
    // Recompute the same transform that was applied
    const transform = computeLetterboxTransform(origWidth, origHeight, targetSize);
    const { resizedWidth, resizedHeight, left, top } = transform;
    
    console.log(`[UN-LETTERBOX] Cropping ${targetSize}x${targetSize} → extract ${resizedWidth}x${resizedHeight} at (${left},${top}) → resize to ${origWidth}x${origHeight}`);
    
    // Extract the content region and resize back to original
    const result = await sharp(buffer)
      .extract({ left, top, width: resizedWidth, height: resizedHeight })
      .resize(origWidth, origHeight, { fit: 'fill' })
      .jpeg({ quality: 95 })
      .toBuffer();
    
    return `data:image/jpeg;base64,${result.toString('base64')}`;
  } catch (error) {
    console.error("[UN-LETTERBOX] Error:", error);
    // Return original URL on error
    return imageUrl;
  }
}

/**
 * Shared BiSeNet mask generation helper
 * Normalizes EXIF, calls Python BiSeNet pipeline, returns aligned mask and image buffers
 * Uses config values for dilation/feather parameters
 */
async function generateBiSeNetMask(
  imageBase64: string,
  options: BiSeNetMaskOptions = {}
): Promise<BiSeNetResult | null> {
  // Use config values as defaults
  const {
    includeForehead = false,
    aboveHair = 0,
    dilationKernel = GENERATION_CONFIG.MASK_DILATION_KERNEL,
    dilationIterations = GENERATION_CONFIG.MASK_DILATION_ITERATIONS,
    featherSize = GENERATION_CONFIG.MASK_FEATHER_SIZE,
    downwardOnly = false
  } = options;

  // Ensure we have a proper data URI
  let inputImage = imageBase64;
  if (!inputImage.startsWith("data:")) {
    if (inputImage.startsWith("http")) {
      const response = await fetch(inputImage);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      inputImage = `data:${contentType};base64,${base64}`;
    }
  }

  // CRITICAL: Normalize EXIF orientation BEFORE sending to Python
  // Sharp auto-rotates based on EXIF, but OpenCV ignores EXIF orientation
  const rawBuffer = Buffer.from(
    inputImage.replace(/^data:image\/\w+;base64,/, ''),
    'base64'
  );
  
  const normalizedBuffer = await sharp(rawBuffer)
    .rotate()  // Auto-rotate based on EXIF orientation
    .jpeg({ quality: 95 })  // Convert to JPEG to strip EXIF
    .toBuffer();
  
  const normalizedBase64 = `data:image/jpeg;base64,${normalizedBuffer.toString('base64')}`;
  
  // Call local Python BiSeNet pipeline
  const pythonInput = JSON.stringify({
    imageUrl: normalizedBase64,
    includeForehead,
    aboveHair,
    dilationKernel,
    dilationIterations,
    featherSize,
    downwardOnly
  });
  
  const result = await new Promise<string | null>((resolve) => {
    const python = spawn('python3', ['server/hair_mask_pipeline.py']);
    let stdout = '';
    let stderr = '';
    
    python.stdout.on('data', (data) => { stdout += data.toString(); });
    python.stderr.on('data', (data) => { stderr += data.toString(); });
    
    python.on('close', (code) => {
      if (code !== 0) {
        console.error("BiSeNet pipeline failed:", stderr);
        resolve(null);
        return;
      }
      
      try {
        const output = JSON.parse(stdout);
        if (output.success && output.mask) {
          resolve(output.mask);
        } else {
          console.error("BiSeNet pipeline error:", output.error);
          resolve(null);
        }
      } catch (e) {
        console.error("Failed to parse BiSeNet output:", e);
        resolve(null);
      }
    });
    
    python.stdin.write(pythonInput);
    python.stdin.end();
  });
  
  if (!result) {
    return null;
  }
  
  const maskBuffer = Buffer.from(
    result.replace(/^data:image\/\w+;base64,/, ''),
    'base64'
  );
  
  // Get dimensions from normalized image
  const origMeta = await sharp(normalizedBuffer).metadata();
  
  return {
    maskBuffer,
    normalizedBuffer,
    origWidth: origMeta.width!,
    origHeight: origMeta.height!
  };
}

export async function downloadImage(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    console.log("Converting base64 data URL to buffer...");
    const base64Data = url.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(base64Data, "base64");
  }
  
  console.log("Downloading image from:", url.substring(0, 80) + "...");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function preprocessImage(imageBuffer: Buffer): Promise<PreprocessedImage> {
  console.log("Preprocessing image for FLUX 2 Pro (optimized for face preservation)...");
  
  const processed = await sharp(imageBuffer)
    .rotate()
    .resize(1024, 1024, {
      fit: "contain",
      position: "centre",
      background: { r: 128, g: 128, b: 128, alpha: 1 },
    })
    .png({ quality: 100 })
    .toBuffer();

  const base64 = `data:image/png;base64,${processed.toString("base64")}`;
  
  console.log("Image preprocessed: 1024x1024 PNG (contain fit, no normalization)");
  return { base64, buffer: processed };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run Python hair mask refinement script
 * Applies BiSeNet-style post-processing: dilation, feathering, clamping
 */
async function runMaskRefinement(
  rawMaskBase64: string,
  options: MaskRefinementOptions = {}
): Promise<MaskRefinementResult | null> {
  return new Promise((resolve) => {
    console.log("Running Python mask refinement (dilation + feathering + clamp)...");
    
    const python = spawn("python3", ["server/hair_mask.py"]);
    
    const input = JSON.stringify({
      action: "refine",
      rawMask: rawMaskBase64,
      dilationKernel: options.dilationKernel ?? 5,
      dilationIterations: options.dilationIterations ?? 1,
      featherSize: options.featherSize ?? 7,
      userImage: options.userImage,
      createOverlay: options.createOverlay ?? false,
    });
    
    let stdout = "";
    let stderr = "";
    
    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    
    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    python.on("close", (code) => {
      if (code !== 0) {
        console.error("Python mask refinement failed:", stderr);
        resolve(null);
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.success) {
          console.log("✓ Mask refinement complete (dilated, feathered, clamped)");
          resolve({
            mask: result.mask,
            overlay: result.overlay,
          });
        } else {
          console.error("Mask refinement error:", result.error);
          resolve(null);
        }
      } catch (e) {
        console.error("Failed to parse Python output:", e);
        resolve(null);
      }
    });
    
    python.stdin.write(input);
    python.stdin.end();
  });
}

/**
 * Get raw hair mask using LOCAL ONNX BiSeNet model
 * No external API needed - runs entirely on CPU
 */
async function getRawHairMask(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    console.log("Getting raw hair mask using LOCAL BiSeNet ONNX model...");
    
    const python = spawn("python3", ["server/hair_segment_local.py"]);
    
    const input = JSON.stringify({ imageUrl });
    
    let stdout = "";
    let stderr = "";
    
    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    
    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    python.on("close", (code) => {
      if (code !== 0) {
        console.error("Local segmentation failed:", stderr);
        resolve(null);
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.success) {
          console.log(`✓ Local segmentation complete (${result.width}x${result.height})`);
          resolve(result.mask);
        } else {
          console.error("Local segmentation error:", result.error);
          resolve(null);
        }
      } catch (e) {
        console.error("Failed to parse segmentation output:", e);
        resolve(null);
      }
    });
    
    python.stdin.write(input);
    python.stdin.end();
  });
}

/**
 * Generate a refined hair mask using OPTIMIZED single-process pipeline
 * Combines: BiSeNet segmentation → Dilation → Feathering → Clamping
 * 
 * @param imageUrl - URL or base64 of the image to segment
 * @param options - Refinement options (dilation size, feather amount, etc.)
 * @returns Refined hair mask as base64 (white=hair, black=rest)
 */
export async function generateHairMask(
  imageUrl: string,
  options: MaskRefinementOptions = {}
): Promise<string | null> {
  console.log("=== Generating Hair Mask (Optimized Local Pipeline) ===");
  console.log(`Config: dilation=${options.dilationKernel ?? GENERATION_CONFIG.MASK_DILATION_KERNEL}, iterations=${options.dilationIterations ?? GENERATION_CONFIG.MASK_DILATION_ITERATIONS}, feather=${options.featherSize ?? GENERATION_CONFIG.MASK_FEATHER_SIZE}`);
  
  return new Promise((resolve) => {
    const python = spawn("python3", ["server/hair_mask_pipeline.py"]);
    
    const input = JSON.stringify({
      imageUrl,
      dilationKernel: options.dilationKernel ?? GENERATION_CONFIG.MASK_DILATION_KERNEL,
      dilationIterations: options.dilationIterations ?? GENERATION_CONFIG.MASK_DILATION_ITERATIONS,
      featherSize: options.featherSize ?? GENERATION_CONFIG.MASK_FEATHER_SIZE,
      createOverlay: options.createOverlay ?? GENERATION_CONFIG.MASK_DEBUG_OVERLAY,
    });
    
    let stdout = "";
    let stderr = "";
    
    python.stdout.on("data", (data) => { stdout += data.toString(); });
    python.stderr.on("data", (data) => { stderr += data.toString(); });
    
    python.on("close", (code) => {
      if (code !== 0) {
        console.error("Hair mask pipeline failed:", stderr);
        resolve(null);
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.success) {
          console.log(`✓ Hair mask complete (${result.width}x${result.height})`);
          resolve(result.mask);
        } else {
          console.error("Pipeline error:", result.error);
          resolve(null);
        }
      } catch (e) {
        console.error("Failed to parse pipeline output:", e);
        resolve(null);
      }
    });
    
    python.stdin.write(input);
    python.stdin.end();
  });
}

/**
 * Generate a refined hair mask and return both mask and debug overlay
 */
export async function generateHairMaskWithOverlay(
  imageUrl: string,
  userImageBase64: string,
  options: Omit<MaskRefinementOptions, 'createOverlay' | 'userImage'> = {}
): Promise<{ mask: string; overlay: string } | null> {
  console.log("=== Generating Hair Mask with Debug Overlay ===");
  
  const rawMask = await getRawHairMask(imageUrl);
  if (!rawMask) {
    console.error("Failed to get raw hair mask");
    return null;
  }
  
  const refinedResult = await runMaskRefinement(rawMask, {
    ...options,
    userImage: userImageBase64,
    createOverlay: true,
  });
  
  if (!refinedResult || !refinedResult.overlay) {
    console.error("Failed to generate mask with overlay");
    return null;
  }
  
  return {
    mask: refinedResult.mask,
    overlay: refinedResult.overlay,
  };
}

export async function postProcessMask(maskBuffer: Buffer): Promise<string> {
  console.log("Post-processing mask for diffusion model...");
  
  const processed = await sharp(maskBuffer)
    .resize(1024, 1024, {
      fit: "cover",
      position: "centre",
    })
    .greyscale()
    .blur(2)
    .modulate({
      brightness: 1.1,
    })
    .linear(1.2, -25)
    .png({ quality: 100 })
    .toBuffer();

  const base64 = `data:image/png;base64,${processed.toString("base64")}`;
  
  console.log("Mask post-processed: 1024x1024 grayscale PNG with feathered edges");
  return base64;
}

export async function invertMask(maskBase64: string): Promise<string> {
  const base64Data = maskBase64.replace(/^data:image\/\w+;base64,/, "");
  const maskBuffer = Buffer.from(base64Data, "base64");
  
  const inverted = await sharp(maskBuffer)
    .negate()
    .png({ quality: 100 })
    .toBuffer();

  return `data:image/png;base64,${inverted.toString("base64")}`;
}

export async function createImageWithAlphaMask(
  userImageBase64: string,
  hairMaskBase64: string
): Promise<string> {
  console.log("Creating image with alpha channel mask...");
  
  const userBase64Data = userImageBase64.replace(/^data:image\/\w+;base64,/, "");
  const userBuffer = Buffer.from(userBase64Data, "base64");
  
  const maskBase64Data = hairMaskBase64.replace(/^data:image\/\w+;base64,/, "");
  const maskBuffer = Buffer.from(maskBase64Data, "base64");
  
  const [userResized, maskResized] = await Promise.all([
    sharp(userBuffer)
      .resize(1024, 1024, { fit: "cover", position: "centre" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(maskBuffer)
      .resize(1024, 1024, { fit: "cover", position: "centre" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  
  const width = userResized.info.width;
  const height = userResized.info.height;
  const rgbaBuffer = Buffer.alloc(width * height * 4);
  
  for (let i = 0; i < width * height; i++) {
    const rgbOffset = i * 3;
    const rgbaOffset = i * 4;
    const maskValue = maskResized.data[i];
    
    rgbaBuffer[rgbaOffset] = userResized.data[rgbOffset];
    rgbaBuffer[rgbaOffset + 1] = userResized.data[rgbOffset + 1];
    rgbaBuffer[rgbaOffset + 2] = userResized.data[rgbOffset + 2];
    rgbaBuffer[rgbaOffset + 3] = 255 - maskValue;
  }
  
  const pngWithAlpha = await sharp(rgbaBuffer, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png({ quality: 100 })
    .toBuffer();
  
  const base64 = `data:image/png;base64,${pngWithAlpha.toString("base64")}`;
  console.log("Created PNG with alpha channel mask (hair = transparent)");
  
  return base64;
}

export async function prepareInspirationPipelineImages(
  userPhotoUrl: string,
  inspirationPhotoUrl: string
): Promise<ProcessedImages | null> {
  try {
    console.log("=== Starting Inspiration Pipeline Image Preparation ===");

    const [userImageBuffer, inspirationImageBuffer] = await Promise.all([
      downloadImage(userPhotoUrl),
      downloadImage(inspirationPhotoUrl),
    ]);

    const [userProcessed, inspirationProcessed] = await Promise.all([
      preprocessImage(userImageBuffer),
      preprocessImage(inspirationImageBuffer),
    ]);

    console.log("Step 2: Generating refined hair mask...");
    const hairMaskBase64 = await generateHairMask(userPhotoUrl, {
      dilationKernel: 5,
      dilationIterations: 1,
      featherSize: 7,
    });
    
    if (!hairMaskBase64) {
      console.error("Failed to generate hair mask - falling back to no-mask generation");
      return null;
    }

    console.log("=== Pipeline Image Preparation Complete ===");
    
    return {
      userImageBase64: userProcessed.base64,
      inspirationImageBase64: inspirationProcessed.base64,
      hairMaskBase64,
    };
  } catch (error) {
    console.error("Error in inspiration pipeline preparation:", error);
    return null;
  }
}

export function isReplicateConfigured(): boolean {
  return !!REPLICATE_API_TOKEN;
}

export function isFalConfigured(): boolean {
  return !!FAL_KEY;
}

/**
 * Generate hair mask using Replicate's hadilq/hair-segment model
 * More robust than local BiSeNet, especially for diverse hair types
 * Includes retry logic for rate limits (429 errors)
 */
export async function generateHairMaskReplicate(imageBase64: string, maxRetries: number = 3): Promise<string | null> {
  if (!REPLICATE_API_TOKEN) {
    console.error("REPLICATE_API_TOKEN not configured");
    return null;
  }

  // Ensure we have a proper data URI (do this once before retries)
  let inputImage = imageBase64;
  if (!inputImage.startsWith("data:")) {
    if (inputImage.startsWith("http")) {
      const response = await fetch(inputImage);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      inputImage = `data:${contentType};base64,${base64}`;
    }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Generating hair mask via Replicate (attempt ${attempt}/${maxRetries})...`);
      
      const replicate = new Replicate({
        auth: REPLICATE_API_TOKEN,
      });

      // Use predictions API instead of run() to get the actual URL from response
      const prediction = await replicate.predictions.create({
        version: "b335dc1b693b2de88040736eb426702adfc2f0c869ae9dba3569bac1beb9c0f6",
        input: {
          image: inputImage,
        },
      });

      console.log("Prediction created:", prediction.id);

      // Wait for prediction to complete
      let result = await replicate.predictions.get(prediction.id);
      while (result.status !== "succeeded" && result.status !== "failed") {
        await new Promise(resolve => setTimeout(resolve, 1000));
        result = await replicate.predictions.get(prediction.id);
        console.log("Polling prediction status:", result.status);
      }

      if (result.status === "failed") {
        console.error("Replicate prediction failed:", result.error);
        return null;
      }

      // The output should be a URL string
      const maskUrl = result.output as string;
      console.log("Replicate output:", maskUrl);
      
      if (!maskUrl || typeof maskUrl !== "string") {
        console.error("Unexpected output format:", typeof maskUrl, maskUrl);
        return null;
      }

      console.log("✓ Replicate hair mask generated:", maskUrl.substring(0, 80));

      // Download the mask
      const response = await fetch(maskUrl);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return `data:image/png;base64,${base64}`;
    } catch (error: any) {
      // Check for rate limit error (429)
      const isRateLimit = error?.response?.status === 429 || 
                          error?.message?.includes('429') ||
                          error?.message?.includes('rate limit') ||
                          error?.message?.includes('Too Many Requests');
      
      if (isRateLimit && attempt < maxRetries) {
        // Get retry-after from error or default to exponential backoff
        const retryAfter = error?.response?.headers?.get?.('retry-after') || (attempt * 10);
        console.log(`Rate limited (429). Waiting ${retryAfter}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      
      console.error("Error generating hair mask via Replicate:", error);
      return null;
    }
  }
  
  return null;
}

/**
 * Create a user mask showing FACE ONLY (hair/background grayed).
 * This tells FLUX which face/head identity to preserve.
 * Uses local Python BiSeNet pipeline with "user_mask" mode
 * 
 * @param bufferPx - Number of pixels to expand the face mask (default 10)
 * @param includeValidation - Whether to return validation data (default false)
 * @param hairlineVisiblePx - Pixels of hair to show above the hairline (default 5)
 * @param includeNeck - Whether to include neck in the visible area (default false)
 */
export async function createUserMaskedImage(
  imageBase64: string, 
  bufferPx?: number,
  includeValidation?: false,
  hairlineVisiblePx?: number,
  includeNeck?: boolean,
  grayOutBackground?: boolean
): Promise<string | null>;
export async function createUserMaskedImage(
  imageBase64: string, 
  bufferPx: number,
  includeValidation: true,
  hairlineVisiblePx?: number,
  includeNeck?: boolean,
  grayOutBackground?: boolean
): Promise<MaskResult>;
export async function createUserMaskedImage(
  imageBase64: string, 
  bufferPx: number = 10,
  includeValidation: boolean = false,
  hairlineVisiblePx: number = 0,
  includeNeck: boolean = false,
  grayOutBackground: boolean = true
): Promise<string | null | MaskResult> {
  try {
    // Ensure we have a proper data URI
    let inputImage = imageBase64;
    if (!inputImage.startsWith("data:")) {
      if (inputImage.startsWith("http")) {
        const response = await fetch(inputImage);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const contentType = response.headers.get("content-type") || "image/jpeg";
        inputImage = `data:${contentType};base64,${base64}`;
      }
    }

    // Normalize EXIF orientation
    const rawBuffer = Buffer.from(
      inputImage.replace(/^data:image\/\w+;base64,/, ''),
      'base64'
    );
    
    const normalizedBuffer = await sharp(rawBuffer)
      .rotate()
      .jpeg({ quality: 95 })
      .toBuffer();
    
    const normalizedBase64 = `data:image/jpeg;base64,${normalizedBuffer.toString('base64')}`;
    
    // Get original dimensions
    const meta = await sharp(normalizedBuffer).metadata();
    
    // Call Python BiSeNet pipeline in "user_mask" mode with quality validation
    const pythonInput = JSON.stringify({
      imageUrl: normalizedBase64,
      mode: "user_mask",
      bufferPx: bufferPx,
      hairlineVisiblePx: hairlineVisiblePx,
      includeNeck: includeNeck,
      grayOutBackground: grayOutBackground,
      validateQuality: true  // Enable photo quality validation
    });
    
    const { result, validation, photoQuality } = await new Promise<{ result: string | null; validation?: MaskValidation; photoQuality?: PhotoQualityValidation }>((resolve) => {
      const python = spawn('python3', ['server/hair_mask_pipeline.py']);
      let stdout = '';
      let stderr = '';
      
      python.stdout.on('data', (data) => { stdout += data.toString(); });
      python.stderr.on('data', (data) => { stderr += data.toString(); });
      
      python.on('close', (code) => {
        if (code !== 0) {
          console.error("User mask creation failed");
          if (stderr.trim()) console.error(stderr);
          resolve({ result: null });
          return;
        }
        
        try {
          const output = JSON.parse(stdout);
          if (output.success && output.userMaskedImage) {
            const validation = output.validation as MaskValidation | undefined;
            const photoQuality = output.photoQuality as PhotoQualityValidation | undefined;
            
            // Only log issues if there are problems
            if (validation && !validation.valid) {
              console.log(`   ⚠️ User mask issues: ${validation.issues.join(', ')}`);
            }
            if (photoQuality && !photoQuality.valid) {
              console.log(`   ⚠️ Photo quality issues: ${photoQuality.issues.join(', ')}`);
            }
            
            resolve({ result: output.userMaskedImage, validation, photoQuality });
          } else {
            console.error("User mask creation error:", output.error);
            resolve({ result: null });
          }
        } catch (e) {
          console.error("Failed to parse mask output:", e);
          resolve({ result: null });
        }
      });
      
      python.stdin.write(pythonInput);
      python.stdin.end();
    });
    
    if (!result) {
      if (includeValidation) {
        return { image: null, width: 0, height: 0 };
      }
      return null;
    }
    
    // Only log success if photo quality validation passed (or wasn't requested)
    const qualityPassed = !photoQuality || photoQuality.valid;
    const maskPassed = !validation || validation.valid;
    
    if (qualityPassed && maskPassed) {
      console.log(`✓ User masked image created at ${meta.width}x${meta.height} with ${bufferPx}px buffer (hair removed)`);
    }
    
    if (includeValidation) {
      return { image: result, validation, photoQuality, width: meta.width || 0, height: meta.height || 0 };
    }
    return result;
  } catch (error: any) {
    console.error("Error creating user masked image:", error);
    if (includeValidation) {
      return { image: null, width: 0, height: 0 };
    }
    return null;
  }
}

// Validation result type from Python BiSeNet pipeline
export interface MaskValidation {
  valid: boolean;
  score: number;
  issues: string[];
  metrics: {
    hair_ratio?: number;
    hair_pixels?: number;
    centroid_y_ratio?: number;
    centroid?: [number, number];
    connected_ratio?: number;
    num_components?: number;
    facial_pixels?: number;
    bbox_aspect_ratio?: number;
    bbox?: [number, number, number, number];
    face_ratio?: number;
    face_pixels?: number;
    centroid_x_ratio?: number;
  };
}

// Photo quality validation result from Python BiSeNet pipeline
export interface PhotoQualityValidation {
  valid: boolean;
  issues: string[];
  metrics: {
    min_dimension?: number;
    left_eye_pixels?: number;
    right_eye_pixels?: number;
    nose_pixels?: number;
    mouth_pixels?: number;
    forehead_pixels?: number;
  };
  guidance: string;
}

/**
 * Helper function to normalize image and call BiSeNet pipeline
 */
async function callBiSeNetPipeline(
  imageBase64: string,
  mode: "kontext_result_mask_test",
  bufferPx: number,
  options?: { roiDilatePx?: number }
): Promise<{ result: string | null; width: number; height: number; validation?: MaskValidation }> {
  // Ensure we have a proper data URI
  let inputImage = imageBase64;
  if (!inputImage.startsWith("data:")) {
    if (inputImage.startsWith("http")) {
      const response = await fetch(inputImage);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      inputImage = `data:${contentType};base64,${base64}`;
    }
  }

  // Normalize EXIF orientation and sharpen for better edge detection
  const rawBuffer = Buffer.from(
    inputImage.replace(/^data:image\/\w+;base64,/, ''),
    'base64'
  );
  
  // Sharpen reference images before masking to improve hair edge detection
  // Uses unsharp mask: sigma=1.0, flat=1.0, jagged=2.0 for balanced sharpening
  const normalizedBuffer = await sharp(rawBuffer)
    .rotate()
    .sharpen({ sigma: 1.0, m1: 1.0, m2: 2.0 })
    .jpeg({ quality: 95 })
    .toBuffer();
  
  const normalizedBase64 = `data:image/jpeg;base64,${normalizedBuffer.toString('base64')}`;
  
  // Get original dimensions
  const meta = await sharp(normalizedBuffer).metadata();
  
  // Call Python BiSeNet pipeline
  const pythonInput = JSON.stringify({
    imageUrl: normalizedBase64,
    mode: mode,
    bufferPx: bufferPx,
    grayOutEyes: options?.grayOutEyes || false,
    faceBorderPx: options?.faceBorderPx || 0,
    roiDilatePx: options?.roiDilatePx
  });
  
  const { result, validation } = await new Promise<{ result: string | null; validation?: MaskValidation }>((resolve) => {
    const python = spawn('python3', ['server/hair_mask_pipeline.py']);
    let stdout = '';
    let stderr = '';
    
    python.stdout.on('data', (data) => { stdout += data.toString(); });
    python.stderr.on('data', (data) => { stderr += data.toString(); });
    
    python.on('close', (code) => {
      if (code !== 0) {
        console.error(`Mask creation failed (${mode})`);
        if (stderr.trim()) console.error(stderr);
        resolve({ result: null });
        return;
      }
      
      try {
        const output = JSON.parse(stdout);
        if (output.success) {
          const resultKey = "hairOnlyImage";
          const validation = output.validation as MaskValidation | undefined;
          
          // Only log issues if validation failed
          if (validation && !validation.valid) {
            console.log(`   ⚠️ Mask issues: ${validation.issues.join(', ')}`);
          }
          
          resolve({ result: output[resultKey] || null, validation });
        } else {
          console.error(`Mask creation error (${mode}):`, output.error);
          resolve({ result: null });
        }
      } catch (e) {
        console.error(`Failed to parse mask output:`, e);
        resolve({ result: null });
      }
    });
    
    python.stdin.write(pythonInput);
    python.stdin.end();
  });
  
  return { result, width: meta.width || 0, height: meta.height || 0, validation };
}

// Return type for mask creation with validation
export interface MaskResult {
  image: string | null;
  validation?: MaskValidation;
  photoQuality?: PhotoQualityValidation;
  width: number;
  height: number;
}

/**
 * Creates a hair-only mask for FLUX.
 * This now uses the same kontext_result_mask_test pipeline as Kontext Stage-1 masking.
 * 
 * @param imageBase64 - Base64 encoded image (with or without data URI prefix)
 * @param bufferPx - Number of pixels to expand the hair mask (default 3)
 * @param includeValidation - Whether to return validation data (default false for backward compatibility)
 */
export async function createHairOnlyImage(
  imageBase64: string, 
  bufferPx?: number,
  includeValidation?: false
): Promise<string | null>;
export async function createHairOnlyImage(
  imageBase64: string, 
  bufferPx: number,
  includeValidation: true
): Promise<MaskResult>;
export async function createHairOnlyImage(
  imageBase64: string, 
  bufferPx: number = 3,
  includeValidation: boolean = false
): Promise<string | null | MaskResult> {
  try {
    console.log(`Creating hair-only mask via kontext_result_mask_test (${bufferPx}px buffer)...`);
    
    const { result, width, height, validation } = await callBiSeNetPipeline(imageBase64, "kontext_result_mask_test", bufferPx);
    
    if (result) {
      console.log(`✓ Hair-only mask created at ${width}x${height} with ${bufferPx}px buffer`);
    }
    
    if (includeValidation) {
      return { image: result, validation, width, height };
    }
    return result;
  } catch (error: any) {
    console.error("Error creating hair-only mask:", error);
    if (includeValidation) {
      return { image: null, width: 0, height: 0 };
    }
    return null;
  }
}

/**
 * Creates a standalone Kontext Stage-1 result mask using the hair_only pipeline.
 * Output: hair-only mask with 30px buffer around detected hair (face excluded).
 */
export async function createKontextResultMaskTest(
  imageBase64: string,
  bufferPx: number = 30
): Promise<string | null> {
  try {
    console.log(`Creating Kontext result mask test (${bufferPx}px buffer)...`);

    // Use raw Stage-1 output for this test pipeline (no TS-side sharpening).
    const { result, width, height } = await callBiSeNetPipeline(imageBase64, "kontext_result_mask_test", bufferPx);

    if (result) {
      console.log(`✓ Kontext result mask test created at ${width}x${height} (${bufferPx}px buffer)`);
    }
    return result;
  } catch (error: any) {
    console.error("Error creating Kontext result mask test:", error);
    return null;
  }
}

/**
 * Result from processing hair mask and creating inpainting input
 */
export interface HairInpaintingInput {
  binaryMask: string;        // White = hair region to replace
  hairErasedImage: string;   // Original with hair region neutralized
  originalImage: string;     // Original for reference
}

/**
 * Connected component labeling using flood fill algorithm.
 * Returns the labeled image and list of component sizes/bounding boxes.
 */
function labelConnectedComponents(maskPixels: Buffer, width: number, height: number): {
  labels: Int32Array;
  components: Array<{ label: number; size: number; minY: number; maxY: number; minX: number; maxX: number; centerY: number }>;
} {
  const totalPixels = width * height;
  const labels = new Int32Array(totalPixels);
  let currentLabel = 0;
  const componentStats: Map<number, { size: number; minY: number; maxY: number; minX: number; maxX: number; sumY: number }> = new Map();

  // 4-connected flood fill
  const floodFill = (startX: number, startY: number, label: number) => {
    const stack: Array<[number, number]> = [[startX, startY]];
    let size = 0;
    let minY = startY, maxY = startY, minX = startX, maxX = startX, sumY = 0;

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const idx = y * width + x;

      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (labels[idx] !== 0 || maskPixels[idx] === 0) continue;

      labels[idx] = label;
      size++;
      sumY += y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);

      // 4-connected neighbors
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    return { size, minY, maxY, minX, maxX, sumY };
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (maskPixels[idx] === 255 && labels[idx] === 0) {
        currentLabel++;
        const stats = floodFill(x, y, currentLabel);
        componentStats.set(currentLabel, stats);
      }
    }
  }

  const components = Array.from(componentStats.entries()).map(([label, stats]) => ({
    label,
    size: stats.size,
    minY: stats.minY,
    maxY: stats.maxY,
    minX: stats.minX,
    maxX: stats.maxX,
    centerY: stats.sumY / stats.size,
  }));

  return { labels, components };
}

/**
 * Filter mask to keep only the main hair region.
 * Strategy: Keep ONLY the largest connected component in the upper portion of the image.
 * This eliminates background white regions that might be detected.
 */
function filterHairRegion(
  maskPixels: Buffer, 
  width: number, 
  height: number,
  options: { minSizeRatio?: number; maxCenterYRatio?: number } = {}
): Buffer {
  const { minSizeRatio = 0.01, maxCenterYRatio = 0.50 } = options; // Stricter: top 50%, min 1%
  const totalPixels = width * height;
  const minComponentSize = Math.floor(totalPixels * minSizeRatio);
  const maxCenterY = Math.floor(height * maxCenterYRatio);

  console.log(`Filtering hair region: minSize=${minComponentSize}px, maxCenterY=${maxCenterY}px (${(maxCenterYRatio * 100).toFixed(0)}% of height)`);

  const { labels, components } = labelConnectedComponents(maskPixels, width, height);
  
  console.log(`Found ${components.length} connected components`);

  // Sort by size descending
  const sortedComponents = [...components].sort((a, b) => b.size - a.size);

  // Log top components for debugging
  for (const c of sortedComponents.slice(0, 10)) {
    const passesPosition = c.centerY <= maxCenterY;
    console.log(`  Component ${c.label}: size=${c.size}, centerY=${c.centerY.toFixed(0)} (${(c.centerY / height * 100).toFixed(0)}%), passPosition=${passesPosition}`);
  }

  // STRICT: Only keep the SINGLE LARGEST component that's in the upper portion
  const hairComponent = sortedComponents.find(c => 
    c.size >= minComponentSize && c.centerY <= maxCenterY
  );

  // Create filtered mask with only the main hair component
  const filteredMask = Buffer.alloc(totalPixels);
  let keptPixels = 0;

  if (hairComponent) {
    console.log(`✓ Selected hair component ${hairComponent.label}: ${hairComponent.size} pixels`);
    for (let i = 0; i < totalPixels; i++) {
      if (labels[i] === hairComponent.label) {
        filteredMask[i] = 255;
        keptPixels++;
      }
    }
  } else {
    console.warn("No valid hair component found in upper portion, using largest overall");
    const largest = sortedComponents[0];
    if (largest) {
      for (let i = 0; i < totalPixels; i++) {
        if (labels[i] === largest.label) {
          filteredMask[i] = 255;
          keptPixels++;
        }
      }
    }
  }

  console.log(`Kept 1 hair component, ${keptPixels} pixels (${(keptPixels / totalPixels * 100).toFixed(1)}%)`);

  return filteredMask;
}

/**
 * Extract a REAL binary mask by comparing original image with Replicate's RGB output.
 * Then create a hair-erased input image for FLUX Fill inpainting.
 * 
 * Step 1: Compare pixel differences to find hair region
 * Step 2: Create binary mask (white = hair, black = keep)
 * Step 3: Neutralize hair region in original (blur/gray fill)
 */
export async function extractMaskAndPrepareInpaintingInput(
  originalImageBase64: string,
  replicateOutputBase64: string,
  options: {
    whiteThreshold?: number;     // Brightness threshold to detect white pixels in Replicate output
    neutralizeMethod?: 'blur' | 'gray' | 'skinTone';
    dilationKernel?: number;
    dilationIterations?: number;
  } = {}
): Promise<HairInpaintingInput | null> {
  const {
    whiteThreshold = 200,      // Pixels brighter than this are considered hair mask (white in Replicate output)
    neutralizeMethod = 'blur',
    dilationKernel = 15,
    dilationIterations = 2,
  } = options;

  try {
    console.log("Extracting binary mask from Replicate RGB output (white pixels = hair)...");
    
    // Get raw pixel data from both images
    const origBuffer = Buffer.from(
      originalImageBase64.replace(/^data:image\/\w+;base64,/, ''), 
      'base64'
    );
    const replicateBuffer = Buffer.from(
      replicateOutputBase64.replace(/^data:image\/\w+;base64,/, ''), 
      'base64'
    );

    // Get metadata from both images
    const origMeta = await sharp(origBuffer).metadata();
    const replicateMeta = await sharp(replicateBuffer).metadata();
    
    console.log(`Original: ${origMeta.width}x${origMeta.height} (orientation: ${origMeta.orientation})`);
    console.log(`Replicate: ${replicateMeta.width}x${replicateMeta.height}`);

    // STRATEGY: Keep original in its RAW orientation (no rotation)
    // Replicate auto-rotates based on EXIF, so we need to REVERSE that rotation
    // to match our original's raw pixel layout
    const origWidth = origMeta.width!;
    const origHeight = origMeta.height!;
    const width = origWidth;
    const height = origHeight;

    // Determine if Replicate rotated the image (dimensions swapped)
    const replicateRotated = (replicateMeta.width === origHeight && replicateMeta.height === origWidth);
    
    let replicateMatchedBuffer: Buffer;
    if (replicateRotated) {
      // Replicate rotated 90°, we need to rotate it back to match original raw layout
      // EXIF orientation 6 = 90° CW, so Replicate did 90° CW, we need 90° CCW (270° CW)
      console.log(`Replicate was rotated, rotating back to match original (${origWidth}x${origHeight})...`);
      replicateMatchedBuffer = await sharp(replicateBuffer)
        .rotate(270) // Rotate 270° CW = 90° CCW to undo Replicate's rotation
        .resize(width, height) // Ensure exact match
        .toBuffer();
    } else {
      // Same dimensions, just resize if needed
      replicateMatchedBuffer = await sharp(replicateBuffer)
        .resize(width, height)
        .toBuffer();
    }

    console.log(`Processing at original dimensions: ${width}x${height}`);

    // Get raw pixel data (RGBA) from the matched Replicate output
    const replicatePixels = await sharp(replicateMatchedBuffer).ensureAlpha().raw().toBuffer();

    const totalPixels = width * height;

    // Create binary mask by finding WHITE pixels in Replicate output
    // The Replicate hair-segment model outputs: white = hair, other colors = background
    const maskPixels = Buffer.alloc(totalPixels); // Grayscale mask
    let hairPixelCount = 0;

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4; // RGBA
      
      // Check if pixel is white (or near-white) in Replicate output
      const r = replicatePixels[idx];
      const g = replicatePixels[idx + 1];
      const b = replicatePixels[idx + 2];
      
      // White pixels have high values in all RGB channels
      const isWhite = r > whiteThreshold && g > whiteThreshold && b > whiteThreshold;

      if (isWhite) {
        maskPixels[i] = 255;
        hairPixelCount++;
      } else {
        maskPixels[i] = 0;
      }
    }

    const hairPercentage = (hairPixelCount / totalPixels * 100).toFixed(1);
    console.log(`Found ${hairPixelCount} white (hair) pixels (${hairPercentage}% of image)`);

    // If very few hair pixels detected, the model might have failed
    if (hairPixelCount < totalPixels * 0.01) {
      console.warn("Warning: Very few hair pixels detected (<1%), model may have failed");
    }

    // CRITICAL: Filter out spurious white regions (background, noise)
    // Keep only connected components in the upper portion of the image (where hair should be)
    console.log("Filtering to keep only main hair region...");
    const filteredMaskPixels = filterHairRegion(maskPixels, width, height, {
      minSizeRatio: 0.005,    // Components must be at least 0.5% of image
      maxCenterYRatio: 0.65,  // Hair center of mass should be in top 65%
    });

    // Create the binary mask image from FILTERED pixels
    const rawMaskBuffer = await sharp(filteredMaskPixels, {
      raw: { width, height, channels: 1 }
    }).png().toBuffer();

    // Apply dilation to expand the mask and catch edge pixels
    const dilatedMask = await applyMaskDilation(rawMaskBuffer, dilationKernel, dilationIterations);
    
    const binaryMaskBase64 = `data:image/png;base64,${dilatedMask.toString('base64')}`;

    // Step 2: Create hair-erased input image using the ROTATED original
    console.log(`Neutralizing hair region using method: ${neutralizeMethod}`);
    
    let hairErasedBuffer: Buffer;
    
    if (neutralizeMethod === 'blur') {
      // Create a heavily blurred version of the original
      const blurred = await sharp(origBuffer)
        .blur(40) // Heavy blur
        .toBuffer();
      
      // Blend: use original where mask is black, blurred where mask is white
      hairErasedBuffer = await blendWithMask(origBuffer, blurred, dilatedMask, width, height);
    } else if (neutralizeMethod === 'gray') {
      // Fill hair region with mid-gray
      const grayFill = await sharp({
        create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } }
      }).png().toBuffer();
      
      hairErasedBuffer = await blendWithMask(origBuffer, grayFill, dilatedMask, width, height);
    } else {
      // Skin tone fill - sample from face region
      // For now, use a neutral skin-like color
      const skinFill = await sharp({
        create: { width, height, channels: 3, background: { r: 180, g: 140, b: 120 } }
      }).png().toBuffer();
      
      hairErasedBuffer = await blendWithMask(origBuffer, skinFill, dilatedMask, width, height);
    }

    const hairErasedBase64 = `data:image/png;base64,${hairErasedBuffer.toString('base64')}`;

    console.log("✓ Created binary mask and hair-erased input image");

    return {
      binaryMask: binaryMaskBase64,
      hairErasedImage: hairErasedBase64,
      originalImage: originalImageBase64,
    };
  } catch (error) {
    console.error("Error extracting mask:", error);
    return null;
  }
}

/**
 * Apply morphological dilation to expand the mask
 */
async function applyMaskDilation(
  maskBuffer: Buffer, 
  kernelSize: number, 
  iterations: number
): Promise<Buffer> {
  // Use sharp's convolve operation to simulate dilation
  // A max filter approximation using blur + threshold
  let current = maskBuffer;
  
  for (let i = 0; i < iterations; i++) {
    // Blur slightly then threshold to expand white regions
    current = await sharp(current)
      .blur(kernelSize / 2)
      .threshold(128) // Re-binarize
      .toBuffer();
  }
  
  return current;
}

/**
 * Blend two images using a mask (white = use fill, black = use original)
 */
async function blendWithMask(
  originalBuffer: Buffer,
  fillBuffer: Buffer,
  maskBuffer: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  // Get raw pixels from all three
  const origPixels = await sharp(originalBuffer).ensureAlpha().raw().toBuffer();
  const fillPixels = await sharp(fillBuffer).resize(width, height).ensureAlpha().raw().toBuffer();
  const maskPixels = await sharp(maskBuffer).resize(width, height).grayscale().raw().toBuffer();

  const totalPixels = width * height;
  const resultPixels = Buffer.alloc(totalPixels * 4); // RGBA

  for (let i = 0; i < totalPixels; i++) {
    const rgbaIdx = i * 4;
    const maskValue = maskPixels[i] / 255; // 0-1, where 1 = use fill
    
    // Linear blend based on mask
    resultPixels[rgbaIdx] = Math.round(origPixels[rgbaIdx] * (1 - maskValue) + fillPixels[rgbaIdx] * maskValue);
    resultPixels[rgbaIdx + 1] = Math.round(origPixels[rgbaIdx + 1] * (1 - maskValue) + fillPixels[rgbaIdx + 1] * maskValue);
    resultPixels[rgbaIdx + 2] = Math.round(origPixels[rgbaIdx + 2] * (1 - maskValue) + fillPixels[rgbaIdx + 2] * maskValue);
    resultPixels[rgbaIdx + 3] = 255; // Full opacity
  }

  return sharp(resultPixels, {
    raw: { width, height, channels: 4 }
  }).png().toBuffer();
}
