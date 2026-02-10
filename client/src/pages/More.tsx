import { Link } from "wouter";
import { ChevronRight, Sparkles, CreditCard, Compass, MapPin, Store, Info, Shield, FileText, HelpCircle } from "lucide-react";
import Navigation from "@/components/Navigation";
import { useState } from "react";

const faqs = [
  {
    question: "How do credits work?",
    answer: "Each AI hairstyle generation costs 1 credit. Free plan users get 3 credits daily that reset every 24 hours. Paid plans provide credits that never expire (pay-as-you-go) or monthly allocations (subscription plans)."
  },
  {
    question: "Can I cancel my subscription anytime?",
    answer: "Yes! You can cancel your Monthly or Business subscription at any time. You'll continue to have access until the end of your billing period."
  },
  {
    question: "Do pay-as-you-go credits expire?",
    answer: "No, credits purchased with the pay-as-you-go plan never expire. Use them whenever you want, at your own pace."
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept all major credit cards (Visa, MasterCard, American Express) and digital wallets through our secure payment processor, Stripe."
  }
];

export default function More() {
  const [showFaq, setShowFaq] = useState(false);
  
  const sections = [
    {
      title: "Product",
      items: [
        { label: "Try It Free", href: "/upload", icon: Sparkles },
        { label: "Pricing", href: "/pricing", icon: CreditCard },
        { label: "Explore", href: "/explore", icon: Compass },
      ],
    },
    {
      title: "For Stylists",
      items: [
        { label: "Find Stylists", href: "/stylists", icon: MapPin },
        { label: "List Your Salon", href: "/list-your-salon", icon: Store },
      ],
    },
    {
      title: "Company",
      items: [
        { label: "About", href: "/about", icon: Info },
        { label: "Privacy", href: "/privacy", icon: Shield },
        { label: "Terms", href: "/terms", icon: FileText },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 pb-20 md:pb-0">
      <Navigation />
      <div className="max-w-lg mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-foreground mb-6">More</h1>
        
        {sections.map((section) => (
          <div key={section.title} className="mb-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
              {section.title}
            </h2>
            <div className="bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-sm">
              {section.items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <Link key={item.label} href={item.href}>
                    <div
                      className={`flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer ${
                        index !== section.items.length - 1 ? "border-b border-gray-100 dark:border-slate-700" : ""
                      }`}
                      data-testid={`more-link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                          <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <span className="text-foreground font-medium">{item.label}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* FAQ Section */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
            Help
          </h2>
          <div className="bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={() => setShowFaq(!showFaq)}
              className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer w-full"
              data-testid="more-link-faq"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <HelpCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-foreground font-medium">FAQ</span>
              </div>
              <ChevronRight className={`w-5 h-5 text-muted-foreground transition-transform ${showFaq ? "rotate-90" : ""}`} />
            </button>
            
            {showFaq && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-100 dark:border-slate-700 pt-4">
                {faqs.map((faq, idx) => (
                  <div key={idx} className="pb-4 border-b border-gray-100 dark:border-slate-700 last:border-b-0 last:pb-0">
                    <h3 className="text-sm font-medium mb-1 text-foreground">{faq.question}</h3>
                    <p className="text-sm text-muted-foreground">{faq.answer}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div className="text-center text-sm text-muted-foreground mt-8">
          <p>&copy; {new Date().getFullYear()} Auren. All rights reserved.</p>
          <p className="mt-1">Powered by AI</p>
        </div>
      </div>
    </div>
  );
}
