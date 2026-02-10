import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Construction } from "lucide-react";

// Beta testing mode - payments disabled
const BETA_MODE = true;
const stripeKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
const stripePromise = stripeKey && !BETA_MODE ? loadStripe(stripeKey) : null;

function CheckoutForm({ credits, onSuccess }: { credits: number; onSuccess: () => void }) {
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
          title: "Payment Successful",
          description: `${credits} credits added to your account!`,
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
        data-testid="button-complete-payment"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          `Pay $${(credits * 0.25).toFixed(2)}`
        )}
      </Button>
    </form>
  );
}

export default function BuyCredits() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [credits, setCredits] = useState(20);
  const [clientSecret, setClientSecret] = useState("");
  const [isLoadingPayment, setIsLoadingPayment] = useState(false);

  if (!user) {
    setLocation("/");
    return null;
  }

  const handleCreatePayment = async () => {
    if (credits < 1) {
      toast({
        title: "Invalid Amount",
        description: "Please enter at least 1 credit",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingPayment(true);

    try {
      const response: any = await apiRequest("POST", "/api/create-payment-intent", { credits });
      setClientSecret(response.clientSecret);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create payment",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPayment(false);
    }
  };

  const totalCost = (credits * 0.25).toFixed(2);

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

        <Card>
          <CardHeader>
            <CardTitle style={{ fontFamily: "DM Sans" }} data-testid="text-title">
              Buy Credits
            </CardTitle>
            <CardDescription>
              Purchase credits for $0.25 each. Credits never expire.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {BETA_MODE ? (
              <div className="text-center py-8">
                <Construction className="w-12 h-12 mx-auto text-amber-500 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Payments Disabled During Beta</h3>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                  Credit purchases are temporarily disabled while we're in beta testing. 
                  Thank you for your patience!
                </p>
              </div>
            ) : !clientSecret ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="credits">Number of Credits</Label>
                  <Input
                    id="credits"
                    type="number"
                    min="1"
                    value={credits}
                    onChange={(e) => setCredits(parseInt(e.target.value) || 0)}
                    data-testid="input-credits"
                  />
                  <p className="text-sm text-muted-foreground">
                    Minimum: 1 credit ($0.25)
                  </p>
                </div>

                <div className="bg-muted p-4 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-muted-foreground">Credits:</span>
                    <span className="font-semibold" data-testid="text-credits-amount">{credits}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="text-2xl font-bold" data-testid="text-total-cost">${totalCost}</span>
                  </div>
                </div>
              </>
            ) : (
              <Elements stripe={stripePromise!} options={{ clientSecret }}>
                <CheckoutForm
                  credits={credits}
                  onSuccess={() => setLocation("/dashboard")}
                />
              </Elements>
            )}
          </CardContent>
          {!BETA_MODE && !clientSecret && (
            <CardFooter>
              <Button
                className="w-full"
                onClick={handleCreatePayment}
                disabled={isLoadingPayment || credits < 1}
                data-testid="button-proceed-payment"
              >
                {isLoadingPayment ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Proceed to Payment"
                )}
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
