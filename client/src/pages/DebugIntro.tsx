import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowLeft, X, Camera, MessageCircle, Upload, Sparkles, Gift, Scissors, CheckCircle2 } from "lucide-react";
import idealPhotoExample from "@assets/generated_images/ideal_photo_example.png";
import modeDescribeIt from "@/assets/images/mode_describe_it.png";
import modeUploadInspo from "@/assets/images/mode_upload_inspo.png";
import modeAurenIQ from "@/assets/images/mode_aureniq.png";

export default function DebugIntro() {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Debug: Intro Slide Preview</h1>
        </div>

        <div className="rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-b from-slate-50 via-white to-slate-100 flex flex-col" style={{ height: "700px" }}>
            <div className="flex items-center justify-between px-5 pt-6 pb-4">
              <span className="font-bold text-xl tracking-tight text-slate-800" style={{ fontFamily: "'Nunito', 'Poppins', sans-serif" }}>
                AÜREN
              </span>
              <button
                className="p-2 rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
                data-testid="button-close-instructions"
              >
                <X className="h-5 w-5 text-slate-600" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="text-center mb-5">
                <h1 className="text-2xl font-bold text-slate-800 mb-1">How-To-Use</h1>
                <p className="text-slate-500 text-sm">Upgrade your hair days with Auren</p>
              </div>

              <div className="space-y-3">
                {/* Section 1: Upload Photo with Example Image */}
                <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-md">
                      <Camera className="h-4 w-4 text-white" />
                    </div>
                    <h3 className="text-slate-800 font-semibold">1. Upload Your Photo</h3>
                  </div>
                  <div className="flex gap-3 items-start">
                    <img 
                      src={idealPhotoExample} 
                      alt="Ideal photo example" 
                      className="w-20 h-28 object-cover rounded-lg border-2 border-slate-200 shadow-sm"
                    />
                    <ul className="text-slate-600 text-sm space-y-1.5 flex-1">
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span>Front-facing, looking at camera</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span>Good lighting on face</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span>Space above head for hair</span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Section 2: Choose Your Style - Enhanced */}
                <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-md">
                      <Sparkles className="h-4 w-4 text-white" />
                    </div>
                    <h3 className="text-slate-800 font-semibold">2. Choose Your Style</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col items-center gap-1.5 p-2 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200">
                      <div className="w-full aspect-square rounded-lg overflow-hidden mb-1">
                        <img src={modeDescribeIt} alt="Describe your hairstyle" className="w-full h-full object-cover" />
                      </div>
                      <span className="text-xs text-slate-700 font-medium text-center">Describe It</span>
                      <span className="text-[10px] text-slate-500 text-center leading-tight">Type your dream look</span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 p-2 bg-gradient-to-br from-amber-50 to-orange-100 rounded-xl border border-amber-200">
                      <div className="w-full aspect-square rounded-lg overflow-hidden mb-1">
                        <img src={modeUploadInspo} alt="Upload inspiration photo" className="w-full h-full object-cover" />
                      </div>
                      <span className="text-xs text-slate-700 font-medium text-center">Upload Inspo</span>
                      <span className="text-[10px] text-slate-500 text-center leading-tight">Use a reference photo</span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 p-2 bg-gradient-to-br from-pink-50 to-rose-100 rounded-xl border border-pink-200">
                      <div className="w-full aspect-square rounded-lg overflow-hidden mb-1">
                        <img src={modeAurenIQ} alt="AurenIQ AI suggestions" className="w-full h-full object-cover" />
                      </div>
                      <span className="text-xs text-slate-700 font-medium text-center">AurenIQ</span>
                      <span className="text-[10px] text-slate-500 text-center leading-tight">AI picks for you</span>
                    </div>
                  </div>
                </div>

                {/* Section 3: Book a Stylist */}
                <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md">
                      <Scissors className="h-4 w-4 text-white" />
                    </div>
                    <h3 className="text-slate-800 font-semibold">3. Book a Trusted Stylist</h3>
                  </div>
                  <p className="text-slate-500 text-sm ml-10">Find verified stylists on Auren and bring your new look to life</p>
                </div>
              </div>

              {/* Survey Incentive */}
              <div className="mt-4 p-3 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md">
                    <Gift className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-slate-800 font-medium text-sm">Win a $25 Gift Card!</p>
                    <p className="text-slate-500 text-xs">Complete our quick survey for a chance to win</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-shrink-0 px-5 py-4 border-t border-slate-200 bg-white/80 backdrop-blur-sm">
              <Button
                className="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-6"
                data-testid="button-start-creating"
              >
                Begin Your Journey
              </Button>
              <p className="text-center text-xs text-slate-400 mt-3">
                BETA — Free to use during testing
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
