import { HEALTH_FLAGS, INCIDENT_FLAGS } from "../enums";

/** The written part of a progress note: everything the worker records beyond the shift details. */
export interface NoteContent {
  supportTypes: string[];
  support: string;
  summary: string;
  goals: string[];
  outcome: string;
  achievements: string;
  health: string[];
  healthDetails: string;
  incident: string[];
  incidentDetails: string;
  followUp: string;
}

export const NOTE_FIELDS = [
  "supportTypes",
  "support",
  "summary",
  "goals",
  "outcome",
  "achievements",
  "health",
  "healthDetails",
  "incident",
  "incidentDetails",
  "followUp",
] as const satisfies ReadonlyArray<keyof NoteContent>;

export const NOTE_FIELD_LABELS: Record<keyof NoteContent, string> = {
  supportTypes: "Support provided",
  support: "Support details",
  summary: "Shift summary",
  goals: "Goals worked on",
  outcome: "Progress towards goals",
  achievements: "Achievements and outcomes",
  health: "Health and wellbeing",
  healthDetails: "Health details",
  incident: "Incidents and behaviours of concern",
  incidentDetails: "Incident details",
  followUp: "Handover and follow-up",
};

export const EMPTY_NOTE: NoteContent = {
  supportTypes: [],
  support: "",
  summary: "",
  goals: [],
  outcome: "",
  achievements: "",
  health: [],
  healthDetails: "",
  incident: [],
  incidentDetails: "",
  followUp: "",
};

export const OTHER_SUPPORT = "Other support";
export const NO_HEALTH_CONCERNS: string = HEALTH_FLAGS[0];
export const NO_INCIDENT: string = INCIDENT_FLAGS[0];
/** The health options that need explaining and a team leader's eye. Medication support is routine. */
export const HEALTH_ALERTS: string[] = [HEALTH_FLAGS[1], HEALTH_FLAGS[3]];
export const INCIDENT_ALERTS: string[] = [INCIDENT_FLAGS[1], INCIDENT_FLAGS[2]];

const toggle = (
  current: string[],
  value: string,
  none: string,
  alerts: string[],
  order: readonly string[]
): string[] => {
  let next: string[];
  if (current.includes(value)) next = current.filter(item => item !== value);
  else if (value === none)
    next = [...current.filter(item => !alerts.includes(item)), none];
  else if (alerts.includes(value))
    next = [...current.filter(item => item !== none), value];
  else next = [...current, value];
  return order.filter(item => next.includes(item));
};

/** Ticking "No concerns" clears a concern or follow-up, and the other way round. */
export const toggleHealth = (current: string[], value: string) =>
  toggle(current, value, NO_HEALTH_CONCERNS, HEALTH_ALERTS, HEALTH_FLAGS);
/** Ticking "No incident" clears the other two, and the other way round. */
export const toggleIncident = (current: string[], value: string) =>
  toggle(current, value, NO_INCIDENT, INCIDENT_ALERTS, INCIDENT_FLAGS);

export const healthNeedsDetails = (flags: string[]) =>
  flags.some(flag => HEALTH_ALERTS.includes(flag));
export const incidentNeedsDetails = (flags: string[]) =>
  flags.some(flag => INCIDENT_ALERTS.includes(flag));

/** A note a team leader should look at: a health concern, a follow-up, an incident or a behaviour of concern. */
export const noteNeedsAttention = (
  note: Pick<NoteContent, "health" | "incident">
) => healthNeedsDetails(note.health) || incidentNeedsDetails(note.incident);

export interface NoteProblem {
  path: keyof NoteContent;
  message: string;
}

/** What still stops a note being submitted, in the order the form shows its sections. */
export function noteProblems(note: NoteContent): NoteProblem[] {
  const problems: NoteProblem[] = [];
  const blank = (value: string) => !value.trim();
  if (!note.supportTypes.length)
    problems.push({
      path: "supportTypes",
      message: "Tick at least one kind of support provided.",
    });
  if (note.supportTypes.includes(OTHER_SUPPORT) && blank(note.support))
    problems.push({
      path: "support",
      message: "Describe the other support provided.",
    });
  if (blank(note.summary))
    problems.push({ path: "summary", message: "Write the shift summary." });
  if (note.goals.length && blank(note.outcome))
    problems.push({
      path: "outcome",
      message: "Describe the progress towards the goals you selected.",
    });
  if (!note.health.length)
    problems.push({
      path: "health",
      message: "Choose a health and wellbeing option.",
    });
  else if (
    note.health.includes(NO_HEALTH_CONCERNS) &&
    healthNeedsDetails(note.health)
  )
    problems.push({
      path: "health",
      message: '"No concerns" cannot be ticked together with a concern.',
    });
  else if (healthNeedsDetails(note.health) && blank(note.healthDetails))
    problems.push({
      path: "healthDetails",
      message: "Describe the health concern or the follow-up needed.",
    });
  if (!note.incident.length)
    problems.push({
      path: "incident",
      message: "Choose an incident option.",
    });
  else if (
    note.incident.includes(NO_INCIDENT) &&
    incidentNeedsDetails(note.incident)
  )
    problems.push({
      path: "incident",
      message: '"No incident" cannot be ticked together with an incident.',
    });
  else if (incidentNeedsDetails(note.incident) && blank(note.incidentDetails))
    problems.push({
      path: "incidentDetails",
      message:
        "Briefly describe what happened. A separate incident report is still required.",
    });
  return problems;
}

export interface NoteChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

const shown = (value: string | string[]) =>
  Array.isArray(value) ? value.join(", ") : value.trim();

/** What an amendment changed, section by section, in words a reader can follow. */
export function noteChanges(
  before: NoteContent,
  after: NoteContent
): NoteChange[] {
  return NOTE_FIELDS.filter(
    field => shown(before[field]) !== shown(after[field])
  ).map(field => ({
    field,
    label: NOTE_FIELD_LABELS[field],
    before: shown(before[field]),
    after: shown(after[field]),
  }));
}
