import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"

export function MobileNav() {
    const { t } = useTranslation()
    const location = useLocation()

    const routes = [
        { href: "/", label: t("dashboard") },
        { href: "/create", label: t("create_gift") },
        { href: "/claim", label: t("claim_gift") },
        { href: "/history", label: t("history") },
        { href: "/bridge", label: "Bridge" },
    ]

    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[240px] sm:w-[300px]">
                <div className="flex flex-col gap-4 py-4">
                    <Link to="/" className="flex items-center gap-2 font-semibold">
                        <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-pink-500">
                            {t("app_name")}
                        </span>
                    </Link>
                    <nav className="flex flex-col gap-2">
                        {routes.map((route) => (
                            <Link
                                key={route.href}
                                to={route.href}
                                className={cn(
                                    "block px-2 py-1 text-lg",
                                    location.pathname === route.href
                                        ? "font-medium text-foreground"
                                        : "text-muted-foreground"
                                )}
                            >
                                {route.label}
                            </Link>
                        ))}
                    </nav>
                </div>
            </SheetContent>
        </Sheet>
    )
}
