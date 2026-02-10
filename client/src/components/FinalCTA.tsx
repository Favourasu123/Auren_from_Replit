import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "wouter";

export default function FinalCTA() {
  return (
    <section id="transformation" className="py-20 relative overflow-hidden bg-white dark:bg-background">
      <div className="max-w-4xl mx-auto px-4 text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8 border border-primary/20">
            <Sparkles className="w-4 h-4" />
            <span>Your transformation starts here</span>
          </div>
          
          <h2 className="font-heading font-bold text-3xl md:text-4xl lg:text-5xl mb-6 text-foreground leading-tight">
            Know What You Want.<br />
            <span className="text-muted-foreground">Show Your Stylist.</span>
          </h2>
          
          <p className="text-lg md:text-xl mb-10 text-muted-foreground max-w-2xl mx-auto">
            Stop hoping your next haircut turns out right. Start <em>knowing</em> it will.
          </p>
          
          <Link href="/upload">
            <Button
              size="lg"
              className="text-base px-8 shadow-xl rounded-full h-14 font-semibold"
              data-testid="button-start-free"
            >
              Try Your First Look Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
          
          <p className="text-sm text-muted-foreground mt-4">
            No credit card required
          </p>
        </motion.div>
      </div>
    </section>
  );
}
