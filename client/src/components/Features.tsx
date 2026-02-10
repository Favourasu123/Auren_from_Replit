import { Sparkles, Users, Zap, Shield, MessageCircle } from "lucide-react";
import feature1 from "@assets/stock_images/professional_hairsty_22a97611.jpg";
import feature2 from "@assets/stock_images/professional_hairsty_9dafeefb.jpg";

const features = [
  {
    icon: Sparkles,
    title: "Know What You Want",
    description:
      "Stop scrolling Pinterest feeling unsure. Try dozens of styles on YOUR face until you find the one that makes you say 'that's it.' No more walking into a salon hoping for the best.",
    image: feature1,
    imageAlt: "Style discovery",
  },
  {
    icon: Users,
    title: "Show Your Stylist Exactly",
    description:
      "Every stylist knows the struggle: 'I want it shorter but not too short.' Hand them a photo of your face with your dream style—they'll finally know exactly what you mean.",
    image: feature2,
    imageAlt: "Stylist communication",
  },
];

const additionalFeatures = [
  {
    icon: MessageCircle,
    title: "Refine Until Perfect",
    description: "Not quite right? Tell our AI what to change. 'A bit shorter,' 'more volume,' 'warmer color'—keep refining until it's exactly what you want.",
  },
  {
    icon: Zap,
    title: "Instant Try-Ons",
    description: "See yourself with any hairstyle in seconds. No appointments, no commitment, no regrets.",
  },
  {
    icon: Shield,
    title: "Private & Secure",
    description: "Your photos are encrypted and automatically deleted after 24 hours.",
  },
];

export default function Features() {
  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="font-heading font-bold text-3xl md:text-4xl mb-3">
            Two Problems, <span className="text-primary">One Solution</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            You don't know what you want. Your stylist doesn't know what you want. Let's fix both.
          </p>
        </div>

        <div className="space-y-20">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            const isEven = index % 2 === 0;

            return (
              <div
                key={index}
                className={`flex flex-col ${
                  isEven ? "md:flex-row" : "md:flex-row-reverse"
                } items-center gap-12`}
                data-testid={`feature-${index + 1}`}
              >
                <div className="flex-1">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
                    <Icon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="font-heading font-bold text-2xl mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
                <div className="flex-1">
                  <img
                    src={feature.image}
                    alt={feature.imageAlt}
                    className="rounded-lg w-full h-auto"
                  />
                </div>
              </div>
            );
          })}

          <div className="grid md:grid-cols-3 gap-8 pt-4">
            {additionalFeatures.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div key={index}>
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
                    <Icon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="font-heading font-bold text-2xl mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
