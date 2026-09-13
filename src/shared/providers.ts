export const PROVIDER_IDS = ['github', 'gitlab', 'bitbucket'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]
