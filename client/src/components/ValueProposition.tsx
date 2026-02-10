import { motion } from "framer-motion";
import { Sparkles, ArrowRight, Eye, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

import beforeAfterImage from "@assets/generated_images/white_woman_hair_transformation.png";
import happySalonImage from "@assets/stock_images/happy_woman_at_hair__636abcab.jpg";

export default function ValueProposition() {
  return (
    <section className="py-16 px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background to-muted/20" />
      <div className="absolute top-0 left-1/4 w-[400px] h-[400px] rounded-full bg-accent/5 blur-[100px]" />
      
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          {/* Image side - Two images stacked */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="order-2 lg:order-1"
          >
            <div className="relative space-y-4">
              <div className="absolute -inset-4 bg-accent/10 rounded-3xl blur-2xl" />
              
              {/* Happy salon experience image */}
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border">
                <img 
                  src={happySalonImage} 
                  alt="Happy client at salon" 
                  className="w-full aspect-[16/9] object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                
                <div className="absolute bottom-4 left-4 right-4">
                  <p className="text-white font-medium text-lg">Walk in confident, walk out happy</p>
                  <p className="text-white/80 text-sm">Real results, every time</p>
                </div>
              </div>
              
              {/* AI transformation preview */}
              <div className="relative rounded-2xl overflow-hidden shadow-xl border">
                <img 
                  src={beforeAfterImage} 
                  alt="AI hair transformation preview" 
                  className="w-full aspect-[4/3] object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                
                <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/20 text-white text-xs font-medium flex items-center gap-2">
                  <Sparkles className="w-3 h-3 text-accent" />
                  Instant Preview
                </div>
                
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary text-primary-foreground">
                      Same Face
                    </span>
                    <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/20">
                      New Style
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Text side */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="order-1 lg:order-2"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-sm font-medium mb-4">
              <Sparkles className="w-4 h-4 text-accent" />
              <span className="text-accent">AI-Powered</span>
            </div>
            
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4 leading-tight">
              A Picture Is Worth<br />
              <span className="text-accent">A Thousand Words</span>
            </h2>
            
            <p className="text-muted-foreground mb-6 text-lg">
              Give your stylist a photo of exactly what you want on <em>your</em> face—no more guessing.
            </p>

            {/* Benefit cards */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="p-4 rounded-xl bg-muted/50 border">
                <Eye className="w-5 h-5 text-accent mb-2" />
                <p className="font-semibold text-sm mb-1">For You</p>
                <p className="text-xs text-muted-foreground">
                  See what actually suits you
                </p>
              </div>
              <div className="p-4 rounded-xl bg-muted/50 border">
                <Users className="w-5 h-5 text-accent mb-2" />
                <p className="font-semibold text-sm mb-1">For Your Stylist</p>
                <p className="text-xs text-muted-foreground">
                  Crystal clear expectations
                </p>
              </div>
            </div>

            <Link href="/upload">
              <Button size="lg" className="rounded-full" data-testid="button-try-now">
                Try It Now
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
