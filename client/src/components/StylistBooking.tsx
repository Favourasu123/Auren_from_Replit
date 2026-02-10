import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, MapPin, Star, Check, Send, Calendar, Sparkles } from "lucide-react";

import whiteWomanBalayage from "@assets/generated_images/white_woman_balayage_color_transformation.png";
import stylistImage from "@assets/stock_images/professional_hairsty_22a97611.jpg";

export default function StylistBooking() {
  return (
    <section className="py-16 px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-muted/30 to-background" />
      
      <div className="max-w-5xl mx-auto relative z-10">
        <motion.div 
          className="text-center mb-10"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="font-heading text-3xl md:text-4xl font-bold mb-3">
            From Vision to <span className="text-foreground">Reality</span>
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Your stylist sees exactly what you want—no guessing.
          </p>
        </motion.div>

        {/* Timeline/Journey visualization */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative"
        >
          {/* Horizontal timeline line (desktop) */}
          <div className="hidden md:block absolute top-[60px] left-[15%] right-[15%] h-0.5 bg-border z-0">
            <motion.div 
              className="h-full bg-primary"
              initial={{ width: "0%" }}
              whileInView={{ width: "100%" }}
              viewport={{ once: true }}
              transition={{ duration: 1.5, delay: 0.3 }}
            />
          </div>

          <div className="grid md:grid-cols-4 gap-6 relative z-10">
            {/* Step 1: Create Look */}
            <motion.div 
              className="flex flex-col items-center text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
            >
              <div className="w-[120px] h-[120px] rounded-xl overflow-hidden border-2 border-primary shadow-lg mb-4 relative">
                <img src={whiteWomanBalayage} alt="AI generated look" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <div className="absolute bottom-2 left-2 right-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary text-primary-foreground">
                    Your Look
                  </span>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold mb-2">
                1
              </div>
              <p className="font-medium text-sm">Create Your Look</p>
              <p className="text-xs text-muted-foreground">AI generates your perfect style</p>
            </motion.div>

            {/* Step 2: Choose Stylist */}
            <motion.div 
              className="flex flex-col items-center text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
            >
              <div className="w-[120px] h-[120px] rounded-xl overflow-hidden border shadow-lg mb-4 relative bg-card">
                <img src={stylistImage} alt="Stylist" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                  <div className="flex">
                    {[1,2,3,4,5].map(i => (
                      <Star key={i} className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <div className="flex items-center gap-0.5 text-white text-[10px]">
                    <MapPin className="w-2.5 h-2.5" />
                    2mi
                  </div>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold mb-2">
                2
              </div>
              <p className="font-medium text-sm">Find Your Stylist</p>
              <p className="text-xs text-muted-foreground">Browse local pros</p>
            </motion.div>

            {/* Step 3: Send Request */}
            <motion.div 
              className="flex flex-col items-center text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5 }}
            >
              <div className="w-[120px] h-[120px] rounded-xl border shadow-lg mb-4 relative bg-card flex flex-col items-center justify-center p-3">
                <div className="w-12 h-12 rounded-lg overflow-hidden border mb-2">
                  <img src={whiteWomanBalayage} alt="Attached look" className="w-full h-full object-cover" />
                </div>
                <div className="flex items-center gap-1 text-primary">
                  <Send className="w-4 h-4" />
                  <span className="text-xs font-medium">Sending...</span>
                </div>
                <motion.div
                  className="absolute -right-2 -top-2 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  <Sparkles className="w-3 h-3" />
                </motion.div>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold mb-2">
                3
              </div>
              <p className="font-medium text-sm">Share Your Vision</p>
              <p className="text-xs text-muted-foreground">Send look + notes</p>
            </motion.div>

            {/* Step 4: Confirmed */}
            <motion.div 
              className="flex flex-col items-center text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.7 }}
            >
              <div className="w-[120px] h-[120px] rounded-xl border shadow-lg mb-4 relative bg-card flex flex-col items-center justify-center p-3">
                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center mb-2">
                  <Check className="w-5 h-5 text-green-500" />
                </div>
                <p className="text-xs font-medium">Appointment Set</p>
                <div className="flex items-center gap-1 text-muted-foreground mt-1">
                  <Calendar className="w-3 h-3" />
                  <span className="text-[10px]">Dec 15, 2pm</span>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-bold mb-2">
                <Check className="w-4 h-4" />
              </div>
              <p className="font-medium text-sm">Book & Go</p>
              <p className="text-xs text-muted-foreground">Walk in confident</p>
            </motion.div>
          </div>

          {/* CTA */}
          <div className="flex justify-center mt-10">
            <Link href="/stylists">
              <Button size="lg" className="rounded-full" data-testid="button-find-stylists-booking">
                Find Stylists Near You
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
