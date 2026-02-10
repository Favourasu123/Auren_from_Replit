import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check } from "lucide-react";
import { useState } from "react";

const hairstyles = [
  { id: 1, name: "Classic Fade", category: "fade" },
  { id: 2, name: "Textured Crop", category: "crop" },
  { id: 3, name: "Side Part", category: "classic" },
  { id: 4, name: "Undercut", category: "modern" },
  { id: 5, name: "Pompadour", category: "classic" },
  { id: 6, name: "Buzz Cut", category: "short" },
];

const colors = [
  { id: 1, name: "Natural Black", hex: "#000000" },
  { id: 2, name: "Dark Brown", hex: "#3B2F2F" },
  { id: 3, name: "Chestnut", hex: "#8B4513" },
  { id: 4, name: "Blonde", hex: "#F4E4C1" },
  { id: 5, name: "Platinum", hex: "#E5E4E2" },
  { id: 6, name: "Auburn", hex: "#A52A2A" },
];

export default function CustomizationPanel() {
  const [selectedStyle, setSelectedStyle] = useState(1);
  const [selectedColor, setSelectedColor] = useState(1);

  return (
    <div className="h-full flex flex-col bg-card border-l">
      <div className="p-6 border-b">
        <h2 className="font-heading font-bold text-2xl">Customize Your Look</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose your perfect style
        </p>
      </div>

      <Tabs defaultValue="style" className="flex-1 flex flex-col">
        <TabsList className="w-full rounded-none border-b">
          <TabsTrigger value="style" className="flex-1" data-testid="tab-style">
            Hairstyle
          </TabsTrigger>
          <TabsTrigger value="color" className="flex-1" data-testid="tab-color">
            Color
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value="style" className="p-6 mt-0">
            <div className="grid grid-cols-2 gap-4">
              {hairstyles.map((style) => (
                <button
                  key={style.id}
                  onClick={() => {
                    setSelectedStyle(style.id);
                    console.log("Selected hairstyle:", style.name);
                  }}
                  className={`relative aspect-square rounded-md border-2 overflow-hidden hover-elevate active-elevate-2 ${
                    selectedStyle === style.id
                      ? "border-primary"
                      : "border-transparent"
                  }`}
                  data-testid={`style-${style.id}`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-accent/20" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-medium text-sm text-center px-2">
                      {style.name}
                    </span>
                  </div>
                  {selectedStyle === style.id && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                      <Check className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="color" className="p-6 mt-0">
            <div className="grid grid-cols-2 gap-4">
              {colors.map((color) => (
                <button
                  key={color.id}
                  onClick={() => {
                    setSelectedColor(color.id);
                    console.log("Selected color:", color.name);
                  }}
                  className={`relative aspect-square rounded-md border-2 overflow-hidden hover-elevate active-elevate-2 ${
                    selectedColor === color.id
                      ? "border-primary"
                      : "border-transparent"
                  }`}
                  data-testid={`color-${color.id}`}
                >
                  <div
                    className="absolute inset-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                    <span className="font-medium text-sm text-white">
                      {color.name}
                    </span>
                  </div>
                  {selectedColor === color.id && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                      <Check className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
