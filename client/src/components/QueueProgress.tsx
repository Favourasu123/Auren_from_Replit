import { motion } from "framer-motion";
import { Clock, Users } from "lucide-react";

interface QueueProgressProps {
  position: number;
  totalInQueue: number;
  estimatedWaitSeconds: number;
}

export function QueueProgress({ 
  position, 
  totalInQueue, 
  estimatedWaitSeconds 
}: QueueProgressProps) {
  const formatWaitTime = (seconds: number) => {
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  };

  return (
    <motion.div 
      className="flex flex-col items-center justify-center py-8 px-4 w-full max-w-md mx-auto"
      style={{ minHeight: '400px' }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      data-testid="queue-progress"
    >
      <div className="relative mb-8 h-24 w-24 flex-shrink-0">
        <motion.div
          className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg"
          animate={{ 
            boxShadow: [
              "0 0 20px rgba(245, 158, 11, 0.3)",
              "0 0 40px rgba(245, 158, 11, 0.5)",
              "0 0 20px rgba(245, 158, 11, 0.3)"
            ]
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Users className="h-10 w-10 text-white" />
          </motion.div>
        </motion.div>
      </div>

      <h3 className="font-heading font-semibold text-xl text-center mb-2" data-testid="text-queue-title">
        You're in the queue
      </h3>
      
      <p className="text-muted-foreground text-sm text-center mb-6">
        Another generation is in progress. Your turn is coming up!
      </p>

      <div className="bg-card border rounded-xl p-6 w-full max-w-sm mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-foreground">
            <Users className="h-5 w-5 text-amber-500" />
            <span className="font-medium">Position in queue</span>
          </div>
          <span className="text-2xl font-bold text-amber-500" data-testid="text-queue-position">
            #{position}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Estimated wait</span>
          </div>
          <span className="text-lg text-muted-foreground" data-testid="text-wait-time">
            ~{formatWaitTime(estimatedWaitSeconds)}
          </span>
        </div>
      </div>

      <div className="flex gap-2 items-center justify-center">
        {[...Array(Math.min(totalInQueue, 5))].map((_, i) => (
          <motion.div
            key={i}
            className={`w-3 h-3 rounded-full ${
              i < position ? 'bg-amber-500' : 'bg-muted'
            }`}
            animate={i === position - 1 ? { scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 1, repeat: Infinity }}
          />
        ))}
        {totalInQueue > 5 && (
          <span className="text-xs text-muted-foreground ml-1">+{totalInQueue - 5}</span>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center mt-6">
        We're processing one at a time to ensure the best quality results.
        <br />
        Your generation will start automatically when it's your turn.
      </p>
    </motion.div>
  );
}
