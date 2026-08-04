import type { RoleId, RoleProfile } from "./types";

export const ROLES = [
  {
    id: "designer",
    label: "设计师",
    eyebrow: "方案与选型",
    description: "从柜体场景、面板形式与动感开合体验出发梳理方案。",
    starterPrompts: [
      "一组 600 mm 宽、门板含把手 8 kg 的吊柜上翻门，如何按 Lift Factor 选 AVENTOS 并校核开启空间？",
      "岛台的 900 mm 宽锅具抽需要兼顾承重、抗侧摆和无拉手体验，MERIVOBOX、LEGRABOX 与 MOVENTO 应怎样组合？",
      "18 mm 木门、35 mm 杯孔、两扇共用中侧板时，怎样计算半盖门的 C 值、门缝和底座组合？",
      "玻璃门与窄铝框门不能开标准杯孔时，选 Blum 铰链前需要向门厂确认哪些截面和固定参数？",
      "开放式厨房的水槽柜和灶台邻柜，如何在防潮、清洁、检修和五金寿命之间制定结构方案？",
    ],
  },
  {
    id: "sales",
    label: "销售",
    eyebrow: "价值与沟通",
    description: "把产品差异转成客户听得懂、可核实的价值表达。",
    starterPrompts: [
      "客户认为“普通缓冲铰链都一样”，如何用不夸大的语言解释 CLIP top BLUMOTION 的体验、调节和适用边界？",
      "面对无拉手厨房报价，怎样向客户比较 TIP-ON、TIP-ON BLUMOTION 与 SERVO-DRIVE 的使用感、预算和维护差异？",
      "客户要做宽锅具抽，如何把 40 kg/70 kg 导轨选择、完整抽屉构造和安全校核解释成可签字确认的方案？",
      "旧橱柜客户问“能不能把所有合页换成百隆”，销售应先收集哪些尺寸、照片和产品号，避免承诺兼容？",
      "如何向工程客户说明 Blum 正品渠道、产品号、包装单位和交期需要以书面报价确认，而不是只报一个单价？",
    ],
  },
  {
    id: "installer",
    label: "安装工",
    eyebrow: "安装与排障",
    description: "按产品、现象和现场条件定位安装或调节问题。",
    starterPrompts: [
      "CLIP top 双门中缝一边大、一边小，如何按高度、侧向、深度的顺序调到齐平且不互相蹭？",
      "MOVENTO 抽屉一边先到位、推回发涩，现场应怎样核对柜体内宽、导轨孔位和锁定装置？",
      "35 mm 杯孔准备批量开钻前，如何用模板和首件确认 C 值、杯深、固定孔及门缝？",
      "AVENTOS HK top 装好后门会自己下落或猛弹，应先查 LF、左右省力装置还是调节螺丝？",
      "抽屉运行不顺时如何分步排查？",
    ],
  },
  {
    id: "production",
    label: "生产",
    eyebrow: "加工与工艺",
    description: "围绕加工数据、装配顺序、工具与复核点组织工作。",
    starterPrompts: [
      "一批 18 mm 门板使用 CLIP top，量产前怎样把产品号、杯孔 C 值、钻孔深度和首件门缝固化进工艺单？",
      "MERIVOBOX 宽抽量产时，侧帮、导轨、前板连接件、后板和同步/稳定件怎样做防错配套？",
      "MINIPRESS 与 EASYSTICK 在小批多规格和连续批量生产中分别如何安排，首件和换型复核点有哪些？",
      "柜体内宽前后有差导致隐藏轨抽屉不顺，生产端应怎样定义方正度检查、返修门槛和放行标准？",
      "AVENTOS 上翻门加工前，如何把 Lift Factor、左右省力装置、门高和安装孔位转换成可追溯的工单？",
    ],
  },
  {
    id: "procurement",
    label: "采购",
    eyebrow: "料号与清单",
    description: "明确选型参数、套装关系、地区差异和下单复核要求。",
    starterPrompts: [
      "采购 AVENTOS 前，设计师必须提供哪些门重、门高、门型、柜深、开启方式和左右件信息才能形成准确 BOM？",
      "MERIVOBOX 项目下单时，怎样用完整产品号逐项核对侧帮、导轨、前板连接件、后板和包装单位，防止漏订？",
      "工程项目的 Blum 交期如何拆成报价锁定、备货、配套、运输和到场验收，并设置哪些风险预警？",
      "拿到旧铰链或导轨的照片后，怎样通过本体标识、长度、左右件和安装尺寸确认可替换产品，而不误下相似型号？",
      "供应商报价显著偏低时，采购如何核验授权渠道、正品凭证、PU、税运条款、保修责任和批次可追溯性？",
    ],
  },
  {
    id: "consumer",
    label: "消费者",
    eyebrow: "选择与使用",
    description: "用生活化语言解释体验差异、日常维护和购买注意事项。",
    starterPrompts: [
      "我家百隆抽屉拉起来有异响、偶尔卡住，自己可以按什么顺序检查，哪些情况必须找安装师傅？",
      "橱柜门下垂、门缝一边大一边小，CLIP 铰链的哪几颗螺丝可以调，怎样避免越调越歪？",
      "无拉手柜门的 TIP-ON 按了不弹或一碰就开，先检查门缝、磁吸还是铰链？",
      "老橱柜想换成百隆铰链或托底轨，拍哪些照片、量哪些尺寸，才能判断能否改装？",
      "网上购买百隆配件怎样看产品号、包装和渠道，遇到阻尼失效或生锈能不能直接自己加油？",
    ],
  },
] as const satisfies readonly RoleProfile[];

const roleMap = new Map(ROLES.map((role) => [role.id, role]));

export function getRole(value: string): RoleProfile {
  return roleMap.get(value as RoleId) ?? roleMap.get("consumer")!;
}
