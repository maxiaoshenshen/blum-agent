import type { RoleId, RoleProfile } from "./types";

export const ROLES = [
  {
    id: "designer",
    label: "设计师",
    eyebrow: "方案与选型",
    description: "从柜体场景、面板形式与动感开合体验出发梳理方案。",
    starterPrompts: [
      "窄厨房高柜适合采用哪种 Blum 收纳方案？",
      "无拉手吊柜有哪些 AVENTOS 选择？",
    ],
  },
  {
    id: "sales",
    label: "销售",
    eyebrow: "价值与沟通",
    description: "把产品差异转成客户听得懂、可核实的价值表达。",
    starterPrompts: [
      "如何向客户解释 BLUMOTION 和 TIP-ON BLUMOTION 的区别？",
      "用三句话介绍 MERIVOBOX 的价值。",
    ],
  },
  {
    id: "installer",
    label: "安装工",
    eyebrow: "安装与排障",
    description: "按产品、现象和现场条件定位安装或调节问题。",
    starterPrompts: [
      "柜门关闭后高低不齐，应该先检查什么？",
      "抽屉运行不顺时如何分步排查？",
    ],
  },
  {
    id: "production",
    label: "生产",
    eyebrow: "加工与工艺",
    description: "围绕加工数据、装配顺序、工具与复核点组织工作。",
    starterPrompts: [
      "量产前应怎样复核 Blum 五金加工数据？",
      "MINIPRESS 和 EASYSTICK 分别解决什么问题？",
    ],
  },
  {
    id: "procurement",
    label: "采购",
    eyebrow: "料号与清单",
    description: "明确选型参数、套装关系、地区差异和下单复核要求。",
    starterPrompts: [
      "采购 AVENTOS 前需要设计师提供哪些参数？",
      "如何降低 Blum 配件漏订和错订风险？",
    ],
  },
  {
    id: "consumer",
    label: "消费者",
    eyebrow: "选择与使用",
    description: "用生活化语言解释体验差异、日常维护和购买注意事项。",
    starterPrompts: [
      "百隆抽屉为什么手感不一样？",
      "家里的铰链异响应该怎样清洁和检查？",
    ],
  },
] as const satisfies readonly RoleProfile[];

const roleMap = new Map(ROLES.map((role) => [role.id, role]));

export function getRole(value: string): RoleProfile {
  return roleMap.get(value as RoleId) ?? roleMap.get("consumer")!;
}
