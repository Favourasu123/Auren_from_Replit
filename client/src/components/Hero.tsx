import { MapPin, Star, Check, Calendar } from "lucide-react";

import transformationImage from "@assets/generated_images/Hero_transformation_split_screen_30b35779.png";
import chatSharingVision from "@assets/generated_images/chat_interface_sharing_hairstyle_vision.png";
import stylistImage from "@assets/stock_images/professional_hairsty_22a97611.jpg";

export default function Hero() {
  return (
    <>
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* White to slate gradient background for smooth transition */}
        <div className="absolute inset-0 bg-gradient-to-b from-white via-white to-[#e5eaf1] dark:from-background dark:via-background dark:to-slate-800" />

        <div className="relative z-20 w-full max-w-5xl mx-auto px-4 pt-3 md:pt-24 pb-4 md:pb-16">
          {/* Header text - shows on both mobile and desktop */}
          <div className="text-center mb-2 md:mb-8">
            <h1 className="font-heading font-bold text-xl md:text-4xl lg:text-5xl leading-tight text-black dark:text-white">
              Get the look you want,<br className="md:hidden" />{" "}
              <span className="font-bold" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>AÜREN</span> makes it effortless!
            </h1>
          </div>

          {/* 4-Step Process - shows on both mobile and desktop */}
          <div className="relative mb-3 md:mb-10">
            {/* Progress line for desktop */}
            <div className="hidden md:block absolute top-[55px] left-[12%] right-[12%] h-0.5 bg-border z-0">
              <div className="h-full bg-primary w-full" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 relative z-10">
              {/* Step 1: Create Your Look */}
              <div 
                className="flex flex-col items-center text-center"
                data-testid="hero-step-1"
              >
                <div className="w-[70px] h-[70px] md:w-[100px] md:h-[100px] rounded-xl overflow-hidden border-2 border-primary shadow-lg mb-2 md:mb-3 relative">
                  <img src={transformationImage} alt="Hairstyle transformation" className="w-full h-full object-cover" />
                </div>
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] md:text-xs font-bold mb-1 md:mb-1.5 shadow-md">
                  1
                </div>
                <p className="font-medium text-xs md:text-sm">Discover Your Best Look</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">AI generates your style</p>
              </div>

              {/* Step 2: Find a Stylist */}
              <div 
                className="flex flex-col items-center text-center"
                data-testid="hero-step-2"
              >
                <div className="w-[70px] h-[70px] md:w-[100px] md:h-[100px] rounded-xl overflow-hidden border shadow-lg mb-2 md:mb-3 relative bg-card">
                  <img src={stylistImage} alt="Stylist" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                  <div className="absolute bottom-1 left-1 right-1 md:bottom-1.5 md:left-1.5 md:right-1.5 flex items-center justify-between">
                    <div className="flex">
                      {[1,2,3,4,5].map(i => (
                        <Star key={i} className="w-2 h-2 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                    <div className="flex items-center gap-0.5 text-white text-[8px] md:text-[9px]">
                      <MapPin className="w-2 h-2" />
                      2mi
                    </div>
                  </div>
                </div>
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] md:text-xs font-bold mb-1 md:mb-1.5 shadow-md">
                  2
                </div>
                <p className="font-medium text-xs md:text-sm">Choose Your Stylist</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">Browse local pros</p>
              </div>

              {/* Step 3: Share Your Vision */}
              <div 
                className="flex flex-col items-center text-center"
                data-testid="hero-step-3"
              >
                <div className="w-[70px] h-[70px] md:w-[100px] md:h-[100px] rounded-xl overflow-hidden border shadow-lg mb-2 md:mb-3 relative">
                  <img src={chatSharingVision} alt="Sharing hairstyle with stylist" className="w-full h-full object-cover" />
                </div>
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] md:text-xs font-bold mb-1 md:mb-1.5 shadow-md">
                  3
                </div>
                <p className="font-medium text-xs md:text-sm">Share Your Vision</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">Send look + notes</p>
              </div>

              {/* Step 4: Book & Go */}
              <div 
                className="flex flex-col items-center text-center"
                data-testid="hero-step-4"
              >
                <div className="w-[70px] h-[70px] md:w-[100px] md:h-[100px] rounded-xl border shadow-lg mb-2 md:mb-3 relative bg-card flex flex-col items-center justify-center p-1.5 md:p-2">
                  <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-green-500/20 flex items-center justify-center mb-1 md:mb-1.5">
                    <Check className="w-3 h-3 md:w-4 md:h-4 text-green-500" />
                  </div>
                  <p className="text-[9px] md:text-[10px] font-medium">Appointment Set</p>
                  <div className="flex items-center gap-0.5 text-muted-foreground mt-0.5">
                    <Calendar className="w-2 h-2 md:w-2.5 md:h-2.5" />
                    <span className="text-[8px] md:text-[9px]">Dec 15, 2pm</span>
                  </div>
                </div>
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] md:text-xs font-bold mb-1 md:mb-1.5 shadow-md">
                  4
                </div>
                <p className="font-medium text-xs md:text-sm">Book & Go</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">Walk in confident</p>
              </div>
            </div>
          </div>

        </div>
      </section>
    </>
  );
}
