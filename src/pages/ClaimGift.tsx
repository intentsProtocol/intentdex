import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CONTRACT_ADDRESS } from "@/lib/aptos"
import { toast } from "sonner"

import { Gift, ArrowRight, Check, ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"

export default function ClaimGift() {
    const { t } = useTranslation()
    const [giftId, setGiftId] = useState("")
    const [loading, setLoading] = useState(false)
    const [claimed, setClaimed] = useState(false)

    const handleClaim = async () => {
        if (!giftId) return

        setLoading(true)
        try {
            // Mock claiming process
            // Real implementation would verify identity first via Privy
            // Then submit transaction to smart contract

            toast.loading("Verifying identity...")
            await new Promise(r => setTimeout(r, 1000))

            toast.dismiss()
            toast.loading("Claiming gift on-chain...")

            const payload = {
                function: `${CONTRACT_ADDRESS}::move_giftcards::claim_giftcard`,
                typeArguments: [],
                functionArguments: [
                    giftId,
                    "alice@example.com" // Needs to match the logged in user's identifier
                ],
            };
            console.log("Claim Payload:", payload)

            await new Promise(r => setTimeout(r, 1500))

            toast.dismiss()
            toast.success("Gift claimed successfully!")
            setClaimed(true)

        } catch (error) {
            toast.dismiss()
            toast.error("Failed to claim gift")
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    if (claimed) {
        return (
            <div className="flex justify-center items-start lg:mt-10">
                <Card className="w-full max-w-md text-center">
                    <CardHeader>
                        <div className="mx-auto bg-green-100 dark:bg-green-900/20 p-4 rounded-full mb-4">
                            <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
                        </div>
                        <CardTitle className="text-2xl">{t("success")}!</CardTitle>
                        <CardDescription>You have successfully claimed your gift.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button onClick={() => { setClaimed(false); setGiftId("") }} className="w-full">
                            Claim Another
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="flex justify-center items-start lg:mt-10">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <Link to="/claim" className="flex items-center text-sm text-gray-500 hover:text-purple-600 mb-4 transition-colors">
                        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Claims
                    </Link>
                    <CardTitle>{t("claim_gift")}</CardTitle>
                    <CardDescription>Enter the Gift ID to claim your crypto.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2">
                        <Input
                            placeholder="Gift ID (e.g. 1)"
                            value={giftId}
                            onChange={(e) => setGiftId(e.target.value)}
                        />
                        <Button onClick={handleClaim} disabled={!giftId || loading}>
                            {loading ? "..." : <ArrowRight className="h-4 w-4" />}
                        </Button>
                    </div>

                    <div className="rounded-lg bg-muted/50 p-4 mt-6">
                        <div className="flex items-center gap-2 mb-2">
                            <Gift className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">How it works</span>
                        </div>
                        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                            <li>Enter the Gift ID from your email/message</li>
                            <li>Log in with the same account (Email/Twitter)</li>
                            <li>Confirm the transaction to claim funds</li>
                        </ul>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
