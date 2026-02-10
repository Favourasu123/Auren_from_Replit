import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, Sparkles, Quote } from "lucide-react";

import hispanicManQuiff from "@assets/generated_images/hispanic_man_quiff_hair_transformation.png";
import blackManFade from "@assets/generated_images/black_man_fade_haircut_transformation.png";

export default function FounderStory() {
  return (
    <section className="py-16 px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-muted/20 to-background" />
      <div className="absolute top-1/2 left-0 w-[300px] h-[300px] rounded-full bg-muted/30 blur-[100px] -translate-y-1/2" />
      
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          {/* Left: Visual element - Transformation cards */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative order-2 lg:order-1"
          >
            <div className="relative">
              {/* Stacked cards effect */}
              <div className="relative">
                {/* Back card - rotated */}
                <div className="absolute -rotate-6 left-4 top-4 w-[85%]">
                  <div className="rounded-2xl overflow-hidden border shadow-xl">
                    <img 
                      src={blackManFade} 
                      alt="Transformation example" 
                      className="w-full aspect-[4/3] object-cover opacity-60"
                    />
                  </div>
                </div>
                
                {/* Front card */}
                <div className="relative rounded-2xl overflow-hidden border-2 border-border shadow-2xl">
                  <img 
                    src={hispanicManQuiff} 
                    alt="My transformation" 
                    className="w-full aspect-[4/3] object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4">
                    <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary text-primary-foreground">
                      Finally, the right cut
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: Story content - compact */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="order-1 lg:order-2"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border text-sm font-medium mb-4">
              <Quote className="w-4 h-4 text-muted-foreground" />
              <span className="text-foreground">The Story</span>
            </div>
            
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4">
              A Problem I Knew<br />
              <span className="text-foreground">All Too Well</span>
            </h2>

            <div className="space-y-4 text-muted-foreground">
              <p>
                <strong className="text-foreground">I never really knew what haircut I wanted</strong>—and when I tried to explain it, the words always came out wrong.
              </p>
              
              <p>
                I'd show a picture that didn't look like me, use the wrong name for the style, or assume they understood. <strong className="text-foreground">But they didn't—and the results showed it.</strong>
              </p>
              
              <p>
                <strong className="text-foreground">So I decided to build it.</strong> A way to see it on yourself first. A way to walk into that chair knowing—not hoping—you'll love what you see.
              </p>
            </div>

            {/* Highlight box */}
            <div className="mt-6 p-4 rounded-xl bg-muted border">
              <p className="text-lg md:text-xl font-heading font-bold text-foreground">
                No more bad hair days—just better choices.
              </p>
            </div>

            <Link href="/upload">
              <Button size="lg" className="mt-6 rounded-full" data-testid="button-start-journey">
                <Sparkles className="mr-2 h-5 w-5" />
                Start Your Journey
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
