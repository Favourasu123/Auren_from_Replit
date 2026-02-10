import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Scissors, Wand2, Stars, Camera, Zap } from "lucide-react";

const GENERATION_START_TIMES_KEY = "auren_generation_start_times";

// Helper to get stored start times from localStorage
function getStoredStartTimes(): Record<string, number> {
  try {
    const stored = localStorage.getItem(GENERATION_START_TIMES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

// Helper to store a start time for a variant
function storeStartTime(variantId: string, startTime: number) {
  try {
    const times = getStoredStartTimes();
    times[variantId] = startTime;
    // Clean up old entries (keep only last 20)
    const entries = Object.entries(times);
    if (entries.length > 20) {
      const sorted = entries.sort((a, b) => b[1] - a[1]);
      const cleaned = Object.fromEntries(sorted.slice(0, 20));
      localStorage.setItem(GENERATION_START_TIMES_KEY, JSON.stringify(cleaned));
    } else {
      localStorage.setItem(GENERATION_START_TIMES_KEY, JSON.stringify(times));
    }
  } catch {
    // Ignore storage errors
  }
}

// Helper to get a stored start time for a variant
function getStoredStartTime(variantId: string): number | null {
  const times = getStoredStartTimes();
  return times[variantId] || null;
}

const CombIcon = ({ className }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="currentColor"
    className={className}
  >
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <rect x="4" y="8" width="2.5" height="13" rx="0.5" />
    <rect x="8" y="8" width="2.5" height="11" rx="0.5" />
    <rect x="12" y="8" width="2.5" height="13" rx="0.5" />
    <rect x="16" y="8" width="2.5" height="11" rx="0.5" />
  </svg>
);

const GENERATION_STAGES = [
  { id: "analyzing", label: "Analyzing your photo", icon: Camera, duration: 8 },
  { id: "searching", label: "Finding the perfect style", icon: CombIcon, duration: 12 },
  { id: "creating", label: "Creating your new look", icon: Wand2, duration: 25 },
  { id: "refining", label: "Adding final touches", icon: Stars, duration: 10 },
];

const FUN_FACTS = [
  "The average person has about 100,000 hair follicles on their head",
  "Hair is the second-fastest growing tissue in the body",
  "Your hair grows about half an inch per month",
  "Red is the rarest natural hair color, found in only 1-2% of people",
  "A single strand of hair can support up to 100 grams of weight",
  "Hair contains information about everything in your bloodstream",
  "Cutting your hair doesn't make it grow faster - that's a myth!",
  "Your hair is made of the same protein as your fingernails",
  "Blonde hair is the finest, while black hair is the coarsest",
  "The lifespan of a single hair strand is about 5 years",
];

const ENCOURAGING_MESSAGES = [
  "Your new look is almost ready...",
  "Great choice! This style will look amazing...",
  "AI magic in progress...",
  "Crafting your personalized transformation...",
  "Almost there! Perfecting the details...",
];

interface GenerationProgressProps {
  startTime?: number;
  estimatedDuration?: number;
  variantId?: string;
}

export function GenerationProgress({ 
  startTime: propStartTime, 
  estimatedDuration = 90000,
  variantId
}: GenerationProgressProps) {
  // Use a stable start time that persists across navigation
  // Priority: 1) localStorage (if same variant), 2) propStartTime from server, 3) Date.now()
  const startTime = useMemo(() => {
    // If we have a variantId, check localStorage first
    if (variantId) {
      const stored = getStoredStartTime(variantId);
      if (stored) {
        return stored;
      }
    }
    
    // Use the prop start time from server (createdAt timestamp)
    const serverTime = propStartTime || Date.now();
    
    // Store it for future navigation back to this page
    if (variantId) {
      storeStartTime(variantId, serverTime);
    }
    
    return serverTime;
  }, [variantId, propStartTime]);
  
  const [progress, setProgress] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [currentFact, setCurrentFact] = useState(() => 
    FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)]
  );
  const [currentMessage, setCurrentMessage] = useState(() =>
    ENCOURAGING_MESSAGES[0]
  );

  useEffect(() => {
    const updateProgress = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      setElapsedTime(elapsed);
      const newProgress = Math.min((elapsed / estimatedDuration) * 100, 95);
      setProgress(newProgress);

      let cumulativeTime = 0;
      for (let i = 0; i < GENERATION_STAGES.length; i++) {
        cumulativeTime += (GENERATION_STAGES[i].duration / 55) * 100;
        if (newProgress < cumulativeTime) {
          setCurrentStageIndex(i);
          break;
        }
      }
    };

    updateProgress();
    const progressInterval = setInterval(updateProgress, 50);
    return () => clearInterval(progressInterval);
  }, [startTime, estimatedDuration]);

  useEffect(() => {
    const factInterval = setInterval(() => {
      setCurrentFact(prev => {
        const currentIndex = FUN_FACTS.indexOf(prev);
        const nextIndex = (currentIndex + 1) % FUN_FACTS.length;
        return FUN_FACTS[nextIndex];
      });
    }, 6000);

    return () => clearInterval(factInterval);
  }, []);

  useEffect(() => {
    const messageInterval = setInterval(() => {
      setCurrentMessage(prev => {
        const currentIndex = ENCOURAGING_MESSAGES.indexOf(prev);
        const nextIndex = (currentIndex + 1) % ENCOURAGING_MESSAGES.length;
        return ENCOURAGING_MESSAGES[nextIndex];
      });
    }, 4000);

    return () => clearInterval(messageInterval);
  }, []);

  const currentStage = GENERATION_STAGES[currentStageIndex];
  const StageIcon = currentStage.icon;

  const remainingSeconds = Math.max(0, Math.ceil((estimatedDuration - elapsedTime) / 1000));

  return (
    <motion.div 
      className="flex flex-col items-center justify-center py-8 px-4 w-full max-w-md mx-auto"
      style={{ minHeight: '520px' }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      data-testid="generation-progress"
    >
      <div className="relative mb-8 h-24 w-24 flex-shrink-0">
        <motion.div
          className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-600 to-blue-900 flex items-center justify-center shadow-lg"
          animate={{ 
            boxShadow: [
              "0 0 20px rgba(59, 130, 246, 0.3)",
              "0 0 40px rgba(59, 130, 246, 0.5)",
              "0 0 20px rgba(59, 130, 246, 0.3)"
            ]
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 rounded-full border-2 border-blue-400/30 border-t-blue-400"
          />
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStage.id}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <StageIcon className="h-10 w-10 text-white" />
            </motion.div>
          </AnimatePresence>
        </motion.div>
        
        <motion.div
          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <Sparkles className="h-3 w-3 text-yellow-900" />
        </motion.div>
      </div>

      <div className="h-8 flex items-center justify-center mb-2">
        <AnimatePresence mode="wait">
          <motion.h3
            key={currentStage.id}
            className="font-heading font-semibold text-xl text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            data-testid="text-current-stage"
          >
            {currentStage.label}
          </motion.h3>
        </AnimatePresence>
      </div>

      <div className="h-6 flex items-center justify-center mb-6">
        <AnimatePresence mode="wait">
          <motion.p
            key={currentMessage}
            className="text-muted-foreground text-sm text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {currentMessage}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="w-full max-w-sm mb-4 flex-shrink-0">
        <div className="relative h-5 bg-muted rounded-full" data-testid="progress-bar">
          <div 
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-blue-500 rounded-full transition-all duration-100 ease-linear"
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 z-20 pointer-events-none"
            style={{ 
              left: `${Math.max(progress, 2)}%`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <motion.div
              animate={{ 
                rotate: [0, -20, 0, 20, 0],
              }}
              transition={{ 
                duration: 0.6, 
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="w-7 h-7 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-blue-600"
            >
              <Scissors className="h-4 w-4 text-blue-600" />
            </motion.div>
          </div>
        </div>
        <div className="flex justify-between mt-3 text-sm font-medium">
          <span className="text-blue-600 dark:text-blue-400 tabular-nums">
            {Math.round(progress)}%
          </span>
          <span className="text-muted-foreground tabular-nums">
            ~{remainingSeconds}s remaining
          </span>
        </div>
      </div>

      <div className="flex justify-center gap-3 mb-6 flex-shrink-0">
        {GENERATION_STAGES.map((stage, index) => {
          const isCompleted = index < currentStageIndex;
          const isCurrent = index === currentStageIndex;
          const Icon = stage.icon;
          
          return (
            <motion.div
              key={stage.id}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isCompleted 
                  ? "bg-green-500 text-white" 
                  : isCurrent 
                    ? "bg-blue-900 text-white" 
                    : "bg-muted text-muted-foreground"
              }`}
              animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 1, repeat: isCurrent ? Infinity : 0 }}
              data-testid={`stage-indicator-${stage.id}`}
            >
              <Icon className="h-4 w-4" />
            </motion.div>
          );
        })}
      </div>

      <motion.div 
        className="bg-muted/50 rounded-xl p-4 w-full max-w-sm text-center border border-border flex-shrink-0"
        style={{ minHeight: '100px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <div className="flex items-center justify-center gap-2 mb-2">
          <Zap className="h-4 w-4 text-yellow-500" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Did you know?</span>
        </div>
        <div className="h-12 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={currentFact}
              className="text-sm text-foreground"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.4 }}
              data-testid="text-fun-fact"
            >
              {currentFact}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
