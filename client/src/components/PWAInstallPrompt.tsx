import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWA } from "@/hooks/use-pwa";
import aurenLogo from "@/assets/images/auren-logo.png";

const INSTALL_PROMPT_SHOWN_KEY = "auren_install_prompt_shown";

export function PWAInstallPrompt() {
  const [isOpen, setIsOpen] = useState(false);
  const { isInstallable, isInstalled, installApp } = usePWA();

  useEffect(() => {
    const hasShownPrompt = localStorage.getItem(INSTALL_PROMPT_SHOWN_KEY);
    
    if (!hasShownPrompt && !isInstalled) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isInstalled]);

  const handleInstall = async () => {
    localStorage.setItem(INSTALL_PROMPT_SHOWN_KEY, "true");
    if (isInstallable) {
      const installed = await installApp();
      if (installed) {
        setIsOpen(false);
      }
    }
    setIsOpen(false);
  };

  const handleContinueWeb = () => {
    localStorage.setItem(INSTALL_PROMPT_SHOWN_KEY, "true");
    setIsOpen(false);
  };

  const handleClose = () => {
    localStorage.setItem(INSTALL_PROMPT_SHOWN_KEY, "true");
    setIsOpen(false);
  };

  if (isInstalled) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="w-[calc(100%-2rem)] max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative p-6 text-center">
              <button
                onClick={handleClose}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                data-testid="button-close-install-prompt"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>

              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 rounded-2xl shadow-lg overflow-hidden bg-gradient-to-br from-slate-900 to-slate-700 p-2">
                  <img 
                    src={aurenLogo} 
                    alt="Auren" 
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>

              <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">
                Welcome to Auren
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                Get the best experience with our app
              </p>

              <div className="space-y-3">
                {isInstallable ? (
                  <Button
                    onClick={handleInstall}
                    className="w-full h-12 rounded-xl font-semibold bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white gap-2"
                    data-testid="button-install-app"
                  >
                    <Download className="h-5 w-5" />
                    Install App
                  </Button>
                ) : (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                    <p className="text-slate-500 dark:text-slate-400 text-xs">
                      To install, use your browser's "Add to Home Screen" option
                    </p>
                  </div>
                )}

                <Button
                  onClick={handleContinueWeb}
                  variant="outline"
                  className="w-full h-12 rounded-xl font-semibold border-slate-200 dark:border-slate-700 gap-2"
                  data-testid="button-continue-web"
                >
                  <Globe className="h-5 w-5" />
                  Continue on Web
                </Button>
              </div>

              <p className="text-xs text-slate-400 mt-4">
                You can always install later from the menu
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
