import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Loader2, CreditCard, TrendingUp, Calendar, Heart } from "lucide-react";
import type { User, CreditTransaction } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { user: authUser, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user/me"],
    enabled: !!authUser,
  });

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<CreditTransaction[]>({
    queryKey: ["/api/user/transactions"],
    enabled: !!authUser,
  });

  useEffect(() => {
    if (!authLoading && !authUser) {
      setLocation("/");
    }
  }, [authUser, authLoading, setLocation]);

  if (authLoading || userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const planName = {
    free: "Free Plan",
    payg: "Pay-as-you-go",
    monthly: "Monthly Plan",
    business: "Business Plan",
  }[user.plan || "free"];

  return (
    <div className="min-h-screen bg-background py-4 md:py-12 pb-20 md:pb-12">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-4 md:mb-8">
          <h1 className="text-2xl md:text-4xl font-bold mb-2" style={{ fontFamily: "DM Sans" }} data-testid="text-welcome">
            Welcome back{user.firstName ? `, ${user.firstName}` : ""}!
          </h1>
          <p className="text-muted-foreground">
            Manage your account and view your usage
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Current Plan</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-plan-name">{planName}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {user.plan === "free" && "3 daily credits"}
                {user.plan === "payg" && "Pay per use"}
                {user.plan === "monthly" && "100 credits/month"}
                {user.plan === "business" && "Unlimited credits"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available Credits</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-credits">
                {user.plan === "business" ? "∞" : user.credits}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {user.plan === "free" && user.dailyCreditsResetAt && (
                  <>Resets {formatDistanceToNow(new Date(user.dailyCreditsResetAt), { addSuffix: true })}</>
                )}
                {user.plan !== "free" && user.plan !== "business" && "Never expires"}
                {user.plan === "business" && "Unlimited"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Member Since</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-member-since">
                {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "N/A"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {user.createdAt && formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Manage your account and credits</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Button onClick={() => setLocation("/upload")} data-testid="button-try-hairstyle">
              Try a Hairstyle
            </Button>
            <Button variant="outline" onClick={() => setLocation("/appointments")} data-testid="button-my-appointments">
              My Appointments
            </Button>
            <Button variant="outline" onClick={() => setLocation("/saved-looks")} data-testid="button-saved-looks">
              <Heart className="h-4 w-4 mr-2" />
              Saved Looks
            </Button>
            {user.plan !== "business" && (
              <Button variant="outline" onClick={() => setLocation("/buy-credits")} data-testid="button-buy-credits">
                Buy Credits
              </Button>
            )}
            <Button variant="outline" onClick={() => setLocation("/pricing")} data-testid="button-upgrade">
              {user.plan === "free" ? "Upgrade Plan" : "Change Plan"}
            </Button>
          </CardContent>
        </Card>

        {/* Transaction History */}
        <Card>
          <CardHeader>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>Your recent credit activity</CardDescription>
          </CardHeader>
          <CardContent>
            {transactionsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No transactions yet
              </p>
            ) : (
              <div className="space-y-4">
                {transactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between py-3 border-b last:border-0"
                    data-testid={`transaction-${transaction.id}`}
                  >
                    <div>
                      <p className="font-medium">{transaction.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {transaction.createdAt ? formatDistanceToNow(new Date(transaction.createdAt), { addSuffix: true }) : "N/A"}
                      </p>
                    </div>
                    <div className={`text-lg font-semibold ${transaction.amount > 0 ? "text-green-600" : "text-red-600"}`}>
                      {transaction.amount > 0 ? "+" : ""}{transaction.amount}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
