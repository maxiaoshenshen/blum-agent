import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_SC } from "next/font/google";
import { publicSiteUrlFromEnvironment } from "@/src/security/site-url";
import { ErrorBoundary } from "@/components/error-boundary";
import "./globals.css";

const notoSans = Noto_Sans_SC({
  variable: "--font-noto-sans",
  display: "swap",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  display: "swap",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const title = "Blum Agent｜百隆五金智能工作台";
const description =
  "面向设计师、销售、安装工、生产、采购和消费者的百隆五金专业助手，提供官方资料优先、风险分级的产品与应用建议。";
const siteUrl = "https://blum-agent-cn.maxiaoshen.chatgpt.site";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: title,
  description,
  url: siteUrl,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  provider: { "@type": "Organization", name: "Blum", url: "https://www.blum.com" },
};

export function generateMetadata(): Metadata {
  const metadataBase = publicSiteUrlFromEnvironment();
  const socialImage = new URL("/og.png", metadataBase).href;

  return {
    metadataBase,
    title,
    description,
    applicationName: "Blum Agent",
    keywords: [
      "百隆", "Blum", "五金", "家具五金", "家具配件",
      "铰链", "抽屉", "导轨", "橱柜五金",
      "AVENTOS", "CLIP top", "MERIVOBOX", "LEGRABOX",
      "MOVENTO", "BLUMOTION", "TIP-ON", "SERVO-DRIVE",
    ],
    alternates: { canonical: "/" },
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      apple: "/favicon.svg",
    },
    openGraph: {
      title, description, type: "website",
      images: [{ url: socialImage, width: 1672, height: 941, alt: "Blum Agent" }],
      locale: "zh_CN",
      siteName: "Blum Agent",
    },
    twitter: {
      card: "summary_large_image", title, description, images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#ef561f" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Blum助手" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${notoSans.variable} ${plexMono.variable}`}>
        <a className="skip-link" href="#workspace">跳转到主内容</a>
        <ErrorBoundary
          fallback={<div className="app-error" role="alert">出错了，请刷新页面重试。</div>}
        >
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
