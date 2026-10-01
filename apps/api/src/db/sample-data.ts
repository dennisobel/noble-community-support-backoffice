import type { Kyc, ShiftRatio } from "@shared/enums";

/**
 * Fictional sample workspace for development and demos: who works for the provider, what they
 * deliver, who they support and the standing weekly roster. Everything here is invented; phone
 * numbers use the ranges reserved for fictional use and email addresses use reserved domains.
 */

export type StaffKey =
  | "jordan"
  | "priyanka"
  | "tom"
  | "sam"
  | "rachel"
  | "alex";
export type ServiceKey =
  | "community"
  | "group"
  | "weekend"
  | "daily"
  | "coord"
  | "review"
  | "legacy";
export type ParticipantKey =
  | "mia"
  | "noah"
  | "priya"
  | "ethan"
  | "grace"
  | "liam"
  | "sofia"
  | "oliver";

export const STAFF: Array<{
  key: StaffKey;
  name: string;
  position: string;
  team: string;
  email: string;
  phone: string;
  notes: string;
}> = [
  {
    key: "jordan",
    name: "Jordan Lee",
    position: "Support Worker",
    team: "Community Support",
    email: "jordan.lee@noble.example",
    phone: "08 5550 0141",
    notes: "Community access and travel training. First aid current.",
  },
  {
    key: "priyanka",
    name: "Priyanka Desai",
    position: "Senior Support Worker",
    team: "Community Support",
    email: "priyanka.desai@noble.example",
    phone: "08 5550 0142",
    notes: "Leads group outings. Medication-assist trained.",
  },
  {
    key: "tom",
    name: "Tom Nguyen",
    position: "Support Worker",
    team: "Community Support",
    email: "tom.nguyen@noble.example",
    phone: "08 5550 0143",
    notes: "Available on weekends.",
  },
  {
    key: "sam",
    name: "Sam Patel",
    position: "Support Worker",
    team: "Community Support",
    email: "sam.patel@noble.example",
    phone: "08 5550 0144",
    notes: "",
  },
  {
    key: "rachel",
    name: "Rachel Kim",
    position: "Support Coordinator",
    team: "Support Coordination",
    email: "rachel.kim@noble.example",
    phone: "08 5550 0145",
    notes: "Plan reviews and provider liaison.",
  },
  {
    key: "alex",
    name: "Alex Rivera",
    position: "Administrator",
    team: "Administration",
    email: "alex.rivera@noble.example",
    phone: "08 5550 0146",
    notes: "Rostering support and invoicing.",
  },
];

export const SERVICES: Array<{
  key: ServiceKey;
  name: string;
  unit: "Hour" | "Session";
  rate: number;
  transport: boolean;
  category: string;
  item: string;
  active: boolean;
}> = [
  {
    key: "community",
    name: "Community participation",
    unit: "Hour",
    rate: 68.3,
    transport: true,
    category: "Community participation",
    item: "04_104_0125_6_1",
    active: true,
  },
  {
    key: "group",
    name: "Group community access",
    unit: "Hour",
    rate: 34.15,
    transport: true,
    category: "Community participation",
    item: "04_102_0136_6_1",
    active: true,
  },
  {
    key: "weekend",
    name: "Weekend community participation",
    unit: "Hour",
    rate: 96.11,
    transport: true,
    category: "Community participation",
    item: "04_105_0125_6_1",
    active: true,
  },
  {
    key: "daily",
    name: "Daily living skills",
    unit: "Hour",
    rate: 68.3,
    transport: true,
    category: "Daily living skills",
    item: "01_011_0107_1_1",
    active: true,
  },
  {
    key: "coord",
    name: "Support coordination",
    unit: "Hour",
    rate: 100.14,
    transport: false,
    category: "Support coordination",
    item: "07_002_0106_8_3",
    active: true,
  },
  {
    key: "review",
    name: "Plan review session",
    unit: "Session",
    rate: 250,
    transport: false,
    category: "Support coordination",
    item: "",
    active: true,
  },
  {
    key: "legacy",
    name: "Respite day program (legacy)",
    unit: "Hour",
    rate: 62.1,
    transport: false,
    category: "Daily living skills",
    item: "",
    active: false,
  },
];

export const ALL_KYC: Kyc = {
  serviceAgreement: true,
  consentForms: true,
  supportPlan: true,
  riskInformationReviewed: true,
  transportRequirementsConfirmed: true,
};

export interface ParticipantSeed {
  key: ParticipantKey;
  name: string;
  preferred: string;
  ndis: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  /** The current plan started on the 1st of the month this many months before the current month. */
  planMonthsAgo: number;
  /** Set when the plan was renewed: the plan it replaced started this many months ago. */
  previousPlanMonthsAgo?: number;
  manager: string;
  managerEmail: string;
  nominee: string;
  emergencyName: string;
  emergencyPhone: string;
  alerts: string[];
  goals: string[];
  communication: string;
  mobility: string;
  transport: string;
  support: string;
  risks: string;
  allergies: string;
  preferences: string;
  kyc: Kyc;
  /** First and last week of service, relative to the current week (0 = this week). */
  startWeek: number;
  endWeek?: number;
  /** Invoice payment terms in days and how often invoices are raised. */
  terms: 7 | 14 | 30;
  cadence: "monthly" | "fortnightly";
  /** Budget categories funded by the plan. */
  categories: string[];
  /** Share of each funded category that is used or committed today (drives the plan allocation). */
  utilisation: number;
  /** The same for the plan that was renewed, which ran its full term. */
  previousUtilisation?: number;
  /** How the payer settles invoices: days after (or, if negative, before) the due date. */
  paymentHabit: number;
  /** Where the newest invoice is left when it is still being prepared. */
  recentInvoice?: "Draft" | "Ready to send";
  archivedReason?: string;
}

const COMMUNITY = "Community participation";
const DAILY = "Daily living skills";
const COORDINATION = "Support coordination";
const ALL_CATEGORIES = [COMMUNITY, DAILY, COORDINATION];

export const PARTICIPANTS: ParticipantSeed[] = [
  {
    key: "mia",
    name: "Amelia Carter",
    preferred: "Mia",
    ndis: "431208775",
    dob: "1996-04-12",
    phone: "08 5550 0111",
    email: "amelia.carter@example.org",
    address: "14 Gilbert Street, Adelaide SA 5000",
    planMonthsAgo: 7,
    manager: "Bright Path Plan Management",
    managerEmail: "invoices@brightpath.example",
    nominee: "Sarah Carter (mother)",
    emergencyName: "Sarah Carter",
    emergencyPhone: "08 5550 0112",
    alerts: [
      "Anaphylaxis — carry EpiPen",
      "Advance notice preferred for schedule changes",
    ],
    goals: [
      "Build independence with community access",
      "Develop meal-planning skills",
      "Increase confidence using public transport",
    ],
    communication:
      "Allow extra processing time. Use clear, short instructions and check understanding.",
    mobility: "No mobility aid required.",
    transport: "Prefers familiar staff for community transport.",
    support: "Community access, daily living skills, meal planning.",
    risks: "May become anxious in crowded, unfamiliar settings.",
    allergies: "Peanuts — anaphylaxis",
    preferences: "Likes quiet cafés, gardening and written reminders.",
    kyc: ALL_KYC,
    startWeek: -13,
    terms: 14,
    cadence: "monthly",
    categories: ALL_CATEGORIES,
    utilisation: 0.42,
    paymentHabit: -4,
  },
  {
    key: "noah",
    name: "Noah Williams",
    preferred: "Noah",
    ndis: "431662090",
    dob: "2001-09-03",
    phone: "08 5550 0113",
    email: "noah.williams@example.org",
    address: "7 Jetty Road, Glenelg SA 5045",
    planMonthsAgo: 5,
    manager: "Horizon Plan Services",
    managerEmail: "accounts@horizonplans.example",
    nominee: "Mark Williams (father)",
    emergencyName: "Mark Williams",
    emergencyPhone: "08 5550 0114",
    alerts: ["Uses a communication board when tired"],
    goals: ["Practice independent travel", "Build social connections"],
    communication: "Speak face-to-face; offer visual choices.",
    mobility: "No mobility aid required.",
    transport: "Wheelchair accessible vehicle not required.",
    support: "Social participation and travel training.",
    risks: "Check road-crossing safety.",
    allergies: "None recorded",
    preferences: "Enjoys basketball and music.",
    kyc: ALL_KYC,
    startWeek: -13,
    terms: 30,
    cadence: "monthly",
    categories: ALL_CATEGORIES,
    utilisation: 0.4,
    paymentHabit: 0,
  },
  {
    key: "priya",
    name: "Priya Nair",
    preferred: "Priya",
    ndis: "431054823",
    dob: "1988-11-21",
    phone: "08 5550 0115",
    email: "priya.nair@example.org",
    address: "29 Unley Road, Parkside SA 5063",
    planMonthsAgo: 8,
    manager: "Self-managed",
    managerEmail: "",
    nominee: "",
    emergencyName: "Arun Nair",
    emergencyPhone: "08 5550 0116",
    alerts: ["Latex sensitivity — use nitrile gloves"],
    goals: ["Maintain daily routines", "Explore volunteering opportunities"],
    communication: "Prefers a written agenda before appointments.",
    mobility: "Uses a walking stick for longer distances.",
    transport: "Allow additional time for vehicle access.",
    support: "Daily living, appointments, community participation.",
    risks: "Uneven surfaces can affect balance.",
    allergies: "Latex sensitivity",
    preferences: "Enjoys art galleries and cooking.",
    kyc: ALL_KYC,
    startWeek: -13,
    terms: 7,
    cadence: "fortnightly",
    categories: ALL_CATEGORIES,
    utilisation: 0.5,
    paymentHabit: 9,
    recentInvoice: "Draft",
  },
  {
    key: "ethan",
    name: "Ethan Brooks",
    preferred: "Ethan",
    ndis: "431810445",
    dob: "1999-02-17",
    phone: "08 5550 0117",
    email: "ethan.brooks@example.org",
    address: "3 / 18 Henley Beach Road, Mile End SA 5031",
    planMonthsAgo: 6,
    manager: "Bright Path Plan Management",
    managerEmail: "invoices@brightpath.example",
    nominee: "",
    emergencyName: "Lara Brooks",
    emergencyPhone: "08 5550 0118",
    alerts: ["Medication reminder at 12:00"],
    goals: ["Develop cooking confidence", "Practice budgeting"],
    communication: "",
    mobility: "",
    transport: "",
    support: "Capacity building and meal preparation.",
    risks: "",
    allergies: "None recorded",
    preferences: "Likes step-by-step recipes.",
    // Onboarding still in progress: two checklist items are open.
    kyc: { ...ALL_KYC, consentForms: false, riskInformationReviewed: false },
    startWeek: -13,
    terms: 14,
    cadence: "monthly",
    categories: ALL_CATEGORIES,
    utilisation: 0.4,
    paymentHabit: -2,
  },
  {
    key: "grace",
    name: "Grace Chen",
    preferred: "Grace",
    ndis: "431425992",
    dob: "1993-06-30",
    phone: "08 5550 0119",
    email: "grace.chen@example.org",
    address: "6 Stirling Street, Norwood SA 5067",
    // Plan renewed on the 1st of this month.
    planMonthsAgo: 0,
    previousPlanMonthsAgo: 12,
    manager: "New Horizons Plan Management",
    managerEmail: "billing@newhorizons.example",
    nominee: "Ming Chen (sister)",
    emergencyName: "Ming Chen",
    emergencyPhone: "08 5550 0120",
    alerts: ["Prefers a one-to-one conversation before group activities"],
    goals: ["Build confidence in social settings", "Maintain healthy routines"],
    communication: "Prefers one-to-one conversations.",
    mobility: "",
    transport: "",
    support: "Social and community participation.",
    risks: "",
    allergies: "Shellfish",
    preferences: "Enjoys swimming and podcasts.",
    kyc: ALL_KYC,
    startWeek: -13,
    terms: 14,
    cadence: "monthly",
    categories: ALL_CATEGORIES,
    // The new plan is only weeks old; the one it replaced was almost fully used.
    utilisation: 0.12,
    previousUtilisation: 0.8,
    paymentHabit: -1,
  },
  {
    key: "liam",
    name: "Liam O'Connor",
    preferred: "Liam",
    ndis: "431771308",
    dob: "2003-08-19",
    phone: "08 5550 0121",
    email: "liam.oconnor@example.org",
    address: "42 Prospect Road, Prospect SA 5082",
    planMonthsAgo: 2,
    manager: "Horizon Plan Services",
    managerEmail: "accounts@horizonplans.example",
    nominee: "Deirdre O'Connor (mother)",
    emergencyName: "Deirdre O'Connor",
    emergencyPhone: "08 5550 0122",
    alerts: ["Sensitive to loud noise — headphones available"],
    goals: [
      "Build a routine around a work-experience placement",
      "Travel independently by bus",
    ],
    communication:
      "Give a short warning before changes to the plan for the day.",
    mobility: "No mobility aid required.",
    transport: "Confident on buses with a written route.",
    support: "Community access and travel training.",
    risks: "Loud, crowded places can be overwhelming; offer a quiet break.",
    allergies: "None recorded",
    preferences: "Likes cycling, trains and keeping to a routine.",
    kyc: ALL_KYC,
    startWeek: -8,
    terms: 30,
    cadence: "monthly",
    categories: ALL_CATEGORIES,
    utilisation: 0.45,
    paymentHabit: 1,
  },
  {
    key: "sofia",
    name: "Sofia Rossi",
    preferred: "Sofia",
    ndis: "431390517",
    dob: "1985-12-02",
    phone: "08 5550 0123",
    email: "sofia.rossi@example.org",
    address: "23 Hutt Street, Adelaide SA 5000",
    planMonthsAgo: 3,
    manager: "Clear Path Plan Management",
    managerEmail: "accounts@clearpath.example",
    nominee: "",
    emergencyName: "Marco Rossi",
    emergencyPhone: "08 5550 0124",
    alerts: ["Plan funds are running low — review before the next invoice"],
    goals: [
      "Coordinate supports across health and community providers",
      "Join a weekend social group",
    ],
    communication: "Prefers email for anything that needs a decision.",
    mobility: "No mobility aid required.",
    transport: "Meets staff at the venue on weekends.",
    support: "Support coordination and weekend community participation.",
    risks: "",
    allergies: "None recorded",
    preferences: "Enjoys markets, cooking classes and live music.",
    kyc: ALL_KYC,
    startWeek: -12,
    terms: 14,
    cadence: "fortnightly",
    categories: [COMMUNITY, COORDINATION],
    // Nearly all of the plan is used or committed, so the budget shows a low balance.
    utilisation: 0.9,
    paymentHabit: 2,
  },
  {
    key: "oliver",
    name: "Oliver Grant",
    preferred: "Oliver",
    ndis: "431298864",
    dob: "1997-07-08",
    phone: "08 5550 0125",
    email: "oliver.grant@example.org",
    address: "5 Semaphore Road, Semaphore SA 5019",
    planMonthsAgo: 5,
    manager: "Bright Path Plan Management",
    managerEmail: "invoices@brightpath.example",
    nominee: "",
    emergencyName: "Janet Grant",
    emergencyPhone: "08 5550 0126",
    alerts: [],
    goals: ["Explore local community activities"],
    communication: "",
    mobility: "",
    transport: "",
    support: "Community participation.",
    risks: "",
    allergies: "None recorded",
    preferences: "Enjoys the beach and the library.",
    kyc: ALL_KYC,
    startWeek: -13,
    endWeek: -5,
    terms: 14,
    cadence: "fortnightly",
    categories: [COMMUNITY, COORDINATION],
    utilisation: 0.4,
    paymentHabit: -3,
    archivedReason: "Moved interstate — services concluded and file closed.",
  },
];

/* ───────────── The standing weekly roster ───────────── */

export interface ShiftPattern {
  id: string;
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  start: string;
  end: string;
  ratio: ShiftRatio;
  clients: ParticipantKey[];
  staff: StaffKey[];
  service: ServiceKey;
  /** Venues, used in turn week by week. */
  locations: string[];
  notes?: string;
  /** Runs every N weeks, starting `offset` weeks after `fromWeek`. */
  every?: number;
  offset?: number;
  /** Weeks relative to the current week, inclusive. */
  fromWeek?: number;
  toWeek?: number;
  /** A one-off in a single week. */
  onlyWeek?: number;
}

export const PATTERNS: ShiftPattern[] = [
  {
    id: "mia-mon",
    day: 0,
    start: "09:00",
    end: "12:00",
    ratio: "1:1",
    clients: ["mia"],
    staff: ["jordan"],
    service: "community",
    locations: [
      "Marion Shopping Centre",
      "Adelaide Central Market",
      "Burnside Village",
      "Glenelg foreshore",
    ],
  },
  {
    id: "noah-mon",
    day: 0,
    start: "13:00",
    end: "15:30",
    ratio: "1:1",
    clients: ["noah"],
    staff: ["tom"],
    service: "community",
    locations: ["Glenelg foreshore", "Henley Square", "Norwood Parade"],
  },
  {
    id: "priya-mon",
    day: 0,
    start: "10:00",
    end: "12:00",
    ratio: "1:1",
    clients: ["priya"],
    staff: ["priyanka"],
    service: "daily",
    locations: ["Participant home"],
  },
  {
    id: "ethan-tue-sam",
    day: 1,
    start: "09:30",
    end: "11:30",
    ratio: "1:1",
    clients: ["ethan"],
    staff: ["sam"],
    service: "daily",
    locations: ["Participant home"],
    toWeek: -4,
  },
  {
    id: "ethan-tue-tom",
    day: 1,
    start: "09:30",
    end: "11:30",
    ratio: "1:1",
    clients: ["ethan"],
    staff: ["tom"],
    service: "daily",
    locations: ["Participant home"],
    fromWeek: -3,
  },
  {
    id: "sofia-tue-coordination",
    day: 1,
    start: "11:00",
    end: "12:00",
    ratio: "1:1",
    clients: ["sofia"],
    staff: ["rachel"],
    service: "coord",
    locations: ["Noble office", "Video call"],
    every: 2,
    fromWeek: -12,
  },
  {
    id: "liam-tue",
    day: 1,
    start: "13:00",
    end: "15:00",
    ratio: "1:1",
    clients: ["liam"],
    staff: ["jordan"],
    service: "community",
    locations: [
      "Prospect Road shops",
      "Adelaide Central Market",
      "Unley Road shops",
    ],
    fromWeek: -8,
  },
  {
    id: "oliver-wed",
    day: 2,
    start: "09:00",
    end: "11:00",
    ratio: "1:1",
    clients: ["oliver"],
    staff: ["sam"],
    service: "community",
    locations: ["Semaphore foreshore", "Local library", "Glenelg foreshore"],
    toWeek: -5,
  },
  {
    id: "grace-review",
    day: 2,
    start: "10:00",
    end: "11:30",
    ratio: "1:1",
    clients: ["grace"],
    staff: ["rachel"],
    service: "review",
    locations: ["Noble office"],
    notes: "Plan review ahead of the 1 September plan start.",
    onlyWeek: -5,
  },
  {
    id: "group-wed",
    day: 2,
    start: "13:00",
    end: "16:00",
    ratio: "M:M",
    clients: ["mia", "grace"],
    staff: ["jordan", "priyanka"],
    service: "group",
    locations: [
      "Adelaide Botanic Garden",
      "Semaphore foreshore",
      "Adelaide Zoo",
      "Henley Square",
    ],
    toWeek: -9,
  },
  {
    id: "group-wed-liam",
    day: 2,
    start: "13:00",
    end: "16:00",
    ratio: "M:M",
    clients: ["mia", "grace", "liam"],
    staff: ["jordan", "priyanka"],
    service: "group",
    locations: [
      "Adelaide Botanic Garden",
      "Semaphore foreshore",
      "Adelaide Zoo",
      "Henley Square",
    ],
    fromWeek: -8,
  },
  {
    id: "mia-thu",
    day: 3,
    start: "09:00",
    end: "12:00",
    ratio: "1:1",
    clients: ["mia"],
    staff: ["jordan"],
    service: "community",
    locations: [
      "Adelaide Botanic Garden",
      "Norwood Parade",
      "Unley Road shops",
      "West Lakes Shopping Centre",
    ],
  },
  {
    id: "priya-thu",
    day: 3,
    start: "10:00",
    end: "12:00",
    ratio: "1:1",
    clients: ["priya"],
    staff: ["priyanka"],
    service: "daily",
    locations: ["Participant home"],
  },
  {
    id: "grace-thu",
    day: 3,
    start: "13:30",
    end: "15:30",
    ratio: "1:1",
    clients: ["grace"],
    staff: ["tom"],
    service: "community",
    locations: [
      "Norwood Swimming Centre",
      "Adelaide Botanic Garden",
      "Norwood Parade",
    ],
  },
  {
    id: "priya-thu-coordination",
    day: 3,
    start: "14:00",
    end: "15:00",
    ratio: "1:1",
    clients: ["priya"],
    staff: ["rachel"],
    service: "coord",
    locations: ["Noble office", "Video call"],
    every: 2,
    offset: 1,
  },
  {
    id: "group-fri",
    day: 4,
    start: "09:30",
    end: "12:30",
    ratio: "1:M",
    clients: ["noah", "ethan"],
    staff: ["priyanka"],
    service: "group",
    locations: ["Adelaide CBD", "Henley Square", "Glenelg foreshore"],
    notes: "Bus passes and headphones in the vehicle.",
    toWeek: -9,
  },
  {
    id: "group-fri-liam",
    day: 4,
    start: "09:30",
    end: "12:30",
    ratio: "1:M",
    clients: ["noah", "ethan", "liam"],
    staff: ["priyanka"],
    service: "group",
    locations: ["Adelaide CBD", "Henley Square", "Glenelg foreshore"],
    notes: "Bus passes and headphones in the vehicle.",
    fromWeek: -8,
  },
  {
    id: "grace-fri-coordination",
    day: 4,
    start: "11:00",
    end: "12:00",
    ratio: "1:1",
    clients: ["grace"],
    staff: ["rachel"],
    service: "coord",
    locations: ["Noble office", "Video call"],
    every: 4,
    offset: 2,
  },
  {
    id: "sofia-sat",
    day: 5,
    start: "10:00",
    end: "14:00",
    ratio: "1:1",
    clients: ["sofia"],
    staff: ["tom"],
    service: "weekend",
    locations: [
      "Adelaide Central Market",
      "Semaphore foreshore",
      "Rundle Mall",
    ],
    every: 2,
    fromWeek: -12,
  },
];

/** Kilometres travelled to and from each venue (workers drive, or meet the participant on route). */
export const LOCATION_KM: Record<string, number> = {
  "Marion Shopping Centre": 12.4,
  "Adelaide Central Market": 9.6,
  "Burnside Village": 8.8,
  "Glenelg foreshore": 14.2,
  "Henley Square": 11.7,
  "Norwood Parade": 5.4,
  "Adelaide Botanic Garden": 6,
  "Adelaide Zoo": 7.2,
  "Semaphore foreshore": 21.5,
  "West Lakes Shopping Centre": 15.3,
  "Unley Road shops": 4.9,
  "Prospect Road shops": 5.8,
  "Norwood Swimming Centre": 3.8,
  "Local library": 2.6,
  "Adelaide CBD": 8.1,
  "Rundle Mall": 7.4,
  "Participant home": 4.6,
};

/* ───────────── Progress-note scripts ───────────── */

export type VenueKind =
  | "shops"
  | "outdoors"
  | "pool"
  | "library"
  | "home"
  | "office"
  | "city";

export const LOCATION_KIND: Record<string, VenueKind> = {
  "Marion Shopping Centre": "shops",
  "Adelaide Central Market": "shops",
  "Burnside Village": "shops",
  "West Lakes Shopping Centre": "shops",
  "Unley Road shops": "shops",
  "Prospect Road shops": "shops",
  "Norwood Parade": "shops",
  "Rundle Mall": "shops",
  "Glenelg foreshore": "outdoors",
  "Semaphore foreshore": "outdoors",
  "Henley Square": "outdoors",
  "Adelaide Botanic Garden": "outdoors",
  "Adelaide Zoo": "outdoors",
  "Norwood Swimming Centre": "pool",
  "Local library": "library",
  "Participant home": "home",
  "Noble office": "office",
  "Video call": "office",
  "Phone call": "office",
  "Adelaide CBD": "city",
};

export interface NoteScript {
  support: string;
  response: string;
  outcome: string;
  observations: string[];
  followUp: string[];
  /** Venue kinds the activity suits; omitted when it fits anywhere. */
  kinds?: VenueKind[];
}

/** {n} is the participant's preferred name and {loc} the venue. */
const script = (
  support: string,
  response: string,
  outcome: string,
  observations: string[],
  followUp: string[],
  kinds?: VenueKind[]
): NoteScript => ({
  support,
  response,
  outcome,
  observations,
  followUp,
  kinds,
});

/** Notes written for one participant and service; other combinations fall back to GENERIC_SCRIPTS. */
export const PERSONAL_SCRIPTS: Partial<
  Record<ParticipantKey, Partial<Record<ServiceKey, NoteScript[]>>>
> = {
  mia: {
    community: [
      script(
        "Supported {n} with grocery shopping at {loc}. {n} worked from a written list and chose most items independently, with a verbal prompt when comparing labels.",
        "{n} was settled and engaged throughout and asked for help comparing two products before deciding.",
        "Practised making independent choices in the community and following a shopping list.",
        [
          "No incidents. A quieter time of day helped {n} stay focused.",
          "Ingredients checked together for peanut content before buying; no concerns.",
        ],
        [
          "Bring the meal-planning worksheet to the next session.",
          "Review the list for next week together before the next shop.",
        ],
        ["shops"]
      ),
      script(
        "Supported {n} to plan and travel by public transport to {loc}, using the timetable app to check departures and connections.",
        "{n} read the timetable independently and asked for a prompt only when a platform changed.",
        "Built confidence using public transport, in line with {n}'s travel goal.",
        [
          "Arrived with time to spare; {n} stayed calm at the busy interchange.",
          "A crowded carriage caused brief worry; a breathing strategy was used and worked well.",
        ],
        [
          "Repeat the trip next week with {n} leading the route.",
          "Practise topping up the travel card at the next outing.",
        ]
      ),
      script(
        "Supported {n} to spend time at {loc} and take part in a quiet activity of {n}'s choice, including ordering independently.",
        "{n} chose the activity, ordered without prompting and started a conversation with staff.",
        "Practised communicating preferences and taking part in community settings.",
        [
          "Quiet environment; {n} appeared relaxed.",
          "Warm weather; water and sun-protection reminders were accepted.",
        ],
        [
          "Ask {n} which venue to try next.",
          "Note any new interests to add to the support plan.",
        ]
      ),
    ],
  },
  noah: {
    community: [
      script(
        "Supported {n} to plan a route to {loc} using a map and to practise crossing at marked crossings.",
        "{n} used the communication board to ask for a short break and rejoined the walk after five minutes.",
        "Practised safe independent travel and communicating support preferences.",
        [
          "Warm afternoon; water breaks offered.",
          "Traffic was light; {n} checked both directions before each crossing.",
        ],
        [
          "Repeat the route next week and add a second crossing.",
          "Review the route map together before the next session.",
        ]
      ),
      script(
        "Supported {n} to attend a casual basketball session near {loc} and to join in with other players.",
        "{n} took part for most of the session and passed to new teammates.",
        "Built social connections through a shared interest.",
        [
          "Energy dropped near the end; {n} used the communication board to ask to finish.",
          "{n} stayed with the group and chatted at the break.",
        ],
        [
          "Check the session times for next month.",
          "Ask {n} whether to invite a friend next time.",
        ]
      ),
      script(
        "Supported {n} to browse a music shop near {loc} and choose a track to add to {n}'s playlist.",
        "{n} pointed to choices on the communication board and stayed engaged for the whole visit.",
        "Practised making purchases and expressing choices independently.",
        [
          "Quiet visit with no concerns.",
          "{n} paid at the counter with a prompt to count the change.",
        ],
        [
          "Plan a visit to the record fair next month.",
          "Practise counting change at the next outing.",
        ],
        ["shops"]
      ),
    ],
  },
  priya: {
    daily: [
      script(
        "Worked through a meal plan with {n} and prepared a vegetable stir-fry together at home.",
        "{n} followed the written recipe and measured the ingredients independently.",
        "Built confidence with meal preparation and sequencing.",
        [
          "Walking stick used for kitchen transitions.",
          "Nitrile gloves used as agreed; no concerns.",
        ],
        [
          "Check whether the written recipe format is helpful.",
          "Choose next week's recipe together.",
        ]
      ),
      script(
        "Supported {n} to plan and complete laundry and tidy the living area using a weekly routine checklist.",
        "{n} ticked off tasks on the checklist and asked for help only with lifting the basket.",
        "Maintained daily routines with less prompting.",
        [
          "Balance was steady with the walking stick within reach.",
          "Took two seated breaks; energy was good.",
        ],
        [
          "Add bin day to the routine checklist.",
          "Look at a lighter laundry basket.",
        ]
      ),
      script(
        "Supported {n} to prepare for an upcoming appointment, including a written agenda, questions to ask and transport.",
        "{n} wrote three questions and rehearsed them aloud.",
        "Prepared to take part in appointments with confidence.",
        ["Written agenda used, as {n} prefers.", "No concerns noted."],
        [
          "Debrief after the appointment.",
          "Confirm transport for the appointment.",
        ]
      ),
    ],
  },
  ethan: {
    daily: [
      script(
        "Supported {n} to cook a two-step recipe at home, following a step-by-step recipe card and ticking off each step.",
        "{n} read the steps aloud and asked for a demonstration of one technique before trying it.",
        "Developed cooking confidence and sequencing skills.",
        [
          "Hands washed and benches cleaned as agreed.",
          "A timer helped manage cooking times and worked well.",
        ],
        [
          "Choose a new recipe for the next session.",
          "Ask {n} to write the shopping list in advance.",
        ]
      ),
      script(
        "Supported {n} to check the weekly budget, compare prices on a shopping list and record expected costs.",
        "{n} added up the costs with a calculator and found two cheaper options.",
        "Practised budgeting for weekly groceries.",
        [
          "{n} kept the budget sheet up to date since the last session.",
          "Focused for the full session.",
        ],
        [
          "Review the actual receipts next week.",
          "Introduce a simple savings goal.",
        ]
      ),
      script(
        "Supported {n} to practise kitchen safety, including safe knife handling, oven use and food storage.",
        "{n} demonstrated safe handling with only occasional reminders.",
        "Improved safety awareness during meal preparation.",
        [
          "The 12:00 medication reminder was completed independently.",
          "No incidents.",
        ],
        [
          "Continue oven practice next session.",
          "Check the fire blanket is stored where {n} can reach it.",
        ]
      ),
    ],
  },
  grace: {
    community: [
      script(
        "Supported {n} to attend a swimming session at {loc}, including getting changed, entering the pool and using the lockers.",
        "{n} swam for most of the session and chatted with another regular.",
        "Maintained healthy routines and grew more comfortable in social settings.",
        ["The centre was busy; {n} chose a quieter lane.", "No concerns."],
        [
          "Confirm next week's session time.",
          "Look at a membership option together.",
        ],
        ["pool"]
      ),
      script(
        "Supported {n} on a walk around {loc} while listening to a chosen podcast, followed by a coffee stop.",
        "{n} led the route and started conversations with two people along the way.",
        "Built confidence in social settings.",
        [
          "Fine weather and a comfortable pace.",
          "{n} appeared more relaxed than earlier in the plan.",
        ],
        [
          "Ask {n} to choose the next walk.",
          "Look for a small walking group nearby.",
        ],
        ["outdoors"]
      ),
      script(
        "Supported {n} to attend a community group near {loc} and to be introduced to the facilitator.",
        "{n} took part in the activity and spoke up once during the discussion.",
        "Built social connections through a group with shared interests.",
        [
          "{n} preferred to arrive early and settle before the others.",
          "No concerns.",
        ],
        [
          "Send the group calendar to {n}.",
          "Discuss whether to attend every week.",
        ]
      ),
    ],
  },
  liam: {
    community: [
      script(
        "Supported {n} to plan the trip to and from the work-experience placement and to pack for the day using a checklist.",
        "{n} used the checklist and set phone reminders without prompting.",
        "Built a routine around the work-experience placement.",
        [
          "Arrived on time; headphones used on the bus.",
          "{n} said the placement is going well.",
        ],
        [
          "Review the weekly schedule together.",
          "Plan for the extra shift next week.",
        ]
      ),
      script(
        "Supported {n} to travel by bus to {loc}, checking the timetable and tapping on with the travel card.",
        "{n} navigated the route with one verbal prompt at a change of bus.",
        "Practised travelling independently by bus.",
        [
          "The interchange was loud; {n} used headphones and took a short break.",
          "Calm and organised throughout.",
        ],
        [
          "Repeat with {n} leading and staff following.",
          "Try a second route next week.",
        ]
      ),
    ],
  },
  sofia: {
    weekend: [
      script(
        "Supported {n} to attend a weekend community event at {loc} and to talk with organisers about regular groups.",
        "{n} asked several questions and collected contact details for two groups.",
        "Explored weekend social groups.",
        ["Busy venue; {n} managed well.", "{n} enjoyed the activity."],
        [
          "Follow up with the two groups by email.",
          "Plan to attend one session as a trial.",
        ]
      ),
      script(
        "Supported {n} to spend time at {loc}, including browsing stalls and having lunch.",
        "{n} chatted with stallholders and chose a lunch option without prompting.",
        "Increased social participation on weekends.",
        ["Good weather; comfortable throughout.", "No concerns."],
        [
          "Ask {n} what to try next weekend.",
          "Review weekend costs against the plan budget.",
        ],
        ["shops"]
      ),
    ],
  },
  oliver: {
    community: [
      script(
        "Supported {n} to walk along {loc} and have a coffee, practising planning the trip and paying independently.",
        "{n} chose the route and paid at the café without assistance.",
        "Practised community access and independent transactions.",
        ["Comfortable pace.", "No concerns."],
        [
          "Plan next week's outing together.",
          "Confirm session times for the coming fortnight.",
        ],
        ["outdoors"]
      ),
      script(
        "Supported {n} to visit {loc} and borrow items linked to {n}'s interests.",
        "{n} searched the catalogue and used the self-checkout.",
        "Built independence using community facilities.",
        ["Quiet visit.", "{n} was chatty and relaxed."],
        ["Return the items at the next visit.", "Look at a local hobby group."],
        ["library"]
      ),
    ],
  },
};

export const GENERIC_SCRIPTS: Record<ServiceKey, NoteScript[]> = {
  community: [
    script(
      "Supported {n} with a community outing to {loc}, planning the trip together and checking the plan for the day.",
      "{n} took part willingly and made choices about how to spend the time.",
      "Practised community access in line with {n}'s goals.",
      ["No incidents.", "Comfortable pace; no concerns."],
      ["Plan the next outing together.", "Ask {n} for feedback on the venue."]
    ),
  ],
  group: [
    script(
      "Supported {n} to take part in the group outing to {loc}, staying with the group and joining the planned activities.",
      "{n} joined in with others and chose which activities to try.",
      "Built social connections and confidence in group settings.",
      [
        "The group stayed together and the outing ran to time.",
        "One short rest break was taken; no concerns.",
      ],
      [
        "Ask {n} what to do at the next outing.",
        "Share feedback from the outing with {n}.",
      ]
    ),
    script(
      "Supported {n} in a small-group activity at {loc}, including turn-taking and shared planning.",
      "{n} contributed ideas and waited for a turn without prompting.",
      "Practised working with others and sharing choices.",
      ["Good group dynamics; {n} sat with familiar peers.", "No incidents."],
      [
        "Plan a similar activity next month.",
        "Check that {n} enjoyed the choice of venue.",
      ]
    ),
  ],
  weekend: [
    script(
      "Supported {n} with a weekend outing to {loc}.",
      "{n} took part and made choices about how to spend the time.",
      "Increased social participation on weekends.",
      ["No concerns."],
      ["Ask {n} what to try next."]
    ),
  ],
  daily: [
    script(
      "Supported {n} with daily living tasks at home, following the routine agreed in the support plan.",
      "{n} completed the tasks with light prompting.",
      "Maintained daily routines and independence at home.",
      ["No concerns."],
      ["Review the routine with {n} next session."]
    ),
  ],
  coord: [
    script(
      "Coordination session with {n} to review current supports, follow up provider requests and check plan spending.",
      "{n} shared updates about current supports and asked questions about the plan.",
      "Kept supports coordinated and aligned with plan goals.",
      [
        "Two provider follow-ups identified; no urgent concerns raised.",
        "Plan spending is on track for the period.",
      ],
      [
        "Email the provider updates this week.",
        "Book the next coordination session.",
      ]
    ),
    script(
      "Supported {n} to prepare for a service review meeting and to organise the documents needed.",
      "{n} identified the topics to raise and gathered the documents.",
      "Prepared {n} to take an active part in the review.",
      ["Documents collected in one folder.", "No concerns noted."],
      [
        "Send the agenda to the attendees.",
        "Debrief with {n} after the meeting.",
      ]
    ),
  ],
  review: [
    script(
      "Plan review session with {n} to review progress against goals and prepare notes for the plan review.",
      "{n} took part fully and described what is working and what to change.",
      "Progress against goals reviewed and next steps agreed.",
      ["Draft goals updated in the support plan.", "No concerns raised."],
      [
        "Send the review summary to {n} and the plan manager.",
        "Book a follow-up in three months.",
      ]
    ),
  ],
  legacy: [],
};

/** Why a submitted note came back, and the text the worker adds when correcting it. */
export const RETURN_CASES: Array<{
  reason: string;
  field: "observations" | "outcome" | "response";
  addition: string;
}> = [
  {
    reason:
      "Please add the departure and return points for the recorded travel kilometres.",
    field: "observations",
    addition:
      "Travel: left from the participant's home and returned there at the end of the session.",
  },
  {
    reason:
      "The outcome does not say which goal this session supported. Please link it to a goal in the support plan.",
    field: "outcome",
    addition: "This session supported goal: {goal}.",
  },
  {
    reason:
      "Please record whether any health or safety prompts were needed during the session.",
    field: "observations",
    addition: "No health or safety prompts were needed during the session.",
  },
  {
    reason:
      "Please add how the participant responded to the activity (engagement and mood).",
    field: "response",
    addition: "Engagement stayed steady and mood was positive.",
  },
];

/** Ad-hoc (unrostered) records, keyed by weeks before the current week. */
export const AD_HOC: Array<{
  weeksAgo: number;
  day: number;
  start: string;
  end: string;
  client: ParticipantKey;
  staff: StaffKey;
  service: ServiceKey;
  location: string;
}> = [
  {
    weeksAgo: 2,
    day: 2,
    start: "15:00",
    end: "15:30",
    client: "priya",
    staff: "rachel",
    service: "coord",
    location: "Phone call",
  },
  {
    weeksAgo: 3,
    day: 5,
    start: "09:00",
    end: "10:30",
    client: "mia",
    staff: "jordan",
    service: "community",
    location: "Unley Road shops",
  },
  {
    weeksAgo: 1,
    day: 1,
    start: "10:00",
    end: "11:30",
    client: "noah",
    staff: "tom",
    service: "community",
    location: "Henley Square",
  },
  {
    weeksAgo: 4,
    day: 3,
    start: "16:00",
    end: "16:45",
    client: "sofia",
    staff: "rachel",
    service: "coord",
    location: "Video call",
  },
  {
    weeksAgo: 6,
    day: 5,
    start: "09:00",
    end: "11:00",
    client: "priya",
    staff: "priyanka",
    service: "daily",
    location: "Participant home",
  },
];
