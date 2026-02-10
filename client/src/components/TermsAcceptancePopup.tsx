import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const TERMS_ACCEPTED_KEY = "auren_terms_accepted";
const AI_INSTRUCTIONS_STORAGE_KEY = "auren_ai_instructions_hidden";
const INTRO_DISMISSED_SESSION_KEY = "auren_intro_dismissed_session";

export function TermsAcceptancePopup() {
  const [showPopup, setShowPopup] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    // Check if terms already accepted
    const hasAccepted = localStorage.getItem(TERMS_ACCEPTED_KEY) === "true";
    if (hasAccepted) {
      setShowPopup(false);
      return;
    }
    
    // Check if intro was dismissed (either permanently or this session)
    const introPermanentlyHidden = localStorage.getItem(AI_INSTRUCTIONS_STORAGE_KEY) === "true";
    const introSessionDismissed = sessionStorage.getItem(INTRO_DISMISSED_SESSION_KEY) === "true";
    
    if (introPermanentlyHidden || introSessionDismissed) {
      setShowPopup(true);
    } else {
      // Set up a listener to show terms when intro is dismissed
      const checkIntro = setInterval(() => {
        const permanentHidden = localStorage.getItem(AI_INSTRUCTIONS_STORAGE_KEY) === "true";
        const sessionDismissed = sessionStorage.getItem(INTRO_DISMISSED_SESSION_KEY) === "true";
        if (permanentHidden || sessionDismissed) {
          setShowPopup(true);
          clearInterval(checkIntro);
        }
      }, 300);
      return () => clearInterval(checkIntro);
    }
  }, []);

  const handleAccept = () => {
    if (accepted) {
      localStorage.setItem(TERMS_ACCEPTED_KEY, "true");
      setShowPopup(false);
    }
  };

  if (!showPopup) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div 
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        data-testid="terms-acceptance-popup"
      >
        <div className="p-6">
          <div className="text-center mb-6">
            <span 
              className="font-bold text-2xl tracking-tight text-black dark:text-white" 
              style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}
            >
              AÜREN
            </span>
          </div>

          <h2 className="text-xl font-bold text-foreground text-center mb-2">
            Welcome to Auren
          </h2>
          <p className="text-muted-foreground text-center text-sm mb-6">
            Before you begin, please review and accept our terms.
          </p>

          <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 mb-6 max-h-64 overflow-y-auto text-sm text-muted-foreground space-y-4">
            <div>
              <h3 className="font-semibold text-foreground mb-2">1. Acceptance of Terms</h3>
              <p>By accessing or using Auren, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree, please do not use our service.</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">2. Eligibility</h3>
              <p>You must be at least 13 years old to use Auren. By using our service, you represent that you meet this age requirement.</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">3. Photo Upload & Usage</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Photos you upload are used solely for AI hairstyle generation</li>
                <li>Photos are processed securely and not shared with third parties</li>
                <li>You retain ownership of your original photos</li>
                <li>Photos may be temporarily stored for processing purposes</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">4. AI-Generated Content</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>AI-generated images are for visualization purposes only</li>
                <li>Results may vary from actual salon outcomes</li>
                <li>We do not guarantee exact replication of generated styles</li>
                <li>Generated images should not be used for identity fraud</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">5. Credits & Payments</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Credits are required for hairstyle generations</li>
                <li>Purchased credits are non-refundable</li>
                <li>Credits do not expire unless account is deleted</li>
                <li>Subscription plans auto-renew until cancelled</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">6. Booking & Appointments</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Appointments cancelled less than 3 hours prior may incur a 20% fee</li>
                <li>Stylists set their own availability and pricing</li>
                <li>Auren facilitates bookings but is not the service provider</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">7. Privacy & Data</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>We collect only necessary personal information</li>
                <li>We do not sell your personal data to third parties</li>
                <li>You can request deletion of your data at any time</li>
                <li>We use industry-standard security measures</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">8. Limitation of Liability</h3>
              <p>Auren is provided "as is" without warranties. We are not liable for any damages arising from use of our service, including but not limited to dissatisfaction with generated results or salon services.</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">9. Changes to Terms</h3>
              <p>We may update these terms periodically. Continued use of Auren after changes constitutes acceptance of the updated terms.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 mb-6">
            <Checkbox
              id="accept-terms"
              checked={accepted}
              onCheckedChange={(checked) => setAccepted(checked === true)}
              className="mt-0.5"
              data-testid="checkbox-accept-terms"
            />
            <label htmlFor="accept-terms" className="text-sm text-foreground cursor-pointer leading-relaxed">
              I have read and agree to the{" "}
              <Link href="/terms" className="text-primary hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
            </label>
          </div>

          <Button
            onClick={handleAccept}
            disabled={!accepted}
            className="w-full"
            size="lg"
            data-testid="button-accept-terms"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
