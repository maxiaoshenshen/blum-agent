import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_SC } from "next/font/google";
import { headers } from "next/headers";
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

function safeOrigin(hostValue: string | null, protocolValue: string | null) {
  const host =
    hostValue && /^[a-z0-9.:[\]-]+$/i.test(hostValue)
      ? hostValue
      : "localhost:3000";
  const protocol =
    protocolValue === "http" || protocolValue === "https"
      ? protocolValue
      : host.startsWith("localhost")
        ? "http"
        : "https";
  return `${protocol}://${host}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = safeOrigin(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
  );
  const socialImage = `${origin}/og.png`;

  return {
    title,
    description,
    applicationName: "Blum Agent",
    keywords: [
      "Blum",
      "百隆",
      "家具五金",
      "AVENTOS",
      "MERIVOBOX",
      "LEGRABOX",
      "MOVENTO",
      "BLUMOTION",
    ],
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: socialImage,
          width: 1672,
          height: 941,
          alt: "Blum Agent precision hardware knowledge workbench",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${notoSans.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
