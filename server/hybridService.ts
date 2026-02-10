/**
 * Hybrid Hair Transfer Service
 * Combines copy/paste compositing with AI generation for 4 variant results
 */

import { spawn } from "child_process";
import { generateHairMask, downloadImage, preprocessImage } from "./imageProcessing";
import { GENERATION_CONFIG } from "./config";

const BFL_API_KEY = process.env.BFL_API_KEY;
const BFL_API_URL = "https://api.bfl.ai/v1/flux-pro-1.1-ultra";
const FAL_KEY = process.env.FAL_KEY;

export interface HybridResult {
  compositeImageUrl: string;
  aiVariantUrls: string[];
  compositeData?: {
    userMaskUrl: string;
    refMaskUrl: string;
    blendMethod: string;
  };
}

async function runPythonBlend(
  userImageBase64: string,
  referenceImageBase64: string,
  userMaskBase64: string,
  referenceMaskBase64: string
): Promise<string | null> {
  return new Promise((resolve) => {
    console.log("Running Python hair blend script...");
    
    const python = spawn("python3", ["server/hair_blend.py"]);
    
    const input = JSON.stringify({
      userImage: userImageBase64,
      referenceImage: referenceImageBase64,
      userMask: userMaskBase64,
      referenceMask: referenceMaskBase64,
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
        console.error("Python blend script failed:", stderr);
        resolve(null);
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.success) {
          console.log("Python blend successful");
          resolve(result.result);
        } else {
          console.error("Python blend error:", result.error);
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

async function refineWithFluxDev(
  compositeBase64: string,
  strength: number = 0.15
): Promise<string | null> {
  if (!FAL_KEY) {
    console.log("FAL_KEY not configured, skipping refinement");
    return compositeBase64;
  }
  
  try {
    console.log(`Refining composite with fal.ai FLUX dev (strength: ${strength})...`);
    
    const response = await fetch("https://queue.fal.run/fal-ai/flux/dev/image-to-image", {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: compositeBase64,
        prompt: "Natural looking hair, seamless blend, photorealistic",
        strength: strength,
        num_inference_steps: 28,
        guidance_scale: 3.5,
      }),
    });
    
    if (!response.ok) {
      console.error("fal.ai refinement failed:", response.status);
      return compositeBase64;
    }
    
    const data = await response.json();
    
    if (data.request_id) {
      const resultUrl = await pollFalResult(data.request_id);
      return resultUrl || compositeBase64;
    }
    
    if (data.images && data.images[0]?.url) {
      console.log("Refinement complete");
      return data.images[0].url;
    }
    
    return compositeBase64;
  } catch (error) {
    console.error("Error in FLUX dev refinement:", error);
    return compositeBase64;
  }
}

async function pollFalResult(requestId: string): Promise<string | null> {
  const maxAttempts = 60;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const response = await fetch(`https://queue.fal.run/fal-ai/flux/dev/image-to-image/status/${requestId}`, {
        headers: {
          "Authorization": `Key ${FAL_KEY}`,
        },
      });
      
      if (!response.ok) {
        attempts++;
        continue;
      }
      
      const data = await response.json();
      
      if (data.status === "COMPLETED" && data.response?.images?.[0]?.url) {
        return data.response.images[0].url;
      } else if (data.status === "FAILED") {
        console.error("fal.ai refinement failed");
        return null;
      }
    } catch (e) {
      attempts++;
    }
    
    attempts++;
  }
  
  return null;
}

async function generateAiVariant(
  userPhotoBase64: string,
  compositeBase64: string,
  variantIndex: number
): Promise<string | null> {
  if (!BFL_API_KEY) {
    console.error("BFL_API_KEY not configured");
    return null;
  }
  
  try {
    console.log(`Generating AI variant ${variantIndex}...`);
    
    const prompt = GENERATION_CONFIG.HYBRID_AI_VARIANT_PROMPT;
    
    // Note: FLUX.2 Pro API only supports: prompt, input_image*, seed, width, height, safety_tolerance, output_format
    const requestBody = {
      prompt: prompt,
      input_image: userPhotoBase64,
      input_image_2: compositeBase64,
      safety_tolerance: 0,
    };
    
    const submitResponse = await fetch(BFL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": BFL_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(`BFL submission error for variant ${variantIndex}:`, errorText);
      return null;
    }
    
    const submitData = await submitResponse.json();
    const pollingUrl = submitData.polling_url;
    
    if (!pollingUrl) {
      console.error("No polling URL returned");
      return null;
    }
    
    const maxAttempts = 120;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pollResponse = await fetch(pollingUrl, {
        headers: { "x-key": BFL_API_KEY },
      });
      
      if (!pollResponse.ok) {
        attempts++;
        continue;
      }
      
      const result = await pollResponse.json();
      
      if (result.status === "Ready" || result.status === "succeeded") {
        console.log(`AI variant ${variantIndex} generated`);
        return result.result?.sample || null;
      } else if (result.status === "Error" || result.status === "Failed") {
        console.error(`AI variant ${variantIndex} failed`);
        return null;
      }
      
      attempts++;
    }
    
    console.error(`AI variant ${variantIndex} timed out`);
    return null;
  } catch (error) {
    console.error(`Error generating AI variant ${variantIndex}:`, error);
    return null;
  }
}

export async function runHybridPipeline(
  userPhotoUrl: string,
  referenceImageUrl: string
): Promise<HybridResult | null> {
  console.log("=== Starting Hybrid Hair Transfer Pipeline ===");
  
  try {
    console.log("Step 1: Downloading and preprocessing images...");
    const [userBuffer, refBuffer] = await Promise.all([
      downloadImage(userPhotoUrl),
      downloadImage(referenceImageUrl),
    ]);
    
    const [userProcessed, refProcessed] = await Promise.all([
      preprocessImage(userBuffer),
      preprocessImage(refBuffer),
    ]);
    
    console.log("Step 2: Generating hair masks for both images...");
    const [userMaskUrl, refMaskUrl] = await Promise.all([
      generateHairMask(userProcessed.base64),
      generateHairMask(refProcessed.base64),
    ]);
    
    if (!userMaskUrl || !refMaskUrl) {
      console.error("Failed to generate hair masks");
      return null;
    }
    
    const [userMaskBuffer, refMaskBuffer] = await Promise.all([
      downloadImage(userMaskUrl),
      downloadImage(refMaskUrl),
    ]);
    
    const userMaskBase64 = `data:image/png;base64,${userMaskBuffer.toString("base64")}`;
    const refMaskBase64 = `data:image/png;base64,${refMaskBuffer.toString("base64")}`;
    
    console.log("Step 3: Running Python hair blend...");
    const compositeBase64 = await runPythonBlend(
      userProcessed.base64,
      refProcessed.base64,
      userMaskBase64,
      refMaskBase64
    );
    
    if (!compositeBase64) {
      console.error("Python hair blend failed");
      return null;
    }
    
    console.log("Step 4: Refining composite with AI...");
    const refinedComposite = await refineWithFluxDev(
      compositeBase64,
      GENERATION_CONFIG.HYBRID_REFINEMENT_STRENGTH
    );
    
    console.log("Step 5: Generating AI variants from composite...");
    const variantCount = GENERATION_CONFIG.HYBRID_VARIANT_COUNT;
    const variantPromises = [];
    
    for (let i = 0; i < variantCount; i++) {
      variantPromises.push(
        generateAiVariant(userProcessed.base64, refinedComposite || compositeBase64, i + 1)
      );
    }
    
    const aiVariants = await Promise.all(variantPromises);
    const successfulVariants = aiVariants.filter((v): v is string => v !== null);
    
    console.log(`=== Hybrid Pipeline Complete: 1 composite + ${successfulVariants.length} AI variants ===`);
    
    return {
      compositeImageUrl: refinedComposite || compositeBase64,
      aiVariantUrls: successfulVariants,
      compositeData: {
        userMaskUrl: userMaskBase64,
        refMaskUrl: refMaskBase64,
        blendMethod: "opencv_seamless_clone",
      },
    };
  } catch (error) {
    console.error("Error in hybrid pipeline:", error);
    return null;
  }
}

export function isHybridModeEnabled(): boolean {
  return GENERATION_CONFIG.MODE === "HYBRID";
}
