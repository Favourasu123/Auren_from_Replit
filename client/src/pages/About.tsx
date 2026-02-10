import Navigation from "@/components/Navigation";
import { Sparkles, Users, Zap, CheckCircle2, Target } from "lucide-react";

import phoneHairstyleTryOn from "@assets/generated_images/phone_showing_male_hairstyle_try-on.png";
import happySalonImage from "@assets/generated_images/happy_client_in_bright_salon.png";
import transformImage from "@assets/generated_images/male_before_after_hair_transformation.png";
import confidentImage from "@assets/generated_images/confident_man_entering_salon.png";
import sharingImage from "@assets/generated_images/client_stylist_phone_sharing.png";

const slides = [
  {
    id: "welcome",
    title: "Get the look you want",
    subtitle: "Auren makes it effortless",
    description: "Discover, preview, and perfect your ideal hairstyle with AI before your appointment.",
    image: phoneHairstyleTryOn,
    icon: Sparkles,
    gradient: "from-purple-600 to-pink-500",
  },
  {
    id: "know-your-look",
    title: "Know your look",
    subtitle: "Show your stylist. Get it done right.",
    description: "Get the exact look you want using AI, and share your vision with your stylist confidently.",
    image: happySalonImage,
    icon: Users,
    gradient: "from-blue-600 to-cyan-500",
  },
  {
    id: "realistic-tryons",
    title: "Realistic Try-ons",
    subtitle: "Find the right cut",
    description: "Preview any hairstyle on your actual face with AI-powered, photorealistic transformations.",
    image: transformImage,
    icon: Zap,
    gradient: "from-orange-500 to-amber-500",
  },
  {
    id: "confidence",
    title: "Choose with confidence",
    subtitle: "Work together with your stylist",
    description: "Browse verified stylists, see their portfolios, and book with transparent pricing.",
    image: confidentImage,
    icon: CheckCircle2,
    gradient: "from-green-500 to-emerald-500",
  },
  {
    id: "business",
    title: "Upgrade your business",
    subtitle: "with Auren",
    description: "AI-powered consultations help clients know what they want. Play to your strengths.",
    image: sharingImage,
    icon: Target,
    gradient: "from-slate-600 to-slate-800",
  },
];

export default function About() {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4" data-testid="text-about-title">
            About <span className="font-bold" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>AÜREN</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            AI-powered hairstyle visualization that bridges the gap between your vision and your stylist's expertise.
          </p>
        </div>

        <div className="space-y-8">
          {slides.map((slide, index) => {
            const SlideIcon = slide.icon;
            return (
              <div 
                key={slide.id}
                className={`bg-card rounded-2xl overflow-hidden shadow-sm border ${index % 2 === 0 ? '' : 'md:flex-row-reverse'} md:flex`}
                data-testid={`about-slide-${slide.id}`}
              >
                <div className="md:w-1/2 h-48 md:h-auto relative">
                  <img 
                    src={slide.image} 
                    alt={slide.title} 
                    className="w-full h-full object-cover"
                  />
                  <div className={`absolute inset-0 bg-gradient-to-br ${slide.gradient} opacity-20`} />
                </div>
                
                <div className="md:w-1/2 p-6 md:p-8 flex flex-col justify-center">
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${slide.gradient} mb-4`}>
                    <SlideIcon className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-foreground mb-1">
                    {slide.title}
                  </h2>
                  <p className="text-muted-foreground font-medium mb-3">{slide.subtitle}</p>
                  <p className="text-muted-foreground leading-relaxed">
                    {slide.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-16 text-center">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-8 md:p-12">
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
              Our Mission
            </h2>
            <p className="text-white/80 text-lg max-w-2xl mx-auto leading-relaxed">
              We believe everyone deserves to feel confident about their next haircut. 
              Auren bridges the communication gap between clients and stylists, 
              using AI to help you visualize and articulate exactly what you want.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
