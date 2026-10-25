// Fixed ids shared by the seed, stub adapters, tests and replays. Contract for the demo cast.
export const SQUAD_ID = 'sq_demo';
export const STUDENT_IDS = ['s_ana', 's_ben', 's_chi', 's_dev'] as const;
export const ANA = 's_ana';
export const BEN = 's_ben';
export const CHI = 's_chi';
export const DEV = 's_dev';
export const TRIP_ID = 'trip_cabo';
export const TRIP_TASK_ID = 'task_trip_cabo';
export const STUDY_TASK_ID = 'task_study_ch5';
export const QUIZ_IDS = ['qz_ch5_1', 'qz_ch5_2'] as const;
export const COURSE_ID = 'cse310';
export const EXPERT_AGENT = 'expert:ch5';
/** Sentinel withheld values planted in private data by the seed. They must never leave except via the owner's GET /v1/ledger. */
export const SEED_SENTINELS = { budget: '$180', topic: 'therapy' } as const;
