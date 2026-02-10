import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Check, Construction } from "lucide-react";

// Beta testing mode - payments disabled
const BETA_MODE = true;
const stripeKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
const stripePromise = stripeKey && !BETA_MODE ? loadStripe(stripeKey) : null;

function CheckoutForm({ plan, onSuccess }: { plan: string; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/dashboard`,
        },
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Subscription Activated",
          description: "Welcome to your new plan!",
        });
        onSuccess();
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      <Button
        type="submit"
        className="w-full"
        disabled={!stripe || isProcessing}
        data-testid="button-complete-subscription"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          "Complete Subscription"
        )}
      </Button>
    </form>
  );
}

export default function Subscribe() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [clientSecret, setClientSecret] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const params = new URLSearchParams(location.split("?")[1]);
  const plan = params.get("plan") || "monthly";

  const planDetails = plan === "monthly"
    ? {
        name: "Monthly Plan",
        price: "$5.99",
        period: "/month",
        features: [
          "Full access to all app features",
          "Unlimited AI hairstyle generations",
          "Book trusted stylists",
          "Save transformation history",
          "Priority processing",
          "Cancel anytime",
        ],
      }
    : {
        name: "Business Plan",
        price: "$60",
        period: "/month",
        badge: "First month only $30",
        features: [
          "AI hairstyle visualization",
          "24/7 online booking",
          "Client & calendar management",
          "Payment processing",
          "Auren verified badge",
        ],
      };

  useEffect(() => {
    if (!user) {
      setLocation("/");
      return;
    }

    const createSubscription = async () => {
      setIsLoading(true);

      try {
        const response: any = await apiRequest("POST", "/api/create-subscription", { plan });
        setClientSecret(response.clientSecret);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to create subscription",
          variant: "destructive",
        });
        setLocation("/pricing");
      } finally {
        setIsLoading(false);
      }
    };

    createSubscription();
  }, [user, plan]);

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background py-6 pb-20 md:pb-6">
      <div className="max-w-2xl mx-auto px-4">
        <Button
          variant="ghost"
          onClick={() => setLocation("/pricing")}
          className="mb-6"
          data-testid="button-back-pricing"
        >
          ← Back to Pricing
        </Button>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Plan Summary */}
          <Card>
            <CardHeader>
              <CardTitle style={{ fontFamily: "DM Sans" }} data-testid="text-plan-name">
                {planDetails.name}
              </CardTitle>
              <div className="mt-4">
                <span className="text-4xl font-bold" data-testid="text-plan-price">{planDetails.price}</span>
                <span className="text-muted-foreground">{planDetails.period}</span>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {planDetails.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Payment Form */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Details</CardTitle>
              <CardDescription>
                Secure payment processed by Stripe
              </CardDescription>
            </CardHeader>
            <CardContent>
              {BETA_MODE ? (
                <div className="text-center py-8">
                  <Construction className="w-12 h-12 mx-auto text-amber-500 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Payments Disabled During Beta</h3>
                  <p className="text-muted-foreground text-sm">
                    Subscriptions are temporarily disabled while we're in beta testing. 
                    Thank you for your patience!
                  </p>
                </div>
              ) : isLoading ? (
                <div className="flex justify-center items-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : clientSecret ? (
                <Elements stripe={stripePromise!} options={{ clientSecret }}>
                  <CheckoutForm
                    plan={plan}
                    onSuccess={() => setLocation("/dashboard")}
                  />
                </Elements>
              ) : (
                <p className="text-center text-muted-foreground">
                  Failed to load payment form
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
