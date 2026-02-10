import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useState, useEffect } from "react";

import celebrityLookTransform from "@assets/generated_images/celebrity_look_copy_transformation.png";
import kpopLookTransform from "@assets/generated_images/k-pop_look_copy_transformation.png";
import redCarpetTransform from "@assets/generated_images/red_carpet_look_transformation.png";
import blackWomanNatural from "@assets/generated_images/black_woman_natural_hair_transformation.png";
import whiteWomanBalayage from "@assets/generated_images/white_woman_balayage_color_transformation.png";
import asianWomanColor from "@assets/generated_images/asian_woman_color_transformation.png";

const inspirationLooks = [
  { src: celebrityLookTransform, label: "Celebrity Style" },
  { src: kpopLookTransform, label: "K-Pop Hair" },
  { src: redCarpetTransform, label: "Red Carpet" },
  { src: blackWomanNatural, label: "Natural Curls" },
  { src: whiteWomanBalayage, label: "Balayage" },
  { src: asianWomanColor, label: "Color Pop" },
];

export default function InspirationFeature() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (isHovered) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % inspirationLooks.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [isHovered]);

  const currentLook = inspirationLooks[currentIndex];

  return (
    <section className="py-16 px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-muted/20 to-background" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-muted/30 blur-[100px]" />
      
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          {/* Text side */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border text-sm font-medium mb-4">
              <Image className="w-4 h-4 text-muted-foreground" />
              <span className="text-foreground">Try a Look</span>
            </div>
            
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4 leading-tight">
              See a Style You Love?<br />
              <span className="text-foreground">Try It First</span>
            </h2>
            
            <p className="text-muted-foreground mb-6 text-lg">
              Upload any inspiration—celebrity, influencer, or friend—and see exactly how it looks on you.
            </p>

            {/* Quick select pills */}
            <div className="flex flex-wrap gap-2 mb-6">
              {inspirationLooks.map((look, idx) => (
                <button
                  key={look.label}
                  onClick={() => setCurrentIndex(idx)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    idx === currentIndex
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                  data-testid={`button-look-${idx}`}
                >
                  {look.label}
                </button>
              ))}
            </div>

            <Link href="/upload?tab=inspiration">
              <Button size="lg" className="rounded-full" data-testid="button-try-inspiration">
                Upload Inspiration
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </motion.div>

          {/* Image side */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div className="relative">
              <div className="absolute -inset-4 bg-muted/50 rounded-3xl blur-2xl" />
              
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border">
                <motion.img 
                  key={currentIndex}
                  src={currentLook.src}
                  alt={`${currentLook.label} transformation`}
                  className="w-full aspect-[4/3] object-cover"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  data-testid="img-inspiration-demo"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                
                <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/20 text-white text-xs font-medium flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  Style Transfer
                </div>
                
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <span className="px-4 py-2 rounded-full text-sm font-medium bg-primary text-primary-foreground">
                    {currentLook.label}
                  </span>
                  <div className="flex items-center gap-2 text-white text-sm bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                    <span className="opacity-70">Inspo</span>
                    <ArrowRight className="w-3 h-3" />
                    <span className="font-medium">You</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
