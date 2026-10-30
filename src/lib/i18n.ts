import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n
    .use(initReactI18next)
    .init({
        resources: {
            en: {
                translation: {
                    "app_name": "MoveGiftCards",
                    "dashboard": "Dashboard",
                    "create_gift": "Send Gift",
                    "claim_gift": "Claim Gift",
                    "history": "History",
                    "bridge": "Bridge",
                    "connect_wallet": "Connect Wallet",
                    "disconnect": "Disconnect",
                    "welcome": "Send Crypto Gifts Instantly",
                    "welcome_desc": "The easiest way to send MOVE, USDC, and USDT via email or social media.",
                    "total_sent": "Total Value Sent",
                    "total_claimed": "Gifts Claimed",
                    "fees_collected": "Platform Fees",
                    "recent_activity": "Recent Activity",
                    "recipient": "Recipient",
                    "amount": "Amount",
                    "message": "Message",
                    "token": "Token",
                    "send": "Send Gift",
                    "claim": "Claim",
                    "gift_id": "Gift Card ID",
                    "verify_identity": "Verify Identity",
                    "success": "Success",
                    "error": "Error"
                }
            },
            zh: {
                translation: {
                    "app_name": "MoveGiftCards",
                    "dashboard": "仪表板",
                    "create_gift": "发送礼物",
                    "claim_gift": "领取礼物",
                    "history": "历史记录",
                    "bridge": "跨链桥",
                    "connect_wallet": "连接钱包",
                    "disconnect": "断开连接",
                    "welcome": "即时发送加密礼物",
                    "welcome_desc": "通过电子邮件或社交媒体发送 MOVE、USDC 和 USDT 的最简单方式。",
                    "total_sent": "发送总价值",
                    "total_claimed": "已领取礼物",
                    "fees_collected": "平台费用",
                    "recent_activity": "最近活动",
                    "recipient": "接收者",
                    "amount": "金额",
                    "message": "留言",
                    "token": "代币",
                    "send": "发送礼物",
                    "claim": "领取",
                    "gift_id": "礼品卡 ID",
                    "verify_identity": "验证身份",
                    "success": "成功",
                    "error": "错误"
                }
            }
        },
        lng: "en",
        fallbackLng: "en",
        interpolation: {
            escapeValue: false
        }
    });

export default i18n;
