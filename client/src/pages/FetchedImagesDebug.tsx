import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface FetchedImage {
  index: number;
  source: string;
  url: string;
  base64Preview: string;
}

interface FetchedImagesResponse {
  count: number;
  timestamp: string | null;
  images: FetchedImage[];
}

export default function FetchedImagesDebug() {
  const [data, setData] = useState<FetchedImagesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchImages = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/debug/fetched-images?t=${Date.now()}`);
      const json = await response.json();
      setData(json);
    } catch (e) {
      console.error("Failed to fetch images:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, [refreshKey]);

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Fetched Reference Images</h1>
            <p className="text-muted-foreground">
              {data?.count || 0} images fetched
              {data?.timestamp && ` at ${new Date(data.timestamp).toLocaleTimeString()}`}
            </p>
          </div>
          <Button onClick={handleRefresh} variant="outline" size="sm" data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : !data?.images?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            No images fetched yet. Run a generation first.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {data.images.map((img) => (
              <div key={img.index} className="relative group" data-testid={`image-card-${img.index}`}>
                <div className="aspect-square rounded-lg overflow-hidden bg-muted">
                  <img
                    src={`/api/debug/fetched-image/${img.index}?t=${refreshKey}`}
                    alt={`Reference ${img.index}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                  #{img.index}
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-2 opacity-0 group-hover:opacity-100 transition-opacity truncate">
                  {img.source}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
