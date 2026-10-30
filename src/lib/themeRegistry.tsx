import { type LucideIcon, Gift, PartyPopper, Heart, Snowflake, Sparkles, Zap, Flame, Star, Palmtree } from "lucide-react"

export type ThemeCategory = 'all' | 'popular' | 'holidays' | 'occasions' | 'premium' | 'minimal'

export interface ThemeConfig {
    id: string
    name: string
    category: ThemeCategory[]
    isPremium: boolean
    styles: {
        background: string
        text: string
        border: string
        accent: string
        overlay?: string
    }
    icon: LucideIcon
    description?: string
}

export const THEME_CATEGORIES: { id: ThemeCategory; label: string; icon: LucideIcon }[] = [
    { id: 'all', label: 'All Themes', icon: Gift },
    { id: 'popular', label: 'Popular', icon: Flame }, // Defined below
    { id: 'holidays', label: 'Holidays', icon: Snowflake },
    { id: 'occasions', label: 'Occasions', icon: PartyPopper },
    { id: 'premium', label: 'Premium', icon: Star },
    { id: 'minimal', label: 'Minimal', icon: Zap },
]



export const THEME_REGISTRY: ThemeConfig[] = [
    // --- POPULAR / ESSENTIALS ---
    {
        id: 'modern',
        name: 'Modern Purple',
        category: ['all', 'popular', 'minimal'],
        isPremium: false,
        styles: {
            background: "bg-gradient-to-br from-purple-600 via-indigo-600 to-purple-700",
            text: "text-white",
            border: "border-purple-400/30",
            accent: "text-purple-200"
        },
        icon: Zap,
        description: "Our signature gradient. Clean and versatile."
    },
    {
        id: 'ocean',
        name: 'Ocean Breeze',
        category: ['all', 'popular'],
        isPremium: false,
        styles: {
            background: "bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-600",
            text: "text-white",
            border: "border-blue-400/30",
            accent: "text-cyan-200"
        },
        icon: Palmtree,
        description: "Calm and refreshing teal gradients."
    },

    // --- HOLIDAYS ---
    {
        id: 'christmas',
        name: 'Festive Red',
        category: ['all', 'holidays'],
        isPremium: false,
        styles: {
            background: "bg-gradient-to-br from-red-600 via-red-700 to-green-900",
            text: "text-red-50",
            border: "border-red-400/30",
            accent: "text-gold-400", // Tailwind doesn't have gold default, will use yellow-400
            overlay: "bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20"
        },
        icon: Gift,
        description: "Perfect for the holiday season."
    },
    {
        id: 'newyear',
        name: 'Midnight Sparkle',
        category: ['all', 'holidays', 'premium'],
        isPremium: true,
        styles: {
            background: "bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900",
            text: "text-white",
            border: "border-indigo-400/50",
            accent: "text-indigo-300"
        },
        icon: Sparkles,
        description: "Ring in the new year with style."
    },
    {
        id: 'thanksgiving',
        name: 'Harvest Gold',
        category: ['all', 'holidays'],
        isPremium: false,
        styles: {
            background: "bg-gradient-to-br from-orange-600 via-amber-700 to-brown-800",
            text: "text-orange-50",
            border: "border-orange-400/30",
            accent: "text-amber-200"
        },
        icon: Star,
        description: "Warm tones for gratitude."
    },

    // --- OCCASIONS ---
    {
        id: 'birthday',
        name: 'Birthday Bash',
        category: ['all', 'occasions', 'popular'],
        isPremium: false,
        styles: {
            background: "bg-gradient-to-br from-pink-500 via-rose-500 to-yellow-500",
            text: "text-white",
            border: "border-pink-300/50",
            accent: "text-yellow-200"
        },
        icon: PartyPopper,
        description: "Fun and vibrant for celebrations."
    },
    {
        id: 'love',
        name: 'Romance',
        category: ['all', 'occasions'],
        isPremium: false,
        styles: {
            background: "bg-gradient-to-br from-rose-400 via-pink-600 to-purple-600",
            text: "text-rose-50",
            border: "border-rose-300/40",
            accent: "text-pink-100"
        },
        icon: Heart,
        description: "For that special someone."
    },
    {
        id: 'wedding',
        name: 'Elegant White',
        category: ['all', 'occasions', 'premium', 'minimal'],
        isPremium: true,
        styles: {
            background: "bg-gradient-to-br from-slate-100 via-slate-200 to-slate-300",
            text: "text-slate-800",
            border: "border-slate-400/50",
            accent: "text-slate-500"
        },
        icon: Sparkles,
        description: "Clean, sophisticated, and classy."
    },

    // --- PREMIUM / EXCLUSIVE ---
    {
        id: 'gold',
        name: 'Luxury Gold',
        category: ['all', 'premium'],
        isPremium: true,
        styles: {
            background: "bg-gradient-to-br from-yellow-600 via-yellow-500 to-yellow-700",
            text: "text-yellow-50",
            border: "border-yellow-300/60",
            accent: "text-yellow-100"
        },
        icon: Star,
        description: "The ultimate status symbol."
    },
    {
        id: 'cyberpunk',
        name: 'Neon City',
        category: ['all', 'premium'],
        isPremium: true,
        styles: {
            background: "bg-gradient-to-br from-slate-900 via-fuchsia-900 to-slate-900",
            text: "text-cyan-400",
            border: "border-cyan-500/50",
            accent: "text-fuchsia-400"
        },
        icon: Zap,
        description: "Glitchy, futuristic vibes."
    }
]

export const getThemeById = (id: string): ThemeConfig => {
    return THEME_REGISTRY.find(t => t.id === id) || THEME_REGISTRY[0]
}
