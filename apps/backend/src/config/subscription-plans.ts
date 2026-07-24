export type SubscriptionPlanSeed = {
  name: string
  displayName: string
  description: string
  price: number
  priceUnit: 'month' | 'year' | 'one_time'
  videoQuotaMonthly: number
  imageQuotaMonthly: number
  storageQuotaMb: number
  aiTokensQuotaMonthly: number
  features: string[]
  isActive: boolean
  sortOrder: number
}

export const SUBSCRIPTION_PLAN_SEEDS = [
  {
    name: 'free',
    displayName: '免费版',
    description: '默认个人工作室方案',
    price: 0,
    priceUnit: 'month',
    videoQuotaMonthly: 3000,
    imageQuotaMonthly: 15000,
    storageQuotaMb: 10240,
    aiTokensQuotaMonthly: 3000000,
    features: ['workspace', 'basic-auth', 'default-quota'],
    isActive: true,
    sortOrder: 0,
  },
] as const satisfies readonly SubscriptionPlanSeed[]

export const DEFAULT_SUBSCRIPTION_PLAN = SUBSCRIPTION_PLAN_SEEDS[0].name

export function getSubscriptionPlanSeed(name: string): SubscriptionPlanSeed | null {
  return SUBSCRIPTION_PLAN_SEEDS.find((plan) => plan.name === name) ?? null
}
