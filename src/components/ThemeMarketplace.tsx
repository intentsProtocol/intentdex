import { useState } from "react"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
    THEME_REGISTRY,
    THEME_CATEGORIES,
    type ThemeCategory
} from "@/lib/themeRegistry"
import { Search, Crown, Check } from "lucide-react"
import { Input } from "@/components/ui/input"

interface ThemeMarketplaceProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentThemeId: string
    onSelectTheme: (themeId: string) => void
}

export function ThemeMarketplace({
    open,
    onOpenChange,
    currentThemeId,
    onSelectTheme
}: ThemeMarketplaceProps) {
    const [activeCategory, setActiveCategory] = useState<ThemeCategory>('all')
    const [searchQuery, setSearchQuery] = useState("")

    // Filter themes based on category and search
    const filteredThemes = THEME_REGISTRY.filter(theme => {
        const matchesCategory = activeCategory === 'all' || theme.category.includes(activeCategory)
        const matchesSearch = theme.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            theme.description?.toLowerCase().includes(searchQuery.toLowerCase())
        return matchesCategory && matchesSearch
    })

    const handleSelect = (id: string, _isPremium: boolean) => {
        // In a real app, check for premium access here
        // For now, we allow selection but maybe show a toast or note
        onSelectTheme(id)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] h-full flex flex-col p-0 gap-0 bg-gray-50 dark:bg-zinc-900 border-none overflow-hidden">
                {/* Header Section */}
                <div className="p-6 pb-4 border-b bg-white dark:bg-zinc-900 z-10">
                    <DialogHeader>
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-pink-600">
                                    Theme Gallery
                                </DialogTitle>
                                <DialogDescription>
                                    Design the perfect gift for any occasion.
                                </DialogDescription>
                            </div>
                            <div className="relative w-64">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                                <Input
                                    placeholder="Search themes..."
                                    className="pl-9 bg-gray-100 border-none"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </DialogHeader>

                    {/* Category Tabs / Pills */}
                    <ScrollArea className="w-full whitespace-nowrap pb-2">
                        <div className="flex gap-2">
                            {THEME_CATEGORIES.map((cat) => (
                                <Button
                                    key={cat.id}
                                    variant={activeCategory === cat.id ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setActiveCategory(cat.id)}
                                    className={`rounded-full px-4 border transition-all ${activeCategory === cat.id
                                        ? "bg-black text-white dark:bg-white dark:text-black border-transparent shadow-lg"
                                        : "bg-white dark:bg-zinc-800 border-gray-200 hover:bg-gray-100"
                                        }`}
                                >
                                    <cat.icon className="mr-2 h-3.5 w-3.5" />
                                    {cat.label}
                                </Button>
                            ))}
                        </div>
                    </ScrollArea>
                </div>

                {/* Main Content: Theme Grid */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 dark:bg-zinc-950/50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredThemes.map((theme) => {
                            const isSelected = currentThemeId === theme.id

                            return (
                                <button
                                    key={theme.id}
                                    onClick={() => handleSelect(theme.id, theme.isPremium)}
                                    className={`
                                        group relative text-left rounded-xl overflow-hidden transition-all duration-300
                                        hover:shadow-2xl hover:scale-[1.02] hover:-translate-y-1
                                        ${isSelected ? 'ring-2 ring-purple-600 ring-offset-2' : ''}
                                    `}
                                >
                                    {/* Preview Aspect */}
                                    <div className={`
                                        h-40 w-full relative p-4 flex flex-col justify-between
                                        ${theme.styles.background}
                                        ${theme.styles.text}
                                    `}>
                                        {/* Overlay */}
                                        {theme.styles.overlay && <div className={`absolute inset-0 ${theme.styles.overlay}`} />}

                                        <div className="relative z-10 flex justify-between items-start">
                                            <div className="bg-white/20 backdrop-blur-md rounded-lg p-1.5">
                                                <theme.icon className="h-4 w-4" />
                                            </div>
                                            {theme.isPremium && (
                                                <Badge className="bg-amber-400 text-amber-950 hover:bg-amber-500 border-none font-bold text-[10px] px-2 py-0.5">
                                                    <Crown className="w-3 h-3 mr-1 inline" /> PREMIUM
                                                </Badge>
                                            )}
                                        </div>

                                        <div className="relative z-10">
                                            <div className="h-2 w-16 bg-white/20 rounded-full mb-2" />
                                            <div className="h-8 w-1/2 bg-white/30 rounded-lg" />
                                        </div>
                                    </div>

                                    {/* Info Footer */}
                                    <div className="bg-white dark:bg-zinc-800 p-4 border border-t-0 rounded-b-xl">
                                        <div className="flex justify-between items-center mb-1">
                                            <h3 className="font-semibold text-sm">{theme.name}</h3>
                                            {isSelected && <Check className="h-4 w-4 text-green-500" />}
                                        </div>
                                        <p className="text-xs text-gray-500 line-clamp-1">{theme.description}</p>
                                    </div>

                                    {/* Locked Overlay (Visual Only for now) */}
                                    {/* 
                                    {theme.isPremium && (
                                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="sm" variant="secondary" className="shadow-xl font-semibold">
                                                Unlock Theme
                                            </Button>
                                        </div>
                                    )} 
                                    */}
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Footer Section (Optional Call to Action) */}
                <div className="p-4 border-t bg-white dark:bg-zinc-900 flex justify-end">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
