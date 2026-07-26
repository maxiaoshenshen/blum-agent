import type { OfficialSource } from "./types";

export const OFFICIAL_SOURCES = [
  {
    id: "lift-systems",
    title: "AVENTOS 上翻门系列",
    url: "https://www.blum.com/connects/zh/app/lift-systems",
    summary:
      "AVENTOS 覆盖上翻折叠、斜移、平移和上翻等面板运动形式，包含 HF top、HS top、HL top、HK top、HK-S、HK-XS 与 HKi 等系列。精确省力装置选型必须结合柜体高度、面板尺寸和重量。",
    official: true,
    keywords: [
      "aventos",
      "爱翻",
      "hk top",
      "hk-s",
      "hk-xs",
      "hki",
      "hf top",
      "hs top",
      "hl top",
      "上翻门",
      "吊柜",
    ],
  },
  {
    id: "hinge-systems",
    title: "Blum 铰链系列",
    url: "https://www.blum.com/connects/zh/app/hinge-systems",
    summary:
      "Blum 铰链系列包含 CLIP top BLUMOTION、CLIP top、MODUL 以及适用于多种门型和材料的解决方案；BLUMOTION 用于轻柔关闭，TIP-ON for doors 用于无拉手柜门。",
    official: true,
    keywords: [
      "clip top blumotion",
      "clip top",
      "modul",
      "铰链",
      "合页",
      "柜门",
      "门盖",
      "门铰",
    ],
  },
  {
    id: "box-systems",
    title: "Blum 抽屉系列",
    url: "https://www.blum.com/connects/zh/app/box-systems",
    summary:
      "Blum 金属抽屉系统包含 LEGRABOX 乐薄、MERIVOBOX 魅宝和 TANDEMBOX 豪华金属抽等产品系列，可结合不同动感开合技术与内分隔方案。",
    official: true,
    keywords: [
      "merivobox",
      "魅宝",
      "legrabox",
      "乐薄",
      "tandembox",
      "豪华金属抽",
      "金属抽屉",
      "抽屉系统",
    ],
  },
  {
    id: "runner-systems",
    title: "MOVENTO 与 TANDEM 导轨系列",
    url: "https://www.blum.com/connects/zh/app/runner-systems",
    summary:
      "MOVENTO 魔顺与 TANDEM 隐顺是用于木抽的隐藏式导轨系列。具体长度、负载等级、动感开合组合和木抽加工尺寸应按官方配置结果复核。",
    official: true,
    keywords: [
      "movento",
      "魔顺",
      "tandem",
      "隐顺",
      "导轨",
      "木抽",
      "滑轨",
    ],
  },
  {
    id: "motion-technologies",
    title: "Blum 动感开合技术",
    url: "https://publications.blum.com/2022/catalogue/zh/560/",
    summary:
      "Blum 动感开合技术包括 BLUMOTION 阻尼、TIP-ON 碰碰开、TIP-ON BLUMOTION 阻尼碰碰开与 SERVO-DRIVE 电动开启支持；不同产品系列的可用组合不同。",
    official: true,
    keywords: [
      "blumotion",
      "tip-on blumotion",
      "tip-on",
      "servo-drive",
      "碰碰开",
      "阻尼",
      "电动开启",
      "动感开合",
    ],
  },
  {
    id: "pocket-systems",
    title: "REVEGO 口袋门系列",
    url: "https://www.blum.com/connects/zh/app/pocket-systems",
    summary:
      "REVEGO 是用于单门或双门应用的口袋门系统，可让整块家具区域在使用时打开、闲置时隐藏。精确规划需使用官方配置和加工数据。",
    official: true,
    keywords: ["revego", "口袋门", "隐藏门", "折入", "内藏门"],
  },
  {
    id: "organization-systems",
    title: "AMBIA-LINE 与 ORGA-LINE 内分隔",
    url: "https://publications.blum.com/2022/catalogue/zh/526/",
    summary:
      "AMBIA-LINE 主要用于 LEGRABOX 与 MERIVOBOX，ORGA-LINE 用于 TANDEMBOX；应依据抽屉系列、宽度和收纳任务选择。",
    official: true,
    keywords: [
      "ambia-line",
      "乐比翼",
      "orga-line",
      "内分隔",
      "收纳",
      "厨房小帮手",
    ],
  },
  {
    id: "easy-assembly",
    title: "Blum EASY ASSEMBLY",
    url: "https://www.blum.com/us/en/services/e-services/easyassemblyapp/",
    summary:
      "EASY ASSEMBLY 提供按产品组织的最新安装说明、调节步骤和安装视频，并支持下载后离线使用。",
    official: true,
    keywords: [
      "easy assembly",
      "安装",
      "调节",
      "拆卸",
      "排障",
      "故障",
      "异响",
      "视频",
    ],
  },
  {
    id: "product-configurator",
    title: "Blum 产品配置器",
    url: "https://www.blum.com/us/en/services/e-services/onlineproductconfigurator/",
    summary:
      "产品配置器可根据应用选择合适五金，输出经过校验的完整零件清单、规划信息以及 2D/3D CAD 数据。精确 BOM 与订购前复核应以配置器和当地市场资料为准。",
    official: true,
    keywords: [
      "配置器",
      "configurator",
      "bom",
      "物料清单",
      "零件清单",
      "cad",
      "选型",
      "料号",
      "订购",
      "下单",
    ],
  },
  {
    id: "product-catalogue",
    title: "Blum 中文产品目录",
    url: "https://publications.blum.com/2022/catalogue/zh/toc/",
    summary:
      "Blum 中文目录汇总上翻门、铰链、抽屉、导轨、内分隔、动感开合、其他产品、E-SERVICES、加工工具与通用技术信息。",
    official: true,
    keywords: ["blum", "百隆", "产品目录", "产品手册", "五金", "产品系列"],
  },
  {
    id: "ordering-guide",
    title: "Blum 中国订购手册",
    url: "https://publications.blum.com/2025/miscellaneous/bcn/ordering/zh/",
    summary:
      "中国市场订购手册提供当地套装订购信息和产品概览。产品范围和编号可能随市场及时间变化，实际采购必须核对当前手册。",
    official: true,
    keywords: ["订购手册", "套装", "中国市场", "采购", "产品编号", "订货"],
  },
  {
    id: "blum-contact",
    title: "Blum 官方联系渠道",
    url: "https://www.blum.com/cn/zh/contact/",
    summary:
      "当技术资料冲突、市场型号不明确或需要官方确认时，应联系当地 Blum 团队或授权经销渠道。",
    official: true,
    keywords: ["联系", "客服", "经销商", "售后", "官方确认", "哪里买"],
  },
] as const satisfies readonly OfficialSource[];

export const FALLBACK_SOURCE_IDS = [
  "product-catalogue",
  "product-configurator",
  "blum-contact",
] as const;
