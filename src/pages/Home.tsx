import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Gift, Download, Activity, DollarSign } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

export default function Home() {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">{t("dashboard")}</h1>
                <p className="text-muted-foreground">
                    {t("welcome_desc")}
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("total_sent")}</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">1,234 MOVE</div>
                        <p className="text-xs text-muted-foreground">+20.1% from last month</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t("total_claimed")}</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">+573</div>
                        <p className="text-xs text-muted-foreground">+201 since last hour</p>
                    </CardContent>
                </Card>
                {/* Add more stats cards as needed */}
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Overview</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        {/* Placeholder for chart */}
                        <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                            Chart Placeholder
                        </div>
                    </CardContent>
                </Card>
                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>{t("recent_activity")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-8">
                            {/* Placeholder activity items */}
                            <div className="flex items-center">
                                <div className="ml-4 space-y-1">
                                    <p className="text-sm font-medium leading-none">Sent to Alice</p>
                                    <p className="text-sm text-muted-foreground">alice@example.com</p>
                                </div>
                                <div className="ml-auto font-medium">100 MOVE</div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="flex gap-4">
                <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link to="/create">
                        <Gift className="mr-2 h-4 w-4" />
                        {t("send")}
                    </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                    <Link to="/claim">
                        <Download className="mr-2 h-4 w-4" />
                        {t("claim")}
                    </Link>
                </Button>
            </div>
        </div>
    )
}
