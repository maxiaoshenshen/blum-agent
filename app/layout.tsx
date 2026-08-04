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
      "百隆",
      "Blum",
      "五金",
      "家具五金",
      "家具配件",
      "铰链",
      "抽屉",
      "导轨",
      "橱柜五金",
      "AVENTOS",
      "CLIP top",
      "MERIVOBOX",
      "LEGRABOX",
      "MOVENTO",
      "BLUMOTION",
    ],
    alternates: {
      canonical: "/",
    },
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    },
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
        <a className="skip-link" href="#workspace">
          跳转到主内容
        </a>
        {children}
      </body>
    </html>
  );
}
