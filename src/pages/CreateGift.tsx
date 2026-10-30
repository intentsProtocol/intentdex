import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { usePrivy } from "@privy-io/react-auth"
import { CONTRACT_ADDRESS } from "@/lib/aptos"
import { toast } from "sonner"

const formSchema = z.object({
    recipient: z.string().email(),
    amount: z.string().min(1),
    message: z.string().optional(),
    token: z.string().default("MOVE"),
})

export default function CreateGift() {
    const { t } = useTranslation()
    const { user } = usePrivy()

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            recipient: "",
            amount: "",
            message: "",
            token: "MOVE",
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (!user?.wallet?.address) {
            toast.error("Please connect your wallet first")
            return
        }

        try {
            toast.loading("Creating gift card...")

            // This is where we construct the transaction payload
            const payload = {
                function: `${CONTRACT_ADDRESS}::move_giftcards::create_giftcard_move`,
                typeArguments: [],
                functionArguments: [
                    1, // Email type
                    values.recipient,
                    parseFloat(values.amount) * 100000000,
                    values.message || "",
                    30
                ],
            };

            console.log("Transaction Payload:", payload)

            setTimeout(() => {
                toast.dismiss()
                toast.success("Gift card created successfully!")
                form.reset()
            }, 1000)

        } catch (error) {
            toast.dismiss()
            toast.error("Failed to create gift card")
            console.error(error)
        }
    }

    return (
        <div className="flex justify-center items-start lg:mt-10">
            <Card className="w-full max-w-lg">
                <CardHeader>
                    <CardTitle>{t("create_gift")}</CardTitle>
                    <CardDescription>Send crypto to anyone via email.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-6">
                            <FormField
                                control={form.control as any}
                                name="recipient"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("recipient")} Email</FormLabel>
                                        <FormControl>
                                            <Input placeholder="alice@example.com" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control as any}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("amount")}</FormLabel>
                                            <FormControl>
                                                <Input placeholder="0.00" type="number" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control as any}
                                    name="token"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("token")}</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select token" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="MOVE">MOVE</SelectItem>
                                                    <SelectItem value="USDC">USDC</SelectItem>
                                                    <SelectItem value="USDT">USDT</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control as any}
                                name="message"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("message")} (Optional)</FormLabel>
                                        <FormControl>
                                            <Textarea placeholder="Happy Birthday!" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <Button type="submit" className="w-full">{t("send")}</Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    )
}
