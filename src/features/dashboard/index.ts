/**
 * Public contract of the dashboard feature (net worth, balance history,
 * spending analytics, and timeline annotations). Other features and routes
 * must import from here — never from `./domain/*` or `./infrastructure/*`
 * directly.
 */
export { sankeyService } from './domain/sankey-service'
export type { SankeyData, SankeyNode, SankeyLink } from './domain/sankey-service'
export { categorySpendingService } from './domain/category-spending-service'
export type { CategoryInfo, CategoryBarDatum, CategoryBarData } from './domain/category-spending-service'
export { annotationService } from './domain/annotation-service'
export { expandAnnotations } from './domain/timeline-annotations'
export type { AnnotationForExpansion, ExpandedAnnotation } from './domain/timeline-annotations'

export { default as BalanceHistogram } from './ui/balance-histogram'
export type { InstrumentRates } from './ui/balance-histogram'
export * from './ui/charts'
export { SankeyChart } from './ui/charts/sankey-chart'

export { dashboardFeature } from './feature'
