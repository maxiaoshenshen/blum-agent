import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_SC } from "next/font/google";
import { publicSiteUrlFromEnvironment } from "@/src/security/site-url";
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

export function generateMetadata(): Metadata {
  const metadataBase = publicSiteUrlFromEnvironment();
  const socialImage = new URL("/og.png", metadataBase).href;

  return {
    metadataBase,
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
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  return (
    <html lang="zh-CN">
      <body className={`${notoSans.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
