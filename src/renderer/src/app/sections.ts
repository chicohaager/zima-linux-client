/** The four destinations of the app, in the order the mobile client shows them. */
export const SECTIONS = ['files', 'photos', 'apps', 'device'] as const
export type Section = (typeof SECTIONS)[number]

/** Sections that live in the floating pill; `device` sits apart as its own button. */
export const PILL_SECTIONS = ['files', 'photos', 'apps'] as const satisfies readonly Section[]
