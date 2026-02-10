import Navigation from "@/components/Navigation";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Navigation />
      
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-terms-title">
          Terms of Service
        </h1>
        <p className="text-muted-foreground mb-8">Last updated: January 31, 2026</p>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using Auren ("the Service"), you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use the Service. 
              We reserve the right to modify these terms at any time, and your continued use of the Service 
              constitutes acceptance of any modifications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Description of Service</h2>
            <p className="text-muted-foreground leading-relaxed">
              Auren is an AI-powered platform that allows users to visualize different hairstyles on their photos, 
              connect with verified stylists, and book salon appointments. The Service includes hairstyle generation, 
              stylist discovery, appointment booking, and related features.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. User Accounts</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              To access certain features, you must create an account. You agree to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Provide accurate and complete information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Notify us immediately of any unauthorized use</li>
              <li>Accept responsibility for all activities under your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Credits and Payments</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The Service uses a credit-based system for AI hairstyle generations:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Free users receive daily credits that reset every 24 hours</li>
              <li>Purchased credits do not expire and are non-refundable</li>
              <li>Subscription credits are provided monthly and do not roll over</li>
              <li>All payments are processed securely through Stripe</li>
              <li>Prices are subject to change with reasonable notice</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. User Content</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              By uploading photos or other content ("User Content"), you:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Confirm you have the right to upload such content</li>
              <li>Grant us a license to process the content for providing the Service</li>
              <li>Agree not to upload illegal, offensive, or harmful content</li>
              <li>Understand that generated images are for personal, non-commercial use</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. AI-Generated Content</h2>
            <p className="text-muted-foreground leading-relaxed">
              AI-generated hairstyle images are provided for visualization purposes only. 
              Results may vary from actual haircuts performed by stylists. 
              Auren does not guarantee that any hairstyle can be replicated exactly by a stylist. 
              We are not responsible for salon outcomes based on AI-generated previews.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Stylist and Booking Services</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              When booking appointments through the platform:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Stylists are independent professionals, not Auren employees</li>
              <li>Auren is not responsible for the quality of salon services</li>
              <li>Cancellation policies are set by individual stylists/salons</li>
              <li>A cancellation fee may apply for late cancellations (typically 20% if within 3 hours)</li>
              <li>Disputes with stylists should be addressed directly with them first</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Prohibited Conduct</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              You agree not to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Use the Service for any illegal purpose</li>
              <li>Upload content depicting minors or inappropriate material</li>
              <li>Attempt to reverse-engineer or copy our AI technology</li>
              <li>Use automated systems to access the Service without permission</li>
              <li>Harass, abuse, or harm other users or stylists</li>
              <li>Circumvent credit or payment systems</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Intellectual Property</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Service, including its design, features, and AI technology, is owned by Auren and 
              protected by intellectual property laws. You may not copy, modify, or distribute any 
              part of the Service without our written permission.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground leading-relaxed">
              THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. 
              WE DO NOT GUARANTEE THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, 
              OR THAT AI-GENERATED IMAGES WILL MEET YOUR EXPECTATIONS.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, AUREN SHALL NOT BE LIABLE FOR ANY 
              INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY 
              LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">12. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may terminate or suspend your account at any time for violations of these Terms. 
              You may delete your account at any time. Upon termination, your right to use the 
              Service will immediately cease.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">13. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">
              These Terms shall be governed by and construed in accordance with the laws of the 
              United States, without regard to conflict of law principles.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">14. Contact Information</h2>
            <p className="text-muted-foreground leading-relaxed">
              For questions about these Terms of Service, please contact us at 
              legal@auren.app or through our support channels.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
