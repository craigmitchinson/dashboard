import type {
  Roadmap,
  DependenciesBoard,
  Dependency,
  DepStatus,
  DepOrigin,
  Org,
  DeliveryBoard,
  ObjectivesBoard,
  SummaryBoard,
} from "./types";

// Org identity, shared across every slide and quarter: Platform > Lab > Team.
export const seedOrg: Org = {
  platform: "Customer Platform",
  lab: "Onboarding Lab",
};

// Placeholder seed data in the domain of customer-facing process automation.
// Branch depths are deliberately uneven: some themes carry many features, others
// only a couple, to prove the vertical alignment holds for an irregular tree.
// The words are placeholder and editable in the UI. UK English, no em dashes.

let counter = 0;
const id = (prefix: string) => `${prefix}-${(counter += 1)}`;

// A feature takes one or more value statements; pass several to demonstrate a
// feature spanning multiple value rows. Optionally lead with a Jira ref via
// featureRef(...) to show the reference slot populated.
const feature = (text: string, ...values: string[]) => ({
  id: id("f"),
  text,
  values: values.map((v) => ({ id: id("v"), text: v })),
});
const featureRef = (ref: string, text: string, ...values: string[]) => ({
  ...feature(text, ...values),
  ref,
});

export const seedRoadmap: Roadmap = {
  meta: {
    title: "Customer-facing process automation",
  },
  themes: [
    {
      id: id("t"),
      text: "Getting customers online",
      outcomes: [
        {
          id: id("o"),
          text: "Digital-first onboarding",
          ref: "ONB-100",
          epics: [
            {
              id: id("e"),
              text: "Self-serve sign-up",
              ref: "ONB-110",
              features: [
                featureRef(
                  "ONB-111",
                  "Guided account creation",
                  "Cuts sign-up time from days to minutes",
                  "Lifts completion rate on mobile",
                ),
                feature(
                  "Identity verification",
                  "Removes manual document checks",
                ),
                feature(
                  "Progress save and resume",
                  "Fewer drop-offs mid-application",
                ),
              ],
            },
            {
              id: id("e"),
              text: "Welcome journey",
              features: [
                feature(
                  "Automated welcome emails",
                  "Sets expectations without agent effort",
                ),
                feature("In-product checklist", "Faster time to first value"),
              ],
            },
          ],
        },
        {
          id: id("o"),
          text: "Channel migration",
          epics: [
            {
              id: id("e"),
              text: "Move calls to web",
              features: [
                feature("Deflection prompts", "Reduces inbound call volume"),
              ],
            },
          ],
        },
      ],
    },
    {
      id: id("t"),
      text: "Removing manual handovers",
      outcomes: [
        {
          id: id("o"),
          text: "Straight-through processing",
          ref: "STP-200",
          epics: [
            {
              id: id("e"),
              text: "Rules engine",
              ref: "STP-210",
              features: [
                feature(
                  "Configurable decision rules",
                  "No code change per policy",
                  "Faster reaction to regulatory shifts",
                ),
                feature("Auto-approval thresholds", "Instant decisions on low risk"),
                feature("Exception routing", "Only edge cases reach a human"),
                feature("Full audit trail", "Compliance evidence by default"),
              ],
            },
            {
              id: id("e"),
              text: "Case orchestration",
              features: [
                feature("Task auto-assignment", "Work lands with the right team"),
                feature("SLA timers", "Nothing stalls unnoticed"),
              ],
            },
          ],
        },
      ],
    },
    {
      id: id("t"),
      text: "Proactive customer comms",
      outcomes: [
        {
          id: id("o"),
          text: "Status transparency",
          epics: [
            {
              id: id("e"),
              text: "Live tracking",
              features: [
                feature(
                  "Real-time status page",
                  "Fewer where-is-it enquiries",
                  "Builds trust through transparency",
                ),
                feature("Milestone notifications", "Customers feel informed"),
              ],
            },
          ],
        },
        {
          id: id("o"),
          text: "Smart reminders",
          epics: [
            {
              id: id("e"),
              text: "Nudge engine",
              features: [
                feature("Action-needed alerts", "Keeps cases moving"),
              ],
            },
          ],
        },
      ],
    },
    {
      id: id("t"),
      text: "Faster issue resolution",
      outcomes: [
        {
          id: id("o"),
          text: "Self-healing support",
          epics: [
            {
              id: id("e"),
              text: "Assisted diagnostics",
              features: [
                feature("Guided troubleshooting", "Resolves common faults unaided"),
                feature("Knowledge suggestions", "Right answer surfaced in context"),
                feature("One-click escalation", "Smooth handoff when needed"),
              ],
            },
          ],
        },
      ],
    },
    {
      id: id("t"),
      text: "Trust by design",
      outcomes: [
        {
          id: id("o"),
          text: "Consent and data control",
          epics: [
            {
              id: id("e"),
              text: "Preference centre",
              features: [
                feature("Granular consent toggles", "Meets data obligations"),
              ],
            },
          ],
        },
      ],
    },
  ],
};

// --- Dependencies slide seed ---------------------------------------------

const dep = (
  status: DepStatus,
  origin: DepOrigin,
  text: string,
): Dependency => ({ id: id("d"), status, origin, text });

export const seedDependencies: DependenciesBoard = {
  title: "Cross-team dependencies",
  current: [
    dep("committed", "existing", "Payments SDK upgrade from Payments"),
    dep("committed", "incoming", "Identity service API from Platform"),
    dep("not-committed", "incoming", "Design system tokens from Brand"),
    dep("not-committed", "existing", "Data warehouse access from Data Engineering"),
    dep("blocked", "existing", "Legacy CRM decommission from IT Operations"),
    dep("blocked", "incoming", "Consent service from Privacy"),
  ],
  next: [
    dep("committed", "incoming", "Notifications platform from Messaging"),
    dep("not-committed", "incoming", "ML scoring service from Data Science"),
    dep("not-committed", "existing", "Mobile app shell from Apps"),
    dep("blocked", "incoming", "Single sign-on from Security"),
  ],
  escalations: [
    {
      id: id("x"),
      text: "Privacy review for the consent service is slipping. Need a go or no-go decision by month end.",
    },
    {
      id: id("x"),
      text: "Payments SDK owner is on leave for three weeks, putting the committed date at risk.",
    },
    {
      id: id("x"),
      text: "Funding for the ML scoring service is unconfirmed, so it stays not committed for now.",
    },
  ],
  risks: [
    {
      id: id("r"),
      severity: "high",
      text: "Consent service has no owner assigned and is blocking go-live.",
    },
    {
      id: id("r"),
      severity: "medium",
      text: "Single sign-on timeline depends on Security team hiring.",
    },
    {
      id: id("r"),
      severity: "low",
      text: "Design token delay is cosmetic only; a workaround exists.",
    },
  ],
};

// Fresh, empty content for a quarter that has not been populated yet. Each
// quarter holds its own roadmap and dependencies, so a new quarter starts blank.
export const emptyRoadmap = (): Roadmap => ({
  meta: { title: "Add a roadmap title" },
  themes: [],
});

export const emptyBoard = (): DependenciesBoard => ({
  title: "Cross-team dependencies",
  current: [],
  next: [],
  escalations: [],
  risks: [],
});

// --- Delivery slide seed --------------------------------------------------

const highlight = (team: string, text: string) => ({ id: id("h"), team, text });

export const emptyDelivery = (): DeliveryBoard => ({
  title: "Delivery",
  metrics: { committed: 0, delivered: 0, committedDelivered: 0, throughput: 0 },
  highlights: [],
});

// Delivery is keyed by quarter so the slide can show a three-quarter trend. The
// selected (current) quarter has commitments but little delivered yet.
export const seedDelivery: Record<string, DeliveryBoard> = {
  "2026-Q1": {
    title: "Delivery",
    metrics: { committed: 18, delivered: 15, committedDelivered: 13, throughput: 22 },
    highlights: [
      highlight("Payments", "Shipped SDK v2 and migrated 70% of callers."),
      highlight("Platform", "Delivered the identity service ahead of plan."),
    ],
  },
  "2026-Q2": {
    title: "Delivery",
    metrics: { committed: 20, delivered: 17, committedDelivered: 15, throughput: 25 },
    highlights: [
      highlight("Onboarding", "Launched self-serve sign-up to all segments."),
      highlight("Data Engineering", "Opened warehouse access for analytics."),
    ],
  },
  "2026-Q3": {
    title: "Delivery",
    metrics: { committed: 22, delivered: 0, committedDelivered: 0, throughput: 0 },
    highlights: [
      highlight("Messaging", "Notifications platform entered integration testing."),
    ],
  },
};

// --- Objectives slide seed ------------------------------------------------

const kr = (text: string, metric: string, status: ObjectivesBoard["objectives"][number]["status"]) => ({
  id: id("k"),
  text,
  metric,
  status,
});

export const emptyObjectives = (): ObjectivesBoard => ({
  title: "Objectives and key results",
  objectives: [],
});

export const seedObjectives: Record<string, ObjectivesBoard> = {
  "2026-Q3": {
    title: "Objectives and key results",
    objectives: [
      {
        id: id("ob"),
        text: "Make onboarding self-serve",
        status: "on-track",
        keyResults: [
          kr("Self-serve sign-up live for all segments", "Live", "on-track"),
          kr("Time to first value", "3 days vs 1 day target", "at-risk"),
        ],
      },
      {
        id: id("ob"),
        text: "Cut cost to serve",
        status: "at-risk",
        keyResults: [
          kr("Automation rate", "62% vs 70% target", "at-risk"),
          kr("Manual handovers removed", "8 of 12", "on-track"),
        ],
      },
      {
        id: id("ob"),
        text: "Trust and compliance by design",
        status: "off-track",
        keyResults: [
          kr("Consent service live", "Blocked on Privacy", "off-track"),
          kr("Audit trail coverage", "100%", "on-track"),
        ],
      },
    ],
  },
};

// --- Summary slide seed ---------------------------------------------------

export const emptySummary = (): SummaryBoard => ({
  title: "Quarter in review",
  headline: "Add the headline story for this quarter.",
  asks: [],
});

export const seedSummary: Record<string, SummaryBoard> = {
  "2026-Q3": {
    title: "Quarter in review",
    headline:
      "Onboarding is now self-serve and automation is climbing, but cost-to-serve and the consent service need leadership attention this quarter.",
    asks: [
      { id: id("a"), owner: "Security", text: "Decision on consent service go or no-go by month end." },
      { id: id("a"), owner: "Data Engineering", text: "Confirm funding for the ML scoring service." },
      { id: id("a"), owner: "Platform", text: "Prioritise single sign-on to unblock Q4 delivery." },
    ],
  },
};
