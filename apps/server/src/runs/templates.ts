import type { Template } from "@ariadne/shared";

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "research-brief",
    name: "Research Brief",
    description:
      "Generate a source-backed research brief from notes, papers, and readings in a local folder.",
    builtin: true,
    inputs: [
      {
        key: "topic",
        type: "string",
        label: "Research Topic",
        required: true,
        placeholder: "e.g. Site-specificity in contemporary art",
      },
      {
        key: "audience",
        type: "string",
        label: "Intended Audience",
        required: false,
        default: "General academic reader",
        placeholder: "e.g. Undergraduate students",
      },
      {
        key: "goal",
        type: "text",
        label: "Goal or Question",
        required: false,
        placeholder: "What should the brief answer or demonstrate?",
      },
    ],
    outputContract: {
      sections: [
        "summary",
        "key_findings",
        "evidence_backed_claims",
        "risks_uncertainties",
        "unsupported_claims",
        "missing_information",
        "next_actions",
        "sources_used",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: true,
    rerunDiffRequired: true,
    promptHint:
      "Focus on accuracy and source grounding. Flag any claim that cannot be directly tied to a selected file.",
  },

  {
    id: "lecture-brief",
    name: "Lecture Brief",
    description: "Generate a source-backed lecture preparation brief from course notes and readings.",
    builtin: true,
    inputs: [
      {
        key: "topic",
        type: "string",
        label: "Lecture Topic",
        required: true,
        placeholder: "e.g. New media sculpture and site-specificity",
      },
      {
        key: "duration",
        type: "string",
        label: "Duration",
        required: false,
        default: "90 minutes",
        placeholder: "e.g. 60 minutes",
      },
      {
        key: "audience",
        type: "string",
        label: "Audience",
        required: false,
        default: "Undergraduate students",
        placeholder: "e.g. Graduate seminar",
      },
    ],
    outputContract: {
      sections: [
        "summary",
        "learning_objectives",
        "key_concepts",
        "lecture_flow",
        "evidence_backed_claims",
        "unsupported_claims",
        "missing_information",
        "next_actions",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: true,
    rerunDiffRequired: true,
    promptHint:
      "Structure the output as a lecture plan. Identify concepts that lack source support.",
  },

  {
    id: "investment-decision-memo",
    name: "Investment Decision Memo",
    description:
      "Generate a structured investment decision memo from research notes, financials, and market data.",
    builtin: true,
    inputs: [
      {
        key: "subject",
        type: "string",
        label: "Investment Subject",
        required: true,
        placeholder: "e.g. Company X Series B round",
      },
      {
        key: "thesis",
        type: "text",
        label: "Investment Thesis",
        required: false,
        placeholder: "Why might this be a good investment?",
      },
      {
        key: "horizon",
        type: "string",
        label: "Investment Horizon",
        required: false,
        default: "3–5 years",
        placeholder: "e.g. 12 months",
      },
    ],
    outputContract: {
      sections: [
        "executive_summary",
        "opportunity_overview",
        "evidence_backed_strengths",
        "risks_and_weaknesses",
        "unsupported_assumptions",
        "missing_data",
        "decision_recommendation",
        "sources_used",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: true,
    rerunDiffRequired: true,
    promptHint:
      "Use conservative language for claims not directly supported by the selected files. Separate opinion from evidence.",
  },

  {
    id: "job-search-review",
    name: "Job Search Review",
    description:
      "Summarise and evaluate job applications, role matches, and outreach progress from local folder notes.",
    builtin: true,
    inputs: [
      {
        key: "goal",
        type: "string",
        label: "Job Search Goal",
        required: true,
        placeholder: "e.g. Senior product manager roles in fintech",
      },
      {
        key: "period",
        type: "string",
        label: "Review Period",
        required: false,
        default: "Last 30 days",
        placeholder: "e.g. Q1 2026",
      },
    ],
    outputContract: {
      sections: [
        "summary",
        "applications_status",
        "top_opportunities",
        "patterns_and_gaps",
        "unsupported_claims",
        "next_actions",
        "sources_used",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: false,
    rerunDiffRequired: true,
    promptHint:
      "Be factual about application status. Do not infer outcomes not recorded in the notes.",
  },

  {
    id: "source-audit",
    name: "Source Audit",
    description:
      "Audit a set of files for source quality, coverage gaps, and citation completeness.",
    builtin: true,
    inputs: [
      {
        key: "scope",
        type: "string",
        label: "Audit Scope",
        required: true,
        placeholder: "e.g. All readings in /research/papers/",
      },
      {
        key: "criteria",
        type: "text",
        label: "Quality Criteria",
        required: false,
        placeholder: "e.g. Peer-reviewed, post-2015, primary sources preferred",
      },
    ],
    outputContract: {
      sections: [
        "summary",
        "source_inventory",
        "coverage_assessment",
        "weak_sources",
        "missing_source_types",
        "unsupported_claims",
        "recommendations",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: true,
    rerunDiffRequired: false,
    promptHint:
      "Focus on coverage and credibility. List files that lack proper attribution.",
  },
];

export function getTemplate(id: string): Template | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
