import { Camera, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function ImageUploader() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadedImage(event.target?.result as string);
        console.log("Image uploaded:", file.name);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex items-center justify-center h-full p-8">
      {!uploadedImage ? (
        <div className="max-w-md w-full">
          <div className="border-2 border-dashed rounded-lg p-12 text-center hover-elevate active-elevate-2 cursor-pointer">
            <Upload className="h-16 w-16 mx-auto mb-6 text-muted-foreground" />
            <h3 className="font-heading font-semibold text-2xl mb-3">
              Upload Your Photo
            </h3>
            <p className="text-muted-foreground mb-8">
              Drag and drop or click to select a photo
            </p>

            <div className="flex flex-col gap-3">
              <Button
                variant="default"
                size="lg"
                onClick={() => document.getElementById("file-upload")?.click()}
                data-testid="button-upload"
              >
                <Upload className="mr-2 h-5 w-5" />
                Upload Photo
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => console.log("Take selfie clicked")}
                data-testid="button-camera"
              >
                <Camera className="mr-2 h-5 w-5" />
                Take Selfie
              </Button>
            </div>

            <input
              id="file-upload"
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />

            <p className="text-xs text-muted-foreground mt-6">
              Supports JPG, PNG up to 10MB
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-2xl w-full">
          <div className="relative rounded-lg overflow-hidden">
            <img
              src={uploadedImage}
              alt="Uploaded photo"
              className="w-full h-auto"
            />
          </div>
          <div className="flex gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => setUploadedImage(null)}
              className="flex-1"
              data-testid="button-change-photo"
            >
              Change Photo
            </Button>
            <Button
              variant="default"
              onClick={() => console.log("Start customization")}
              className="flex-1"
              data-testid="button-start-customization"
            >
              Start Customizing
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
