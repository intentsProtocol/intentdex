import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTranslation } from "react-i18next"
import { ArrowUpRight, ArrowDownLeft, Filter, TrendingUp, Loader2 } from "lucide-react"
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth"
import { aptos, CONTRACT_ADDRESS } from "@/lib/aptos"
import { TOKENS } from "@/lib/tokens"
import { format } from "date-fns"

interface Transaction {
    id: string
    type: "sent" | "received"
    amount: string
    token: string
    counterparty: string
    status: string
    date: number // seconds
    txHash: string // Not available from view function, use ID or placeholder
    rawAmount: number
}

interface GiftCardDetails {
    id: string
    sender: string
    recipient_identifier: string
    amount: string
    token_type: string
    created_at: string
    expires_at: string
    claimed: boolean
    claimed_by: string
    claimed_at: string
}

export default function History() {
    useTranslation()
    const { user } = usePrivy()
    const [filter, setFilter] = useState("all")
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [loading, setLoading] = useState(true)

    // Find Movement wallet
    const movementWallet = user?.linkedAccounts.find(
        (account) => account.type === 'wallet' && account.chainType === 'aptos'
    ) as WalletWithMetadata | undefined;

    useEffect(() => {
        if (!user) return
        fetchAllHistory()
    }, [user, movementWallet])

    const fetchAllHistory = async () => {
        try {
            setLoading(true)
            const allTxs: Transaction[] = []

            // 1. Fetch SENT gifts (if wallet exists)
            if (movementWallet?.address) {
                const sentIdsResponse = await aptos.view({
                    payload: {
                        function: `${CONTRACT_ADDRESS}::move_giftcards::get_sender_giftcards`,
                        functionArguments: [movementWallet.address],
                    },
                })
                const sentIds = sentIdsResponse[0] as string[]
                const sentDetails = await fetchGiftCardDetails(sentIds)

                sentDetails.forEach(details => {
                    allTxs.push(mapToTransaction(details, "sent"))
                })
            }

            // 2. Fetch RECEIVED gifts (iterate all linked identifiers)
            const identifiers = []
            if (user?.email?.address) identifiers.push(user.email.address)
            if (user?.twitter?.username) identifiers.push(user.twitter.username) // Assuming stored as 'username'
            if (user?.discord?.username) identifiers.push(user.discord.username)

            for (const identifier of identifiers) {
                try {
                    const receivedIdsResponse = await aptos.view({
                        payload: {
                            function: `${CONTRACT_ADDRESS}::move_giftcards::get_recipient_giftcards`,
                            functionArguments: [identifier],
                        },
                    })
                    const receivedIds = receivedIdsResponse[0] as string[]
                    const receivedDetails = await fetchGiftCardDetails(receivedIds)

                    receivedDetails.forEach(details => {
                        // Avoid duplicates if multiple identifiers point to same
                        if (!allTxs.find(tx => tx.id === details.id)) {
                            allTxs.push(mapToTransaction(details, "received"))
                        }
                    })
                } catch (e) {
                    console.warn(`Failed to fetch received for ${identifier}`, e)
                }
            }

            // Sort by date desc
            allTxs.sort((a, b) => b.date - a.date)
            setTransactions(allTxs)

        } catch (error) {
            console.error("Error fetching history:", error)
        } finally {
            setLoading(false)
        }
    }

    const fetchGiftCardDetails = async (ids: string[]) => {
        const promises = ids.map(async (id) => {
            const details = await aptos.view({
                payload: {
                    function: `${CONTRACT_ADDRESS}::move_giftcards::get_giftcard`,
                    functionArguments: [id],
                },
            })
            return {
                id,
                sender: details[0],
                recipient_identifier: details[3],
                amount: details[4],
                token_type: details[5],
                created_at: details[10],
                expires_at: details[11],
                claimed: details[12],
                claimed_by: details[13],
                claimed_at: details[14],
            } as GiftCardDetails
        })
        return Promise.all(promises)
    }

    const mapToTransaction = (details: GiftCardDetails, type: "sent" | "received"): Transaction => {
        const tokenInfo = TOKENS.find(t => t.symbol === details.token_type)
        const decimals = tokenInfo ? tokenInfo.decimals : 8
        const rawAmount = parseInt(details.amount)
        const formattedAmount = (rawAmount / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })

        // Determine status
        let status = "pending"
        if (details.claimed) status = "claimed"
        else if (Date.now() / 1000 > parseInt(details.expires_at)) status = "expired"

        return {
            id: details.id,
            type,
            amount: `${formattedAmount} ${details.token_type}`,
            token: details.token_type,
            rawAmount: rawAmount, // approximated relative value for stats
            counterparty: type === "sent" ? details.recipient_identifier : `${details.sender.slice(0, 6)}...`,
            status,
            date: parseInt(details.created_at),
            txHash: "#" + details.id // Placeholder
        }
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "claimed": return <Badge className="bg-green-500/20 text-green-400 hover:bg-green-500/30 border-green-500/50">Claimed</Badge>
            case "pending": return <Badge className="bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border-yellow-500/50">Pending</Badge>
            case "expired": return <Badge className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/50">Expired</Badge>
            default: return <Badge variant="outline">{status}</Badge>
        }
    }

    // Stats Calculation
    const stats = transactions.reduce((acc, tx) => {
        if (tx.type === "sent") {
            acc.totalSent++
            // Naive value sum (mixing tokens, but just for demo stats)
            // In reality need Price Oracle
        } else {
            acc.totalReceived++
        }
        return acc
    }, { totalSent: 0, totalReceived: 0 })

    const filteredTransactions = transactions.filter(tx => {
        if (filter === "all") return true
        if (filter === "sent") return tx.type === "sent"
        if (filter === "received") return tx.type === "received"
        return tx.status === filter
    })

    return (
        <div className="space-y-6 text-white min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Transaction History</h1>
                    <p className="text-gray-400">View all your gift card transactions</p>
                </div>
                {/* <Button variant="outline" className="border-white/20 hover:bg-white/10 text-white">
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button> */}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-gradient-to-br from-purple-900/40 to-indigo-900/40 border-white/10 backdrop-blur-md">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 mb-1">Total Sent</p>
                                <p className="text-2xl font-bold text-white">{stats.totalSent} Cards</p>
                            </div>
                            <div className="p-3 bg-purple-500/20 rounded-full">
                                <ArrowUpRight className="h-6 w-6 text-purple-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-emerald-900/40 to-teal-900/40 border-white/10 backdrop-blur-md">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 mb-1">Total Received</p>
                                <p className="text-2xl font-bold text-white">{stats.totalReceived} Cards</p>
                            </div>
                            <div className="p-3 bg-emerald-500/20 rounded-full">
                                <ArrowDownLeft className="h-6 w-6 text-emerald-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-blue-900/40 to-cyan-900/40 border-white/10 backdrop-blur-md">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 mb-1">Net Activity</p>
                                <p className="text-2xl font-bold text-white">{transactions.length}</p>
                                <p className="text-sm text-blue-400 flex items-center gap-1">
                                    <TrendingUp className="h-3 w-3" /> Total Txns
                                </p>
                            </div>
                            <div className="p-3 bg-blue-500/20 rounded-full">
                                <TrendingUp className="h-6 w-6 text-blue-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="bg-black/20 border-white/10 backdrop-blur-md">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle className="text-white">All Transactions</CardTitle>
                        <Select value={filter} onValueChange={setFilter}>
                            <SelectTrigger className="w-[150px] bg-white/5 border-white/10 text-white">
                                <Filter className="h-4 w-4 mr-2" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-gray-900 border-white/10 text-white">
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="sent">Sent</SelectItem>
                                <SelectItem value="received">Received</SelectItem>
                                <SelectItem value="claimed">Claimed</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
                        </div>
                    ) : filteredTransactions.length === 0 ? (
                        <div className="text-center p-8 text-gray-500">
                            No transactions found.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-white/10 hover:bg-white/5">
                                    <TableHead className="text-gray-400">Type</TableHead>
                                    <TableHead className="text-gray-400">Amount</TableHead>
                                    <TableHead className="text-gray-400">Counterparty</TableHead>
                                    <TableHead className="text-gray-400">Status</TableHead>
                                    <TableHead className="text-gray-400">Date</TableHead>
                                    <TableHead className="text-right text-gray-400">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredTransactions.map((tx) => (
                                    <TableRow key={tx.id} className="border-white/10 hover:bg-white/5">
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {tx.type === "sent" ? (
                                                    <div className="p-1.5 bg-purple-500/20 rounded-full">
                                                        <ArrowUpRight className="h-3 w-3 text-purple-400" />
                                                    </div>
                                                ) : (
                                                    <div className="p-1.5 bg-green-500/20 rounded-full">
                                                        <ArrowDownLeft className="h-3 w-3 text-green-400" />
                                                    </div>
                                                )}
                                                <span className="font-medium capitalize text-white">{tx.type}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-medium text-white">{tx.amount}</TableCell>
                                        <TableCell className="text-gray-300">{tx.counterparty}</TableCell>
                                        <TableCell>{getStatusBadge(tx.status)}</TableCell>
                                        <TableCell className="text-gray-400">
                                            {format(new Date(tx.date * 1000), 'MMM d, yyyy')}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {/* <Button variant="ghost" size="sm" className="hover:bg-white/10 text-gray-400">
                                                <ExternalLink className="h-4 w-4" />
                                            </Button> */}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
