# AI Grooming App - Design Guidelines

## Design Approach

**Selected Approach:** Reference-Based (Experience-Focused)

Drawing inspiration from Instagram's visual-first interface, Pinterest's discovery patterns, and Airbnb's marketplace aesthetic. The app requires an engaging, beauty-focused experience that builds trust through visual polish.

**Key Principles:**
- Visual-first: Images and transformations are the hero content
- Trust-building: Professional, polished interface inspires confidence
- Intuitive flow: Seamless journey from photo → customization → booking

## Typography System

**Font Stack:** Google Fonts - "Inter" (UI/body) + "DM Sans" (headings)

**Hierarchy:**
- Hero/Page Titles: 4xl-6xl, font-bold (DM Sans)
- Section Headings: 2xl-3xl, font-semibold (DM Sans)
- Card Titles: lg-xl, font-medium (Inter)
- Body Text: base, font-normal (Inter)
- Captions/Meta: sm-xs, font-normal (Inter)

## Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, 8, 12, 16, 24

**Container Strategy:**
- Main container: max-w-7xl mx-auto px-4
- Content sections: py-12 to py-24
- Card padding: p-6
- Element spacing: gap-4 to gap-8

## Core Components

### Navigation
Top navigation bar with glass-morphism effect (backdrop-blur), sticky positioning. Left-aligned logo, center navigation links (Home, Customize, Salons, Gallery), right-aligned user profile/login button.

### Photo Upload Zone
Large, centered upload area (min-h-96) with dashed border, drag-and-drop functionality. Two prominent CTAs: "Upload Photo" and "Take Selfie" buttons side-by-side. Include small file size/format guidance text below.

### AI Customization Panel
Sidebar panel (w-80 on desktop, full-width drawer on mobile) with:
- Category tabs (Hairstyle, Color, Length, Texture)
- Scrollable grid of visual presets (3 columns on desktop)
- Each preset: square thumbnail with subtle hover lift effect
- Selected state: border accent and check icon overlay

### Before/After Comparison
Split-screen view with draggable slider divider. "Before" label top-left, "After" label top-right. Bottom action bar with: Save, Download, and "Book This Look" CTA buttons.

### Salon Listing Cards
Grid layout (grid-cols-1 md:grid-cols-2 lg:grid-cols-3) with cards featuring:
- Salon photo (aspect-ratio-16/9, rounded-t-lg)
- Salon name (text-xl font-semibold)
- Rating stars + review count
- Distance indicator with map pin icon
- Address line (text-sm)
- "View Details" and "Book Now" buttons (horizontal stack)
- Card shadow on hover with subtle lift

### Map Integration
Full-width map view (h-96 to h-screen toggle). Location markers for salons, user location pin. Side panel overlay (w-96) showing salon details when marker clicked.

### Gallery/History Section
Masonry grid of saved transformations. Each item: transformation image with overlay showing hairstyle name and save date on hover. Click to expand full comparison view.

## Page Layouts

### Landing Page
1. Hero: Full-width (h-screen) with background gradient, centered content. Large headline, subheadline, primary CTA "Try It Now", secondary CTA "Find Salons". Hero image showing transformation example (split before/after).

2. How It Works: 3-column grid with numbered steps, icons, descriptions (py-20)

3. Features Showcase: Alternating 2-column layouts (image-text, text-image) for key features

4. Sample Transformations: Full-width carousel with large before/after examples (h-96)

5. Salon Partners: Logo grid of featured barbershops/salons

6. Social Proof: Testimonial cards in 3-column grid

7. Final CTA: Centered with background treatment, prominent button

### Customization Interface
Split layout:
- Left: Live preview area (2/3 width) showing AI transformation
- Right: Customization panel (1/3 width) with controls
- Bottom: Fixed action bar with primary CTAs

### Salon Directory
- Top: Map view (collapsible)
- Filters bar: Search, distance, rating, services
- Salon cards grid below
- Pagination at bottom

## Images

**Hero Image:** Large before/after split transformation (professional quality, diverse representation). Position: Hero section background with overlay gradient.

**Feature Images:** High-quality photos of people with various hairstyles. Position: Feature showcase sections, alternating sides.

**Salon Photos:** Storefront and interior shots. Position: Salon listing cards and detail pages.

**Transformation Gallery:** User-generated before/after photos. Position: Gallery section, masonry grid.

## Icons

**Library:** Heroicons (outline for secondary actions, solid for primary states)

**Key Icons:** Camera, upload, scissors, map-pin, star (rating), check (selection), chevrons (navigation)

## Animations

Use sparingly:
- Card hover: Subtle lift (translate-y-1) with shadow increase
- Image transitions: Smooth crossfade (transition-opacity duration-300)
- Panel slides: Drawer open/close (transform translate-x)
- Button states: Standard hover/active (no custom animations)

## Accessibility

- Maintain 4.5:1 contrast for all text
- Focus rings on all interactive elements (ring-2 ring-offset-2)
- Alt text for all transformation images
- ARIA labels for icon-only buttons
- Keyboard navigation support for slider controls