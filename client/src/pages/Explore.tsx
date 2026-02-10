import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Compass, Sparkles, Users, Heart, Bell, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import Navigation from "@/components/Navigation";

export default function Explore() {
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 pb-20 md:pb-0" data-testid="explore-page">
      <Navigation />
      
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-4 md:py-12">
        {/* Coming Soon Header */}
        <div className="text-center mb-6 md:mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 md:w-20 md:h-20 rounded-full bg-purple-500/20 mb-4 md:mb-6">
            <Compass className="w-10 h-10 text-purple-400" />
          </div>
          
          <Badge className="mb-4 bg-purple-500/20 text-purple-300 border-purple-500/30">
            Coming Soon
          </Badge>
          
          <h1 className="text-2xl md:text-4xl font-bold text-white mb-3 md:mb-4">
            Explore Community
          </h1>
          
          <p className="text-xl text-slate-400 max-w-2xl mx-auto">
            Discover and share hair transformations with the Auren community. Get inspired by real people with real results.
          </p>
        </div>

        {/* Feature Preview Cards */}
        <div className="grid md:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-12">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-pink-500/20 flex items-center justify-center mx-auto mb-4">
                <Heart className="w-6 h-6 text-pink-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Share Your Look
              </h3>
              <p className="text-slate-400 text-sm">
                Post your AI-generated transformations and get feedback from the community
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
                <Users className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Follow Stylists
              </h3>
              <p className="text-slate-400 text-sm">
                Connect with professional stylists and see their latest creations
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-6 h-6 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Get Inspired
              </h3>
              <p className="text-slate-400 text-sm">
                Browse trending styles and find your next look from real transformations
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Notification signup */}
        <Card className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border-purple-500/30 mb-6 md:mb-12">
          <CardContent className="p-8 text-center">
            <Bell className="w-8 h-8 text-purple-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">
              Be the First to Know
            </h3>
            <p className="text-slate-300 mb-6">
              We'll notify you when the Explore community launches
            </p>
            
            {emailSubmitted ? (
              <div className="flex items-center justify-center gap-2 text-green-400">
                <Sparkles className="w-5 h-5" />
                <span>You're on the list!</span>
              </div>
            ) : (
              <Button 
                className="bg-purple-600 hover:bg-purple-700"
                onClick={() => setEmailSubmitted(true)}
                data-testid="button-notify-me"
              >
                <Bell className="w-4 h-4 mr-2" />
                Notify Me When It's Ready
              </Button>
            )}
          </CardContent>
        </Card>

        {/* CTA to try the app */}
        <div className="text-center">
          <p className="text-slate-400 mb-4">
            In the meantime, try out our AI hairstyle generator
          </p>
          <Link href="/upload">
            <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
              Try a New Look
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
