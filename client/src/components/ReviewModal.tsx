import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Star, Loader2 } from "lucide-react";
import type { BookingWithDetails } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithDetails;
  onSuccess: () => void;
}

export function ReviewModal({ open, onOpenChange, booking, onSuccess }: ReviewModalProps) {
  const { toast } = useToast();
  const [businessRating, setBusinessRating] = useState(0);
  const [stylistRating, setStylistRating] = useState(0);
  const [comment, setComment] = useState("");
  const [hoverBusiness, setHoverBusiness] = useState(0);
  const [hoverStylist, setHoverStylist] = useState(0);

  const reviewMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/reviews", {
        bookingId: booking.id,
        businessRating: businessRating || undefined,
        stylistRating: stylistRating || undefined,
        comment: comment.trim() || undefined,
      });
    },
    onSuccess: () => {
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to submit review",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const canSubmit = businessRating > 0 || stylistRating > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Leave a Review</DialogTitle>
          <DialogDescription>
            Share your experience at {booking.business?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label>Rate the salon</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className="p-1 hover-elevate rounded"
                  onMouseEnter={() => setHoverBusiness(star)}
                  onMouseLeave={() => setHoverBusiness(0)}
                  onClick={() => setBusinessRating(star)}
                  data-testid={`button-business-star-${star}`}
                >
                  <Star
                    className={`h-8 w-8 ${
                      star <= (hoverBusiness || businessRating)
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Rate your stylist ({booking.stylist?.name})</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className="p-1 hover-elevate rounded"
                  onMouseEnter={() => setHoverStylist(star)}
                  onMouseLeave={() => setHoverStylist(0)}
                  onClick={() => setStylistRating(star)}
                  data-testid={`button-stylist-star-${star}`}
                >
                  <Star
                    className={`h-8 w-8 ${
                      star <= (hoverStylist || stylistRating)
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comment">Comments (optional)</Label>
            <Textarea
              id="comment"
              placeholder="Tell us about your experience..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              data-testid="input-review-comment"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-review">
            Cancel
          </Button>
          <Button
            onClick={() => reviewMutation.mutate()}
            disabled={!canSubmit || reviewMutation.isPending}
            data-testid="button-submit-review"
          >
            {reviewMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Review"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
