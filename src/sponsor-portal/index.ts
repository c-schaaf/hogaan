export { wireSponsorPortalRoutes } from './setup.js';
export { registerSponsorPortalRoutes } from './routes.js';
export {
  requireSegmentSize,
  isSuppressed,
  SEGMENT_SIZE_FLOOR,
  SEGMENT_SUPPRESSED_COPY,
  type Segment,
  type SegmentSuppressed,
  type SegmentVisible,
} from './aggregation/privacy.js';
export {
  loadSeatsOverview,
  loadRedemptionVelocity,
  loadGeographyBreakdown,
  countDistinctUsersInCohorts,
  listSponsorCohortIds,
  type SeatsOverview,
  type RedemptionVelocityPoint,
  type GeographyBreakdown,
} from './aggregation/cohort.js';
export {
  loadEngagementSummary,
  loadRetentionCurve,
  loadPracticeDistribution,
  type EngagementSummary,
  type RetentionPoint,
  type PracticeDistribution,
} from './aggregation/engagement.js';
export {
  loadQcSummary,
  loadCrisisCategoryCounts,
  type QcSummary,
  type CrisisCategoryCount,
} from './aggregation/qc.js';
export { requestMagicLink, handleCallback, upsertSponsorUser } from './auth/magic-link.js';
export {
  issueMagicLinkToken,
  validateMagicLinkToken,
  issueSponsorSessionToken,
  validateSponsorSessionToken,
  type SponsorRole,
  type SponsorSessionClaims,
  type MagicLinkClaims,
} from './auth/token.js';
