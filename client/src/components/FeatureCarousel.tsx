import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Sparkles, Image, MessageCircle, ChevronLeft, ChevronRight, Zap, Users, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

import transformImage from "@assets/generated_images/male_before_after_hair_transformation.png";
import styleTransferImage from "@assets/generated_images/colorful_celebrity_style_copy.png";
import refinementImage from "@assets/generated_images/male_chat_hairstyle_refinement.png";
import confidentImage from "@assets/generated_images/confident_man_entering_salon.png";
import sharingImage from "@assets/generated_images/client_stylist_phone_sharing.png";

interface FeaturePanel {
  id: string;
  badge: { icon: typeof Sparkles; text: string };
  title: string;
  description: string;
  image: string;
  imageAlt: string;
}

const panels: FeaturePanel[] = [
  {
    id: "visualize",
    badge: { icon: Sparkles, text: "AI-Powered" },
    title: "Realistic Tryons Help You Find the Right Cut",
    description: "Preview any hairstyle on your actual face.",
    image: transformImage,
    imageAlt: "AI hairstyle transformation",
  },
  {
    id: "inspiration",
    badge: { icon: Image, text: "Style Transfer" },
    title: "Copy Any Look",
    description: "Upload any inspiration and try it on.",
    image: styleTransferImage,
    imageAlt: "Celebrity style transfer",
  },
  {
    id: "refine",
    badge: { icon: MessageCircle, text: "AI Chat" },
    title: "Refine Until Perfect",
    description: "Tell the AI what to adjust.",
    image: refinementImage,
    imageAlt: "AI refinement",
  },
  {
    id: "confident",
    badge: { icon: Zap, text: "Confidence" },
    title: "Walk In Confident",
    description: "Know exactly what you want before your appointment.",
    image: confidentImage,
    imageAlt: "Walking into salon confident",
  },
  {
    id: "share",
    badge: { icon: Users, text: "Collaborate" },
    title: "Team Up With Your Stylist",
    description: "Collaborate to get your best look together.",
    image: sharingImage,
    imageAlt: "Client and stylist collaborating",
  },
];

export default function FeatureCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      setActiveIndex((prev) => (prev + 1) % panels.length);
    } else if (isRightSwipe) {
      setActiveIndex((prev) => (prev - 1 + panels.length) % panels.length);
    }
    setTouchStart(null);
    setTouchEnd(null);
  };

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % panels.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [isPaused]);

  const goToPrev = () => {
    setActiveIndex((prev) => (prev - 1 + panels.length) % panels.length);
  };

  const goToNext = () => {
    setActiveIndex((prev) => (prev + 1) % panels.length);
  };

  const getOrderedPanels = () => {
    const left = (activeIndex - 1 + panels.length) % panels.length;
    const center = activeIndex;
    const right = (activeIndex + 1) % panels.length;
    return [
      { panel: panels[left], position: "left" },
      { panel: panels[center], position: "center" },
      { panel: panels[right], position: "right" },
    ];
  };

  const orderedPanels = getOrderedPanels();

  return (
    <section 
      className="py-6 md:py-16 px-4 bg-slate-900 dark:bg-slate-950"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="max-w-7xl mx-auto">
        {/* Mobile: Full-width single card view */}
        <div 
          className="md:hidden"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex items-center justify-between gap-2 mb-4">
            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full bg-white/10 border-white/20 text-white hover:bg-white/20"
              onClick={goToPrev}
              data-testid="button-carousel-prev"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            
            <div className="flex gap-2">
              {panels.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`h-2 rounded-full transition-all ${
                    idx === activeIndex ? "bg-white w-6" : "bg-white/30 w-2"
                  }`}
                  data-testid={`button-carousel-dot-${idx}`}
                />
              ))}
            </div>

            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full bg-white/10 border-white/20 text-white hover:bg-white/20"
              onClick={goToNext}
              data-testid="button-carousel-next-mobile"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          <motion.div
            key={panels[activeIndex].id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-2xl overflow-hidden bg-white/5 border border-white/10"
          >
            <div className="relative">
              <img 
                src={panels[activeIndex].image}
                alt={panels[activeIndex].imageAlt}
                className="w-full aspect-[4/3] object-cover"
              />
              <div className="absolute top-3 left-3">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/20 text-xs font-medium text-white">
                  {(() => {
                    const BadgeIcon = panels[activeIndex].badge.icon;
                    return <BadgeIcon className="w-3 h-3" />;
                  })()}
                  <span>{panels[activeIndex].badge.text}</span>
                </div>
              </div>
            </div>
            
            <div className="p-5">
              <h3 className="font-heading text-lg font-bold text-white mb-2">
                {panels[activeIndex].title}
              </h3>
              <p className="text-white/70 text-base">
                {panels[activeIndex].description}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Desktop: 3-card carousel view */}
        <div className="hidden md:block">
          <div className="relative flex items-center justify-center gap-6">
            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full flex-shrink-0 bg-white/10 border-white/20 text-white hover:bg-white/20 z-10"
              onClick={goToPrev}
              data-testid="button-carousel-prev-desktop"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <div className="flex-1 flex items-center justify-center gap-8 py-4">
              {orderedPanels.map(({ panel, position }, idx) => {
                const isCenter = position === "center";
                const BadgeIcon = panel.badge.icon;
                
                return (
                  <motion.div
                    key={`${position}-${panel.id}`}
                    className={`flex-shrink-0 rounded-2xl overflow-hidden bg-white/5 border border-white/10 backdrop-blur-sm ${
                      isCenter ? "z-10" : "z-0 opacity-50"
                    }`}
                    initial={false}
                    animate={{
                      scale: isCenter ? 1 : 0.85,
                      opacity: isCenter ? 1 : 0.4,
                    }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    onClick={() => !isCenter && setActiveIndex(panels.indexOf(panel))}
                    style={{
                      width: isCenter ? "380px" : "280px",
                      cursor: isCenter ? "default" : "pointer",
                    }}
                  >
                    <div className="relative">
                      <img 
                        src={panel.image}
                        alt={panel.imageAlt}
                        className="w-full aspect-[4/3] object-cover"
                      />
                      <div className="absolute top-3 left-3">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/20 text-xs font-medium text-white">
                          <BadgeIcon className="w-3 h-3" />
                          <span>{panel.badge.text}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-5">
                      <h3 className="font-heading text-lg font-bold text-white mb-1.5">
                        {panel.title}
                      </h3>
                      <p className="text-white/60 text-sm">
                        {panel.description}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full flex-shrink-0 bg-white/10 border-white/20 text-white hover:bg-white/20 z-10"
              onClick={goToNext}
              data-testid="button-carousel-next-desktop"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex justify-center gap-2 mt-6">
            {panels.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveIndex(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === activeIndex ? "bg-white w-8" : "bg-white/30 w-2"
                }`}
                data-testid={`button-carousel-dot-desktop-${idx}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
