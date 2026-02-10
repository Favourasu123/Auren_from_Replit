import { useState } from "react";
import { motion } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Sparkles, Users, Target, CheckCircle2, Zap, MessageSquare, Image, Camera, Sun, Eye, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import Navigation from "@/components/Navigation";

import phoneHairstyleTryOn from "@assets/generated_images/phone_showing_male_hairstyle_try-on.png";
import happySalonImage from "@assets/generated_images/happy_client_in_bright_salon.png";
import transformImage from "@assets/generated_images/male_before_after_hair_transformation.png";
import confidentImage from "@assets/generated_images/confident_man_entering_salon.png";
import sharingImage from "@assets/generated_images/client_stylist_phone_sharing.png";
import chatSharingVision from "@assets/generated_images/chat_interface_sharing_hairstyle_vision.png";
import stylistImage from "@assets/stock_images/professional_hairsty_22a97611.jpg";
import { MapPin, Star, Check, Calendar } from "lucide-react";

interface Slide {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  icon: typeof Sparkles;
  gradient: string;
}

const slides: Slide[] = [
  {
    id: "how-it-works",
    title: "Your Perfect Look",
    subtitle: "4 Simple Steps",
    description: "Discover, find, share, book.",
    image: phoneHairstyleTryOn,
    icon: Sparkles,
    gradient: "from-purple-600 to-pink-500",
  },
  {
    id: "three-modes",
    title: "3 Ways to Create",
    subtitle: "Your Style, Your Way",
    description: "Describe, upload, or let AI match you.",
    image: happySalonImage,
    icon: Zap,
    gradient: "from-blue-600 to-cyan-500",
  },
  {
    id: "find-stylists",
    title: "Find & Connect",
    subtitle: "The Right Stylist",
    description: "Browse verified pros. Share your look. Get it done right.",
    image: sharingImage,
    icon: Users,
    gradient: "from-green-500 to-emerald-500",
  },
  {
    id: "photo-tips",
    title: "Best Results",
    subtitle: "Photo Tips",
    description: "Front-facing, good lighting, hair visible.",
    image: transformImage,
    icon: CheckCircle2,
    gradient: "from-orange-500 to-amber-500",
  },
];

export default function OnboardingDebug() {
  const [previewIndex, setPreviewIndex] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const currentSlide = slides[previewIndex];
  const SlideIcon = currentSlide.icon;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" className="mb-2">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Onboarding Slides Debug</h1>
          <p className="text-muted-foreground">Review and optimize the intro slides shown to new users</p>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Mobile Preview</span>
                <Button onClick={() => setShowPreview(!showPreview)}>
                  {showPreview ? "Hide Preview" : "Show Live Preview"}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {showPreview && (
                <div className="flex justify-center">
                  <div className="relative w-[375px] h-[667px] bg-slate-950 rounded-3xl overflow-hidden shadow-2xl border-4 border-slate-800">
                    <button
                      onClick={() => setShowPreview(false)}
                      className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>

                    <div className="flex-1 flex flex-col h-full">
                      <motion.div
                        key={currentSlide.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                        className="flex-1 flex flex-col h-full"
                      >
                        {/* First slide: Creative 4-step process */}
                        {previewIndex === 0 ? (
                          <div className="flex-1 flex flex-col h-full bg-gradient-to-b from-slate-900 via-purple-950 to-slate-900">
                            {/* Header */}
                            <div className="px-5 pt-8 pb-4 text-center">
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-medium mb-3">
                                <Sparkles className="w-3 h-3" />
                                How It Works
                              </div>
                              <h1 className="text-2xl font-bold text-white leading-tight mb-1">
                                Your Perfect Look
                              </h1>
                              <p className="text-purple-200/70 text-sm">in 4 simple steps</p>
                            </div>
                            
                            {/* Vertical timeline with steps */}
                            <div className="flex-1 px-6 py-2 overflow-hidden">
                              <div className="relative h-full flex flex-col justify-between">
                                {/* Connecting line */}
                                <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-purple-500 via-blue-500 via-cyan-500 to-green-500" />
                                
                                {/* Step 1 */}
                                <div className="flex items-center gap-3 relative z-10">
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-purple-500/30">1</div>
                                  <div className="flex-1 bg-white/10 backdrop-blur rounded-xl p-2.5 border border-white/10">
                                    <p className="font-semibold text-white text-sm">Discover Your Look</p>
                                    <p className="text-white/60 text-[11px]">AI creates your perfect style</p>
                                  </div>
                                </div>
                                
                                {/* Step 2 */}
                                <div className="flex items-center gap-3 relative z-10">
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-blue-500/30">2</div>
                                  <div className="flex-1 bg-white/10 backdrop-blur rounded-xl p-2.5 border border-white/10">
                                    <p className="font-semibold text-white text-sm">Find Your Stylist</p>
                                    <p className="text-white/60 text-[11px]">Browse verified local pros</p>
                                  </div>
                                </div>
                                
                                {/* Step 3 */}
                                <div className="flex items-center gap-3 relative z-10">
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-cyan-500/30">3</div>
                                  <div className="flex-1 bg-white/10 backdrop-blur rounded-xl p-2.5 border border-white/10">
                                    <p className="font-semibold text-white text-sm">Share Your Vision</p>
                                    <p className="text-white/60 text-[11px]">Send your look + notes</p>
                                  </div>
                                </div>
                                
                                {/* Step 4 */}
                                <div className="flex items-center gap-3 relative z-10">
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-green-500/30">4</div>
                                  <div className="flex-1 bg-white/10 backdrop-blur rounded-xl p-2.5 border border-white/10">
                                    <p className="font-semibold text-white text-sm">Book & Go</p>
                                    <p className="text-white/60 text-[11px]">Walk in confident</p>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="px-5 py-4">
                              <div className="flex items-center gap-2 mb-3 justify-center">
                                {slides.map((_, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => setPreviewIndex(idx)}
                                    className={`h-2 rounded-full transition-all ${
                                      idx === previewIndex ? "bg-white w-6" : "bg-white/30 w-2"
                                    }`}
                                  />
                                ))}
                              </div>
                              <Button
                                onClick={() => setPreviewIndex(1)}
                                className="w-full bg-gradient-to-r from-purple-600 to-pink-500 h-12 text-base font-semibold"
                              >
                                Get Started
                                <ChevronRight className="w-5 h-5" />
                              </Button>
                            </div>
                          </div>
                        ) : previewIndex === 1 ? (
                          /* Second slide: 3 Modes */
                          <div className="flex-1 flex flex-col h-full bg-gradient-to-b from-slate-900 via-blue-950 to-slate-900">
                            {/* Header */}
                            <div className="px-5 pt-6 pb-3 text-center">
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-medium mb-2">
                                <Zap className="w-3 h-3" />
                                Create Your Style
                              </div>
                              <h1 className="text-2xl font-bold text-white leading-tight">
                                3 Ways to Design
                              </h1>
                              <p className="text-blue-200/70 text-sm mt-1">Choose what works for you</p>
                            </div>
                            
                            {/* 3 Mode Cards */}
                            <div className="flex-1 px-4 py-2 flex flex-col gap-3">
                              {/* Mode 1: Describe */}
                              <div className="flex-1 bg-gradient-to-r from-purple-600/20 to-pink-600/20 backdrop-blur rounded-2xl p-4 border border-purple-500/30 flex items-center gap-4">
                                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                                  <MessageSquare className="w-7 h-7 text-white" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-bold text-white text-base">Describe It</h3>
                                  <p className="text-white/60 text-xs leading-relaxed">Tell AI what you want in your own words</p>
                                </div>
                              </div>
                              
                              {/* Mode 2: Upload */}
                              <div className="flex-1 bg-gradient-to-r from-blue-600/20 to-cyan-600/20 backdrop-blur rounded-2xl p-4 border border-blue-500/30 flex items-center gap-4">
                                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg">
                                  <Image className="w-7 h-7 text-white" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-bold text-white text-base">Upload Inspo</h3>
                                  <p className="text-white/60 text-xs leading-relaxed">Share a photo of any hairstyle you love</p>
                                </div>
                              </div>
                              
                              {/* Mode 3: AI Match */}
                              <div className="flex-1 bg-gradient-to-r from-amber-600/20 to-orange-600/20 backdrop-blur rounded-2xl p-4 border border-amber-500/30 flex items-center gap-4">
                                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
                                  <Sparkles className="w-7 h-7 text-white" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-bold text-white text-base">AI Match</h3>
                                  <p className="text-white/60 text-xs leading-relaxed">Get matched with trending celebrity styles</p>
                                </div>
                              </div>
                            </div>

                            <div className="px-5 py-4">
                              <div className="flex items-center gap-2 mb-3 justify-center">
                                {slides.map((_, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => setPreviewIndex(idx)}
                                    className={`h-2 rounded-full transition-all ${
                                      idx === previewIndex ? "bg-white w-6" : "bg-white/30 w-2"
                                    }`}
                                  />
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => setPreviewIndex(0)}
                                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                                >
                                  <ChevronLeft className="w-4 h-4" />
                                  Back
                                </Button>
                                <Button
                                  onClick={() => setPreviewIndex(2)}
                                  className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-500 h-10 font-semibold"
                                >
                                  Next
                                  <ChevronRight className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : previewIndex === 2 ? (
                          /* Third slide: Find & Connect with Stylists */
                          <div className="flex-1 flex flex-col h-full bg-gradient-to-b from-slate-900 via-emerald-950 to-slate-900">
                            <div className="px-5 pt-6 pb-3 text-center">
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-medium mb-2">
                                <Users className="w-3 h-3" />
                                Stylists
                              </div>
                              <h1 className="text-2xl font-bold text-white leading-tight">
                                Find & Connect
                              </h1>
                              <p className="text-emerald-200/70 text-sm mt-1">The right stylist for you</p>
                            </div>
                            
                            <div className="flex-1 px-5 py-3 flex flex-col gap-4">
                              <div className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl p-3 border border-white/10">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                                  <Star className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                  <p className="font-semibold text-white text-sm">Verified Stylists</p>
                                  <p className="text-white/60 text-xs">Ratings & portfolios</p>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl p-3 border border-white/10">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                                  <Send className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                  <p className="font-semibold text-white text-sm">Share Your Look</p>
                                  <p className="text-white/60 text-xs">Send AI image + notes</p>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl p-3 border border-white/10">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                                  <CheckCircle2 className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                  <p className="font-semibold text-white text-sm">Get It Done Right</p>
                                  <p className="text-white/60 text-xs">No miscommunication</p>
                                </div>
                              </div>
                            </div>

                            <div className="px-5 py-4">
                              <div className="flex items-center gap-2 mb-3 justify-center">
                                {slides.map((_, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => setPreviewIndex(idx)}
                                    className={`h-2 rounded-full transition-all ${
                                      idx === previewIndex ? "bg-white w-6" : "bg-white/30 w-2"
                                    }`}
                                  />
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => setPreviewIndex(1)}
                                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                                >
                                  <ChevronLeft className="w-4 h-4" />
                                  Back
                                </Button>
                                <Button
                                  onClick={() => setPreviewIndex(3)}
                                  className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 h-10 font-semibold"
                                >
                                  Next
                                  <ChevronRight className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : previewIndex === 3 ? (
                          /* Fourth slide: Photo Tips */
                          <div className="flex-1 flex flex-col h-full bg-gradient-to-b from-slate-900 via-orange-950 to-slate-900">
                            <div className="px-5 pt-6 pb-3 text-center">
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-500/20 text-orange-300 text-xs font-medium mb-2">
                                <Camera className="w-3 h-3" />
                                Photo Tips
                              </div>
                              <h1 className="text-2xl font-bold text-white leading-tight">
                                Best Results
                              </h1>
                              <p className="text-orange-200/70 text-sm mt-1">For your uploads</p>
                            </div>
                            
                            <div className="flex-1 px-5 py-3 flex flex-col gap-3">
                              <div className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl p-3 border border-white/10">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                                  <Eye className="w-4 h-4 text-white" />
                                </div>
                                <p className="font-medium text-white text-sm">Front-facing photo</p>
                              </div>
                              
                              <div className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl p-3 border border-white/10">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center">
                                  <Sun className="w-4 h-4 text-white" />
                                </div>
                                <p className="font-medium text-white text-sm">Good, even lighting</p>
                              </div>
                              
                              <div className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl p-3 border border-white/10">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center">
                                  <Users className="w-4 h-4 text-white" />
                                </div>
                                <p className="font-medium text-white text-sm">Hair fully visible</p>
                              </div>
                              
                              <div className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl p-3 border border-white/10">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
                                  <X className="w-4 h-4 text-white" />
                                </div>
                                <p className="font-medium text-white text-sm">No hats or sunglasses</p>
                              </div>
                            </div>

                            <div className="px-5 py-4">
                              <div className="flex items-center gap-2 mb-3 justify-center">
                                {slides.map((_, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => setPreviewIndex(idx)}
                                    className={`h-2 rounded-full transition-all ${
                                      idx === previewIndex ? "bg-white w-6" : "bg-white/30 w-2"
                                    }`}
                                  />
                                ))}
                              </div>
                              <Button
                                onClick={() => {/* Start using app */}}
                                className="w-full bg-gradient-to-r from-orange-500 to-amber-500 h-12 text-base font-semibold"
                              >
                                Start Creating
                                <Sparkles className="w-5 h-5" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                        <div className="relative h-[55%] overflow-hidden">
                          <img
                            src={currentSlide.image}
                            alt={currentSlide.title}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
                          
                          <div className="absolute top-4 left-4">
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r ${currentSlide.gradient} text-white text-xs font-medium`}>
                              <SlideIcon className="w-3.5 h-3.5" />
                              <span>{previewIndex + 1} of {slides.length}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 px-6 pt-4 pb-6 flex flex-col">
                          <div className="flex-1">
                            <h1 className="text-2xl font-bold text-white mb-1">
                              {currentSlide.title}
                            </h1>
                            <h2 className={`text-xl font-semibold bg-gradient-to-r ${currentSlide.gradient} bg-clip-text text-transparent mb-3`}>
                              {currentSlide.subtitle}
                            </h2>
                            <p className="text-white/70 text-base leading-relaxed">
                              {currentSlide.description}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 mb-4 justify-center">
                            {slides.map((_, idx) => (
                              <button
                                key={idx}
                                onClick={() => setPreviewIndex(idx)}
                                className={`h-2 rounded-full transition-all ${
                                  idx === previewIndex ? "bg-white w-6" : "bg-white/30 w-2"
                                }`}
                              />
                            ))}
                          </div>

                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                              disabled={previewIndex === 0}
                              className="flex-1"
                            >
                              <ChevronLeft className="w-4 h-4" />
                              Prev
                            </Button>
                            <Button
                              onClick={() => setPreviewIndex(Math.min(slides.length - 1, previewIndex + 1))}
                              disabled={previewIndex === slides.length - 1}
                              className={`flex-1 bg-gradient-to-r ${currentSlide.gradient}`}
                            >
                              Next
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                          </>
                        )}
                      </motion.div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <h2 className="text-xl font-bold mt-4">All Slides Overview</h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {slides.map((slide, index) => {
              const Icon = slide.icon;
              return (
                <Card key={slide.id} className="overflow-hidden">
                  <div className="relative h-48 overflow-hidden">
                    <img
                      src={slide.image}
                      alt={slide.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="absolute top-3 left-3">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r ${slide.gradient} text-white text-xs font-medium`}>
                        <Icon className="w-3 h-3" />
                        <span>Slide {index + 1}</span>
                      </div>
                    </div>
                    <div className="absolute bottom-3 left-3 right-3">
                      <h3 className="text-white font-bold text-lg">{slide.title}</h3>
                      <p className={`text-sm font-medium bg-gradient-to-r ${slide.gradient} bg-clip-text text-transparent`}>
                        {slide.subtitle}
                      </p>
                    </div>
                  </div>
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">{slide.description}</p>
                    <div className="mt-3 pt-3 border-t">
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p><span className="font-medium">ID:</span> {slide.id}</p>
                        <p><span className="font-medium">Gradient:</span> {slide.gradient}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
