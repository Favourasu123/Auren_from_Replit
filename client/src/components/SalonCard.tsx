import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Star } from "lucide-react";

interface SalonCardProps {
  name: string;
  image: string;
  rating: number;
  reviewCount: number;
  distance: string;
  address: string;
}

export default function SalonCard({
  name,
  image,
  rating,
  reviewCount,
  distance,
  address,
}: SalonCardProps) {
  return (
    <Card className="overflow-hidden hover-elevate active-elevate-2">
      <div className="aspect-video overflow-hidden">
        <img
          src={image}
          alt={name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="p-6">
        <h3 className="font-heading font-semibold text-xl mb-2">{name}</h3>
        
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-primary text-primary" />
            <span className="font-medium">{rating.toFixed(1)}</span>
          </div>
          <span className="text-sm text-muted-foreground">
            ({reviewCount} reviews)
          </span>
        </div>

        <div className="flex items-start gap-2 mb-4">
          <MapPin className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
          <div className="text-sm">
            <p className="text-muted-foreground">{address}</p>
            <p className="text-primary font-medium">{distance}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" data-testid="button-view-details">
            View Details
          </Button>
          <Button variant="default" className="flex-1" data-testid="button-book">
            Book Now
          </Button>
        </div>
      </div>
    </Card>
  );
}
