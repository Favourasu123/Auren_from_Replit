// Development configuration - easily toggle models and features without changing code
import fs from "fs";
import path from "path";

function loadDotenvMap(): Map<string, string> {
  const dotenvMap = new Map<string, string>();
  const dotenvPath = path.resolve(process.cwd(), ".env");
  try {
    const raw = fs.readFileSync(dotenvPath, "utf8");
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      dotenvMap.set(key, value);
    }
  } catch {
    // No .env file available in this runtime context; fall back to process.env.
  }
  return dotenvMap;
}

const DOTENV_MAP = loadDotenvMap();

function envValue(key: string): string | undefined {
  return DOTENV_MAP.get(key) ?? process.env[key];
}

// Map vision model's race/ethnicity values to region-based terms for FLUX prompts
// Using region-based terms avoids confusion with hair colors (e.g., "black" hair vs "black" ethnicity)
export const ETHNICITY_TO_REGION_MAP: Record<string, string> = {
  "black": "African",
  "white": "European", 
  "asian": "East Asian",
  "latino": "Latin American",
  "middle_eastern": "Middle Eastern",
  "south_asian": "South Asian",
  "southeast_asian": "Southeast Asian",
  "mixed": "mixed heritage",
  "natural": "natural"
};

// Helper function to convert ethnicity to region-based term
export function getRegionBasedEthnicity(ethnicity: string | undefined | null): string {
  if (!ethnicity) return "natural";
  const lower = ethnicity.toLowerCase();
  return ETHNICITY_TO_REGION_MAP[lower] || ethnicity;
}

const DEFAULT_CHATGPT_STAGE1_PROMPT_TEMPLATE = `Create a front-facing studio portrait of a neutral grey display bust used for wigs with the hairstyle in the input image. A smooth faceless head with no facial features, no eyes, no nose, and no mouth. The surface is completely blank and matte, like a wig display stand. Preserve the hairstyle in the input image(design, length, color, etc). Beautify the hairstyle and make it good looking without changing the overall style. Render the hairstyle from a front view, if the person is not facing forward generate how the hairstyle would look like if they were facing forward. Don't include any accessories, no earrings, no hairpins, nothing in their hair. Use a plain grey background HEX: #BFBFBF. Bright photorealistic lighting with even illumination on the face.`;

export const GENERATION_CONFIG = {
  // Vision model for analyzing user photos (uses GPT-4o-mini via Replit AI Integrations)
  VISION_MODEL: "gpt-4o-mini",
  
  // Generation steps (higher = better quality but slower)
  GENERATION_STEPS: parseInt(process.env.GENERATION_STEPS || "60"),
  
  // Bypass vision analysis for text-to-image (faster for testing)
  SKIP_VISION_ANALYSIS: process.env.SKIP_VISION_ANALYSIS === "true",
  
  // Use only text-based generation even for inspiration photos
  USE_TEXT_FOR_INSPIRATION: process.env.USE_TEXT_FOR_INSPIRATION === "false", // Default: false (use Kontext for inspiration)
  
  // Log all generation prompts for debugging
  DEBUG_PROMPTS: process.env.DEBUG_PROMPTS === "true",
  
  // Mock generation (returns placeholder images for testing without API calls)
  MOCK_GENERATION: process.env.MOCK_GENERATION === "true",
  
  // DEVELOPMENT: Unlimited credits for all users (bypasses credit checks)
  UNLIMITED_CREDITS_DEV: process.env.UNLIMITED_CREDITS_DEV === "true",
  
  // CHATGPT MODE: Use OpenAI's gpt-image-1 for describe mode (no masks, no references)
  // This is a simpler pipeline: user photo + text prompt → gpt-image-1 → result
  CHATGPT_DESCRIBE_MODE: process.env.CHATGPT_DESCRIBE_MODE === "true", // Default: false (use BFL pipeline)
  CHATGPT_MODEL: process.env.CHATGPT_MODEL || "gpt-image-1.5",
  CHATGPT_IMAGE_SIZE: (process.env.CHATGPT_IMAGE_SIZE || "1024x1536") as "1024x1024" | "1024x1536" | "1536x1024",
  CHATGPT_IMAGE_QUALITY: (process.env.CHATGPT_IMAGE_QUALITY || "low") as "low" | "medium" | "high",
  CHATGPT_DESCRIBE_PROMPT_TEMPLATE: "Transform this person's hairstyle to: {hairstyle}. Keep the same person, same face, same features, same clothing, same background. Only change the hairstyle to match the description. Photorealistic, natural lighting, professional portrait quality.",
  CHATGPT_STAGE1_PROMPT_TEMPLATE: envValue("CHATGPT_STAGE1_PROMPT_TEMPLATE") || DEFAULT_CHATGPT_STAGE1_PROMPT_TEMPLATE,
  
  // BFL FLUX 2 Pro prompt template (used by AI Polish and fallback features)
  TEXT_MODE_FRONT_PROMPT_TEMPLATE: "Apply image 1's exact face and head with the hair from image 2. Place them in the exact background in image 3. Preserve image 3's head shape and dimensions. Use the hairtype in image 2. Smooth natural photorealistic lighting",
  
  // KONTEXT REFINED PIPELINE: Two-stage generation (Kontext Pro → FLUX 2 Pro)
  // Stage 1: FLUX Kontext Pro (reference image ONLY → generate person with that hairstyle)
  // Stage 2: FLUX 2 Pro (user mask + hair-only mask from Kontext + full user photo → refined result)
  TEXT_MODE_DIRECT_KONTEXT: process.env.TEXT_MODE_DIRECT_KONTEXT !== "false", // true = direct mode (no web refs in text mode)
  TEXT_MODE_STAGE1_PROVIDER: (process.env.TEXT_MODE_STAGE1_PROVIDER || "gpt_image").trim().toLowerCase(), // flux_klein | gpt_image | kontext
  KONTEXT_STAGE1_ONLY: process.env.KONTEXT_STAGE1_ONLY === "true", // true = stop after Stage 1
  KONTEXT_STAGE1_PROMPT: "Make the person front-facing, centered, looking directly at the camera. Preserve the exact hairstyle. The person is wearing a clean white shirt. Bright, centered, symmetrical, frontal lighting aligned with the camera axis, producing flat, even illumination across the entire subject. The full hairstyle is visible with at least 15–20% of the image height as empty space above the highest hair point. Plain studio background in neutral light gray (hex #D0D0D0), evenly lit, no texture or objects. Professional photorealistic studio portrait. Shot in a bright professional studio using a Phase One XF IQ4 medium format camera, ultra-sharp focus, high clarity, high dynamic range, no depth-of-field blur, and no cinematic softness.",
  KONTEXT_STAGE1_PROMPT_DIRECT_TEMPLATE: "Give the person a {hairstyle} hairstyle while preserving the person. Use bright, frontal lighting aligned with the camera axis, producing flat, even illumination across the entire subject. Professional photorealistic studio portrait. Shot in a bright professional studio using a Phase One XF IQ4 medium format camera, ultra-sharp focus, high clarity, high dynamic range, no depth-of-field blur, and no cinematic softness.",
  KONTEXT_STAGE1_GUIDANCE: 15, // Guidance for Kontext Stage 1
  KONTEXT_STAGE2_PROMPT: envValue("KONTEXT_STAGE2_PROMPT") || "Use image 1 as the full user photo base. Preserve the person's face and neck in image 2. Edit only the hair region in image 3 (hair in original color on gray background). Apply the hairstyle from image 4. Keep all non-hair pixels from image 1. Smooth natural photorealistic lighting.",
  KONTEXT_STAGE2_PROMPT_KLEIN:
    envValue("STAGE2_PROMPT_KLEIN") ||
    envValue("KONTEXT_STAGE2_PROMPT_KLEIN") ||
    "Image 1 is the full image, it contains the subject. Use image 1 as the base and reference. Preserve the person in image 1. Image 2 shows the subject's face which you should preserve. Image 3 shows the subject's current hair which is the only thing you can change. Image 4 contains a hairstyle on a mannequin, change the subject's hair to the hairstyle in image 4. Make the hair emerge naturally from the scalp. Maintain a natural hairline and root direction. Make the hairstyle match the subject's head shape and perspective. Original photorealistic lighting.",
  KONTEXT_FILL_PROMPT: envValue("KONTEXT_FILL_PROMPT") || "The person in image 1 with a {hairstyle} hairstyle.",
  KONTEXT_FILL_GUIDANCE: parseFloat(process.env.KONTEXT_FILL_GUIDANCE || "25"),
  KONTEXT_FILL_STEPS: parseInt(process.env.KONTEXT_FILL_STEPS || "45"),
  KONTEXT_FILL_PROMPT_UPSAMPLING: process.env.KONTEXT_FILL_PROMPT_UPSAMPLING === "true",
  KONTEXT_FILL_OUTPUT_FORMAT: (process.env.KONTEXT_FILL_OUTPUT_FORMAT || "jpeg").trim().toLowerCase(),
  KONTEXT_STAGE2_SAFETY_TOLERANCE: 0, // Safety tolerance for FLUX 2 Pro Stage 2
  KONTEXT_STAGE2_BACKEND: (() => {
    const backend = (process.env.KONTEXT_STAGE2_BACKEND || "flux2").trim().toLowerCase();
    return backend === "fal_redux_fill" ? "flux2" : backend; // flux2 | flux_klein | flux_fill | blend_inpaint | gpt_fill
  })(),
  KONTEXT_STAGE2_USE_IMAGE3: process.env.KONTEXT_STAGE2_USE_IMAGE3 !== "false", // Legacy flag; refined Stage 2 now uses a 4-image contract
  KONTEXT_STAGE2_FACE_OUTLINE_PX: 10, // Pixels of face outline to show in hair mask
  TEXT_MODE_VISION_SELECTION: false, // Use strict prompt-match ranking for references
  TEXT_MODE_CANDIDATES_TO_ANALYZE: parseInt(process.env.TEXT_MODE_CANDIDATES_TO_ANALYZE || "200"), // Number of candidates to fetch from SerpAPI
  TEXT_MODE_PREFILTER_TOP_N: parseInt(process.env.TEXT_MODE_PREFILTER_TOP_N || "50"), // Keep top prompt-matched references
  SAVE_FETCHED_REFERENCE_DEBUG: envValue("SAVE_FETCHED_REFERENCE_DEBUG") === "true", // Persist only final ranked references for debug viewing
  TEXT_MODE_GEMINI_MIN_FOR_GPT: 15, // If Gemini passes more than this, use GPT-4o-mini for ranking
  TEXT_MODE_GPT_MAX_CANDIDATES: 30, // Max candidates to send to GPT-4o-mini for ranking
  TEXT_MODE_GUIDANCE: 1,
  TEXT_MODE_SAFETY_TOLERANCE: 0,
  
  // BFL FLUX 2 Pro inspiration mode settings (used by AI Polish feature)
  INSPIRATION_FRONT_PROMPT_TEMPLATE: "Apply image 1's exact face and head with the hair from image 2. Place them in the exact background in image 3. Preserve image 3's head shape and dimensions. Use the hairtype in image 2. Smooth natural photorealistic lighting",
  INSPIRATION_GUIDANCE: 1,
  INSPIRATION_SAFETY_TOLERANCE: 0,
  INSPIRATION_DEFAULT_NUM_IMAGES: 1,
  INSPIRATION_MAX_NUM_IMAGES: 4,
  
  // Hair Mask Refinement Settings (BiSeNet-style post-processing)
  // These control the mask quality for FLUX inpainting
  MASK_DILATION_KERNEL: parseInt(process.env.MASK_DILATION_KERNEL || "3"), // Size of dilation kernel (2-3px per guidelines)
  MASK_DILATION_ITERATIONS: parseInt(process.env.MASK_DILATION_ITERATIONS || "1"), // Number of dilation passes
  MASK_FEATHER_SIZE: parseInt(process.env.MASK_FEATHER_SIZE || "3"), // Gaussian blur size for soft edges (1-2px blur per guidelines)
  MASK_DEBUG_OVERLAY: process.env.MASK_DEBUG_OVERLAY === "true", // Generate debug overlay images
};

// Map race labels to ethnicity terms that won't confuse hair color
function mapRaceToEthnicity(race: string): string {
  const raceMap: Record<string, string> = {
    'black': 'African',
    'white': 'European',
    'asian': 'Asian',
    'latino': 'Latino',
    'hispanic': 'Latino',
    'middle eastern': 'Middle Eastern',
    'south asian': 'South Asian',
    'indian': 'South Asian',
  };
  return raceMap[race.toLowerCase()] || race;
}

// Helper function to build dynamic prompt with user/style details
export function buildGenerationPrompt(
  template: string,
  hairstyle: string,
  race: string,
  gender: string
): string {
  const ethnicity = mapRaceToEthnicity(race);
  return template
    .replace("{hairstyle name}", hairstyle)
    .replace("{hairstyle}", hairstyle)
    .replace("{ethnicity}", ethnicity)
    .replace("{race}", race)
    .replace("{gender}", gender);
}

export function logConfig() {
  console.log("=== Auren Generation Config ===");
  if (GENERATION_CONFIG.CHATGPT_DESCRIBE_MODE) {
    console.log("Describe Mode: ChatGPT Image Edit");
    console.log(`  - Model: ${GENERATION_CONFIG.CHATGPT_MODEL}`);
    console.log(`  - Size: ${GENERATION_CONFIG.CHATGPT_IMAGE_SIZE}`);
    console.log(`  - Quality: ${GENERATION_CONFIG.CHATGPT_IMAGE_QUALITY}`);
    console.log(`  - No masks or references needed`);
  } else {
    const textModeStage1Provider = GENERATION_CONFIG.TEXT_MODE_STAGE1_PROVIDER === "flux_klein"
      ? "flux_klein"
      : GENERATION_CONFIG.TEXT_MODE_STAGE1_PROVIDER === "gpt_image"
        ? "gpt_image"
        : "kontext";
    const textModeStage1Label = textModeStage1Provider === "gpt_image"
      ? `GPT Image (${GENERATION_CONFIG.CHATGPT_MODEL})`
      : textModeStage1Provider === "flux_klein"
        ? "FLUX 2 Klein"
        : "FLUX Kontext Pro";
    const stage1PromptTemplate = textModeStage1Provider === "gpt_image" || textModeStage1Provider === "flux_klein"
      ? GENERATION_CONFIG.CHATGPT_STAGE1_PROMPT_TEMPLATE
      : (GENERATION_CONFIG.TEXT_MODE_DIRECT_KONTEXT
        ? GENERATION_CONFIG.KONTEXT_STAGE1_PROMPT_DIRECT_TEMPLATE
        : GENERATION_CONFIG.KONTEXT_STAGE1_PROMPT);
    const webReferenceSearchEnabled = !GENERATION_CONFIG.TEXT_MODE_DIRECT_KONTEXT;
    const stage2Backend = GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND === "blend_inpaint"
      ? "blend_inpaint"
      : GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND === "flux_fill"
        ? "flux_fill"
      : GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND === "flux_klein"
        ? "flux_klein"
      : GENERATION_CONFIG.KONTEXT_STAGE2_BACKEND === "gpt_fill"
        ? "gpt_fill"
        : "flux2";
    const stage2Label = stage2Backend === "blend_inpaint"
      ? "Blend Inpaint"
      : stage2Backend === "flux_fill"
        ? "FLUX Fill"
      : stage2Backend === "flux_klein"
        ? "FLUX 2 Klein"
      : stage2Backend === "gpt_fill"
        ? `GPT Fill (${GENERATION_CONFIG.CHATGPT_MODEL})`
        : "FLUX 2 Pro";

    const stage2PromptTemplate = stage2Backend === "flux_klein"
      ? GENERATION_CONFIG.KONTEXT_STAGE2_PROMPT_KLEIN
      : GENERATION_CONFIG.KONTEXT_STAGE2_PROMPT;
    const pipelineMode = GENERATION_CONFIG.KONTEXT_STAGE1_ONLY
      ? "Stage 1 only"
      : `${textModeStage1Label} → ${stage2Label}`;
    console.log(`Pipeline: Kontext Refined (${textModeStage1Label} → ${pipelineMode})`);
    console.log(`  - Text Mode: ${GENERATION_CONFIG.TEXT_MODE_DIRECT_KONTEXT ? "direct (no web references)" : "reference-guided (web references)"}`);
    console.log(`  - Stage 1 Provider: ${textModeStage1Label}`);
    console.log(`  - Stage 1 Prompt: ${stage1PromptTemplate.substring(0, 60)}...`);
    if (!GENERATION_CONFIG.KONTEXT_STAGE1_ONLY) {
      console.log(`  - Stage 2 Prompt: ${stage2PromptTemplate.substring(0, 60)}...`);
      console.log(`  - Stage 2 Backend: ${stage2Backend}`);
      const stage2InputSummary = stage2Backend === "flux_fill"
        ? "2 inputs (image+mask)"
        : stage2Backend === "flux_klein"
          ? "3 images (img1+img2+img3)"
          : "4 images (img1+img2+img3+img4)";
      console.log(`  - Stage 2 Inputs: ${stage2InputSummary}`);
      if (!GENERATION_CONFIG.TEXT_MODE_DIRECT_KONTEXT && stage2Backend === "flux_klein") {
        console.log("  - Text Generation Path: single-stage FLUX Klein (input_image=user, input_image_2=reference mannequin hair mask, input_image_3=user face mask)");
      }
    } else {
      console.log("  - Stage 2: disabled (KONTEXT_STAGE1_ONLY=true)");
    }
    if (stage2Backend === "blend_inpaint" || stage2Backend === "gpt_fill" || stage2Backend === "flux_fill") {
      console.log(`  - Fill Prompt: ${GENERATION_CONFIG.KONTEXT_FILL_PROMPT.substring(0, 60)}...`);
      console.log(`  - Fill Params: guidance=${GENERATION_CONFIG.KONTEXT_FILL_GUIDANCE}, steps=${GENERATION_CONFIG.KONTEXT_FILL_STEPS}, upsampling=${GENERATION_CONFIG.KONTEXT_FILL_PROMPT_UPSAMPLING}, format=${GENERATION_CONFIG.KONTEXT_FILL_OUTPUT_FORMAT}`);
    }
    console.log(`  - Web Reference Search: ${webReferenceSearchEnabled ? "enabled" : "disabled"}`);
    if (webReferenceSearchEnabled) {
      console.log(`  - Vision Selection: ${GENERATION_CONFIG.TEXT_MODE_VISION_SELECTION ? "enabled" : "disabled"}`);
      if (GENERATION_CONFIG.TEXT_MODE_VISION_SELECTION) {
        console.log(`  - Candidates to Analyze: ${GENERATION_CONFIG.TEXT_MODE_CANDIDATES_TO_ANALYZE}`);
      }
    } else {
      console.log(`  - Vision Selection: skipped (no web references in direct mode)`);
    }
  }
  console.log("Inspiration Mode: Kontext Refined (same 2-stage pipeline)");
  console.log(`  - Prompt: ${GENERATION_CONFIG.INSPIRATION_FRONT_PROMPT_TEMPLATE.substring(0, 60)}...`);
  console.log(`Vision Model: ${GENERATION_CONFIG.VISION_MODEL}`);
  console.log(`BFL API Available: ${!!process.env.BFL_API_KEY}`);
  console.log(`ChatGPT Describe Mode: ${GENERATION_CONFIG.CHATGPT_DESCRIBE_MODE ? "enabled" : "disabled"}`);
  if (GENERATION_CONFIG.UNLIMITED_CREDITS_DEV) {
    console.log("⚠️  UNLIMITED CREDITS DEV MODE ENABLED");
  }
  console.log("================================");
}
