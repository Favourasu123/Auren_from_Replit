import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, Sparkles, Users, Target, CheckCircle2, Zap, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";

import phoneHairstyleTryOn from "@assets/generated_images/phone_showing_male_hairstyle_try-on.png";
import happySalonImage from "@assets/generated_images/happy_client_in_bright_salon.png";
import transformImage from "@assets/generated_images/male_before_after_hair_transformation.png";
import confidentImage from "@assets/generated_images/confident_man_entering_salon.png";
import sharingImage from "@assets/generated_images/client_stylist_phone_sharing.png";

interface OnboardingSlideshowProps {
  onComplete: () => void;
}

interface Slide {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  icon: typeof Sparkles;
  gradient: string;
}

const slides: Slide[] = [
  {
    id: "welcome",
    title: "Get the look you want",
    subtitle: "Auren makes it effortless",
    description: "Discover, preview, and perfect your ideal hairstyle with AI before your appointment.",
    image: phoneHairstyleTryOn,
    icon: Sparkles,
    gradient: "from-purple-600 to-pink-500",
  },
  {
    id: "know-your-look",
    title: "Know your look",
    subtitle: "Show your stylist. Get it done right.",
    description: "Get the exact look you want using AI, and share your vision with your stylist confidently.",
    image: happySalonImage,
    icon: Users,
    gradient: "from-blue-600 to-cyan-500",
  },
  {
    id: "realistic-tryons",
    title: "Realistic Try-ons",
    subtitle: "Find the right cut",
    description: "Preview any hairstyle on your actual face with AI-powered, photorealistic transformations.",
    image: transformImage,
    icon: Zap,
    gradient: "from-orange-500 to-amber-500",
  },
  {
    id: "confidence",
    title: "Choose with confidence",
    subtitle: "Work together with your stylist",
    description: "Browse verified stylists, see their portfolios, and book with transparent pricing.",
    image: confidentImage,
    icon: CheckCircle2,
    gradient: "from-green-500 to-emerald-500",
  },
  {
    id: "business",
    title: "Upgrade your business",
    subtitle: "with Auren",
    description: "AI-powered consultations help clients know what they want. Play to your strengths.",
    image: sharingImage,
    icon: Target,
    gradient: "from-slate-600 to-slate-800",
  },
];

export default function OnboardingSlideshow({ onComplete }: OnboardingSlideshowProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const isLastSlide = currentIndex === slides.length - 1;
  const currentSlide = slides[currentIndex];
  const SlideIcon = currentSlide.icon;

  const handleNext = () => {
    if (isLastSlide) {
      onComplete();
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col" data-testid="onboarding-slideshow">
      <button
        onClick={handleSkip}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        data-testid="button-close-onboarding"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex-1 flex flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlide.id}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col"
          >
            <div className="relative h-[55%] overflow-hidden">
              <img
                src={currentSlide.image}
                alt={currentSlide.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
              
              <div className="absolute top-4 left-4">
                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r ${currentSlide.gradient} text-white text-xs font-medium`}>
                  <SlideIcon className="w-3.5 h-3.5" />
                  <span>{currentIndex + 1} of {slides.length}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 px-6 pt-4 pb-6 flex flex-col">
              <div className="flex-1">
                {/* Combined Beta + Survey Banner - Only on welcome slide */}
                {currentSlide.id === "welcome" && (
                  <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-400/30">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                        <Gift className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-amber-200 font-semibold text-sm">You're a Beta Tester!</p>
                        <p className="text-white/60 text-xs mt-0.5">Complete our quick survey after 2 generations for a chance to win a <span className="font-semibold text-amber-200">$25 gift card</span>. You can also tap the survey icon in the top right anytime.</p>
                      </div>
                    </div>
                  </div>
                )}
                
                <h1 className="text-2xl font-bold text-white mb-1">
                  {currentSlide.title}
                </h1>
                <h2 className={`text-xl font-semibold bg-gradient-to-r ${currentSlide.gradient} bg-clip-text text-transparent mb-3`}>
                  {currentSlide.subtitle}
                </h2>
                <p className="text-white/70 text-base leading-relaxed">
                  {currentSlide.description}
                </p>
              </div>

              <div className="flex items-center gap-2 mb-4 justify-center">
                {slides.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-2 rounded-full transition-all ${
                      idx === currentIndex ? "bg-white w-6" : "bg-white/30 w-2"
                    }`}
                    data-testid={`button-onboarding-dot-${idx}`}
                  />
                ))}
              </div>

              <Button
                onClick={handleNext}
                className={`w-full py-6 text-lg font-semibold bg-gradient-to-r ${currentSlide.gradient} hover:opacity-90 transition-opacity`}
                data-testid="button-onboarding-next"
              >
                {isLastSlide ? "Get Started" : "Next"}
                {!isLastSlide && <ChevronRight className="w-5 h-5 ml-1" />}
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
