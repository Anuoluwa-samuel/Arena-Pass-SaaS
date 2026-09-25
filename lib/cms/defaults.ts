import type { AboutContent, ContactContent, HomepageContent, ServicesPageContent } from "./schemas"

export const DEFAULT_HOMEPAGE: HomepageContent = {
  hero: {
    badge: "Live sessions available now",
    title: "Secure Your Spot.",
    highlight: "Play the Game.",
    description:
      "Book football sessions with ease. Get notified when tickets become available and secure your spot before time runs out.",
    primaryCta: { label: "View Sessions", href: "/sessions" },
    secondaryCta: { label: "Create Account", href: "/signup" },
    imageUrl: null,
  },
  howItWorks: {
    title: "How It Works",
    subtitle: "Get on the field in three simple steps",
    steps: [
      { title: "Find a Session", description: "Browse upcoming football sessions and find one that fits your schedule.", icon: "ticket" },
      { title: "Pick Your Slot", description: "Each session has 8 teams of 4. Grab a player slot before the booking window closes.", icon: "clock" },
      { title: "Pay & Play", description: "Complete your payment securely and receive your digital ticket instantly.", icon: "credit-card" },
    ],
  },
  cta: {
    title: "Ready to Play?",
    description: "Join thousands of players who book their sessions through Game Slots.",
    buttonLabel: "Browse Sessions",
    buttonHref: "/sessions",
  },
  featuredSessionsCount: 3,
}

export const DEFAULT_ABOUT: AboutContent = {
  title: "About Game Slots",
  description:
    "Game Slots is the easiest way to book a place in organised 4-a-side football sessions. We manage the pitch, the teams and the kick-off so all you have to do is show up and play.",
  mission: "Make organised football accessible to everyone, every week.",
  vision: "A pitch full of players in every city, every evening.",
  imageUrl: null,
}

export const DEFAULT_SERVICES: ServicesPageContent = {
  title: "What We Offer",
  subtitle: "Everything you need for a great game",
}

export const DEFAULT_CONTACT: ContactContent = {
  email: "hello@gameslots.local",
  phone: "+234 800 000 0000",
  address: "Lagos, Nigeria",
  whatsapp: "",
  instagram: "",
  twitter: "",
  mapUrl: "",
}

export const DEFAULT_CMS_CONTENT = {
  homepage: DEFAULT_HOMEPAGE,
  about: DEFAULT_ABOUT,
  services: DEFAULT_SERVICES,
  contact: DEFAULT_CONTACT,
} as const
