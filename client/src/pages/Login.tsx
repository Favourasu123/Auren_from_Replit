import { Button } from "@/components/ui/button";
import { Scissors, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import loginHeroImage from "@assets/stock_images/happy_hairdresser_wi_60443ad3.jpg";

export default function Login() {
  const handleLogin = () => {
    window.location.href = '/api/login';
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Login form */}
      <div className="w-full lg:w-1/2 flex flex-col bg-background">
        {/* Header */}
        <header className="p-4 border-b lg:border-none">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-login">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <Link href="/" className="flex items-center">
              <span className="font-bold text-xl tracking-tight text-black dark:text-white" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>AÜREN</span>
            </Link>
          </div>
        </header>

        {/* Login content */}
        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div 
            className="w-full max-w-sm"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="text-center mb-8">
              <h1 className="font-heading font-bold text-3xl md:text-4xl mb-3">
                Welcome back
              </h1>
              <p className="text-muted-foreground">
                Sign in to try new looks and book appointments
              </p>
            </div>

            <div className="space-y-4">
              <Button
                size="lg"
                className="w-full h-12 text-base"
                onClick={handleLogin}
                data-testid="button-login"
              >
                Sign In with Replit
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    New to Auren?
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                size="lg"
                className="w-full h-12 text-base"
                onClick={handleLogin}
                data-testid="button-signup"
              >
                Create Account
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground mt-8">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>

            <div className="mt-8 pt-6 border-t">
              <p className="text-center text-sm text-muted-foreground mb-3">
                Are you a stylist or barber?
              </p>
              <Link href="/business/signup">
                <Button
                  variant="ghost"
                  className="w-full text-primary hover:text-primary"
                  data-testid="link-business-signup"
                >
                  Sign up your business
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right side - Full page image */}
      <div className="hidden lg:block lg:w-1/2 relative">
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${loginHeroImage})`,
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
        </div>
        
        {/* Overlay content */}
        <div className="absolute bottom-0 left-0 right-0 p-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h2 className="text-white font-heading font-bold text-3xl mb-3">
              Reimagine your hair appointments
            </h2>
            <p className="text-white/80 text-lg max-w-md">
              Reduce miscommunication and focus on enjoying your hair day.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
