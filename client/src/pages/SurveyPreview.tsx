import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { ThumbsUp, ThumbsDown, ArrowLeft, Sparkles, Target, MessageCircle, Lightbulb, Star, Rocket, Crown, Heart, Gift, Zap, Check } from "lucide-react";
import { Link } from "wouter";

const ratingEmojis = [
  { value: 1, emoji: "😔", label: "Very Poor" },
  { value: 2, emoji: "😕", label: "Poor" },
  { value: 3, emoji: "🙂", label: "Fair" },
  { value: 4, emoji: "😊", label: "Good" },
  { value: 5, emoji: "😄", label: "Very Good" },
  { value: 6, emoji: "🤩", label: "Excellent" },
  { value: 7, emoji: "🥳", label: "Amazing" },
];

const featureOptions = [
  { value: "text_mode", label: "Text Mode", desc: "Describing your style", gradient: "from-blue-400 to-cyan-400" },
  { value: "inspiration_mode", label: "Inspiration Mode", desc: "Uploading reference photos", gradient: "from-purple-400 to-pink-400" },
  { value: "aureniq", label: "AurenIQ", desc: "AI-matched styles", gradient: "from-amber-400 to-orange-400" },
];

const planOptions = [
  { value: "free", label: "Free Plan", desc: "3 credits daily", icon: Gift, color: "from-emerald-400 to-teal-500" },
  { value: "payg", label: "Pay As You Go", desc: "Buy credits when needed", icon: Zap, color: "from-amber-400 to-orange-500" },
  { value: "monthly", label: "Monthly Plan", desc: "Unlimited generations", icon: Crown, color: "from-violet-400 to-purple-500" },
];

export default function SurveyPreview() {
  const [overallRating, setOverallRating] = useState(0);
  const [usabilityRating, setUsabilityRating] = useState(0);
  const [likelihoodToUse, setLikelihoodToUse] = useState(0);
  const [mostUsedFeature, setMostUsedFeature] = useState<string | null>(null);
  const [frustration, setFrustration] = useState("");
  const [missingFeature, setMissingFeature] = useState("");
  const [problemSolved, setProblemSolved] = useState("");
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [improvements, setImprovements] = useState("");
  const [favoriteFeatures, setFavoriteFeatures] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const EmojiRating = ({ 
    value, 
    onChange, 
    title 
  }: { 
    value: number; 
    onChange: (v: number) => void; 
    title: string;
  }) => (
    <div className="space-y-4">
      <h3 className="text-base font-medium text-foreground text-center">{title}</h3>
      <div className="flex justify-center gap-1.5 flex-wrap">
        {ratingEmojis.map((item) => (
          <motion.button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`relative flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
              value === item.value
                ? "bg-gradient-to-br from-primary/20 to-primary/10 ring-2 ring-primary shadow-lg"
                : "hover:bg-muted/50"
            }`}
            whileHover={{ scale: 1.1, y: -2 }}
            whileTap={{ scale: 0.95 }}
          >
            <span className="text-2xl">{item.emoji}</span>
            <span className={`text-[10px] font-semibold ${
              value === item.value ? "text-primary" : "text-muted-foreground"
            }`}>
              {item.value}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );

  const StepHeader = ({ icon: Icon, iconColor, title, subtitle }: { icon: any; iconColor: string; title: string; subtitle?: string }) => (
    <div className="text-center space-y-2 mb-4">
      <div className={`inline-flex p-3 rounded-2xl bg-gradient-to-br from-muted/80 to-muted/40`}>
        <Icon className={`w-6 h-6 ${iconColor}`} />
      </div>
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Survey Preview</h1>
            <p className="text-muted-foreground">Updated creative design (1-7 scale)</p>
          </div>
          <Badge variant="outline" className="ml-auto">Preview Only</Badge>
        </div>

        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 rounded-2xl mb-6">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Quick Survey (3 Steps)
          </h2>
          <p className="text-sm text-muted-foreground">Shown after 5 generations</p>
        </div>

        <Card className="border-2 border-primary/20 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge className="bg-primary">Step 1</Badge>
              Overall Satisfaction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Sparkles} iconColor="text-amber-500" title="Quick Feedback" />
            <EmojiRating
              value={overallRating}
              onChange={setOverallRating}
              title="How satisfied are you with the app overall?"
            />
          </CardContent>
        </Card>

        <Card className="border-2 border-primary/20 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge className="bg-primary">Step 2</Badge>
              Ease of Use
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Target} iconColor="text-blue-500" title="Ease of Use" />
            <EmojiRating
              value={usabilityRating}
              onChange={setUsabilityRating}
              title="How easy was it to use?"
            />
          </CardContent>
        </Card>

        <Card className="border-2 border-primary/20 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge className="bg-primary">Step 3</Badge>
              Future Use
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={MessageCircle} iconColor="text-rose-500" title="Future Use" />
            <EmojiRating
              value={likelihoodToUse}
              onChange={setLikelihoodToUse}
              title="How likely would you be to use Auren for your hair appointments?"
            />
          </CardContent>
        </Card>

        <div className="bg-gradient-to-r from-violet-500/10 via-purple-500/5 to-transparent p-4 rounded-2xl mt-10 mb-6">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-violet-500" />
            Extended Survey (8 Steps)
          </h2>
          <p className="text-sm text-muted-foreground">Shown after 11 generations - more creative design</p>
          <div className="mt-3 bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <div className="flex items-center gap-2 justify-center">
              <Gift className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-medium text-foreground">
                Complete for a chance to win 1 of 3 <span className="text-amber-600 font-bold">$25 gift cards</span>
              </span>
            </div>
          </div>
        </div>

        <Card className="border-2 border-violet-500/20 shadow-lg bg-gradient-to-b from-background to-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-600">Step 1</Badge>
              Feature Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Sparkles} iconColor="text-amber-500" title="Feature Usage" />
            <p className="text-sm text-foreground font-medium text-center mb-3">Which feature did you use most?</p>
            <div className="space-y-2">
              {featureOptions.map((option) => (
                <motion.button
                  key={option.value}
                  type="button"
                  onClick={() => setMostUsedFeature(option.value)}
                  className={`w-full text-left px-4 py-4 rounded-2xl transition-all border-2 ${
                    mostUsedFeature === option.value
                      ? `bg-gradient-to-r ${option.gradient} text-white border-transparent shadow-lg`
                      : "bg-muted/30 border-transparent hover:border-muted-foreground/20"
                  }`}
                  whileHover={{ scale: 1.02, x: 4 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="font-semibold text-base">{option.label}</span>
                  <span className={`text-sm ml-2 ${mostUsedFeature === option.value ? "text-white/80" : "text-muted-foreground"}`}>
                    {option.desc}
                  </span>
                </motion.button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-violet-500/20 shadow-lg bg-gradient-to-b from-background to-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-600">Step 2</Badge>
              Problem Solved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Target} iconColor="text-blue-500" title="Problem Solved" />
            <p className="text-sm text-foreground font-medium text-center mb-3">What problem does the app solve for you, if any?</p>
            <Textarea
              placeholder="Visualizing new looks before committing, communicating with stylists..."
              value={problemSolved}
              onChange={(e) => setProblemSolved(e.target.value)}
              className="resize-none h-28 text-base rounded-2xl border-2 border-muted focus:border-primary bg-muted/20"
            />
          </CardContent>
        </Card>

        <Card className="border-2 border-violet-500/20 shadow-lg bg-gradient-to-b from-background to-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-600">Step 3</Badge>
              Pain Points
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={MessageCircle} iconColor="text-rose-500" title="Frustrations" />
            <p className="text-sm text-foreground font-medium text-center mb-3">What's the most frustrating thing about the app?</p>
            <Textarea
              placeholder="Slow loading, confusing navigation, missing features..."
              value={frustration}
              onChange={(e) => setFrustration(e.target.value)}
              className="resize-none h-28 text-base rounded-2xl border-2 border-muted focus:border-primary bg-muted/20"
            />
          </CardContent>
        </Card>

        <Card className="border-2 border-violet-500/20 shadow-lg bg-gradient-to-b from-background to-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-600">Step 4</Badge>
              Missing Features
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Lightbulb} iconColor="text-violet-500" title="Missing Features" />
            <p className="text-sm text-foreground font-medium text-center mb-3">What's one feature you expected to exist but didn't find?</p>
            <Textarea
              placeholder="Video tutorials, color matching, AR preview..."
              value={missingFeature}
              onChange={(e) => setMissingFeature(e.target.value)}
              className="resize-none h-28 text-base rounded-2xl border-2 border-muted focus:border-primary bg-muted/20"
            />
          </CardContent>
        </Card>

        <Card className="border-2 border-violet-500/20 shadow-lg bg-gradient-to-b from-background to-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-600">Step 5</Badge>
              Highlights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Star} iconColor="text-emerald-500" title="Recommendation" />
            <p className="text-sm text-foreground font-medium text-center mb-3">Would you recommend Auren to a friend?</p>
            <Textarea
              placeholder="The realistic results, easy navigation, quick generation..."
              value={favoriteFeatures}
              onChange={(e) => setFavoriteFeatures(e.target.value)}
              className="resize-none h-28 text-base rounded-2xl border-2 border-muted focus:border-primary bg-muted/20"
            />
          </CardContent>
        </Card>

        <Card className="border-2 border-violet-500/20 shadow-lg bg-gradient-to-b from-background to-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-600">Step 6</Badge>
              One Change
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Rocket} iconColor="text-cyan-500" title="Plan Preference" />
            <p className="text-sm text-foreground font-medium text-center mb-3">What plan would you most likely use?</p>
            <Textarea
              placeholder="Faster generation, more styles, better UI..."
              value={improvements}
              onChange={(e) => setImprovements(e.target.value)}
              className="resize-none h-28 text-base rounded-2xl border-2 border-muted focus:border-primary bg-muted/20"
            />
          </CardContent>
        </Card>

        <Card className="border-2 border-violet-500/20 shadow-lg bg-gradient-to-b from-background to-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-600">Step 7</Badge>
              Plan Selection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Crown} iconColor="text-amber-500" title="Plan Preference" />
            <p className="text-sm text-foreground font-medium text-center mb-3">What plan would you most likely use?</p>
            <div className="space-y-3">
              {planOptions.map((plan) => {
                const IconComponent = plan.icon;
                return (
                  <motion.button
                    key={plan.value}
                    type="button"
                    onClick={() => setSelectedPlan(plan.value)}
                    className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all border-2 ${
                      selectedPlan === plan.value
                        ? `bg-gradient-to-r ${plan.color} text-white border-transparent shadow-lg`
                        : "bg-muted/30 border-transparent hover:border-muted-foreground/20"
                    }`}
                    whileHover={{ scale: 1.02, x: 4 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className={`p-2 rounded-xl ${selectedPlan === plan.value ? "bg-white/20" : "bg-muted"}`}>
                      <IconComponent className={`w-5 h-5 ${selectedPlan === plan.value ? "text-white" : "text-muted-foreground"}`} />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold">{plan.label}</div>
                      <div className={`text-sm ${selectedPlan === plan.value ? "text-white/80" : "text-muted-foreground"}`}>
                        {plan.desc}
                      </div>
                    </div>
                    {selectedPlan === plan.value && (
                      <Check className="w-5 h-5 ml-auto" />
                    )}
                  </motion.button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-violet-500/20 shadow-lg bg-gradient-to-b from-background to-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-600">Step 8</Badge>
              Recommendation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepHeader icon={Heart} iconColor="text-rose-500" title="Recommendation" />
            <p className="text-sm text-foreground font-medium text-center mb-3">Would you recommend Auren to a friend?</p>
            <div className="flex justify-center gap-6">
              <motion.button
                type="button"
                onClick={() => setWouldRecommend(true)}
                className={`flex flex-col items-center gap-3 p-6 rounded-3xl transition-all ${
                  wouldRecommend === true
                    ? "bg-gradient-to-br from-emerald-400 to-green-500 text-white shadow-xl shadow-emerald-500/30"
                    : "bg-muted/50 hover:bg-muted"
                }`}
                whileHover={{ scale: 1.05, y: -4 }}
                whileTap={{ scale: 0.95 }}
              >
                <ThumbsUp className={`w-10 h-10 ${wouldRecommend === true ? "text-white" : "text-muted-foreground"}`} />
                <span className="font-bold text-lg">Yes!</span>
              </motion.button>
              <motion.button
                type="button"
                onClick={() => setWouldRecommend(false)}
                className={`flex flex-col items-center gap-3 p-6 rounded-3xl transition-all ${
                  wouldRecommend === false
                    ? "bg-gradient-to-br from-rose-400 to-red-500 text-white shadow-xl shadow-rose-500/30"
                    : "bg-muted/50 hover:bg-muted"
                }`}
                whileHover={{ scale: 1.05, y: -4 }}
                whileTap={{ scale: 0.95 }}
              >
                <ThumbsDown className={`w-10 h-10 ${wouldRecommend === false ? "text-white" : "text-muted-foreground"}`} />
                <span className="font-bold text-lg">Not yet</span>
              </motion.button>
            </div>
          </CardContent>
        </Card>

        <div className="text-center text-muted-foreground text-sm py-8 space-y-2">
          <p className="font-medium">End of survey preview</p>
          <p>This page is for review purposes only - it does not submit any data.</p>
        </div>
      </div>
    </div>
  );
}
