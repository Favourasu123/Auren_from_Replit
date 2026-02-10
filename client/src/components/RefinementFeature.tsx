import { motion } from "framer-motion";
import { MessageCircle, Sparkles, Send, Check, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useState, useEffect } from "react";

const chatExamples = [
  { userMessage: "Make it shorter on the sides", aiResponse: "Tightening up the sides..." },
  { userMessage: "Add more volume on top", aiResponse: "Adding lift and volume..." },
  { userMessage: "Try a warmer blonde tone", aiResponse: "Adjusting to honey-golden..." },
  { userMessage: "Make the layers more defined", aiResponse: "Enhancing layer definition..." },
  { userMessage: "Add subtle highlights", aiResponse: "Adding soft highlights..." },
];

export default function RefinementFeature() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (isHovered) return;
    const timer = setInterval(() => {
      setIsTyping(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % chatExamples.length);
        setIsTyping(false);
      }, 600);
    }, 3500);
    return () => clearInterval(timer);
  }, [isHovered]);

  const currentChat = chatExamples[currentIndex];

  return (
    <section className="py-16 px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background to-muted/20" />
      <div className="absolute top-1/2 right-0 w-[400px] h-[400px] rounded-full bg-muted/30 blur-[100px] -translate-y-1/2" />
      
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          {/* Chat demo */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div className="relative">
              <div className="absolute -inset-4 bg-muted/50 rounded-3xl blur-2xl" />
              
              <div className="relative rounded-2xl overflow-hidden bg-card border shadow-2xl" data-testid="card-refinement-demo">
                {/* Window chrome */}
                <div className="bg-muted/80 p-3 border-b flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                    <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  </div>
                  <span className="text-muted-foreground text-sm ml-2 flex items-center gap-2">
                    <Wand2 className="w-4 h-4" />
                    AI Refinement
                  </span>
                </div>
                
                <div className="p-5 space-y-4">
                  {/* AI greeting */}
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="bg-muted rounded-2xl rounded-tl-none px-4 py-2.5 max-w-[80%]">
                      <p className="text-sm">Here's your look! What would you like to adjust?</p>
                    </div>
                  </div>

                  {/* User message */}
                  <motion.div 
                    key={currentIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-start gap-3 justify-end"
                  >
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-none px-4 py-2.5 max-w-[80%]">
                      <p className="text-sm">{currentChat.userMessage}</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <MessageCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </motion.div>

                  {/* AI response */}
                  <motion.div 
                    key={`response-${currentIndex}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: isTyping ? 0 : 1, y: isTyping ? 10 : 0 }}
                    transition={{ duration: 0.3, delay: 0.15 }}
                    className="flex items-start gap-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="bg-muted rounded-2xl rounded-tl-none px-4 py-2.5 max-w-[80%]">
                      {isTyping ? (
                        <div className="flex gap-1 py-1">
                          <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      ) : (
                        <p className="text-sm flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                          {currentChat.aiResponse}
                        </p>
                      )}
                    </div>
                  </motion.div>

                  {/* Input area */}
                  <div className="pt-3 border-t border-border/50 mt-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full px-4 py-2.5 text-sm text-muted-foreground">
                        Type your refinement...
                      </div>
                      <Button size="icon" className="rounded-full" data-testid="button-send-refinement">
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
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
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border text-sm font-medium mb-4">
              <MessageCircle className="w-4 h-4 text-muted-foreground" />
              <span className="text-foreground">Refine with AI</span>
            </div>
            
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4 leading-tight">
              Not Quite Right?<br />
              <span className="text-foreground">Keep Refining</span>
            </h2>
            
            <p className="text-muted-foreground mb-6 text-lg">
              Just tell the AI what to change. Adjust until you see exactly what you want.
            </p>

            {/* Quick select pills */}
            <div className="flex flex-wrap gap-2 mb-6">
              {chatExamples.map((example, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentIndex(idx)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    idx === currentIndex
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                  data-testid={`button-refinement-${idx}`}
                >
                  {example.userMessage.slice(0, 12)}...
                </button>
              ))}
            </div>

            <Link href="/upload">
              <Button size="lg" className="rounded-full" data-testid="button-try-refinement">
                Start Creating
                <Sparkles className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
