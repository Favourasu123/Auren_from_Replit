import Navigation from "@/components/Navigation";
import ImageUploader from "@/components/ImageUploader";
import CustomizationPanel from "@/components/CustomizationPanel";
import { Button } from "@/components/ui/button";
import { Download, Share2 } from "lucide-react";

export default function Customize() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      
      <div className="flex-1 flex">
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-auto">
            <ImageUploader />
          </div>
          
          <div className="border-t p-4 bg-card">
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" data-testid="button-download">
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button variant="outline" size="sm" data-testid="button-share">
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
              </div>
              <Button size="sm" data-testid="button-book-look">
                Book This Look
              </Button>
            </div>
          </div>
        </div>

        <div className="w-80 hidden lg:block">
          <CustomizationPanel />
        </div>
      </div>
    </div>
  );
}
