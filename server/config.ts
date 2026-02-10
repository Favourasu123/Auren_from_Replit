// Development configuration - easily toggle models and features without changing code

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
  CHATGPT_MODEL: "gpt-image-1", // OpenAI's best image generation model
  CHATGPT_IMAGE_SIZE: "1024x1024" as "1024x1024" | "512x512" | "256x256", // Supported sizes
  CHATGPT_DESCRIBE_PROMPT_TEMPLATE: "Transform this person's hairstyle to: {hairstyle}. Keep the same person, same face, same features, same clothing, same background. Only change the hairstyle to match the description. Photorealistic, natural lighting, professional portrait quality.",
  
  // BFL FLUX 2 Pro prompt template (used by AI Polish and fallback features)
  TEXT_MODE_FRONT_PROMPT_TEMPLATE: "Apply image 1's exact face and head with the hair from image 2. Place them in the exact background in image 3. Preserve the person's head shape and dimensions. Use the hairtype in image 2. Smooth natural photorealistic lighting.",
  
  // KONTEXT REFINED PIPELINE: Two-stage generation (Kontext Pro → FLUX 2 Pro)
  // Stage 1: FLUX Kontext Pro (reference image ONLY → generate person with that hairstyle)
  // Stage 2: FLUX 2 Pro (user mask + hair-only mask from Kontext + full user photo → refined result)
  KONTEXT_STAGE1_ONLY: false, // Continue to Stage 2 with FLUX 2 Pro
  KONTEXT_STAGE1_PROMPT: "Make the person front-facing, centered, looking directly at the camera. Preserve the exact hairstyle. The person is wearing a clean white shirt. Bright, centered, symmetrical, frontal lighting aligned with the camera axis, producing flat, even illumination across the entire subject. The full hairstyle is visible with at least 15–20% of the image height as empty space above the highest hair point. Plain studio background in neutral light gray (hex #D0D0D0), evenly lit, no texture or objects. Professional photorealistic studio portrait. Shot in a bright professional studio using a Phase One XF IQ4 medium format camera, ultra-sharp focus, high clarity, high dynamic range, no depth-of-field blur, and no cinematic softness.",
  KONTEXT_STAGE1_GUIDANCE: 15, // Guidance for Kontext Stage 1
  KONTEXT_STAGE2_PROMPT: "Apply image 1's exact face and head with the hair from image 2. Place them in the exact background in image 3. Preserve the person's head shape and dimensions. Use the hairtype in image 2. Smooth natural photorealistic lighting.",
  KONTEXT_STAGE2_SAFETY_TOLERANCE: 0, // Safety tolerance for FLUX 2 Pro Stage 2
  KONTEXT_STAGE2_FACE_OUTLINE_PX: 10, // Pixels of face outline to show in hair mask
  TEXT_MODE_VISION_SELECTION: true, // Use vision model to select best reference from candidates
  TEXT_MODE_CANDIDATES_TO_ANALYZE: 40, // Number of candidates to fetch from web search (SerpAPI)
  TEXT_MODE_PREFILTER_TOP_N: 30, // Pre-filter to top N candidates before vision analysis (prioritizes hairstyle name matches)
  TEXT_MODE_GEMINI_MIN_FOR_GPT: 15, // If Gemini passes more than this, use GPT-4o-mini for ranking
  TEXT_MODE_GPT_MAX_CANDIDATES: 30, // Max candidates to send to GPT-4o-mini for ranking
  TEXT_MODE_GUIDANCE: 1,
  TEXT_MODE_SAFETY_TOLERANCE: 0,
  
  // BFL FLUX 2 Pro inspiration mode settings (used by AI Polish feature)
  INSPIRATION_FRONT_PROMPT_TEMPLATE: "Apply image 1's exact face and head with the hair from image 2. Place them in the exact background in image 3. Preserve the person's head shape and dimensions. Use the hairtype in image 2. Smooth natural photorealistic lighting.",
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
    .replace("{hairstyle}", hairstyle)
    .replace("{ethnicity}", ethnicity)
    .replace("{race}", race)
    .replace("{gender}", gender);
}

export function logConfig() {
  console.log("=== Auren Generation Config ===");
  if (GENERATION_CONFIG.CHATGPT_DESCRIBE_MODE) {
    console.log("Describe Mode: ChatGPT (gpt-image-1)");
    console.log(`  - Model: ${GENERATION_CONFIG.CHATGPT_MODEL}`);
    console.log(`  - Size: ${GENERATION_CONFIG.CHATGPT_IMAGE_SIZE}`);
    console.log(`  - No masks or references needed`);
  } else {
    console.log("Pipeline: Kontext Refined (Kontext Pro → FLUX 2 Pro)");
    console.log(`  - Stage 1 (Kontext): ${GENERATION_CONFIG.KONTEXT_STAGE1_PROMPT.substring(0, 60)}...`);
    console.log(`  - Stage 2 (FLUX 2): ${GENERATION_CONFIG.KONTEXT_STAGE2_PROMPT.substring(0, 60)}...`);
    console.log(`  - Vision Selection: ${GENERATION_CONFIG.TEXT_MODE_VISION_SELECTION ? "enabled" : "disabled"}`);
    if (GENERATION_CONFIG.TEXT_MODE_VISION_SELECTION) {
      console.log(`  - Candidates to Analyze: ${GENERATION_CONFIG.TEXT_MODE_CANDIDATES_TO_ANALYZE}`);
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
