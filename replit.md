# Auren - AI Virtual Hairstyle Try-On App

## Overview

Auren is an AI-powered virtual hairstyle try-on platform designed to help users visualize different hairstyles on themselves using AI-generated photorealistic images. It aims to enhance self-discovery for users and improve communication between clients and stylists by offering precise visual representations. The platform also integrates salon finding and booking functionalities.

Key capabilities include:

-   **Two Generation Modes**: Text Mode (describes desired style) and Inspiration Mode (uploads an inspiration photo with multiple AI pipelines).
-   **AI Polish Feature**: Recommends personalized styles based on trending celebrity/model haircuts.
-   **Monetization**: Offers free plans, pay-as-you-go credits, monthly subscriptions, and a business plan.
-   **Community and Booking**: Features an "Explore Page" (future) and a "Stylists Page" for browsing and booking appointments with Auren-verified stylists.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React 18, TypeScript, and Vite, utilizing Wouter for routing, React Query for server state, and `shadcn/ui` with Radix UI primitives for the UI. Styling is managed by Tailwind CSS with custom design tokens, following a "New York" style variant, emphasizing a visual-first approach with glass-morphism effects, hover elevations, and responsive grid layouts. The application is also configured as a Progressive Web App (PWA) with install prompts, service worker caching, and push notification support.

### Backend Architecture

The backend is developed with Express.js on Node.js using TypeScript and ESM modules. It provides a RESTful API for photo uploads, AI generation, session management, salon discovery, user authentication, credit management, and Stripe-based payment processing. It orchestrates AI model calls, stores image URLs, and updates generation statuses. The system incorporates stability features like rate limiting, automatic cache cleanup, retry logic for external APIs, double-booking prevention, session generation limits, and a server-side generation queue with deduplication and exponential backoff retries.

### Data Storage

A PostgreSQL database, accessed via Drizzle ORM, stores all application data, including user sessions, generated variants, user profiles, credit transactions, salon/stylist information, appointments, hairstyles, and video content.

### Advanced Scheduling System

The platform includes a comprehensive scheduling system allowing stylists to configure availability rules, manage time-off, and generate 30-minute interval slots. It features double-booking prevention, a waitlist system, support for recurring appointments, and VAPID-based web push notifications for booking confirmations, reminders, and waitlist updates. Users can view appointment history, submit reviews, and reschedule appointments.

### System Design Choices

-   **Generation Modes**: Configurable via environment variables for "PURE_AI" (front view) or "HYBRID" (composite + AI) and different inspiration pipelines ("standard", "fill", "opencv").
-   **Image Generation**: Uses a 3-image pipeline (user mask, hair reference, original photo) for optimal results.
-   **UI/UX**: Focuses on visual transformation, before/after comparisons, and a streamlined user journey. Desktop results feature a side-by-side layout for generated images and refinement panels.
-   **Booking Payment Flow**: Implemented as a full-screen, step-by-step process with Stripe Elements for card payments. A 20% cancellation fee applies for appointments cancelled less than 3 hours prior.

## External Dependencies

### AI Services

-   **BFL FLUX 2 Pro**: Primary model for text and inspiration-based hairstyle generation.
-   **BFL FLUX Fill**: Used for inpainting with hair masks.
-   **Replicate (hadilq/hair-segment)**: For precise hair segmentation.
-   **fal.ai FLUX dev**: For refining blended images.
-   **Python/OpenCV**: For advanced image blending and compositing.
-   **Together AI Llama-4-Scout Vision Model**: Analyzes inspiration photos.

### API Integrations

-   **Serper API**: For intelligent web-based image searches.
-   **Google Places API**: For discovering salons and stylists.
-   **Stripe**: For secure payment processing.

### Database

-   **Neon Serverless PostgreSQL**: Primary database solution.

### Other

-   **Google Fonts CDN**: For display fonts.
-   **npm**: For package management.