import { Card } from "@/components/ui/card";
import transform1 from "@assets/stock_images/person_getting_hairc_11b2c943.jpg";
import transform2 from "@assets/stock_images/person_getting_hairc_c50e51ff.jpg";
import transform3 from "@assets/stock_images/person_getting_hairc_7a968364.jpg";

const transformations = [
  {
    image: transform1,
    title: "Modern Cut",
  },
  {
    image: transform2,
    title: "Classic Style",
  },
  {
    image: transform3,
    title: "Fresh Look",
  },
];

export default function Transformations() {
  return (
    <section className="py-20 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="font-heading font-bold text-3xl md:text-4xl mb-3">
            Real Transformations
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            See what's possible with the right style
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {transformations.map((item, index) => (
            <Card
              key={index}
              className="overflow-hidden hover-elevate active-elevate-2 cursor-pointer"
              data-testid={`transformation-${index + 1}`}
            >
              <div className="aspect-[3/4] overflow-hidden">
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4">
                <h3 className="font-heading font-semibold text-lg">
                  {item.title}
                </h3>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
