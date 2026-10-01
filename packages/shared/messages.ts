/** User-facing validation messages shared by the API and the UI so both say exactly the same thing. */
export const MESSAGES = {
  ndis: "Enter the 9-digit NDIS number.",
  ndisDuplicate: "A participant with this NDIS number already exists.",
  planDates: "The plan end date must be on or after the start date.",
  password: (min: number) =>
    `Choose a password with at least ${min} characters.`,
  passwordMismatch: "The passwords do not match.",
  email: "Enter a valid email address.",
  serviceName: "Enter a service name.",
  serviceNameExists: "A service with this name already exists.",
  serviceRate: "Enter a valid non-negative rate.",
  serviceCategory: "Choose a budget category.",
  declaration: "Please confirm the staff declaration before submitting.",
  incompleteNote: "Complete all progress note sections before submitting.",
  recordDuration: "Choose a shift end time later than the start time.",
  recordTransport:
    "This service does not allow transport. Remove the kilometres or choose a service that allows transport.",
  returnReason: "Explain what needs to change.",
  noInvoiceRecords: "Select at least one approved service record.",
  shiftTimes: "Choose a date and an end time later than the start time.",
  shiftRatio11:
    "A 1:1 shift requires exactly one participant and one staff member.",
  shiftRatio1M:
    "A 1:M shift requires one staff member and at least two participants.",
  shiftRatioMM:
    "An M:M shift requires at least two staff members and two participants.",
  shiftAssignment:
    "Assign at least one participant and one available staff member.",
  shiftParticipantOverlap: (id: string) =>
    `A participant is already rostered during this time (${id}). Resolve the overlap before saving.`,
  shiftStaffOverlap: (id: string) =>
    `A staff member is already assigned during this time (${id}). Resolve the overlap before saving.`,
  budgetDates: "Choose a valid plan start and end date.",
  budgetConfirm:
    "Confirm the amounts against the approved client plan before saving.",
  budgetPositive: "Enter at least one positive category allocation.",
  budgetAmount: "Enter a valid non-negative allocation amount.",
  budgetReason: "Add a reason for this allocation change.",
  staleVersion: "This record was changed elsewhere. Reload and try again.",
  transcriptRequired:
    "Transcribe the recording (or add a transcript) before generating a draft.",
  generationSections: "Choose at least one section to generate.",
  applicationDuplicate:
    "An application with this email address is already waiting for review.",
  applicationReviewed: "This application has already been reviewed.",
  staffAccountExists: (email: string) =>
    `${email} already has portal access. Use "Reset access" to send a new link.`,
  staffInactive:
    "This team member is not active. Set them back to Active in the directory first.",
  expiryRequired: (label: string) =>
    `Add the expiry date shown on the ${label.toLowerCase()}.`,
  emergencyContact: "Add at least one emergency contact.",
  trackingRunning:
    "A job is already being tracked. Finish it before starting another.",
  trackingNotRunning:
    "This job is not being tracked. Start it from the shift screen.",
  locationPermission:
    "Location access is off. Turn it on for this site so the job can be tracked.",
  reportLocked: (status: string) =>
    `This report is ${status.toLowerCase()} and can no longer be edited.`,
} as const;
