import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormField, FormItem, FormLabel, FormDescription } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { aptos, CONTRACT_ADDRESS } from "@/lib/aptos"
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth"
import { useSignRawHash } from "@privy-io/react-auth/extended-chains"
import { AccountAuthenticatorEd25519, Ed25519PublicKey, Ed25519Signature, generateSigningMessageForTransaction } from "@aptos-labs/ts-sdk"
import { Buffer } from 'buffer'
import { THEME_REGISTRY } from "@/lib/themeRegistry"

const formSchema = z.object({
    amount: z.string().min(1, "Amount is required"),
    message: z.string().max(200).default(""),
    fromName: z.string().max(50).default(""),
    themeId: z.string().default("modern"),
    expiryDays: z.string().default("30"),
    requiredSocials: z.array(z.string()).default([]),
    matchLogic: z.enum(["all", "any"]).default("all"),
})

type FormData = z.infer<typeof formSchema>

interface CreateExploreGiftProps {
    onSuccess: () => void
}

export function CreateExploreGift({ onSuccess }: CreateExploreGiftProps) {
    const { user } = usePrivy()
    const { signRawHash } = useSignRawHash()
    const [isSubmitting, setIsSubmitting] = useState(false)

    const movementWallet = user?.linkedAccounts.find(
        (account) => account.type === 'wallet' && account.chainType === 'aptos'
    ) as WalletWithMetadata | undefined

    const form = useForm<FormData>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            amount: "",
            message: "",
            fromName: "",
            themeId: "modern",
            expiryDays: "30",
            requiredSocials: [],
            matchLogic: "all",
        },
    })

    const socialToCode = (social: string): number => {
        if (social === "email") return 1
        if (social === "twitter") return 2
        if (social === "discord") return 3
        return 0
    }

    const onSubmit = async (values: FormData) => {
        if (!movementWallet) {
            toast.error("Please connect a Movement wallet first")
            return
        }

        setIsSubmitting(true)
        try {
            const amountInOctas = Math.floor(parseFloat(values.amount) * 1e8)
            const expiryDays = parseInt(values.expiryDays)
            const requiredSocialsBytes = values.requiredSocials.map(socialToCode)
            const matchLogicCode = values.matchLogic === "any" ? 1 : 0

            // Build transaction
            const transaction = await aptos.transaction.build.simple({
                sender: movementWallet.address,
                data: {
                    function: `${CONTRACT_ADDRESS}::explore_gifts::create_explore_gift`,
                    functionArguments: [
                        values.fromName || "",
                        amountInOctas,
                        values.message || "",
                        values.themeId,
                        "", // logo_url
                        expiryDays,
                        new Uint8Array(requiredSocialsBytes),
                        matchLogicCode,
                    ],
                },
            })

            // Sign
            const messageBytes = await generateSigningMessageForTransaction(transaction)
            const messageHex = `0x${Array.from(messageBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`

            const signatureHex = await signRawHash({
                address: movementWallet.address,
                chainType: 'aptos',
                hash: messageHex,
            })

            const signatureBytes = Buffer.from(signatureHex.signature.replace('0x', ''), 'hex')

            // Get public key
            const walletObj = movementWallet as any
            let publicKeyBytes = Buffer.from(walletObj.publicKey.replace(/^0x/, ''), 'hex')
            if (publicKeyBytes.length === 33) publicKeyBytes = publicKeyBytes.slice(1)

            const authenticator = new AccountAuthenticatorEd25519(
                new Ed25519PublicKey(publicKeyBytes),
                new Ed25519Signature(signatureBytes)
            )

            const pendingTxn = await aptos.transaction.submit.simple({
                transaction,
                senderAuthenticator: authenticator,
            })

            toast.loading("Transaction submitted...")
            await aptos.waitForTransaction({ transactionHash: pendingTxn.hash })

            toast.dismiss()
            toast.success("Gift created successfully! 🎉")
            onSuccess()

        } catch (error: any) {
            console.error(error)
            toast.dismiss()
            toast.error("Failed to create gift: " + (error.message || "Unknown error"))
        } finally {
            setIsSubmitting(false)
        }
    }



    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-4">
                {/* Amount */}
                <FormField
                    control={form.control as any}
                    name="amount"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Amount (MOVE)</FormLabel>
                            <FormControl>
                                <Input
                                    type="number"
                                    step="0.0001"
                                    placeholder="1.0"
                                    className="bg-gray-800 border-gray-700 text-white"
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />

                {/* From Name */}
                <FormField
                    control={form.control as any}
                    name="fromName"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Your Name (Optional)</FormLabel>
                            <FormControl>
                                <Input
                                    placeholder="Anonymous"
                                    className="bg-gray-800 border-gray-700 text-white"
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />

                {/* Message */}
                <FormField
                    control={form.control as any}
                    name="message"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Message (Optional)</FormLabel>
                            <FormControl>
                                <Textarea
                                    placeholder="A special message for the recipient..."
                                    className="bg-gray-800 border-gray-700 text-white resize-none"
                                    rows={2}
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />

                {/* Theme */}
                <FormField
                    control={form.control as any}
                    name="themeId"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Theme</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-gray-800 border-gray-700">
                                    {THEME_REGISTRY.map(theme => (
                                        <SelectItem key={theme.id} value={theme.id} className="text-white">
                                            {theme.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )}
                />

                {/* Expiry */}
                <FormField
                    control={form.control as any}
                    name="expiryDays"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Expires In</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-gray-800 border-gray-700">
                                    <SelectItem value="7" className="text-white">7 Days</SelectItem>
                                    <SelectItem value="30" className="text-white">30 Days</SelectItem>
                                    <SelectItem value="90" className="text-white">90 Days</SelectItem>
                                    <SelectItem value="365" className="text-white">1 Year</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )}
                />

                {/* Required Socials */}
                <FormField
                    control={form.control as any}
                    name="requiredSocials"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Required Accounts to Claim</FormLabel>
                            <FormDescription className="text-gray-400">
                                Select which accounts a claimer must have linked
                            </FormDescription>
                            <div className="flex gap-3 mt-2">
                                {["email", "twitter", "discord"].map((social) => (
                                    <label key={social} className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-purple-600"
                                            checked={field.value?.includes(social)}
                                            onChange={(e) => {
                                                const current = field.value || []
                                                if (e.target.checked) {
                                                    field.onChange([...current, social])
                                                } else {
                                                    field.onChange(current.filter((v: string) => v !== social))
                                                }
                                            }}
                                        />
                                        <span className="text-white capitalize">{social}</span>
                                    </label>
                                ))}
                            </div>
                        </FormItem>
                    )}
                />

                {/* Match Logic */}
                <FormField
                    control={form.control as any}
                    name="matchLogic"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Match Logic</FormLabel>
                            <FormDescription className="text-gray-400">
                                How should claim requirements be matched?
                            </FormDescription>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-gray-800 border-gray-700">
                                    <SelectItem value="all" className="text-white">Require ALL</SelectItem>
                                    <SelectItem value="any" className="text-white">Require ANY</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )}
                />

                {/* Submit */}
                <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Creating...
                        </>
                    ) : (
                        "Create Gift"
                    )}
                </Button>
            </form>
        </Form>
    )
}
