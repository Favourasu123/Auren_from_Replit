import { useState } from "react";
import { motion } from "framer-motion";
import { X, Camera, Sparkles, MessageCircle, Upload, Wand2, Scissors, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";

import happySalonImage from "@assets/generated_images/happy_client_in_bright_salon.png";
import idealPhotoExample from "@assets/generated_images/ideal_photo_example.png";
import FreeTrialGenerator from "./FreeTrialGenerator";

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gradient-to-b from-slate-50 via-white to-slate-100 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <span className="font-bold text-xl tracking-tight text-slate-800" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>
            AÜREN
          </span>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
            data-testid="button-close-help-modal"
          >
            <X className="h-5 w-5 text-slate-600" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="text-center mb-5">
            <h1 className="text-2xl font-bold text-slate-800 mb-1">How-To-Use</h1>
            <p className="text-slate-500 text-sm">Upgrade your hair days with Auren</p>
          </div>

          <div className="space-y-3">
            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-md">
                  <Camera className="h-4 w-4 text-white" />
                </div>
                <h3 className="text-slate-800 font-semibold">1. Upload Your Photo</h3>
              </div>
              <div className="flex gap-3 items-start">
                <img 
                  src={idealPhotoExample} 
                  alt="Ideal photo example" 
                  className="w-20 h-28 object-cover rounded-lg border-2 border-slate-200 shadow-sm"
                />
                <div className="flex-1">
                  <p className="text-slate-500 text-sm mb-2">For best results:</p>
                  <ul className="space-y-1 text-xs text-slate-600">
                    <li className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span> Face the camera directly</li>
                    <li className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span> Good lighting</li>
                    <li className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span> Hair visible</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-md">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <h3 className="text-slate-800 font-semibold">2. Choose Your Style</h3>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col items-center gap-1.5 p-3 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-md">
                    <MessageCircle className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-xs text-slate-700 font-medium text-center">Describe It</span>
                  <span className="text-[10px] text-slate-500 text-center leading-tight">Type your dream look</span>
                </div>
                <div className="flex flex-col items-center gap-1.5 p-3 bg-gradient-to-br from-amber-50 to-orange-100 rounded-xl border border-amber-200">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md">
                    <Upload className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-xs text-slate-700 font-medium text-center">Upload Inspo</span>
                  <span className="text-[10px] text-slate-500 text-center leading-tight">Use a reference photo</span>
                </div>
                <div className="flex flex-col items-center gap-1.5 p-3 bg-gradient-to-br from-pink-50 to-rose-100 rounded-xl border border-pink-200">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center shadow-md">
                    <Wand2 className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-xs text-slate-700 font-medium text-center">AurenIQ</span>
                  <span className="text-[10px] text-slate-500 text-center leading-tight">AI picks for you</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md">
                  <Scissors className="h-4 w-4 text-white" />
                </div>
                <h3 className="text-slate-800 font-semibold">3. Book a Trusted Stylist</h3>
              </div>
              <p className="text-slate-500 text-sm ml-10">Find verified stylists on Auren and bring your new look to life</p>
            </div>
          </div>

          <div className="mt-4 p-3 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md">
                <Gift className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-slate-800 font-medium text-sm">Win a $25 Gift Card!</p>
                <p className="text-slate-500 text-xs">Complete our quick survey for a chance to win</p>
                <p className="text-slate-400 text-xs mt-1 italic">Survey appears after your first generation</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 px-5 py-4 border-t border-slate-200 bg-white/80">
          <Button
            onClick={onClose}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-6"
            data-testid="button-got-it"
          >
            Got it!
          </Button>
          <p className="text-center text-xs text-slate-400 mt-3">
            BETA — Free to use during testing
          </p>
        </div>
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      
      {/* Free Trial Generator - before the header */}
      <FreeTrialGenerator onHelpClick={() => setShowHelp(true)} />

      {/* Smooth transition gradient from generation preview to light section */}
      <div className="h-[20px] md:h-[60px] bg-gradient-to-b from-[#e5eaf1] to-muted/30 dark:from-slate-800 dark:to-background" />

      {/* Section with header and content - "Know your look..." */}
      <section className="py-4 md:py-16 px-4 bg-muted/30 dark:bg-background">
        <div className="max-w-5xl mx-auto">
          {/* Section header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-3 md:mb-8"
          >
            <h2 className="font-heading font-bold text-2xl md:text-3xl lg:text-4xl mb-3">
              Know your look. Show your stylist.{" "}
              <span className="text-accent">Get it done right.</span>
            </h2>
          </motion.div>

          {/* Mobile: Stacked layout (image then text) */}
          <div className="md:hidden">
            {/* Salon image */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-6"
            >
              <div className="rounded-2xl overflow-hidden shadow-xl">
                <img 
                  src={happySalonImage} 
                  alt="Happy client getting their hair styled in a bright modern salon" 
                  className="w-full h-auto object-cover aspect-[16/10]"
                />
              </div>
            </motion.div>

            {/* Subheader */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <p className="text-foreground text-base font-medium leading-relaxed">
                Get the exact look you want using <span className="font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">AI</span>, seamlessly share your vision with your stylist, and walk into every appointment <span className="font-bold underline decoration-accent decoration-wavy decoration-2 underline-offset-4">confident</span> and worry-free.
              </p>
            </motion.div>
          </div>

          {/* Desktop: Side by side layout (text left, image right) */}
          <div className="hidden md:grid md:grid-cols-2 md:gap-8 md:items-center">
            {/* Left: Subheader text */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <p className="text-foreground text-lg lg:text-xl font-medium leading-relaxed">
                Get the exact look you want using <span className="font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">AI</span>, seamlessly share your vision with your stylist, and walk into every appointment <span className="font-bold underline decoration-accent decoration-wavy decoration-2 underline-offset-4">confident</span> and worry-free.
              </p>
            </motion.div>

            {/* Right: Salon image */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="rounded-2xl overflow-hidden shadow-xl">
                <img 
                  src={happySalonImage} 
                  alt="Happy client getting their hair styled in a bright modern salon" 
                  className="w-full h-auto object-cover aspect-[16/10]"
                />
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  );
}
