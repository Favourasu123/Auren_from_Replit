import SalonCard from '../SalonCard';
import salonImage from '@assets/stock_images/modern_barbershop_in_d23fe720.jpg';

export default function SalonCardExample() {
  return (
    <div className="max-w-sm">
      <SalonCard
        name="Elite Cuts Barbershop"
        image={salonImage}
        rating={4.8}
        reviewCount={124}
        distance="0.5 miles away"
        address="123 Main Street, Downtown"
      />
    </div>
  );
}
