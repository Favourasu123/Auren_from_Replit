import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GenerationNotification } from "@/components/GenerationNotification";
import Home from "@/pages/Home";
import Upload from "@/pages/Upload";
import Results from "@/pages/Results";
import Stylists from "@/pages/Stylists";
import Pricing from "@/pages/Pricing";
import BuyCredits from "@/pages/BuyCredits";
import Subscribe from "@/pages/Subscribe";
import Dashboard from "@/pages/Dashboard";
import Explore from "@/pages/Explore";
import Debug from "@/pages/Debug";
import DebugPartner from "@/pages/DebugPartner";
import MaskComparison from "@/pages/MaskComparison";
import ValidationDebug from "@/pages/ValidationDebug";
import FetchedImagesDebug from "@/pages/FetchedImagesDebug";
import BusinessDashboard from "@/pages/BusinessDashboard";
import BusinessWorkspace from "@/pages/BusinessWorkspace";
import Booking from "@/pages/Booking";
import Login from "@/pages/Login";
import BusinessSignup from "@/pages/BusinessSignup";
import StylistWorkMode from "@/pages/StylistWorkMode";
import Admin from "@/pages/Admin";
import AppointmentHistory from "@/pages/AppointmentHistory";
import SavedLooks from "@/pages/SavedLooks";
import More from "@/pages/More";
import About from "@/pages/About";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import SurveyPreview from "@/pages/SurveyPreview";
import Survey from "@/pages/Survey";
import OnboardingDebug from "@/pages/OnboardingDebug";
import DebugIntro from "@/pages/DebugIntro";
import NotFound from "@/pages/not-found";
import { TermsAcceptancePopup } from "@/components/TermsAcceptancePopup";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/upload" component={Upload} />
      <Route path="/results/:id" component={Results} />
      <Route path="/results-debug" component={Results} />
      <Route path="/stylists" component={Stylists} />
      <Route path="/explore" component={Explore} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/buy-credits" component={BuyCredits} />
      <Route path="/subscribe" component={Subscribe} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/business" component={BusinessDashboard} />
      <Route path="/business/workspace" component={BusinessWorkspace} />
      <Route path="/booking/:placeId" component={Booking} />
      {/* Beta: Login route hidden - redirects to home */}
      <Route path="/login">{() => { window.location.href = "/"; return null; }}</Route>
      <Route path="/business/signup" component={BusinessSignup} />
      <Route path="/list-your-salon" component={BusinessSignup} />
      <Route path="/business/work" component={StylistWorkMode} />
      <Route path="/admin" component={Admin} />
      <Route path="/appointments" component={AppointmentHistory} />
      <Route path="/saved-looks" component={SavedLooks} />
      <Route path="/more" component={More} />
      <Route path="/about" component={About} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/debug/:id" component={Debug} />
      <Route path="/debug-partner" component={DebugPartner} />
      <Route path="/mask-comparison" component={MaskComparison} />
      <Route path="/validation-debug" component={ValidationDebug} />
      <Route path="/fetched-images" component={FetchedImagesDebug} />
      <Route path="/survey-preview" component={SurveyPreview} />
      <Route path="/survey" component={Survey} />
      <Route path="/onboarding-debug" component={OnboardingDebug} />
      <Route path="/debug-intro" component={DebugIntro} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PWAInstallPrompt />
        <TermsAcceptancePopup />
        <Toaster />
        <GenerationNotification />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
