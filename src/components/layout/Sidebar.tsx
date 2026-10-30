import { Link, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Gift, Home, History, Download, ArrowLeftRight, Compass } from "lucide-react"

export function Sidebar() {
    const { t } = useTranslation()
    const location = useLocation()

    const routes = [
        { href: "/dashboard", label: t("dashboard"), icon: Home },
        { href: "/send", label: t("create_gift"), icon: Gift },
        { href: "/claim", label: t("claim_gift"), icon: Download },
        { href: "/history", label: t("history"), icon: History },
        { href: "/bridge", label: t("bridge"), icon: ArrowLeftRight },
        { href: "/explore", label: "Explore", icon: Compass },
    ]

    return (
        <div className="hidden border-r bg-muted/40 md:block w-[220px] lg:w-[280px]">
            <div className="flex h-full max-h-screen flex-col gap-2">
                <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
                    <Link to="/" className="flex items-center gap-2 font-semibold">
                        <Gift className="h-6 w-6 text-purple-600" />
                        <span className="">{t("app_name")}</span>
                    </Link>
                </div>
                <div className="flex-1">
                    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
                        {routes.map((route) => (
                            <Link
                                key={route.href}
                                to={route.href}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
                                    location.pathname === route.href
                                        ? "bg-muted text-primary"
                                        : "text-muted-foreground"
                                )}
                            >
                                <route.icon className="h-4 w-4" />
                                {route.label}
                            </Link>
                        ))}
                    </nav>
                </div>
                <div className="mt-auto p-4">
                    {/* Bottom content if needed */}
                </div>
            </div>
        </div>
    )
}
