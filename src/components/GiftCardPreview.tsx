import { Gift, Sparkles } from "lucide-react"
import { getThemeById } from "@/lib/themeRegistry"

export type PreviewSize = "card" | "story" | "landscape" | "square"

interface GiftCardPreviewProps {
    amount: string
    token: string
    recipient: string
    senderName?: string
    message?: string
    themeId: string
    logoUrl?: string
    size?: PreviewSize
}

export function GiftCardPreview({
    amount,
    token,
    recipient,
    senderName,
    message,
    themeId,
    logoUrl,
    size = "card"
}: GiftCardPreviewProps) {
    const theme = getThemeById(themeId)
    const { styles } = theme

    // Size configuration
    const sizeClasses = {
        card: "aspect-[1.58/1] w-full max-w-sm",
        landscape: "aspect-[1.91/1] w-full max-w-sm", // Twitter card
        square: "aspect-square w-full max-w-sm", // Instagram Post
        story: "aspect-[9/16] w-full max-w-[280px]", // Instagram Story
    }

    return (
        <div className={`mx-auto perspective-1000 ${size === 'story' ? 'max-w-[280px]' : 'max-w-sm'}`}>
            <div className={`
                relative overflow-hidden rounded-xl shadow-xl transition-all duration-500 transform
                ${sizeClasses[size]}
                ${styles.background}
                ${styles.text}
                ${styles.border ? `border ${styles.border}` : ''}
            `}>
                {/* Overlay Texture if present */}
                {styles.overlay && (
                    <div className={`absolute inset-0 pointer-events-none ${styles.overlay}`} />
                )}

                {/* Background decorative elements - dynamic based on colors */}
                <div className="absolute top-0 right-0 w-[80%] h-[80%] bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[60%] h-[60%] bg-black/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

                <div className="relative z-10 flex flex-col h-full justify-between p-6">
                    {/* Header: Logo & Icon */}
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                            {logoUrl ? (
                                <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-sm p-0.5 overflow-hidden flex items-center justify-center ring-2 ring-white/30">
                                    <img src={logoUrl} alt="Logo" className="w-full h-full object-cover rounded-full" />
                                </div>
                            ) : (
                                <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg ring-1 ring-white/30">
                                    <Gift className="h-5 w-5 text-white" />
                                </div>
                            )}
                            <div className="flex flex-col">
                                <span className="font-bold text-xs tracking-wider opacity-90 uppercase">Gift Card</span>
                                {senderName && <span className="text-[10px] opacity-75 font-medium">from {senderName}</span>}
                            </div>
                        </div>
                        <theme.icon className={`h-6 w-6 ${styles.accent} opacity-90`} />
                    </div>

                    {/* Content: Amount & Recipient */}
                    <div className="text-center my-auto">
                        <div className="flex flex-col items-center gap-2">
                            <div className="text-5xl font-extrabold tracking-tight flex items-baseline justify-center gap-2 drop-shadow-sm">
                                {amount || "0"}
                                <span className="text-2xl opacity-90 font-bold">{token}</span>
                            </div>
                            <div className="inline-block px-4 py-1.5 rounded-full bg-white/15 backdrop-blur-md text-sm font-medium border border-white/20 shadow-sm mt-2">
                                To: {recipient || "Recipient"}
                            </div>
                        </div>
                    </div>

                    {/* Footer: Message */}
                    {message && (
                        <div className="mt-4 text-center">
                            <p className="text-sm italic opacity-95 leading-relaxed font-medium line-clamp-3 bg-black/5 rounded-lg p-2 backdrop-blur-[2px]">
                                "{message}"
                            </p>
                        </div>
                    )}

                    {!message && (
                        <div className="mt-auto pt-4 flex justify-center opacity-50">
                            <Sparkles className="w-4 h-4" />
                        </div>
                    )}
                </div>
            </div>

            {/* Reflection effect */}
            <div className="w-[85%] mx-auto h-3 bg-black/20 blur-xl rounded-[100%] mt-4 opacity-60" />
        </div>
    )
}
